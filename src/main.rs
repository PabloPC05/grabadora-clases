//! Grabadora de Clases con IA — interfaz nativa (egui + Python whisper + Claude API)
//!
//! Compilar:  cargo build --release
//! Ejecutar:  cargo run --release   (o doble clic en target/release/grabadora.exe)
//!
//! Prerequisitos (ya instalados en este equipo):
//!   pip install openai-whisper torch sounddevice scipy anthropic

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;

use anyhow::{anyhow, Context, Result};
use chrono::Local;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use eframe::egui::{self, Color32, RichText, ScrollArea};
use serde::{Deserialize, Serialize};

// ─── Tipos ────────────────────────────────────────────────────────────────────

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
    python_cmd: String,
    /// Pista de contexto para Whisper (asignatura, tema…). Mejora mucho la precisión.
    initial_prompt: String,
    /// Ganancia extra en dB para grabar desde lejos (0 = sin cambio, 12 = recomendado en aula)
    gain_db: f32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            api_key: std::env::var("ANTHROPIC_API_KEY").unwrap_or_default(),
            whisper_model: "medium".into(),
            output_dir: "grabaciones".into(),
            python_cmd: "python".into(),
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
        if let Ok(data) = serde_json::to_string_pretty(self) {
            std::fs::write(&path, data).ok();
        }
    }
}

// ─── App ──────────────────────────────────────────────────────────────────────

struct GrabadoraApp {
    state: AppState,
    recording_start: Option<Instant>,
    settings: Settings,
    show_settings: bool,

    current: Option<SessionResult>,
    history: Vec<SessionResult>,
    history_tab: usize,
    result_tab: usize,

    stop_tx: Option<Sender<()>>,
    worker_rx: Receiver<WorkerMsg>,
    worker_tx: Sender<WorkerMsg>,
}

impl GrabadoraApp {
    fn new(_cc: &eframe::CreationContext) -> Self {
        let (tx, rx) = channel::<WorkerMsg>();
        let settings = Settings::load();
        std::fs::create_dir_all(&settings.output_dir).ok();

        // Comprobar si Python tiene whisper al arrancar
        let s = settings.clone();
        let check_tx = tx.clone();
        thread::spawn(move || {
            if let Err(e) = check_python_whisper(&s.python_cmd) {
                check_tx.send(WorkerMsg::Error(format!("⚠ {e}"))).ok();
            }
        });

        Self {
            state: AppState::Idle,
            recording_start: None,
            settings,
            show_settings: false,
            current: None,
            history: Vec::new(),
            history_tab: 0,
            result_tab: 0,
            stop_tx: None,
            worker_rx: rx,
            worker_tx: tx,
        }
    }

    fn start_recording(&mut self) {
        let (stop_tx, stop_rx) = channel::<()>();
        let msg_tx = self.worker_tx.clone();
        let output_dir = self.settings.output_dir.clone();
        let model = self.settings.whisper_model.clone();
        let api_key = self.settings.api_key.clone();
        let python = self.settings.python_cmd.clone();
        let gain_db = self.settings.gain_db;
        let prompt = self.initial_prompt();

        self.stop_tx = Some(stop_tx);
        self.state = AppState::Recording;
        self.recording_start = Some(Instant::now());

        thread::spawn(move || {
            match record_until_stop(stop_rx) {
                Ok(samples) => {
                    let ts = Local::now().format("%Y%m%d_%H%M%S").to_string();
                    let wav = format!("{}/clase_{}.wav", output_dir, ts);
                    msg_tx.send(WorkerMsg::Status("Guardando audio...".into())).ok();
                    let processed = apply_gain(&samples, gain_db);
                    if let Err(e) = save_wav(&wav, &processed) {
                        msg_tx.send(WorkerMsg::Error(format!("Error guardando WAV: {e}"))).ok();
                        return;
                    }
                    process_audio_with_prompt(wav, model, python, api_key, prompt, msg_tx);
                }
                Err(e) => {
                    msg_tx.send(WorkerMsg::Error(format!("Error grabando: {e}"))).ok();
                }
            }
        });
    }

    fn stop_recording(&mut self) {
        if let Some(tx) = self.stop_tx.take() {
            tx.send(()).ok();
        }
        self.state = AppState::Processing("Procesando grabación...".into());
        self.recording_start = None;
    }

    fn open_file(&mut self) {
        if let Some(path) = rfd::FileDialog::new()
            .add_filter("Audio", &["wav", "mp3", "m4a", "flac", "ogg", "aac"])
            .set_title("Seleccionar archivo de audio")
            .pick_file()
        {
            let msg_tx = self.worker_tx.clone();
            let model = self.settings.whisper_model.clone();
            let api_key = self.settings.api_key.clone();
            let python = self.settings.python_cmd.clone();
            let path_str = path.to_string_lossy().to_string();
            self.state = AppState::Processing("Cargando archivo...".into());

            thread::spawn(move || {
                process_audio(path_str, model, python, api_key, msg_tx);
            });
        }
    }

    fn initial_prompt(&self) -> String {
        let base = "Transcripción de una clase universitaria.";
        if self.settings.initial_prompt.is_empty() {
            base.to_string()
        } else {
            format!("{} {}", base, self.settings.initial_prompt)
        }
    }

    fn poll(&mut self) {
        while let Ok(msg) = self.worker_rx.try_recv() {
            match msg {
                WorkerMsg::Status(s) => {
                    self.state = AppState::Processing(s);
                }
                WorkerMsg::Done(result) => {
                    self.current = Some(result.clone());
                    self.history.insert(0, result);
                    self.history.truncate(10);
                    self.history_tab = 0;
                    self.result_tab = 0;
                    self.state = AppState::Done;
                }
                WorkerMsg::Error(e) => {
                    self.state = AppState::Error(e);
                }
            }
        }
    }
}

impl eframe::App for GrabadoraApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.poll();

        match &self.state {
            AppState::Recording | AppState::Processing(_) => {
                ctx.request_repaint_after(std::time::Duration::from_millis(200));
            }
            _ => {}
        }

        // ── Ventana configuración ─────────────────────────────────────────────
        let mut show_settings = self.show_settings;
        if show_settings {
            egui::Window::new("⚙  Configuración")
                .collapsible(false)
                .resizable(false)
                .min_width(440.0)
                .show(ctx, |ui| {
                    egui::Grid::new("cfg")
                        .num_columns(2)
                        .spacing([10.0, 8.0])
                        .show(ui, |ui| {
                            ui.label("API key Anthropic:");
                            ui.add(egui::TextEdit::singleline(&mut self.settings.api_key)
                                .password(true).desired_width(300.0));
                            ui.end_row();

                            ui.label("Modelo Whisper:");
                            egui::ComboBox::from_id_source("model_combo")
                                .selected_text(&self.settings.whisper_model)
                                .show_ui(ui, |ui: &mut egui::Ui| {
                                    for m in &["tiny", "base", "small", "medium", "large"] {
                                        ui.selectable_value(&mut self.settings.whisper_model, m.to_string(), *m);
                                    }
                                });
                            ui.end_row();

                            ui.label("Asignatura / contexto:")
                                .on_hover_text("Pista para Whisper: mejora precisión de términos técnicos");
                            ui.add(egui::TextEdit::singleline(&mut self.settings.initial_prompt)
                                .hint_text("ej: Topología, Ecuaciones Diferenciales, Ciberseguridad…")
                                .desired_width(300.0));
                            ui.end_row();

                            ui.label("Amplificación (dB):")
                                .on_hover_text("Sube el volumen del micro. 12 dB recomendado para clase.");
                            ui.horizontal(|ui: &mut egui::Ui| {
                                ui.add(egui::Slider::new(&mut self.settings.gain_db, 0.0..=24.0)
                                    .suffix(" dB")
                                    .fixed_decimals(0));
                            });
                            ui.end_row();

                            ui.label("Comando Python:");
                            ui.add(egui::TextEdit::singleline(&mut self.settings.python_cmd)
                                .desired_width(300.0));
                            ui.end_row();

                            ui.label("Carpeta de salida:");
                            ui.add(egui::TextEdit::singleline(&mut self.settings.output_dir)
                                .desired_width(300.0));
                            ui.end_row();
                        });

                    ui.add_space(8.0);
                    ui.horizontal(|ui| {
                        if ui.button("Guardar").clicked() {
                            std::env::set_var("ANTHROPIC_API_KEY", &self.settings.api_key);
                            std::fs::create_dir_all(&self.settings.output_dir).ok();
                            self.settings.save();
                            show_settings = false;
                        }
                        if ui.button("Cancelar").clicked() {
                            show_settings = false;
                        }
                    });
                });
        }
        self.show_settings = show_settings;

        // ── Panel principal ───────────────────────────────────────────────────
        egui::CentralPanel::default().show(ctx, |ui| {
            ui.horizontal(|ui| {
                ui.heading("🎙  Grabadora de Clases");
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if ui.button("⚙").on_hover_text("Configuración").clicked() {
                        self.show_settings = !self.show_settings;
                    }
                });
            });
            ui.separator();
            ui.add_space(8.0);

            let is_recording = self.state == AppState::Recording;
            let is_processing = matches!(self.state, AppState::Processing(_));
            let busy = is_recording || is_processing;

            ui.horizontal(|ui| {
                let (label, color) = if is_recording {
                    ("⏹  Detener", Color32::from_rgb(180, 40, 40))
                } else {
                    ("⏺  Grabar", Color32::from_rgb(30, 140, 60))
                };
                let btn = egui::Button::new(
                    RichText::new(label).color(Color32::WHITE).size(15.0),
                )
                .fill(color)
                .min_size(egui::vec2(150.0, 44.0));

                if ui.add_enabled(!is_processing, btn).clicked() {
                    if is_recording {
                        self.stop_recording();
                    } else {
                        self.start_recording();
                    }
                }

                ui.add_space(8.0);

                if ui
                    .add_enabled(
                        !busy,
                        egui::Button::new("📂  Abrir archivo")
                            .min_size(egui::vec2(150.0, 44.0)),
                    )
                    .clicked()
                {
                    self.open_file();
                }
            });

            ui.add_space(10.0);

            // Estado
            match &self.state.clone() {
                AppState::Idle => {
                    ui.label(RichText::new("Listo").color(Color32::GRAY));
                }
                AppState::Recording => {
                    let secs = self
                        .recording_start
                        .map(|s| s.elapsed().as_secs())
                        .unwrap_or(0);
                    ui.label(
                        RichText::new(format!(
                            "●  Grabando  {:02}:{:02}",
                            secs / 60,
                            secs % 60
                        ))
                        .color(Color32::RED)
                        .size(15.0),
                    );
                }
                AppState::Processing(msg) => {
                    ui.horizontal(|ui| {
                        ui.spinner();
                        ui.label(msg.as_str());
                    });
                }
                AppState::Done => {
                    ui.label(RichText::new("✅  Completado").color(Color32::GREEN));
                }
                AppState::Error(e) => {
                    ui.label(
                        RichText::new(format!("❌  {}", e))
                            .color(Color32::from_rgb(220, 80, 80)),
                    );
                }
            }

            ui.separator();

            // ── Historial ─────────────────────────────────────────────────────
            if !self.history.is_empty() {
                ui.horizontal(|ui| {
                    for (i, s) in self.history.iter().enumerate().take(6) {
                        // Mostrar "DDMMM HH:MM" — timestamp = "20260327_200200"
                        let label = format!("📄 {}", &s.timestamp[6..11].replace('_', " "));
                        if ui
                            .selectable_label(self.history_tab == i, &label)
                            .on_hover_text(&s.audio_path)
                            .clicked()
                        {
                            self.history_tab = i;
                            self.current = Some(s.clone());
                        }
                    }
                });
                ui.separator();

                if let Some(result) = self.current.clone() {
                    ui.horizontal(|ui| {
                        ui.label(RichText::new("Idioma original:").strong());
                        let tag = if result.lang_code != "es" {
                            format!("{} → traducido al español", result.lang_name)
                        } else {
                            result.lang_name.clone()
                        };
                        ui.label(tag);
                    });
                    ui.label(
                        RichText::new(format!("💾 {}", result.md_path))
                            .small()
                            .color(Color32::GRAY),
                    );
                    ui.add_space(6.0);

                    ui.horizontal(|ui| {
                        if ui.selectable_label(self.result_tab == 0, "📋  Resumen").clicked() {
                            self.result_tab = 0;
                        }
                        let tl = if result.translation.is_some() {
                            "📝  Transcripción (ES)"
                        } else {
                            "📝  Transcripción"
                        };
                        if ui.selectable_label(self.result_tab == 1, tl).clicked() {
                            self.result_tab = 1;
                        }
                    });
                    ui.add_space(4.0);

                    match self.result_tab {
                        0 => {
                            ScrollArea::vertical()
                                .id_source("sum")
                                .show(ui, |ui: &mut egui::Ui| {
                                    ui.label(&result.summary);
                                });
                        }
                        _ => {
                            let text = result
                                .translation
                                .as_deref()
                                .unwrap_or(&result.transcript);
                            ScrollArea::vertical()
                                .id_source("trans")
                                .max_height(280.0)
                                .show(ui, |ui: &mut egui::Ui| {
                                    ui.label(text);
                                });

                            if result.translation.is_some() {
                                ui.add_space(6.0);
                                egui::CollapsingHeader::new(format!(
                                    "📜 Texto original ({})",
                                    result.lang_name
                                ))
                                .default_open(false)
                                .show(ui, |ui| {
                                    ScrollArea::vertical()
                                        .id_source("orig")
                                        .max_height(200.0)
                                        .show(ui, |ui: &mut egui::Ui| {
                                            ui.label(&result.transcript);
                                        });
                                });
                            }
                        }
                    }
                }
            } else if matches!(
                self.state,
                AppState::Idle | AppState::Done | AppState::Error(_)
            ) {
                ui.add_space(40.0);
                ui.vertical_centered(|ui| {
                    ui.label(
                        RichText::new("Pulsa Grabar para empezar")
                            .color(Color32::GRAY)
                            .size(16.0),
                    );
                    ui.add_space(6.0);
                    ui.label(
                        RichText::new("o abre un archivo de audio existente")
                            .color(Color32::GRAY),
                    );
                    if self.settings.api_key.is_empty() {
                        ui.add_space(16.0);
                        ui.label(
                            RichText::new(
                                "⚠  Configura la API key de Anthropic en ⚙ para activar resumen y traducción",
                            )
                            .color(Color32::YELLOW)
                            .small(),
                        );
                    }
                });
            }
        });
    }
}

// ─── Grabación con cpal ───────────────────────────────────────────────────────

fn record_until_stop(stop_rx: Receiver<()>) -> Result<Vec<f32>> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| anyhow!("No se encontró dispositivo de entrada de audio"))?;

    let config = device
        .default_input_config()
        .context("Error obteniendo configuración de audio")?;

    let native_rate = config.sample_rate().0;
    let channels = config.channels() as usize;
    let buffer: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
    let buf_clone = buffer.clone();

    let err_fn = |e| eprintln!("Error cpal: {e}");

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &config.into(),
            move |data: &[f32], _| {
                let mono: Vec<f32> = data
                    .chunks(channels)
                    .map(|f| f.iter().sum::<f32>() / channels as f32)
                    .collect();
                buf_clone.lock().unwrap().extend_from_slice(&mono);
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            &config.into(),
            move |data: &[i16], _| {
                let mono: Vec<f32> = data
                    .chunks(channels)
                    .map(|f| {
                        f.iter().map(|&s| s as f32 / 32768.0).sum::<f32>()
                            / channels as f32
                    })
                    .collect();
                buf_clone.lock().unwrap().extend_from_slice(&mono);
            },
            err_fn,
            None,
        ),
        fmt => return Err(anyhow!("Formato de audio no soportado: {:?}", fmt)),
    }
    .context("Error creando stream de audio")?;

    stream.play().context("Error iniciando captura")?;
    let _ = stop_rx.recv();
    drop(stream);

    let raw = buffer.lock().unwrap().clone();
    if raw.is_empty() {
        return Err(anyhow!("No se grabó audio"));
    }

    Ok(if native_rate != 16000 {
        resample(&raw, native_rate, 16000)
    } else {
        raw
    })
}

fn resample(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    let ratio = to as f64 / from as f64;
    let out_len = (input.len() as f64 * ratio) as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src = i as f64 / ratio;
        let idx = src as usize;
        let frac = (src - idx as f64) as f32;
        let s0 = input.get(idx).copied().unwrap_or(0.0);
        let s1 = input.get(idx + 1).copied().unwrap_or(0.0);
        out.push(s0 + (s1 - s0) * frac);
    }
    out
}

/// Aplica ganancia en dB y luego normaliza para evitar clipping.
fn apply_gain(samples: &[f32], gain_db: f32) -> Vec<f32> {
    if gain_db <= 0.0 {
        return samples.to_vec();
    }
    let linear = 10f32.powf(gain_db / 20.0);
    let boosted: Vec<f32> = samples.iter().map(|&s| s * linear).collect();
    // Si hay clipping, normalizar para quedar al 95 %
    let peak = boosted.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
    if peak > 0.95 {
        let scale = 0.95 / peak;
        boosted.iter().map(|&s| s * scale).collect()
    } else {
        boosted
    }
}

fn save_wav(path: &str, samples: &[f32]) -> Result<()> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 16000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut w = hound::WavWriter::create(path, spec)?;
    for &s in samples {
        w.write_sample((s.clamp(-1.0, 1.0) * 32767.0) as i16)?;
    }
    w.finalize()?;
    Ok(())
}

// ─── Pipeline de procesamiento ────────────────────────────────────────────────

fn process_audio(
    audio_path: String,
    model: String,
    python_cmd: String,
    api_key: String,
    tx: Sender<WorkerMsg>,
) {
    process_audio_with_prompt(audio_path, model, python_cmd, api_key, String::new(), tx)
}

fn process_audio_with_prompt(
    audio_path: String,
    model: String,
    python_cmd: String,
    api_key: String,
    initial_prompt: String,
    tx: Sender<WorkerMsg>,
) {
    tx.send(WorkerMsg::Status("Transcribiendo con Whisper...".into())).ok();

    let (transcript, lang_code) = match transcribe_with_python(&audio_path, &model, &python_cmd, &initial_prompt) {
        Ok(r) => r,
        Err(e) => {
            tx.send(WorkerMsg::Error(format!("Error en transcripción: {e}"))).ok();
            return;
        }
    };

    let lang_name = lang_name_es(&lang_code);
    tx.send(WorkerMsg::Status(format!("Idioma: {} — procesando...", lang_name))).ok();

    let translation: Option<String> = if lang_code != "es" && !api_key.is_empty() {
        tx.send(WorkerMsg::Status(format!("Traduciendo del {}...", lang_name))).ok();
        match claude_call(
            &format!(
                "Traduce el siguiente texto del {} al español. \
                 Mantén el estilo académico, conserva los términos técnicos y \
                 entre paréntesis indica el término original cuando sea relevante.\n\nTEXTO:\n{}",
                lang_name, transcript
            ),
            &api_key,
            4096,
        ) {
            Ok(t) => Some(t),
            Err(e) => { eprintln!("Error traduciendo: {e}"); None }
        }
    } else {
        None
    };

    let text_for_summary = translation.as_deref().unwrap_or(&transcript);

    let summary = if api_key.is_empty() {
        "[Resumen no disponible — configura ANTHROPIC_API_KEY en ⚙ Configuración]".into()
    } else {
        tx.send(WorkerMsg::Status("Generando resumen con Claude...".into())).ok();
        match claude_call(
            &format!(
                "Eres un asistente especializado en resumir explicaciones de clase universitaria.\n\
                 A continuación tienes la transcripción de una clase (ya en español). Por favor:\n\
                 1. Escribe un resumen claro y estructurado con los conceptos clave.\n\
                 2. Lista los puntos más importantes como viñetas.\n\
                 3. Si hay definiciones o fórmulas relevantes, inclúyelas.\n\
                 4. Responde siempre en español.\n\nTRANSCRIPCIÓN:\n{}",
                text_for_summary
            ),
            &api_key,
            2048,
        ) {
            Ok(s) => s,
            Err(e) => format!("[Error generando resumen: {e}]"),
        }
    };

    let md_path = PathBuf::from(&audio_path)
        .with_extension("md")
        .to_string_lossy()
        .to_string();

    if let Err(e) = save_markdown(
        &md_path, &audio_path, &transcript,
        translation.as_deref(), &summary, &lang_code, &lang_name,
    ) {
        eprintln!("Error guardando .md: {e}");
    }

    tx.send(WorkerMsg::Done(SessionResult {
        timestamp: Local::now().format("%Y%m%d_%H%M%S").to_string(),
        audio_path,
        md_path,
        lang_code,
        lang_name,
        transcript,
        translation,
        summary,
    }))
    .ok();
}

// ─── Transcripción via Python whisper ─────────────────────────────────────────

#[derive(Deserialize)]
struct WhisperResult {
    text: String,
    language: String,
}

fn check_python_whisper(python_cmd: &str) -> Result<()> {
    let out = std::process::Command::new(python_cmd)
        .args(["-c", "import whisper; print('ok')"])
        .output()
        .context("No se pudo ejecutar Python")?;
    if !out.status.success() {
        return Err(anyhow!(
            "Python no tiene whisper instalado. Ejecuta: pip install openai-whisper"
        ));
    }
    Ok(())
}

fn transcribe_with_python(
    audio_path: &str,
    model: &str,
    python_cmd: &str,
    initial_prompt: &str,
) -> Result<(String, String)> {
    let path_escaped = audio_path.replace('\\', "\\\\");
    let prompt_escaped = initial_prompt.replace('"', "\\\"");
    let script = format!(
        r#"
import whisper, json, sys, numpy as np

def preprocess(audio, sr=16000):
    """Reducción de ruido espectral + normalización de ganancia."""
    # 1. Intentar noisereduce si está instalado
    try:
        import noisereduce as nr
        # Primer segundo como muestra de ruido de fondo del aula
        noise_len = min(int(sr * 1.5), len(audio) // 4)
        noise_sample = audio[:noise_len]
        audio = nr.reduce_noise(y=audio, sr=sr, y_noise=noise_sample,
                                prop_decrease=0.75, stationary=False)
    except ImportError:
        pass  # sin noisereduce, continuar

    # 2. Normalización RMS: subir volumen de audio lejano
    rms = np.sqrt(np.mean(audio ** 2))
    if rms > 1e-6:
        target_rms = 0.08          # nivel objetivo
        gain = min(target_rms / rms, 6.0)   # máximo 6x (~15 dB)
        audio = audio * gain

    # 3. Limitar para evitar clipping
    audio = np.clip(audio, -1.0, 1.0)
    return audio

try:
    import whisper as _w
    model = _w.load_model("{model}")

    # Cargar audio con whisper (maneja todos los formatos via ffmpeg)
    audio = _w.load_audio("{path}")
    audio = preprocess(audio)

    result = model.transcribe(
        audio,
        initial_prompt="{prompt}",
        temperature=0,
        beam_size=5,
        best_of=5,
        condition_on_previous_text=True,
        no_speech_threshold=0.4,
        compression_ratio_threshold=2.4,
        word_timestamps=False,
    )
    print(json.dumps({{"text": result["text"].strip(), "language": result["language"]}}))
except Exception as e:
    import traceback
    print(traceback.format_exc(), file=sys.stderr)
    sys.exit(1)
"#,
        model = model,
        path = path_escaped,
        prompt = prompt_escaped,
    );

    let output = std::process::Command::new(python_cmd)
        .args(["-c", &script])
        .output()
        .context("Error ejecutando Python")?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("Whisper falló: {}", err.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let result: WhisperResult = serde_json::from_str(stdout.trim())
        .with_context(|| format!("Salida inesperada de Whisper: {}", stdout.trim()))?;

    Ok((result.text, result.language))
}

// ─── Claude API ───────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct ClaudeReq<'a> {
    model: &'a str,
    max_tokens: u32,
    messages: Vec<ClaudeMsg<'a>>,
}

#[derive(Serialize)]
struct ClaudeMsg<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct ClaudeResp {
    content: Vec<ClaudeContent>,
}

#[derive(Deserialize)]
struct ClaudeContent {
    text: String,
}

fn claude_call(prompt: &str, api_key: &str, max_tokens: u32) -> Result<String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()?;

    let body = ClaudeReq {
        model: "claude-sonnet-4-6",
        max_tokens,
        messages: vec![ClaudeMsg { role: "user", content: prompt }],
    };

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .context("Error conectando con Claude API")?
        .error_for_status()
        .context("Claude API devolvió error")?;

    let data: ClaudeResp = resp.json().context("Error parseando respuesta de Claude")?;
    data.content
        .into_iter()
        .next()
        .map(|c| c.text)
        .ok_or_else(|| anyhow!("Respuesta de Claude vacía"))
}

// ─── Guardar .md ──────────────────────────────────────────────────────────────

fn save_markdown(
    path: &str,
    audio_path: &str,
    transcript: &str,
    translation: Option<&str>,
    summary: &str,
    lang_code: &str,
    lang_name: &str,
) -> Result<()> {
    use std::io::Write;
    let mut f = std::fs::File::create(path)?;
    writeln!(f, "# Clase — {}", Local::now().format("%Y-%m-%d %H:%M"))?;
    writeln!(f)?;
    writeln!(
        f,
        "**Audio:** `{}`  ",
        Path::new(audio_path)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
    )?;
    writeln!(f, "**Idioma original:** {} (`{}`)", lang_name, lang_code)?;
    writeln!(f)?;
    writeln!(f, "## Resumen")?;
    writeln!(f)?;
    writeln!(f, "{}", summary)?;
    writeln!(f)?;
    writeln!(f, "---")?;
    writeln!(f)?;
    if let Some(trans) = translation {
        writeln!(f, "## Transcripción (traducida al español)")?;
        writeln!(f)?;
        writeln!(f, "{}", trans)?;
        writeln!(f)?;
        writeln!(f, "---")?;
        writeln!(f)?;
        writeln!(f, "## Transcripción original ({})", lang_name)?;
        writeln!(f)?;
        writeln!(f, "{}", transcript)?;
    } else {
        writeln!(f, "## Transcripción completa")?;
        writeln!(f)?;
        writeln!(f, "{}", transcript)?;
    }
    Ok(())
}

// ─── Helper idiomas ───────────────────────────────────────────────────────────

fn lang_name_es(code: &str) -> String {
    match code {
        "en" => "inglés", "fr" => "francés", "de" => "alemán",
        "it" => "italiano", "pt" => "portugués", "zh" => "chino",
        "ja" => "japonés", "ko" => "coreano", "ar" => "árabe",
        "ru" => "ruso", "nl" => "neerlandés", "pl" => "polaco",
        "tr" => "turco", "sv" => "sueco", "da" => "danés",
        "ca" => "catalán", "eu" => "euskera", "gl" => "gallego",
        "es" => "español", _ => code,
    }
    .to_string()
}

// ─── Main ─────────────────────────────────────────────────────────────────────

fn main() -> Result<(), eframe::Error> {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title("Grabadora de Clases")
            .with_inner_size([680.0, 600.0])
            .with_min_inner_size([480.0, 380.0]),
        ..Default::default()
    };

    eframe::run_native(
        "Grabadora de Clases",
        options,
        Box::new(|cc| Ok(Box::new(GrabadoraApp::new(cc)))),
    )
}
