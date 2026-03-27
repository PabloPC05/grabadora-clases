# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Aplicación de escritorio nativa (Rust + egui) que graba audio de clases, transcribe con whisper.cpp, detecta el idioma, traduce automáticamente al español si hace falta, y genera un resumen estructurado usando la Claude API.

También existe `grabadora.py` (versión Python anterior) para referencia.

## Prerequisitos (primera vez)

```bash
# CMake — necesario para compilar whisper.cpp
winget install Kitware.CMake

# Modelo Whisper en formato ggml (elegir uno):
# tiny ~75 MB   base ~142 MB   small ~466 MB   medium ~1.5 GB
Invoke-WebRequest -Uri "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin" -OutFile "models/ggml-small.bin"
```

## Comandos

```bash
cargo build --release        # compilar (primera vez tarda ~10 min por whisper.cpp)
cargo run --release          # ejecutar app
cargo run                    # ejecutar en modo debug (muestra consola)
cargo check                  # verificar tipos sin compilar del todo
```

## Arquitectura (todo en src/main.rs)

El archivo único está organizado en secciones:

| Sección | Responsabilidad |
|---|---|
| `Settings` | Persistencia de config en `%APPDATA%/grabadora-clases/settings.json` |
| `GrabadoraApp` + `eframe::App` | GUI inmediata egui, máquina de estados, polling de canal |
| `record_until_stop()` | Captura cpal (WASAPI), resampling lineal a 16 kHz |
| `process_audio()` | Hilo worker: transcribe → traduce → resume → guarda .md |
| `transcribe()` | whisper-rs: carga modelo ggml, detección automática de idioma |
| `load_audio_f32()` | WAV vía hound; otros formatos (mp3/m4a/flac/ogg) vía symphonia |
| `claude_call()` | HTTP POST a `api.anthropic.com/v1/messages` con reqwest blocking |
| `save_markdown()` | Escribe el .md con resumen + transcripción (+ original si hubo traducción) |

### Flujo de datos

```
GUI thread                          Worker thread (std::thread::spawn)
──────────                          ──────────────────────────────────
[Grabar] ──stop_rx chan──►  record_until_stop()  →  Vec<f32> @ 16kHz
                                        │
                                  save_wav() → clase_YYYYMMDD_HHMMSS.wav
                                        │
                                  transcribe() → (texto, "en"/"es"/…)
                                        │ si idioma ≠ es
                                  claude_call(traducir)
                                        │
                                  claude_call(resumir)
                                        │
                                  save_markdown() → .md
                                        │
◄── WorkerMsg::Done(SessionResult) ─────┘
```

### Detección de idioma

`transcribe()` llama a `state.full(params, &audio)` con `params.set_language(None)` (auto-detect). El idioma se extrae con `state.full_lang_id()` que devuelve un índice en la tabla `WHISPER_LANGS` hardcodeada en el mismo orden que `whisper.h`.

### Threading

No se usa tokio. Todo es `std::thread` + `reqwest::blocking`. El canal `worker_tx/worker_rx` (`std::sync::mpsc`) envía `WorkerMsg` del hilo worker a la GUI. El canal `stop_tx` (`Sender<()>`) envía la señal de parada de grabación.

### Configuración en runtime

`Settings` se guarda en JSON (`dirs::config_dir()`). La API key también se lee de `ANTHROPIC_API_KEY` al arrancar. El path del modelo se puede cambiar desde ⚙ en la app (apuntar a cualquier fichero `.bin` ggml).

## Formatos de audio soportados

- **WAV** — lectura directa con hound (rápido)
- **MP3, M4A (AAC), FLAC, OGG** — decodificación con symphonia (puro Rust, sin ffmpeg)
