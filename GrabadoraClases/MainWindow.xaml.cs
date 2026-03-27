using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
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
    private WaveInEvent? _waveIn;
    private WaveFileWriter? _waveWriter;
    private string? _currentRecordingPath;
    private bool _isRecording;
    private DispatcherTimer? _recordTimer;
    private int _recordSeconds;
    private CancellationTokenSource? _processCts;

    private static readonly HttpClient _http = new();

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
    //  RECORDING
    // ═══════════════════════════════════════════════════════════════════════════

    private void RecordButton_Click(object sender, RoutedEventArgs e)
    {
        Directory.CreateDirectory(_settings.OutputDir);
        var timestamp = DateTime.Now.ToString("yyyyMMdd_HHmmss");
        _currentRecordingPath = Path.Combine(_settings.OutputDir, $"clase_{timestamp}.wav");

        try
        {
            _waveIn = new WaveInEvent
            {
                WaveFormat = new WaveFormat(16000, 16, 1),
                BufferMilliseconds = 50
            };
            _waveWriter = new WaveFileWriter(_currentRecordingPath, _waveIn.WaveFormat);
            _waveIn.DataAvailable += (s, ev) =>
            {
                _waveWriter?.Write(ev.Buffer, 0, ev.BytesRecorded);
            };
            _waveIn.StartRecording();
            _isRecording = true;

            RecordButton.IsEnabled = false;
            StopButton.IsEnabled = true;
            OpenFileButton.IsEnabled = false;

            _recordSeconds = 0;
            _recordTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
            _recordTimer.Tick += (s, ev) =>
            {
                _recordSeconds++;
                TimeText.Text = $"⏺  {_recordSeconds / 60:D2}:{_recordSeconds % 60:D2}";
            };
            _recordTimer.Start();

            SetStatus("Grabando... pulsa ⏹ para detener", "#F38BA8");
        }
        catch (Exception ex)
        {
            MessageBox.Show($"Error al iniciar grabación:\n{ex.Message}", "Error",
                MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private async void StopButton_Click(object sender, RoutedEventArgs e)
    {
        if (!_isRecording || _currentRecordingPath is null) return;

        _recordTimer?.Stop();
        _isRecording = false;

        _waveIn?.StopRecording();
        _waveIn?.Dispose();
        _waveIn = null;
        _waveWriter?.Flush();
        _waveWriter?.Dispose();
        _waveWriter = null;

        StopButton.IsEnabled = false;
        RecordButton.IsEnabled = false;
        OpenFileButton.IsEnabled = false;
        TimeText.Text = "";

        var path = _currentRecordingPath;
        await ProcessAudioFileAsync(path);

        RecordButton.IsEnabled = true;
        OpenFileButton.IsEnabled = true;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  OPEN FILE
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

    // ═══════════════════════════════════════════════════════════════════════════
    //  MAIN PIPELINE
    // ═══════════════════════════════════════════════════════════════════════════

    private async Task ProcessAudioFileAsync(string audioPath)
    {
        _processCts?.Cancel();
        _processCts = new CancellationTokenSource();
        var ct = _processCts.Token;

        ShowOverlay("Preparando...", "Cargando modelo de transcripción");
        SetProgress(5);

        try
        {
            // 1. Ensure model exists
            var modelPath = await EnsureModelAsync(ct);
            if (ct.IsCancellationRequested) return;

            // 2. Preprocess audio (normalize, filter) → temp 16kHz WAV
            SetOverlay("Preprocesando audio...", "Filtro de ruido y normalización");
            SetProgress(15);
            var processedWav = await Task.Run(() => PreprocessAudio(audioPath), ct);

            // 3. Transcribe
            SetOverlay("Transcribiendo...", "Puede tardar unos minutos según la duración");
            SetProgress(30);
            var (transcription, language) = await TranscribeAsync(processedWav, modelPath, ct);

            if (ct.IsCancellationRequested) return;

            // Clean up temp file
            TryDelete(processedWav);

            var langName = LangNames.GetValueOrDefault(language, language);

            // 4. Translate if needed
            string? translation = null;
            string textForSummary = transcription;

            if (language != "es" && _settings.AutoTranslate && !string.IsNullOrEmpty(_settings.ApiKey))
            {
                SetOverlay("Traduciendo...", $"Del {langName} al español");
                SetProgress(60);
                translation = await TranslateAsync(transcription, langName, ct);
                if (translation != null) textForSummary = translation;
            }

            // 5. Summarize
            string summary;
            if (!string.IsNullOrEmpty(_settings.ApiKey))
            {
                SetOverlay("Generando resumen...", "Claude IA está resumiendo la clase");
                SetProgress(80);
                summary = await SummarizeAsync(textForSummary, ct);
            }
            else
            {
                summary = "[Resumen no disponible: configura tu ANTHROPIC_API_KEY en ⚙ Configuración]";
            }

            // 6. Save markdown
            SetProgress(95);
            var mdPath = SaveMarkdown(audioPath, transcription, summary, language, langName, translation);

            // 7. Update UI
            Dispatcher.Invoke(() =>
            {
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
            });
        }
        catch (OperationCanceledException)
        {
            Dispatcher.Invoke(() => { HideOverlay(); SetStatus("Cancelado", "#F9E2AF"); });
        }
        catch (Exception ex)
        {
            Dispatcher.Invoke(() =>
            {
                HideOverlay();
                SetStatus($"Error: {ex.Message}", "#F38BA8");
                MessageBox.Show($"Error procesando el audio:\n\n{ex.Message}", "Error",
                    MessageBoxButton.OK, MessageBoxImage.Error);
            });
        }
        finally
        {
            Dispatcher.Invoke(() => SetProgress(0));
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  WHISPER MODEL
    // ═══════════════════════════════════════════════════════════════════════════

    // Ruta fija para los modelos, independiente de donde esté el exe
    internal static readonly string ModelsDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "GrabadoraClases", "models");

    private async Task<string> EnsureModelAsync(CancellationToken ct)
    {
        var modelsDir = ModelsDir;
        Directory.CreateDirectory(modelsDir);

        var modelName = _settings.WhisperModel switch
        {
            "tiny" => "ggml-tiny.bin",
            "base" => "ggml-base.bin",
            "small" => "ggml-small-q5_1.bin",
            "medium" => "ggml-medium-q5_0.bin",
            _ => "ggml-small-q5_1.bin"
        };
        var modelPath = Path.Combine(modelsDir, modelName);

        if (File.Exists(modelPath)) return modelPath;

        // Download
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

        return modelPath;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  AUDIO PREPROCESSING
    // ═══════════════════════════════════════════════════════════════════════════

    private string PreprocessAudio(string inputPath)
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"grabadora_{Guid.NewGuid():N}.wav");

        // Read audio samples using NAudio
        float[] samples;
        int sampleRate;

        using (var reader = new AudioFileReader(inputPath))
        {
            sampleRate = reader.WaveFormat.SampleRate;
            var sampleList = new List<float>();
            var buf = new float[reader.WaveFormat.SampleRate * reader.WaveFormat.Channels];
            int read;
            while ((read = reader.Read(buf, 0, buf.Length)) > 0)
            {
                // Mix to mono if stereo
                if (reader.WaveFormat.Channels == 2)
                {
                    for (int i = 0; i < read; i += 2)
                        sampleList.Add((buf[i] + buf[i + 1]) * 0.5f);
                }
                else
                {
                    for (int i = 0; i < read; i++)
                        sampleList.Add(buf[i]);
                }
            }
            samples = sampleList.ToArray();
        }

        // Resample to 16kHz if needed (simple linear interpolation)
        if (sampleRate != 16000)
            samples = Resample(samples, sampleRate, 16000);

        // High-pass filter at 80Hz (removes low-frequency rumble)
        samples = ApplyHighPassFilter(samples, 80.0f, 16000);

        // RMS normalization (boost quiet distant mic audio)
        var gainLinear = MathF.Pow(10.0f, _settings.GainDb / 20.0f);
        samples = NormalizeRms(samples, targetRms: 0.08f, maxGain: gainLinear);

        // Write as 16kHz 16-bit mono WAV
        var format = new WaveFormat(16000, 16, 1);
        using var writer = new WaveFileWriter(tempPath, format);
        var pcmBytes = new byte[samples.Length * 2];
        for (int i = 0; i < samples.Length; i++)
        {
            var clamped = Math.Clamp(samples[i], -0.95f, 0.95f);
            var pcm = (short)(clamped * 32767f);
            pcmBytes[i * 2]     = (byte)(pcm & 0xFF);
            pcmBytes[i * 2 + 1] = (byte)((pcm >> 8) & 0xFF);
        }
        writer.Write(pcmBytes, 0, pcmBytes.Length);

        return tempPath;
    }

    private static float[] Resample(float[] input, int fromRate, int toRate)
    {
        if (fromRate == toRate) return input;
        var ratio = (double)fromRate / toRate;
        var outputLength = (int)(input.Length / ratio);
        var output = new float[outputLength];
        for (int i = 0; i < outputLength; i++)
        {
            var srcPos = i * ratio;
            var srcIdx = (int)srcPos;
            var frac = (float)(srcPos - srcIdx);
            var a = srcIdx < input.Length ? input[srcIdx] : 0f;
            var b = srcIdx + 1 < input.Length ? input[srcIdx + 1] : 0f;
            output[i] = a + frac * (b - a);
        }
        return output;
    }

    private static float[] ApplyHighPassFilter(float[] input, float cutoffHz, int sampleRate)
    {
        var rc = 1.0f / (2.0f * MathF.PI * cutoffHz);
        var dt = 1.0f / sampleRate;
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
    //  WHISPER TRANSCRIPTION
    // ═══════════════════════════════════════════════════════════════════════════

    private async Task<(string text, string language)> TranscribeAsync(
        string wavPath, string modelPath, CancellationToken ct)
    {
        return await Task.Run(async () =>
        {
            using var factory = WhisperFactory.FromPath(modelPath);
            var processorBuilder = factory.CreateBuilder()
                .WithLanguage("auto");

            if (!string.IsNullOrWhiteSpace(_settings.InitialPrompt))
                processorBuilder = processorBuilder.WithPrompt(_settings.InitialPrompt);

            using var processor = processorBuilder.Build();

            var sb = new StringBuilder();
            string? detectedLang = null;

            using var stream = File.OpenRead(wavPath);
            await foreach (var segment in processor.ProcessAsync(stream, ct))
            {
                var text = segment.Text ?? "";

                // Filter whisper hallucination tokens
                text = Regex.Replace(text, @"\[(music|Music|MUSIC|Música|blank_audio|Blank_Audio|BLANK_AUDIO|silencio|noise|Noise)\]", "", RegexOptions.IgnoreCase);
                text = text.Trim();

                if (!string.IsNullOrWhiteSpace(text))
                    sb.Append(text).Append(' ');

                detectedLang ??= segment.Language;
            }

            return (sb.ToString().Trim(), detectedLang ?? "es");
        }, ct);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  CLAUDE API
    // ═══════════════════════════════════════════════════════════════════════════

    private async Task<string?> TranslateAsync(string text, string langName, CancellationToken ct)
    {
        var prompt = $"Traduce el siguiente texto del {langName} al español. " +
                     "Mantén el estilo académico y conserva los términos técnicos con su original entre paréntesis cuando sea relevante.\n\n" +
                     $"TEXTO:\n{text}";
        try { return await ClaudeRequestAsync(prompt, maxTokens: 4096, ct); }
        catch { return null; }
    }

    private async Task<string> SummarizeAsync(string text, CancellationToken ct)
    {
        var prompt = "Eres un asistente especializado en resumir clases universitarias.\n" +
                     "A continuación tienes la transcripción de una clase. Por favor:\n" +
                     "1. Escribe un resumen claro y estructurado con los conceptos clave.\n" +
                     "2. Lista los puntos más importantes como viñetas (usa markdown).\n" +
                     "3. Si hay definiciones o fórmulas relevantes, inclúyelas.\n" +
                     "4. Responde siempre en español.\n\n" +
                     $"TRANSCRIPCIÓN:\n{text}";
        try { return await ClaudeRequestAsync(prompt, maxTokens: 2048, ct); }
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
        request.Content = new StringContent(
            JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

        var response = await _http.SendAsync(request, ct);
        var json = await response.Content.ReadAsStringAsync(ct);

        if (!response.IsSuccessStatusCode)
            throw new Exception($"Claude API error {(int)response.StatusCode}: {json[..Math.Min(200, json.Length)]}");

        using var doc = JsonDocument.Parse(json);
        return doc.RootElement
            .GetProperty("content")[0]
            .GetProperty("text")
            .GetString() ?? "";
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
                var name = Path.GetFileNameWithoutExtension(md);
                var date = File.GetLastWriteTime(md).ToString("dd/MM/yyyy HH:mm");
                var lang = TryReadLanguage(md);
                items.Add(new HistoryItem
                {
                    FilePath = md,
                    DisplayName = name,
                    Date = date,
                    Language = lang
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
        if (HistoryList.SelectedItem is not HistoryItem item) return;
        if (!File.Exists(item.FilePath)) return;

        try
        {
            var content = File.ReadAllText(item.FilePath);
            ParseMarkdown(content);
        }
        catch (Exception ex)
        {
            SetStatus($"Error al abrir: {ex.Message}", "#F38BA8");
        }
    }

    private void ParseMarkdown(string content)
    {
        // Extract sections from markdown
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
        if (hexColor != null)
            StatusText.Foreground = new System.Windows.Media.SolidColorBrush(
                (System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString(hexColor));
        else
            StatusText.Foreground = (System.Windows.Media.Brush)Application.Current.Resources["SubtextBrush"];
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
        Dispatcher.Invoke(() =>
        {
            OverlayStatus.Text = title;
            OverlayDetail.Text = detail;
        });
    }

    private void HideOverlay() => ProcessingOverlay.Visibility = Visibility.Collapsed;

    private static void TryDelete(string path)
    {
        try { File.Delete(path); } catch { }
    }
}
