# 🎙 Grabadora de Clases con IA

Aplicación de escritorio nativa para grabar audio de clases, transcribir automáticamente, detectar el idioma, traducir al español y generar un resumen estructurado con IA.

![Rust](https://img.shields.io/badge/Rust-egui-orange?logo=rust)
![Python](https://img.shields.io/badge/Python-Whisper-blue?logo=python)
![Claude](https://img.shields.io/badge/AI-Claude%20Sonnet-purple)

## ¿Qué hace?

1. **Graba** audio desde el micrófono con un solo clic
2. **Transcribe** usando [OpenAI Whisper](https://github.com/openai/whisper) localmente
3. **Detecta el idioma** automáticamente (inglés, francés, alemán, chino, japonés…)
4. **Traduce al español** si la clase no es en español
5. **Resume** la transcripción con Claude API en formato estructurado con viñetas
6. **Guarda** el resultado como `.md` junto al audio

También puede procesar archivos de audio existentes (WAV, MP3, M4A, FLAC, OGG).

## Instalación

### 1. Requisitos previos

```bash
# Python con Whisper
pip install openai-whisper torch --index-url https://download.pytorch.org/whl/cpu

# Rust (si no lo tienes)
# https://rustup.rs
```

### 2. Clonar y compilar

```bash
git clone https://github.com/PabloPC05/grabadora-clases.git
cd grabadora-clases
cargo build --release
```

El ejecutable queda en `target/release/grabadora.exe` (Windows) o `target/release/grabadora` (Linux/Mac).

### 3. API key de Anthropic

Necesaria para traducción y resumen. Consíguela en [console.anthropic.com](https://console.anthropic.com).

Puedes configurarla dentro de la app en **⚙ Configuración**, o exportarla antes de ejecutar:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."   # Linux/Mac
set ANTHROPIC_API_KEY=sk-ant-...        # Windows CMD
```

> Sin API key la transcripción sigue funcionando, pero no habrá traducción ni resumen.

## Uso

Abre `grabadora.exe` y:

| Acción | Cómo |
|--------|------|
| Grabar una clase | Pulsa **⏺ Grabar**, cuando termines pulsa **⏹ Detener** |
| Procesar un audio ya grabado | Pulsa **📂 Abrir archivo** |
| Ver el resumen | Pestaña **📋 Resumen** |
| Ver la transcripción | Pestaña **📝 Transcripción** |
| Ver el texto original (si se tradujo) | Desplegable al final |
| Cambiar modelo Whisper | **⚙ Configuración → Modelo** |

Los resultados se guardan como archivos `.md` en la carpeta `grabaciones/` (configurable).

## Modelos Whisper

| Modelo | Precisión | Velocidad | RAM aprox. |
|--------|-----------|-----------|------------|
| `tiny` | ★★☆☆☆ | ★★★★★ | ~1 GB |
| `base` | ★★★☆☆ | ★★★★☆ | ~1 GB |
| `small` | ★★★★☆ | ★★★☆☆ | ~2 GB |
| `medium` | ★★★★★ | ★★☆☆☆ | ~5 GB |

El modelo `small` es el equilibrio recomendado.

## Tecnologías

- **GUI**: [egui](https://github.com/emilk/egui) + eframe — interfaz nativa en Rust
- **Audio**: [cpal](https://github.com/RustAudio/cpal) — captura multiplataforma
- **Transcripción**: [OpenAI Whisper](https://github.com/openai/whisper) vía subproceso Python
- **Traducción y resumen**: [Anthropic Claude API](https://docs.anthropic.com)
- **Formatos de audio**: symphonia (MP3, M4A, FLAC, OGG) + hound (WAV)

## Estructura

```
grabadora-clases/
├── src/
│   └── main.rs          # App completa (GUI + grabación + pipeline IA)
├── grabadora.py         # Versión CLI en Python (referencia)
├── Cargo.toml
└── grabaciones/         # Salida: .wav + .md por sesión
```

## Licencia

MIT
