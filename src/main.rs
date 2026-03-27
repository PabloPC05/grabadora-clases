#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::Write as IoWrite;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;

use anyhow::{anyhow, Result};
use chrono::Local;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use eframe::egui::{self, Color32, RichText, ScrollArea};
use serde::{Deserialize, Serialize};

// ─── Language table (whisper.cpp order) ──────────────────────────────────────

const WHISPER_LANGS: &[&str] = &[
    "en", "zh", "de", "es", "ru", "ko", "fr", "ja", "pt", "tr", "pl", "ca", "nl", "ar", "sv",
    "it", "id", "hi", "fi", "vi", "he", "uk", "el", "ms", "cs", "ro", "da", "hu", "ta", "no",
    "th", "ur", "hr", "bg", "lt", "la", "mi", "ml", "cy", "sk", "te", "fa", "lv", "bn", "sr",
    "az", "sl", "kn", "et", "mk", "br", "eu", "is", "hy", "ne", "mn", "bs", "kk", "sq", "sw",
    "gl", "mr", "pa", "si", "km", "sn", "yo", "so", "af", "oc", "ka", "be", "tg", "sd", "gu",
    "am", "yi", "lo", "uz", "fo", "ht", "ps", "tk", "nn", "mt", "sa", "lb", "my", "bo", "tl",
    "mg", "as", "tt", "haw", "ln", "ha", "ba", "jw", "su",
];

fn lang_name(code: &str) -> &'static str {
    match code {
        "en" => "English",
        "zh" => "Chinese",
        "de" => "German",
        "es" => "Spanish",
        "ru" => "Russian",
        "ko" => "Korean",
        "fr" => "French",
        "ja" => "Japanese",
        "pt" => "Portuguese",
        "tr" => "Turkish",
        "pl" => "Polish",
        "ca" => "Catalan",
        "nl" => "Dutch",
        "ar" => "Arabic",
        "sv" => "Swedish",
        "it" => "Italian",
        "id" => "Indonesian",
        "hi" => "Hindi",
        "fi" => "Finnish",
        "vi" => "Vietnamese",
        "he" => "Hebrew",
        "uk" => "Ukrainian",
        "el" => "Greek",
        "ms" => "Malay",
        "cs" => "Czech",
        "ro" => "Romanian",
        "da" => "Danish",
        "hu" => "Hungarian",
        "ta" => "Tamil",
        "no" => "Norwegian",
        "th" => "Thai",
        "ur" => "Urdu",
        "hr" => "Croatian",
        "bg" => "Bulgarian",
        "lt" => "Lithuanian",
        "la" => "Latin",
        _ => "Unknown",
    }
}

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
struct SessionResult {
    timestamp: String,
    audio_path: String,
    md_path: String,
    lang_code: String,
    lang_name: String,
    transcript: String,
    translation: Option<String>,
    summary: String,
}

#[derive(Debug)]
enum WorkerMsg {
    Status(String),
    DownloadProgress(f32, String),
    Done(SessionResult),
    Error(String),
}

#[derive(PartialEq, Clone)]
enum AppState {
    Idle,
    Recording,
    Processing(String),
    Done,
    Error(String),
}

#[derive(Clone, Serialize, Deserialize)]
struct Settings {
    api_key: String,
    whisper_model: String,
    output_dir: String,
    initial_prompt: String,
    gain_db: f32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            api_key: std::env::var("ANTHROPIC_API_KEY").unwrap_or_default(),
            whisper_model: "small".into(),
            output_dir: "grabaciones".into(),
            initial_prompt: String::new(),
            gain_db: 12.0,
        }
    }
}

impl Settings {
    fn config_path() -> PathBuf {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("grabadora-clases")
            .join("settings.json")
    }

    fn load() -> Self {
        let path = Self::config_path();
        if let Ok(data) = std::fs::read_to_string(&path) {
            if let Ok(s) = serde_json::from_str(&data) {
                return s;
            }
        }
        Self::default()
    }

    fn save(&self) {
        let path = Self::config_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        if let Ok(json) = serde_json::to_string_pretty(self) {
            std::fs::write(&path, json).ok();
        }
    }
}

// ─── Model path helpers ───────────────────────────────────────────────────────

fn exe_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn model_path() -> PathBuf {
    exe_dir().join("models").join("ggml-small.bin")
}

const MODEL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin";

// ─── Audio DSP ────────────────────────────────────────────────────────────────

struct BiquadHighPass {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    x1: f64,
    x2: f64,
    y1: f64,
    y2: f64,
}

impl BiquadHighPass {
    fn new(cutoff_hz: f64, sample_rate: f64) -> Self {
        use std::f64::consts::PI;
        let w0 = 2.0 * PI * cutoff_hz / sample_rate;
        let cos_w0 = w0.cos();
        let sin_w0 = w0.sin();
        let q = 0.7071;
        let alpha = sin_w0 / (2.0 * q);
        let b0 = (1.0 + cos_w0) / 2.0;
        let b1 = -(1.0 + cos_w0);
        let b2 = (1.0 + cos_w0) / 2.0;
        let a0 = 1.0 + alpha;
        let a1 = -2.0 * cos_w0;
        let a2 = 1.0 - alpha;
        Self {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
        }
    }

    fn process(&mut self, x: f32) -> f32 {
        let xd = x as f64;
        let y = self.b0 * xd + self.b1 * self.x1 + self.b2 * self.x2
            - self.a1 * self.y1
            - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = xd;
        self.y2 = self.y1;
        self.y1 = y;
        y as f32
    }
}

fn apply_noise_reduction(samples: &mut Vec<f32>, sample_rate: u32) {
    // 1) Apply gain from dB boost (done before this fn, but we also apply here as needed)
    // 2) High-pass biquad filter at 80 Hz
    let mut hp = BiquadHighPass::new(80.0, sample_rate as f64);
    for s in samples.iter_mut() {
        *s = hp.process(*s);
    }

    // 3) RMS normalization: boost up to 6x to reach target RMS 0.08
    let rms: f32 = {
        let sum_sq: f32 = samples.iter().map(|x| x * x).sum();
        (sum_sq / samples.len() as f32).sqrt()
    };
    const TARGET_RMS: f32 = 0.08;
    const MAX_GAIN: f32 = 6.0;
    if rms > 1e-9 {
        let gain = (TARGET_RMS / rms).min(MAX_GAIN);
        for s in samples.iter_mut() {
            *s *= gain;
        }
    }

    // 4) Hard clip limiter at ±0.95
    for s in samples.iter_mut() {
        *s = s.clamp(-0.95, 0.95);
    }
}

// ─── WAV helpers ──────────────────────────────────────────────────────────────

fn save_wav(path: &std::path::Path, samples: &[f32], sample_rate: u32) -> Result<()> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(path, spec)?;
    for &s in samples {
        let i = (s * 32767.0).clamp(-32768.0, 32767.0) as i16;
        writer.write_sample(i)?;
    }
    writer.finalize()?;
    Ok(())
}

// ─── Symphonia loader ─────────────────────────────────────────────────────────

fn load_audio_file(path: &std::path::Path) -> Result<(Vec<f32>, u32)> {
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let file = std::fs::File::open(path)?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe().format(
        &hint,
        mss,
        &FormatOptions::default(),
        &MetadataOptions::default(),
    )?;
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
        .ok_or_else(|| anyhow!("No audio track found"))?;
    let track_id = track.id;
    let sample_rate = track
        .codec_params
        .sample_rate
        .ok_or_else(|| anyhow!("Unknown sample rate"))?;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())?;

    let mut all_samples: Vec<f32> = Vec::new();
    let mut num_channels = 1usize;

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(symphonia::core::errors::Error::IoError(_)) => break,
            Err(symphonia::core::errors::Error::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(e) => return Err(e.into()),
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = decoder.decode(&packet)?;
        num_channels = decoded.spec().channels.count();

        let mut sample_buf =
            symphonia::core::audio::SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
        sample_buf.copy_interleaved_ref(decoded);
        all_samples.extend_from_slice(sample_buf.samples());
    }

    // Mix to mono
    let mono: Vec<f32> = if num_channels == 1 {
        all_samples
    } else {
        let ch = num_channels as f32;
        all_samples
            .chunks(num_channels)
            .map(|frame| frame.iter().sum::<f32>() / ch)
            .collect()
    };

    // Resample to 16 kHz if needed (linear interpolation)
    let out = if sample_rate != 16000 {
        resample_linear(&mono, sample_rate, 16000)
    } else {
        mono
    };

    Ok((out, 16000))
}

fn resample_linear(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate {
        return samples.to_vec();
    }
    let ratio = from_rate as f64 / to_rate as f64;
    let out_len = (samples.len() as f64 / ratio).ceil() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src_f = i as f64 * ratio;
        let src_i = src_f as usize;
        let frac = (src_f - src_i as f64) as f32;
        let a = samples.get(src_i).copied().unwrap_or(0.0);
        let b = samples.get(src_i + 1).copied().unwrap_or(0.0);
        out.push(a + frac * (b - a));
    }
    out
}

// ─── Whisper transcription ────────────────────────────────────────────────────

fn transcribe(
    model_path: &str,
    samples: &[f32],
    initial_prompt: &str,
) -> Result<(String, String)> {
    use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

    let ctx = WhisperContext::new_with_params(
        model_path,
        WhisperContextParameters::default(),
    )
    .map_err(|e| anyhow!("Failed to load whisper model: {e}"))?;

    let mut state = ctx.create_state().map_err(|e| anyhow!("Failed to create whisper state: {e}"))?;

    let mut params = FullParams::new(SamplingStrategy::BeamSearch {
        beam_size: 5,
        patience: -1.0,
    });
    params.set_language(None);
    params.set_temperature(0.0);
    params.set_no_context(false);
    if !initial_prompt.is_empty() {
        params.set_initial_prompt(initial_prompt);
    }
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    state
        .full(params, samples)
        .map_err(|e| anyhow!("Whisper inference failed: {e}"))?;

    // Detect language
    let lang_id = state.full_lang_id_from_state().unwrap_or(0);
    let detected_lang = WHISPER_LANGS
        .get(lang_id as usize)
        .copied()
        .unwrap_or("en")
        .to_string();

    // Extract text
    let n_segments = state
        .full_n_segments()
        .map_err(|e| anyhow!("Segment count error: {e}"))?;
    let mut text = String::new();
    for i in 0..n_segments {
        let seg = state
            .full_get_segment_text(i)
            .map_err(|e| anyhow!("Segment text error: {e}"))?;
        text.push_str(&seg);
        text.push(' ');
    }

    Ok((text.trim().to_string(), detected_lang))
}

// ─── Claude API ───────────────────────────────────────────────────────────────

fn claude_request(api_key: &str, prompt: &str) -> Result<String> {
    let client = reqwest::blocking::Client::new();
    let body = serde_json::json!({
        "model": "claude-sonnet-4-6",
        "max_tokens": 4096,
        "messages": [{"role": "user", "content": prompt}]
    });
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()?;
    let status = resp.status();
    let text = resp.text()?;
    if !status.is_success() {
        return Err(anyhow!("Claude API error {status}: {text}"));
    }
    let v: serde_json::Value = serde_json::from_str(&text)?;
    let content = v["content"][0]["text"]
        .as_str()
        .ok_or_else(|| anyhow!("Unexpected Claude response format"))?
        .to_string();
    Ok(content)
}

fn translate_to_spanish(api_key: &str, text: &str, from_lang: &str) -> Result<String> {
    let prompt = format!(
        "Translate the following {from_lang} transcription to Spanish. \
         Return ONLY the translation, no commentary.\n\n{text}"
    );
    claude_request(api_key, &prompt)
}

fn summarize(api_key: &str, text: &str) -> Result<String> {
    let prompt = format!(
        "The following is a transcription of a university class. \
         Write a structured summary in Spanish with: \
         main topic, key concepts, important details, and conclusions. \
         Use markdown formatting.\n\n{text}"
    );
    claude_request(api_key, &prompt)
}

// ─── Download worker ──────────────────────────────────────────────────────────

fn download_model(tx: Sender<WorkerMsg>) {
    thread::spawn(move || {
        let path = model_path();
        if let Some(parent) = path.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                let _ = tx.send(WorkerMsg::Error(format!("Cannot create models dir: {e}")));
                return;
            }
        }
        let _ = tx.send(WorkerMsg::Status("Connecting to HuggingFace…".into()));
        let client = match reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(600))
            .build()
        {
            Ok(c) => c,
            Err(e) => {
                let _ = tx.send(WorkerMsg::Error(format!("HTTP client error: {e}")));
                return;
            }
        };
        let mut resp = match client.get(MODEL_URL).send() {
            Ok(r) => r,
            Err(e) => {
                let _ = tx.send(WorkerMsg::Error(format!("Download failed: {e}")));
                return;
            }
        };
        let total = resp.content_length().unwrap_or(0);
        let mut file = match std::fs::File::create(&path) {
            Ok(f) => f,
            Err(e) => {
                let _ = tx.send(WorkerMsg::Error(format!("Cannot create file: {e}")));
                return;
            }
        };
        let mut downloaded = 0u64;
        let mut buf = vec![0u8; 65536];
        loop {
            use std::io::Read;
            let n = match resp.read(&mut buf) {
                Ok(n) => n,
                Err(e) => {
                    let _ = tx.send(WorkerMsg::Error(format!("Download read error: {e}")));
                    return;
                }
            };
            if n == 0 {
                break;
            }
            if let Err(e) = file.write_all(&buf[..n]) {
                let _ = tx.send(WorkerMsg::Error(format!("Write error: {e}")));
                return;
            }
            downloaded += n as u64;
            let progress = if total > 0 {
                downloaded as f32 / total as f32
            } else {
                0.0
            };
            let msg = if total > 0 {
                format!(
                    "Descargando modelo {:.1} MB / {:.1} MB",
                    downloaded as f64 / 1_048_576.0,
                    total as f64 / 1_048_576.0
                )
            } else {
                format!(
                    "Descargando modelo {:.1} MB…",
                    downloaded as f64 / 1_048_576.0
                )
            };
            let _ = tx.send(WorkerMsg::DownloadProgress(progress, msg));
        }
        let _ = tx.send(WorkerMsg::Status(
            "Modelo descargado correctamente.".into(),
        ));
    });
}

// ─── Recording → pipeline ─────────────────────────────────────────────────────

fn run_pipeline(
    wav_path: PathBuf,
    samples_arc: Arc<Mutex<Vec<f32>>>,
    sample_rate: u32,
    settings: Settings,
    tx: Sender<WorkerMsg>,
) {
    thread::spawn(move || {
        // --- Apply gain and noise reduction ---
        let _ = tx.send(WorkerMsg::Status("Aplicando reducción de ruido…".into()));
        let mut samples = {
            let lock = samples_arc.lock().unwrap();
            lock.clone()
        };

        // Apply gain_db
        if settings.gain_db > 0.0 {
            let linear = 10f32.powf(settings.gain_db / 20.0);
            for s in samples.iter_mut() {
                *s *= linear;
            }
        }
        apply_noise_reduction(&mut samples, sample_rate);

        // Resample to 16 kHz if needed
        let (samples_16k, _) = if sample_rate != 16000 {
            let resampled = resample_linear(&samples, sample_rate, 16000);
            (resampled, 16000u32)
        } else {
            (samples, 16000u32)
        };

        // --- Save WAV ---
        let _ = tx.send(WorkerMsg::Status("Guardando audio…".into()));
        if let Err(e) = save_wav(&wav_path, &samples_16k, 16000) {
            let _ = tx.send(WorkerMsg::Error(format!("Error guardando WAV: {e}")));
            return;
        }

        // --- Transcribe ---
        let _ = tx.send(WorkerMsg::Status("Transcribiendo con Whisper…".into()));
        let model_str = model_path().to_string_lossy().to_string();
        let (transcript, lang_code) =
            match transcribe(&model_str, &samples_16k, &settings.initial_prompt) {
                Ok(v) => v,
                Err(e) => {
                    let _ = tx.send(WorkerMsg::Error(format!("Error de transcripción: {e}")));
                    return;
                }
            };
        let lname = lang_name(&lang_code).to_string();

        // --- Translate if not Spanish ---
        let translation: Option<String> = if lang_code != "es" && !settings.api_key.is_empty() {
            let _ = tx.send(WorkerMsg::Status(format!(
                "Traduciendo del {lname} al español…"
            )));
            match translate_to_spanish(&settings.api_key, &transcript, &lname) {
                Ok(t) => Some(t),
                Err(e) => {
                    let _ = tx.send(WorkerMsg::Status(format!(
                        "Advertencia: traducción fallida ({e})"
                    )));
                    None
                }
            }
        } else {
            None
        };

        // --- Summarize ---
        let summary = if settings.api_key.is_empty() {
            "(Configura tu API key de Claude para obtener resumen)".to_string()
        } else {
            let _ = tx.send(WorkerMsg::Status("Resumiendo con Claude…".into()));
            let text_for_summary = translation.as_deref().unwrap_or(&transcript);
            match summarize(&settings.api_key, text_for_summary) {
                Ok(s) => s,
                Err(e) => format!("Error al resumir: {e}"),
            }
        };

        // --- Save .md ---
        let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
        let output_dir = PathBuf::from(&settings.output_dir);
        std::fs::create_dir_all(&output_dir).ok();
        let md_filename = format!("clase_{timestamp}.md");
        let md_path = output_dir.join(&md_filename);
        let md_content = build_markdown(
            &timestamp,
            &lang_code,
            &lname,
            &transcript,
            translation.as_deref(),
            &summary,
        );
        std::fs::write(&md_path, &md_content).ok();

        let result = SessionResult {
            timestamp,
            audio_path: wav_path.to_string_lossy().to_string(),
            md_path: md_path.to_string_lossy().to_string(),
            lang_code,
            lang_name: lname,
            transcript,
            translation,
            summary,
        };
        let _ = tx.send(WorkerMsg::Done(result));
    });
}

fn build_markdown(
    timestamp: &str,
    lang_code: &str,
    lname: &str,
    transcript: &str,
    translation: Option<&str>,
    summary: &str,
) -> String {
    let mut md = format!("# Clase {timestamp}\n\n");
    md.push_str(&format!("**Idioma detectado:** {lname} (`{lang_code}`)\n\n"));
    md.push_str("## Resumen\n\n");
    md.push_str(summary);
    md.push_str("\n\n## Transcripción");
    if let Some(tr) = translation {
        md.push_str(" (ES)\n\n");
        md.push_str(tr);
        md.push_str(&format!(
            "\n\n<details>\n<summary>Original ({lname})</summary>\n\n{transcript}\n\n</details>\n"
        ));
    } else {
        md.push('\n');
        md.push('\n');
        md.push_str(transcript);
        md.push('\n');
    }
    md
}

// ─── App ──────────────────────────────────────────────────────────────────────

struct GrabadoraApp {
    settings: Settings,
    show_settings: bool,
    state: AppState,
    status_msg: String,
    download_progress: Option<(f32, String)>,
    history: Vec<SessionResult>,
    active_session: Option<usize>,
    active_tab: usize, // 0 = Resumen, 1 = Transcripción
    show_original: bool,
    // recording
    recording_start: Option<Instant>,
    samples_arc: Option<Arc<Mutex<Vec<f32>>>>,
    stream: Option<cpal::Stream>,
    sample_rate: u32,
    // worker channel
    rx: Option<Receiver<WorkerMsg>>,
    // model status
    model_exists: bool,
    downloading: bool,
}

impl Default for GrabadoraApp {
    fn default() -> Self {
        let settings = Settings::load();
        let model_exists = model_path().exists();
        Self {
            settings,
            show_settings: false,
            state: AppState::Idle,
            status_msg: "Listo.".into(),
            download_progress: None,
            history: Vec::new(),
            active_session: None,
            active_tab: 0,
            show_original: false,
            recording_start: None,
            samples_arc: None,
            stream: None,
            sample_rate: 44100,
            rx: None,
            model_exists,
            downloading: false,
        }
    }
}

impl GrabadoraApp {
    fn start_recording(&mut self) {
        let host = cpal::default_host();
        let device = match host.default_input_device() {
            Some(d) => d,
            None => {
                self.state = AppState::Error("No se encontró micrófono".into());
                return;
            }
        };
        let config = match device.default_input_config() {
            Ok(c) => c,
            Err(e) => {
                self.state = AppState::Error(format!("Config audio: {e}"));
                return;
            }
        };
        let sample_rate = config.sample_rate().0;
        self.sample_rate = sample_rate;
        let samples_arc = Arc::new(Mutex::new(Vec::<f32>::new()));
        let arc_clone = samples_arc.clone();

        let err_fn = |e| eprintln!("Stream error: {e}");
        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => {
                let arc2 = arc_clone.clone();
                device
                    .build_input_stream(
                        &config.into(),
                        move |data: &[f32], _| {
                            let mut v = arc2.lock().unwrap();
                            v.extend_from_slice(data);
                        },
                        err_fn,
                        None,
                    )
                    .ok()
            }
            cpal::SampleFormat::I16 => {
                let arc2 = arc_clone.clone();
                device
                    .build_input_stream(
                        &config.into(),
                        move |data: &[i16], _| {
                            let mut v = arc2.lock().unwrap();
                            v.extend(data.iter().map(|&s| s as f32 / 32768.0));
                        },
                        err_fn,
                        None,
                    )
                    .ok()
            }
            cpal::SampleFormat::U16 => {
                let arc2 = arc_clone.clone();
                device
                    .build_input_stream(
                        &config.into(),
                        move |data: &[u16], _| {
                            let mut v = arc2.lock().unwrap();
                            v.extend(data.iter().map(|&s| (s as f32 / 32768.0) - 1.0));
                        },
                        err_fn,
                        None,
                    )
                    .ok()
            }
            _ => None,
        };
        match stream {
            Some(s) => {
                s.play().ok();
                self.stream = Some(s);
                self.samples_arc = Some(samples_arc);
                self.recording_start = Some(Instant::now());
                self.state = AppState::Recording;
                self.status_msg = "Grabando…".into();
            }
            None => {
                self.state = AppState::Error("No se pudo abrir el stream de audio".into());
            }
        }
    }

    fn stop_recording(&mut self) {
        // Drop stream to stop recording
        self.stream = None;
        let samples_arc = match self.samples_arc.take() {
            Some(a) => a,
            None => return,
        };
        self.recording_start = None;
        self.state = AppState::Processing("Procesando…".into());

        let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
        let output_dir = PathBuf::from(&self.settings.output_dir);
        std::fs::create_dir_all(&output_dir).ok();
        let wav_path = output_dir.join(format!("clase_{timestamp}.wav"));

        let (tx, rx) = channel::<WorkerMsg>();
        self.rx = Some(rx);

        run_pipeline(
            wav_path,
            samples_arc,
            self.sample_rate,
            self.settings.clone(),
            tx,
        );
    }

    fn process_file(&mut self, path: PathBuf) {
        self.state = AppState::Processing("Cargando archivo…".into());
        let settings = self.settings.clone();
        let (tx, rx) = channel::<WorkerMsg>();
        self.rx = Some(rx);

        thread::spawn(move || {
            let _ = tx.send(WorkerMsg::Status("Cargando audio…".into()));
            let (mut samples, sr) = match load_audio_file(&path) {
                Ok(v) => v,
                Err(e) => {
                    let _ = tx.send(WorkerMsg::Error(format!("Error cargando audio: {e}")));
                    return;
                }
            };
            // Apply gain + noise reduction
            if settings.gain_db > 0.0 {
                let linear = 10f32.powf(settings.gain_db / 20.0);
                for s in samples.iter_mut() {
                    *s *= linear;
                }
            }
            apply_noise_reduction(&mut samples, sr);

            let samples_arc = Arc::new(Mutex::new(samples));
            let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
            let output_dir = PathBuf::from(&settings.output_dir);
            std::fs::create_dir_all(&output_dir).ok();
            let wav_path = output_dir.join(format!("archivo_{timestamp}.wav"));

            run_pipeline(wav_path, samples_arc, sr, settings, tx);
        });
    }

    fn poll_worker(&mut self) {
        let msgs: Vec<WorkerMsg> = if let Some(rx) = &self.rx {
            rx.try_iter().collect()
        } else {
            return;
        };
        for msg in msgs {
            match msg {
                WorkerMsg::Status(s) => {
                    self.status_msg = s.clone();
                    if matches!(self.state, AppState::Processing(_)) {
                        self.state = AppState::Processing(s);
                    }
                }
                WorkerMsg::DownloadProgress(p, s) => {
                    self.download_progress = Some((p, s.clone()));
                    self.status_msg = s;
                }
                WorkerMsg::Done(result) => {
                    self.status_msg = format!("Completado: {}", result.md_path);
                    self.state = AppState::Done;
                    self.downloading = false;
                    self.download_progress = None;
                    self.model_exists = model_path().exists();
                    self.history.insert(0, result);
                    if self.history.len() > 6 {
                        self.history.truncate(6);
                    }
                    self.active_session = Some(0);
                    self.active_tab = 0;
                    self.rx = None;
                }
                WorkerMsg::Error(e) => {
                    self.status_msg = format!("Error: {e}");
                    self.state = AppState::Error(e);
                    self.downloading = false;
                    self.download_progress = None;
                    self.model_exists = model_path().exists();
                    self.rx = None;
                }
            }
        }
    }
}

impl eframe::App for GrabadoraApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.poll_worker();
        // Request repaint while active
        if matches!(self.state, AppState::Recording | AppState::Processing(_))
            || self.downloading
        {
            ctx.request_repaint_after(std::time::Duration::from_millis(200));
        }

        // ── Settings window ──────────────────────────────────────────────────
        if self.show_settings {
            let mut open = true;
            egui::Window::new("Configuración")
                .open(&mut open)
                .resizable(true)
                .min_width(400.0)
                .show(ctx, |ui| {
                    egui::Grid::new("settings_grid")
                        .num_columns(2)
                        .spacing([12.0, 8.0])
                        .show(ui, |ui| {
                            ui.label("API Key (Claude):");
                            ui.add(
                                egui::TextEdit::singleline(&mut self.settings.api_key)
                                    .password(true)
                                    .desired_width(280.0),
                            );
                            ui.end_row();

                            ui.label("Modelo Whisper:");
                            egui::ComboBox::from_id_source("model_combo")
                                .selected_text(&self.settings.whisper_model)
                                .show_ui(ui, |ui| {
                                    for m in &["tiny", "base", "small", "medium", "large"] {
                                        ui.selectable_value(
                                            &mut self.settings.whisper_model,
                                            m.to_string(),
                                            *m,
                                        );
                                    }
                                });
                            ui.end_row();

                            ui.label("Carpeta de salida:");
                            ui.add(
                                egui::TextEdit::singleline(&mut self.settings.output_dir)
                                    .desired_width(280.0),
                            );
                            ui.end_row();

                            ui.label("Pista inicial (asignatura):");
                            ui.add(
                                egui::TextEdit::singleline(&mut self.settings.initial_prompt)
                                    .desired_width(280.0),
                            );
                            ui.end_row();

                            ui.label(format!("Ganancia: {:.0} dB", self.settings.gain_db));
                            ui.add(
                                egui::Slider::new(&mut self.settings.gain_db, 0.0..=24.0)
                                    .suffix(" dB"),
                            );
                            ui.end_row();
                        });
                    ui.separator();
                    if ui.button("Guardar").clicked() {
                        self.settings.save();
                        self.show_settings = false;
                    }
                });
            if !open {
                self.show_settings = false;
            }
        }

        // ── Main panel ──────────────────────────────────────────────────────
        egui::CentralPanel::default().show(ctx, |ui| {
            // Header
            ui.horizontal(|ui| {
                ui.heading(
                    RichText::new("🎙 Grabadora de Clases")
                        .size(20.0)
                        .strong(),
                );
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if ui.button("⚙").on_hover_text("Configuración").clicked() {
                        self.show_settings = !self.show_settings;
                    }
                });
            });
            ui.separator();

            // Model warning
            if !self.model_exists {
                egui::Frame::none()
                    .fill(Color32::from_rgb(80, 70, 0))
                    .inner_margin(8.0)
                    .show(ui, |ui| {
                        ui.horizontal(|ui| {
                            ui.label(
                                RichText::new("⚠ Modelo Whisper no encontrado.")
                                    .color(Color32::YELLOW),
                            );
                            if !self.downloading {
                                if ui.button("Descargar modelo").clicked() {
                                    self.downloading = true;
                                    self.download_progress = None;
                                    let (tx, rx) = channel::<WorkerMsg>();
                                    self.rx = Some(rx);
                                    download_model(tx);
                                }
                            } else {
                                ui.spinner();
                                if let Some((progress, msg)) = &self.download_progress {
                                    ui.label(msg);
                                    let bar_width = ui.available_width().min(200.0);
                                    let (rect, _) = ui.allocate_exact_size(
                                        egui::vec2(bar_width, 16.0),
                                        egui::Sense::hover(),
                                    );
                                    let filled = egui::Rect::from_min_size(
                                        rect.min,
                                        egui::vec2(rect.width() * progress, rect.height()),
                                    );
                                    ui.painter().rect_filled(rect, 3.0, Color32::DARK_GRAY);
                                    ui.painter().rect_filled(filled, 3.0, Color32::GREEN);
                                }
                            }
                        });
                    });
                ui.add_space(4.0);
            }

            // Controls row
            ui.horizontal(|ui| {
                let is_recording = matches!(self.state, AppState::Recording);
                let is_busy = matches!(
                    self.state,
                    AppState::Recording | AppState::Processing(_)
                ) || self.downloading;

                let rec_label = if is_recording {
                    RichText::new("⏹ Detener").color(Color32::RED)
                } else {
                    RichText::new("⏺ Grabar").color(Color32::GREEN)
                };

                let rec_enabled = self.model_exists && !self.downloading
                    && !matches!(self.state, AppState::Processing(_));
                if ui
                    .add_enabled(rec_enabled, egui::Button::new(rec_label))
                    .clicked()
                {
                    if is_recording {
                        self.stop_recording();
                    } else {
                        self.start_recording();
                    }
                }

                if ui
                    .add_enabled(
                        !is_busy && self.model_exists,
                        egui::Button::new("📂 Abrir archivo"),
                    )
                    .clicked()
                {
                    if let Some(path) = rfd::FileDialog::new()
                        .add_filter(
                            "Audio",
                            &["wav", "mp3", "m4a", "aac", "flac", "ogg", "opus"],
                        )
                        .pick_file()
                    {
                        self.process_file(path);
                    }
                }

                // Recording timer
                if let Some(start) = self.recording_start {
                    let elapsed = start.elapsed();
                    let secs = elapsed.as_secs();
                    ui.label(
                        RichText::new(format!(" {:02}:{:02}", secs / 60, secs % 60))
                            .color(Color32::RED),
                    );
                }
            });

            // Status bar
            ui.add_space(2.0);
            let (status_color, status_text) = match &self.state {
                AppState::Idle => (Color32::GRAY, self.status_msg.clone()),
                AppState::Recording => (Color32::RED, self.status_msg.clone()),
                AppState::Processing(s) => (Color32::YELLOW, s.clone()),
                AppState::Done => (Color32::GREEN, self.status_msg.clone()),
                AppState::Error(e) => (Color32::RED, format!("Error: {e}")),
            };
            ui.horizontal(|ui| {
                if matches!(self.state, AppState::Processing(_)) {
                    ui.spinner();
                }
                ui.label(RichText::new(&status_text).color(status_color).small());
            });
            ui.separator();

            // History tabs + result area
            if !self.history.is_empty() {
                ui.horizontal(|ui| {
                    for (i, sess) in self.history.iter().enumerate() {
                        let label = format!("Sesión {}", sess.timestamp.get(9..15).unwrap_or("?"));
                        let selected = self.active_session == Some(i);
                        if ui.selectable_label(selected, &label).clicked() {
                            self.active_session = Some(i);
                            self.active_tab = 0;
                            self.show_original = false;
                        }
                    }
                });

                if let Some(idx) = self.active_session {
                    if let Some(sess) = self.history.get(idx) {
                        let sess = sess.clone();
                        ui.add_space(4.0);

                        // Result tabs
                        ui.horizontal(|ui| {
                            if ui
                                .selectable_label(self.active_tab == 0, "Resumen")
                                .clicked()
                            {
                                self.active_tab = 0;
                            }
                            let trans_label = if sess.translation.is_some() {
                                "Transcripción (ES)"
                            } else {
                                "Transcripción"
                            };
                            if ui
                                .selectable_label(self.active_tab == 1, trans_label)
                                .clicked()
                            {
                                self.active_tab = 1;
                            }
                        });

                        ui.horizontal(|ui| {
                            ui.label(
                                RichText::new(format!(
                                    "Idioma: {} ({})",
                                    sess.lang_name, sess.lang_code
                                ))
                                .small()
                                .color(Color32::GRAY),
                            );
                            ui.label(
                                RichText::new(format!(" | Audio: {}", sess.audio_path))
                                    .small()
                                    .color(Color32::GRAY),
                            );
                        });
                        ui.separator();

                        ScrollArea::vertical()
                            .id_source("result_scroll")
                            .max_height(f32::INFINITY)
                            .show(ui, |ui| {
                                if self.active_tab == 0 {
                                    // Summary tab
                                    ui.label(&sess.summary);
                                } else {
                                    // Transcription tab
                                    let display_text = sess
                                        .translation
                                        .as_deref()
                                        .unwrap_or(&sess.transcript);
                                    ui.label(display_text);

                                    if sess.translation.is_some() {
                                        ui.add_space(8.0);
                                        ui.collapsing(
                                            format!("Original ({})", sess.lang_name),
                                            |ui| {
                                                ui.label(&sess.transcript);
                                            },
                                        );
                                    }
                                }
                            });
                    }
                }
            } else {
                ui.add_space(40.0);
                ui.vertical_centered(|ui| {
                    ui.label(
                        RichText::new(
                            "Pulsa ⏺ Grabar o abre un archivo de audio para comenzar.",
                        )
                        .color(Color32::GRAY),
                    );
                });
            }
        });
    }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

fn main() -> eframe::Result<()> {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title("Grabadora de Clases")
            .with_inner_size([720.0, 600.0])
            .with_min_inner_size([500.0, 400.0]),
        ..Default::default()
    };
    eframe::run_native(
        "Grabadora de Clases",
        options,
        Box::new(|_cc| Ok(Box::new(GrabadoraApp::default()))),
    )
}
