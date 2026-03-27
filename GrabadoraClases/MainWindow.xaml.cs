using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Channels;
using System.Windows;
using System.Windows.Threading;
using NAudio.Wave;
using Whisper.net;
using Whisper.net.Ggml;

namespace GrabadoraClases;

public partial class MainWindow : Window
{
    // ── State ──────────────────────────────────────────────────────────────────
    private AppSettings _settings = AppSettings.Load();
    private bool _isRecording;
    private string? _currentRecordingPath;

    // Recording hardware
    private WaveInEvent? _waveIn;
    private WaveFileWriter? _waveWriter;
    private DispatcherTimer? _clockTimer;
    private int _recordSeconds;

    // Real-time transcription pipeline
    private readonly List<short> _recordBuffer = new();
    private readonly object _bufferLock = new();
    private DispatcherTimer? _chunkTimer;
    private Channel<(short[] samples, bool isLast)>? _chunkChannel;
    private Task<(string text, string language)>? _rtTask;
    private readonly StringBuilder _liveTranscription = new();
    private string _prevContext = "";

    // Batch mode
    private CancellationTokenSource? _batchCts;

    private static readonly HttpClient _http = new();

    // Seconds of audio per real-time chunk (longer = better accuracy but more delay)
    private const int ChunkSeconds = 15;

    // ── Language map ──────────────────────────────────────────────────────────
    private static readonly Dictionary<string, string> LangNames = new()
    {
        ["en"] = "inglés", ["fr"] = "francés", ["de"] = "alemán", ["it"] = "italiano",
        ["pt"] = "portugués", ["zh"] = "chino", ["ja"] = "japonés", ["ko"] = "coreano",
        ["ar"] = "árabe", ["ru"] = "ruso", ["nl"] = "neerlandés", ["pl"] = "polaco",
        ["tr"] = "turco", ["sv"] = "sueco", ["da"] = "danés", ["fi"] = "finlandés",
        ["ca"] = "catalán", ["eu"] = "euskera", ["gl"] = "gallego", ["es"] = "español"
    };

    // ── History item ──────────────────────────────────────────────────────────
    private class HistoryItem
    {
        public string FilePath { get; set; } = "";
        public string DisplayName { get; set; } = "";
        public string Date { get; set; } = "";
        public string Language { get; set; } = "";
    }

    public MainWindow()
    {
        InitializeComponent();
        LoadHistory();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  RECORDING — REAL-TIME PIPELINE
    // ═══════════════════════════════════════════════════════════════════════════

    private async void RecordButton_Click(object sender, RoutedEventArgs e)
    {
        // Disable UI immediately
        RecordButton.IsEnabled = false;
        OpenFileButton.IsEnabled = false;

        // Ensure model is ready before starting
        string modelPath;
        try
        {
            SetStatus("Cargando modelo Whisper...", "#F9E2AF");
            modelPath = await EnsureModelAsync(CancellationToken.None);
        }
        catch (Exception ex)
        {
            SetStatus($"Error cargando modelo: {ex.Message}", "#F38BA8");
            RecordButton.IsEnabled = true;
            OpenFileButton.IsEnabled = true;
            return;
        }

        // Prepare output file
        Directory.CreateDirectory(_settings.OutputDir);
        var timestamp = DateTime.Now.ToString("yyyyMMdd_HHmmss");
        _currentRecordingPath = Path.Combine(_settings.OutputDir, $"clase_{timestamp}.wav");

        // Reset live transcription state
        _liveTranscription.Clear();
        _prevContext = "";

        // Set up processing channel + start background task
        _chunkChannel = Channel.CreateBounded<(short[], bool)>(capacity: 8);
        _rtTask = ProcessChunksAsync(modelPath, _chunkChannel.Reader);

        // Set up NAudio recording
        try
        {
            _waveIn = new WaveInEvent
            {
                WaveFormat = new WaveFormat(16000, 16, 1),
                BufferMilliseconds = 50
            };
            _waveWriter = new WaveFileWriter(_currentRecordingPath, _waveIn.WaveFormat);
            _waveIn.DataAvailable += OnAudioData;
            _waveIn.StartRecording();
        }
        catch (Exception ex)
        {
            _chunkChannel.Writer.TryComplete();
            SetStatus($"Error abriendo micrófono: {ex.Message}", "#F38BA8");
            RecordButton.IsEnabled = true;
            OpenFileButton.IsEnabled = true;
            return;
        }

        _isRecording = true;

        // Chunk timer: every ChunkSeconds extract buffer and queue for transcription
        _chunkTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(ChunkSeconds) };
        _chunkTimer.Tick += async (s, ev) => await ExtractAndQueueChunkAsync(isLast: false);
        _chunkTimer.Start();

        // Clock timer for elapsed time display
        _recordSeconds = 0;
        _clockTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _clockTimer.Tick += (s, ev) =>
        {
            _recordSeconds++;
            TimeText.Text = $"⏺  {_recordSeconds / 60:D2}:{_recordSeconds % 60:D2}";
        };
        _clockTimer.Start();

        // Reset UI for new recording
        SummaryText.Text = "(el resumen aparecerá al detener la grabación)";
        TranscriptionText.Text = "";
        OriginalTab.Visibility = Visibility.Collapsed;
        InfoBar.Visibility = Visibility.Collapsed;
        StopButton.IsEnabled = true;

        SetStatus($"⏺  Grabando — transcripción en tiempo real cada {ChunkSeconds}s", "#F38BA8");
    }

    private void OnAudioData(object? sender, WaveInEventArgs e)
    {
        // Save to WAV file
        _waveWriter?.Write(e.Buffer, 0, e.BytesRecorded);

        // Accumulate in buffer for real-time processing
        lock (_bufferLock)
        {
            for (int i = 0; i < e.BytesRecorded - 1; i += 2)
                _recordBuffer.Add(BitConverter.ToInt16(e.Buffer, i));
        }
    }

    private async Task ExtractAndQueueChunkAsync(bool isLast)
    {
        short[] chunk;
        lock (_bufferLock)
        {
            if (_recordBuffer.Count < 16000) return; // skip if < 1 second of audio
            chunk = _recordBuffer.ToArray();
            _recordBuffer.Clear();
        }

        if (_chunkChannel != null)
            await _chunkChannel.Writer.WriteAsync((chunk, isLast));
    }

    private async void StopButton_Click(object sender, RoutedEventArgs e)
    {
        if (!_isRecording) return;

        _chunkTimer?.Stop();
        _clockTimer?.Stop();
        _isRecording = false;

        StopButton.IsEnabled = false;
        TimeText.Text = "";

        // Stop hardware
        _waveIn?.StopRecording();
        _waveIn?.Dispose();
        _waveIn = null;
        _waveWriter?.Flush();
        _waveWriter?.Dispose();
        _waveWriter = null;

        // Flush remaining buffer as last chunk, then close channel
        await ExtractAndQueueChunkAsync(isLast: true);
        _chunkChannel?.Writer.TryComplete();

        // Wait for all transcription chunks to finish
        SetStatus("Finalizando transcripción...", "#F9E2AF");
        ShowOverlay("Finalizando transcripción...", "Procesando últimos fragmentos de audio");

        var (fullText, language) = await (_rtTask ?? Task.FromResult(("", "es")));

        if (string.IsNullOrWhiteSpace(fullText))
        {
            HideOverlay();
            SetStatus("No se detectó audio transcribible.", "#F9E2AF");
            RecordButton.IsEnabled = true;
            OpenFileButton.IsEnabled = true;
            return;
        }

        var langName = LangNames.GetValueOrDefault(language, language);

        // Translate if needed
        string? translation = null;
        string textForSummary = fullText;

        if (language != "es" && _settings.AutoTranslate && !string.IsNullOrEmpty(_settings.ApiKey))
        {
            SetOverlay("Traduciendo...", $"Del {langName} al español");
            translation = await TranslateAsync(fullText, langName, CancellationToken.None);
            if (translation != null) textForSummary = translation;
        }

        // Summarize
        string summary;
        if (!string.IsNullOrEmpty(_settings.ApiKey))
        {
            SetOverlay("Generando resumen...", "Claude IA está resumiendo la clase");
            summary = await SummarizeAsync(textForSummary, CancellationToken.None);
        }
        else
        {
            summary = "[Resumen no disponible: configura ANTHROPIC_API_KEY en ⚙ Configuración]";
        }

        // Save markdown
        var mdPath = SaveMarkdown(_currentRecordingPath!, fullText, summary, language, langName, translation);

        // Update UI
        SummaryText.Text = summary;
        TranscriptionText.Text = translation ?? fullText;

        if (translation != null)
        {
            OriginalTab.Visibility = Visibility.Visible;
            OriginalText.Text = fullText;
        }

        var fi = new FileInfo(_currentRecordingPath!);
        InfoFileName.Text = $"📄 {fi.Name}";
        InfoLanguage.Text = $"🌐 {langName} ({language})";
        var secs = _recordSeconds;
        InfoDuration.Text = $"⏱ {secs / 60}:{secs % 60:D2}";
        InfoBar.Visibility = Visibility.Visible;

        ResultTabs.SelectedIndex = 0;
        HideOverlay();
        SetStatus($"✓ Guardado: {Path.GetFileName(mdPath)}", "#A6E3A1");
        RecordButton.IsEnabled = true;
        OpenFileButton.IsEnabled = true;
        LoadHistory();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  REAL-TIME CHUNK PROCESSOR
    // ═══════════════════════════════════════════════════════════════════════════

    private async Task<(string text, string language)> ProcessChunksAsync(
        string modelPath, ChannelReader<(short[] samples, bool isLast)> reader)
    {
        var fullText = new StringBuilder();
        string detectedLang = "es";
        int chunkIndex = 0;

        using var factory = WhisperFactory.FromPath(modelPath);

        await foreach (var (samples, isLast) in reader.ReadAllAsync())
        {
            if (samples.Length < 8000) continue; // skip very short fragments

            chunkIndex++;
            Dispatcher.Invoke(() =>
                SetStatus($"⏺  Transcribiendo fragmento {chunkIndex}...", "#F9E2AF"));

            var tempWav = PreprocessSamplesToTempWav(samples);
            try
            {
                var builder = factory.CreateBuilder().WithLanguage("auto");

                // Pass last ~150 chars of previous text as context for continuity
                var context = string.IsNullOrEmpty(_prevContext)
                    ? _settings.InitialPrompt
                    : _prevContext;
                if (!string.IsNullOrWhiteSpace(context))
                    builder = builder.WithPrompt(context);

                using var processor = builder.Build();
                var sb = new StringBuilder();
                string? lang = null;

                using var stream = File.OpenRead(tempWav);
                await foreach (var segment in processor.ProcessAsync(stream))
                {
                    var text = CleanWhisperText(segment.Text ?? "");
                    if (!string.IsNullOrWhiteSpace(text))
                        sb.Append(text).Append(' ');
                    lang ??= segment.Language;
                }

                var chunkText = sb.ToString().Trim();
                if (lang != null) detectedLang = lang;

                if (!string.IsNullOrWhiteSpace(chunkText))
                {
                    fullText.Append(chunkText).Append(' ');

                    // Keep last 150 chars as context for next chunk
                    var full = fullText.ToString().Trim();
                    _prevContext = full.Length > 150 ? full[^150..] : full;

                    Dispatcher.Invoke(() =>
                    {
                        TranscriptionText.Text = full;
                        // Scroll to bottom
                        TranscriptionText.ScrollToEnd();
                        SetStatus($"⏺  Grabando — fragmento {chunkIndex} transcrito", "#F38BA8");
                    });
                }
            }
            catch (Exception ex)
            {
                Dispatcher.Invoke(() =>
                    SetStatus($"⚠  Error en fragmento {chunkIndex}: {ex.Message}", "#F38BA8"));
            }
            finally
            {
                TryDelete(tempWav);
            }
        }

        return (fullText.ToString().Trim(), detectedLang);
    }

    private string PreprocessSamplesToTempWav(short[] rawSamples)
    {
        // Convert short PCM → float
        var floats = new float[rawSamples.Length];
        for (int i = 0; i < rawSamples.Length; i++)
            floats[i] = rawSamples[i] / 32768f;

        // Same preprocessing as batch mode
        floats = ApplyHighPassFilter(floats, 80f, 16000);
        var gainLinear = MathF.Pow(10f, _settings.GainDb / 20f);
        floats = NormalizeRms(floats, 0.08f, gainLinear);

        // Write temp 16kHz 16-bit mono WAV
        var tempPath = Path.Combine(Path.GetTempPath(), $"grab_{Guid.NewGuid():N}.wav");
        var format = new WaveFormat(16000, 16, 1);
        using var writer = new WaveFileWriter(tempPath, format);
        var bytes = new byte[floats.Length * 2];
        for (int i = 0; i < floats.Length; i++)
        {
            var pcm = (short)(Math.Clamp(floats[i], -0.95f, 0.95f) * 32767f);
            bytes[i * 2]     = (byte)(pcm & 0xFF);
            bytes[i * 2 + 1] = (byte)((pcm >> 8) & 0xFF);
        }
        writer.Write(bytes, 0, bytes.Length);
        return tempPath;
    }

    private static string CleanWhisperText(string text)
    {
        return Regex.Replace(text,
            @"\[(music|blank_audio|silencio|noise|BLANK_AUDIO|Music|MUSIC)\]",
            "", RegexOptions.IgnoreCase).Trim();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  OPEN FILE — BATCH PIPELINE (unchanged)
    // ═══════════════════════════════════════════════════════════════════════════

    private async void OpenFileButton_Click(object sender, RoutedEventArgs e)
    {
        var dlg = new Microsoft.Win32.OpenFileDialog
        {
            Title = "Seleccionar archivo de audio",
            Filter = "Audio|*.wav;*.mp3;*.m4a;*.flac;*.ogg;*.aac|Todos los archivos|*.*"
        };
        if (dlg.ShowDialog() != true) return;

        RecordButton.IsEnabled = false;
        OpenFileButton.IsEnabled = false;
        await ProcessAudioFileAsync(dlg.FileName);
        RecordButton.IsEnabled = true;
        OpenFileButton.IsEnabled = true;
    }

    private async Task ProcessAudioFileAsync(string audioPath)
    {
        _batchCts?.Cancel();
        _batchCts = new CancellationTokenSource();
        var ct = _batchCts.Token;

        ShowOverlay("Preparando...", "Cargando modelo de transcripción");
        SetProgress(5);

        try
        {
            var modelPath = await EnsureModelAsync(ct);
            if (ct.IsCancellationRequested) return;

            SetOverlay("Preprocesando audio...", "Filtro de ruido y normalización");
            SetProgress(15);
            var processedWav = await Task.Run(() => PreprocessAudio(audioPath), ct);

            SetOverlay("Transcribiendo...", "Puede tardar unos minutos según la duración");
            SetProgress(30);
            var (transcription, language) = await TranscribeAsync(processedWav, modelPath, ct);
            TryDelete(processedWav);
            if (ct.IsCancellationRequested) return;

            var langName = LangNames.GetValueOrDefault(language, language);

            string? translation = null;
            string textForSummary = transcription;

            if (language != "es" && _settings.AutoTranslate && !string.IsNullOrEmpty(_settings.ApiKey))
            {
                SetOverlay("Traduciendo...", $"Del {langName} al español");
                SetProgress(60);
                translation = await TranslateAsync(transcription, langName, ct);
                if (translation != null) textForSummary = translation;
            }

            string summary;
            if (!string.IsNullOrEmpty(_settings.ApiKey))
            {
                SetOverlay("Generando resumen...", "Claude IA está resumiendo la clase");
                SetProgress(80);
                summary = await SummarizeAsync(textForSummary, ct);
            }
            else
            {
                summary = "[Resumen no disponible: configura ANTHROPIC_API_KEY en ⚙ Configuración]";
            }

            SetProgress(95);
            var mdPath = SaveMarkdown(audioPath, transcription, summary, language, langName, translation);

            SummaryText.Text = summary;
            TranscriptionText.Text = translation ?? transcription;

            if (translation != null)
            {
                OriginalTab.Visibility = Visibility.Visible;
                OriginalText.Text = transcription;
            }
            else
            {
                OriginalTab.Visibility = Visibility.Collapsed;
            }

            var fi = new FileInfo(audioPath);
            InfoFileName.Text = $"📄 {fi.Name}";
            InfoLanguage.Text = $"🌐 {langName} ({language})";
            var secs = fi.Length / (16000 * 2);
            InfoDuration.Text = $"⏱ {secs / 60}:{secs % 60:D2}";
            InfoBar.Visibility = Visibility.Visible;

            ResultTabs.SelectedIndex = 0;
            HideOverlay();
            SetProgress(100);
            SetStatus($"✓ Procesado: {fi.Name}  →  {Path.GetFileName(mdPath)}", "#A6E3A1");
            LoadHistory();
        }
        catch (OperationCanceledException)
        {
            HideOverlay();
            SetStatus("Cancelado", "#F9E2AF");
        }
        catch (Exception ex)
        {
            HideOverlay();
            SetStatus($"Error: {ex.Message}", "#F38BA8");
            MessageBox.Show($"Error procesando el audio:\n\n{ex.Message}", "Error",
                MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally
        {
            SetProgress(0);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  WHISPER MODEL
    // ═══════════════════════════════════════════════════════════════════════════

    internal static readonly string ModelsDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "GrabadoraClases", "models");

    private async Task<string> EnsureModelAsync(CancellationToken ct)
    {
        Directory.CreateDirectory(ModelsDir);

        var modelName = _settings.WhisperModel switch
        {
            "tiny"   => "ggml-tiny.bin",
            "base"   => "ggml-base.bin",
            "small"  => "ggml-small-q5_1.bin",
            "medium" => "ggml-medium-q5_0.bin",
            _        => "ggml-small-q5_1.bin"
        };
        var modelPath = Path.Combine(ModelsDir, modelName);
        if (File.Exists(modelPath)) return modelPath;

        SetOverlay("Descargando modelo Whisper...", $"Primera vez: descargando {modelName}");

        var (ggmlType, quantType) = _settings.WhisperModel switch
        {
            "tiny"   => (GgmlType.Tiny,   QuantizationType.NoQuantization),
            "base"   => (GgmlType.Base,   QuantizationType.NoQuantization),
            "medium" => (GgmlType.Medium, QuantizationType.Q5_0),
            _        => (GgmlType.Small,  QuantizationType.Q5_1)
        };

        using var modelStream = await WhisperGgmlDownloader.GetGgmlModelAsync(ggmlType, quantType, ct);
        using var fileStream = File.OpenWrite(modelPath);
        await modelStream.CopyToAsync(fileStream, ct);
        HideOverlay();
        return modelPath;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  AUDIO PREPROCESSING (batch mode)
    // ═══════════════════════════════════════════════════════════════════════════

    private string PreprocessAudio(string inputPath)
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"grabadora_{Guid.NewGuid():N}.wav");

        float[] samples;
        int sampleRate;

        using (var reader = new AudioFileReader(inputPath))
        {
            sampleRate = reader.WaveFormat.SampleRate;
            var list = new List<float>();
            var buf = new float[reader.WaveFormat.SampleRate * reader.WaveFormat.Channels];
            int read;
            while ((read = reader.Read(buf, 0, buf.Length)) > 0)
            {
                if (reader.WaveFormat.Channels == 2)
                    for (int i = 0; i < read; i += 2)
                        list.Add((buf[i] + buf[i + 1]) * 0.5f);
                else
                    for (int i = 0; i < read; i++)
                        list.Add(buf[i]);
            }
            samples = list.ToArray();
        }

        if (sampleRate != 16000)
            samples = Resample(samples, sampleRate, 16000);

        samples = ApplyHighPassFilter(samples, 80f, 16000);
        var gainLinear = MathF.Pow(10f, _settings.GainDb / 20f);
        samples = NormalizeRms(samples, 0.08f, gainLinear);

        var format = new WaveFormat(16000, 16, 1);
        using var writer = new WaveFileWriter(tempPath, format);
        var bytes = new byte[samples.Length * 2];
        for (int i = 0; i < samples.Length; i++)
        {
            var pcm = (short)(Math.Clamp(samples[i], -0.95f, 0.95f) * 32767f);
            bytes[i * 2]     = (byte)(pcm & 0xFF);
            bytes[i * 2 + 1] = (byte)((pcm >> 8) & 0xFF);
        }
        writer.Write(bytes, 0, bytes.Length);
        return tempPath;
    }

    private static float[] Resample(float[] input, int fromRate, int toRate)
    {
        if (fromRate == toRate) return input;
        var ratio = (double)fromRate / toRate;
        var output = new float[(int)(input.Length / ratio)];
        for (int i = 0; i < output.Length; i++)
        {
            var pos = i * ratio;
            var idx = (int)pos;
            var frac = (float)(pos - idx);
            var a = idx < input.Length ? input[idx] : 0f;
            var b = idx + 1 < input.Length ? input[idx + 1] : 0f;
            output[i] = a + frac * (b - a);
        }
        return output;
    }

    private static float[] ApplyHighPassFilter(float[] input, float cutoffHz, int sampleRate)
    {
        var rc = 1f / (2f * MathF.PI * cutoffHz);
        var dt = 1f / sampleRate;
        var alpha = rc / (rc + dt);
        var output = new float[input.Length];
        if (input.Length == 0) return output;
        output[0] = input[0];
        for (int i = 1; i < input.Length; i++)
            output[i] = alpha * (output[i - 1] + input[i] - input[i - 1]);
        return output;
    }

    private static float[] NormalizeRms(float[] input, float targetRms, float maxGain)
    {
        if (input.Length == 0) return input;
        double sumSq = 0;
        foreach (var s in input) sumSq += s * s;
        var rms = (float)Math.Sqrt(sumSq / input.Length);
        if (rms < 1e-6f) return input;
        var gain = Math.Min(targetRms / rms, maxGain);
        var output = new float[input.Length];
        for (int i = 0; i < input.Length; i++)
            output[i] = input[i] * gain;
        return output;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  WHISPER TRANSCRIPTION (batch mode)
    // ═══════════════════════════════════════════════════════════════════════════

    private async Task<(string text, string language)> TranscribeAsync(
        string wavPath, string modelPath, CancellationToken ct)
    {
        return await Task.Run(async () =>
        {
            using var factory = WhisperFactory.FromPath(modelPath);
            var builder = factory.CreateBuilder().WithLanguage("auto");
            if (!string.IsNullOrWhiteSpace(_settings.InitialPrompt))
                builder = builder.WithPrompt(_settings.InitialPrompt);
            using var processor = builder.Build();

            var sb = new StringBuilder();
            string? lang = null;

            using var stream = File.OpenRead(wavPath);
            await foreach (var segment in processor.ProcessAsync(stream, ct))
            {
                var text = CleanWhisperText(segment.Text ?? "");
                if (!string.IsNullOrWhiteSpace(text))
                    sb.Append(text).Append(' ');
                lang ??= segment.Language;
            }

            return (sb.ToString().Trim(), lang ?? "es");
        }, ct);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  CLAUDE API
    // ═══════════════════════════════════════════════════════════════════════════

    private async Task<string?> TranslateAsync(string text, string langName, CancellationToken ct)
    {
        var prompt = $"Traduce el siguiente texto del {langName} al español. " +
                     "Mantén el estilo académico y conserva los términos técnicos con su original " +
                     "entre paréntesis cuando sea relevante.\n\nTEXTO:\n{text}";
        try { return await ClaudeRequestAsync(prompt, 4096, ct); }
        catch { return null; }
    }

    private async Task<string> SummarizeAsync(string text, CancellationToken ct)
    {
        var prompt = "Eres un asistente especializado en resumir clases universitarias.\n" +
                     "A continuación tienes la transcripción de una clase. Por favor:\n" +
                     "1. Escribe un resumen claro y estructurado con los conceptos clave.\n" +
                     "2. Lista los puntos más importantes como viñetas (usa markdown).\n" +
                     "3. Si hay definiciones o fórmulas relevantes, inclúyelas.\n" +
                     "4. Responde siempre en español.\n\nTRANSCRIPCIÓN:\n" + text;
        try { return await ClaudeRequestAsync(prompt, 2048, ct); }
        catch (Exception ex) { return $"[Error al generar resumen: {ex.Message}]"; }
    }

    private async Task<string> ClaudeRequestAsync(string prompt, int maxTokens, CancellationToken ct)
    {
        var body = new
        {
            model = "claude-sonnet-4-6",
            max_tokens = maxTokens,
            messages = new[] { new { role = "user", content = prompt } }
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.anthropic.com/v1/messages");
        request.Headers.Add("x-api-key", _settings.ApiKey);
        request.Headers.Add("anthropic-version", "2023-06-01");
        request.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

        var response = await _http.SendAsync(request, ct);
        var json = await response.Content.ReadAsStringAsync(ct);

        if (!response.IsSuccessStatusCode)
            throw new Exception($"Claude API {(int)response.StatusCode}: {json[..Math.Min(200, json.Length)]}");

        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.GetProperty("content")[0].GetProperty("text").GetString() ?? "";
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  SAVE MARKDOWN
    // ═══════════════════════════════════════════════════════════════════════════

    private string SaveMarkdown(string audioPath, string transcription, string summary,
        string langCode, string langName, string? translation)
    {
        var mdPath = Path.ChangeExtension(audioPath, ".md");
        Directory.CreateDirectory(Path.GetDirectoryName(mdPath)!);

        var sb = new StringBuilder();
        sb.AppendLine($"# Clase — {DateTime.Now:yyyy-MM-dd HH:mm}");
        sb.AppendLine();
        sb.AppendLine($"**Audio:** `{Path.GetFileName(audioPath)}`  ");
        sb.AppendLine($"**Idioma original:** {langName} (`{langCode}`)");
        sb.AppendLine();
        sb.AppendLine("## Resumen");
        sb.AppendLine();
        sb.AppendLine(summary);
        sb.AppendLine();
        sb.AppendLine("---");
        sb.AppendLine();

        if (translation != null)
        {
            sb.AppendLine("## Transcripción (traducida al español)");
            sb.AppendLine();
            sb.AppendLine(translation);
            sb.AppendLine();
            sb.AppendLine("---");
            sb.AppendLine();
            sb.AppendLine($"## Transcripción original ({langName})");
            sb.AppendLine();
            sb.AppendLine(transcription);
        }
        else
        {
            sb.AppendLine("## Transcripción completa");
            sb.AppendLine();
            sb.AppendLine(transcription);
        }

        File.WriteAllText(mdPath, sb.ToString(), Encoding.UTF8);
        return mdPath;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  HISTORY
    // ═══════════════════════════════════════════════════════════════════════════

    private void LoadHistory()
    {
        var items = new List<HistoryItem>();
        if (Directory.Exists(_settings.OutputDir))
        {
            foreach (var md in Directory.GetFiles(_settings.OutputDir, "*.md")
                                        .OrderByDescending(File.GetLastWriteTime)
                                        .Take(50))
            {
                items.Add(new HistoryItem
                {
                    FilePath = md,
                    DisplayName = Path.GetFileNameWithoutExtension(md),
                    Date = File.GetLastWriteTime(md).ToString("dd/MM/yyyy HH:mm"),
                    Language = TryReadLanguage(md)
                });
            }
        }
        HistoryList.ItemsSource = items;
    }

    private static string TryReadLanguage(string mdPath)
    {
        try
        {
            foreach (var line in File.ReadLines(mdPath).Take(10))
            {
                var m = Regex.Match(line, @"\*\*Idioma original:\*\* (.+?) \(");
                if (m.Success) return $"🌐 {m.Groups[1].Value}";
            }
        }
        catch { }
        return "";
    }

    private void HistoryList_SelectionChanged(object sender, System.Windows.Controls.SelectionChangedEventArgs e)
    {
        if (HistoryList.SelectedItem is not HistoryItem item || !File.Exists(item.FilePath)) return;
        try { ParseMarkdown(File.ReadAllText(item.FilePath)); }
        catch (Exception ex) { SetStatus($"Error al abrir: {ex.Message}", "#F38BA8"); }
    }

    private void ParseMarkdown(string content)
    {
        var summaryMatch = Regex.Match(content,
            @"## Resumen\s*\n(.*?)(?=\n---|\n## |\z)", RegexOptions.Singleline);
        var transMatch = Regex.Match(content,
            @"## Transcripción(?: \(traducida al español\)|completa)\s*\n(.*?)(?=\n---|\n## |\z)",
            RegexOptions.Singleline);
        var origMatch = Regex.Match(content,
            @"## Transcripción original \(.+?\)\s*\n(.*?)(?=\n---|\n## |\z)",
            RegexOptions.Singleline);

        SummaryText.Text = summaryMatch.Success ? summaryMatch.Groups[1].Value.Trim() : content;
        TranscriptionText.Text = transMatch.Success ? transMatch.Groups[1].Value.Trim() : "";

        if (origMatch.Success)
        {
            OriginalTab.Visibility = Visibility.Visible;
            OriginalText.Text = origMatch.Groups[1].Value.Trim();
        }
        else
        {
            OriginalTab.Visibility = Visibility.Collapsed;
        }

        ResultTabs.SelectedIndex = 0;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  SETTINGS
    // ═══════════════════════════════════════════════════════════════════════════

    private void SettingsButton_Click(object sender, RoutedEventArgs e)
    {
        var dlg = new SettingsWindow(_settings) { Owner = this };
        if (dlg.ShowDialog() == true)
        {
            _settings = dlg.Settings;
            _settings.Save();
            LoadHistory();
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  UI HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    private void SetStatus(string text, string? hexColor = null)
    {
        StatusText.Text = text;
        StatusText.Foreground = hexColor != null
            ? new System.Windows.Media.SolidColorBrush(
                (System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString(hexColor))
            : (System.Windows.Media.Brush)Application.Current.Resources["SubtextBrush"];
    }

    private void SetProgress(int value) => ProgressBar.Value = value;

    private void ShowOverlay(string title, string detail)
    {
        OverlayStatus.Text = title;
        OverlayDetail.Text = detail;
        ProcessingOverlay.Visibility = Visibility.Visible;
    }

    private void SetOverlay(string title, string detail)
    {
        Dispatcher.Invoke(() => { OverlayStatus.Text = title; OverlayDetail.Text = detail; });
    }

    private void HideOverlay() => ProcessingOverlay.Visibility = Visibility.Collapsed;

    private static void TryDelete(string path)
    {
        try { File.Delete(path); } catch { }
    }
}
