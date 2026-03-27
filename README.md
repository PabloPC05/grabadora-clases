# 🎙 Grabadora de Clases con IA

Aplicación de escritorio nativa **Windows** para grabar audio de clases, transcribir automáticamente con Whisper, detectar el idioma, traducir al español y generar un resumen estructurado con Claude IA.

![CSharp](https://img.shields.io/badge/C%23-WPF-blue?logo=csharp)
![Whisper](https://img.shields.io/badge/Whisper.net-local-green)
![Claude](https://img.shields.io/badge/AI-Claude%20Sonnet-purple)

## ¿Qué hace?

1. **Graba** audio desde el micrófono con un solo clic
2. **Preprocesa** el audio (filtro paso-alto + normalización) para micrófonos lejanos
3. **Transcribe** localmente con Whisper (sin Python, sin instalar nada extra)
4. **Detecta el idioma** automáticamente (español, inglés, francés, alemán…)
5. **Traduce al español** si la clase no es en español (usando Claude API)
6. **Resume** con Claude API en formato estructurado con viñetas
7. **Guarda** el resultado como `.md` junto al audio

También puede procesar archivos de audio existentes (WAV, MP3, M4A, FLAC, OGG).

## Instalación

### Opción rápida: descarga el ejecutable

Descarga `GrabadoraClases.exe` desde [Releases](https://github.com/PabloPC05/grabadora-clases/releases) y ejecútalo directamente. **No requiere instalar nada** (ni Python, ni .NET, ni Visual C++).

> La primera vez descarga el modelo Whisper (~170MB). Las siguientes, arranca al instante.

### Compilar desde código fuente

Requisitos: [.NET 8 SDK](https://dotnet.microsoft.com/download)

```bash
git clone https://github.com/PabloPC05/grabadora-clases.git
cd grabadora-clases/GrabadoraClases
dotnet publish -c Release -r win-x64 --self-contained -p:PublishSingleFile=true -o publish
```

El ejecutable queda en `GrabadoraClases/publish/GrabadoraClases.exe`.

### API key de Anthropic

Necesaria para traducción y resumen. Consíguela en [console.anthropic.com](https://console.anthropic.com).

Configúrala dentro de la app en **⚙ Configuración → API Key**.

> Sin API key la transcripción sigue funcionando, pero no habrá traducción ni resumen.

## Uso

| Acción | Cómo |
|--------|------|
| Grabar una clase | Pulsa **⏺ Grabar**, cuando termines pulsa **⏹ Detener** |
| Procesar un audio ya grabado | Pulsa **📂 Abrir Archivo** |
| Ver el resumen | Pestaña **📋 Resumen** |
| Ver la transcripción | Pestaña **📝 Transcripción** |
| Ver el texto original (si se tradujo) | Pestaña **🌐 Original** |
| Cambiar modelo Whisper | **⚙ Configuración → Modelo** |
| Ajustar ganancia de micrófono | **⚙ Configuración → Ganancia** |

Los resultados se guardan como archivos `.md` en `Documentos/grabaciones/` (configurable).

## Modelos Whisper

El modelo se descarga automáticamente la primera vez (de Hugging Face).

| Modelo | Precisión | Tamaño | Nota |
|--------|-----------|--------|------|
| `tiny` | ★★☆☆☆ | ~75 MB | Tests rápidos |
| `base` | ★★★☆☆ | ~150 MB | Buena velocidad |
| `small` | ★★★★☆ | ~170 MB | **Recomendado** |
| `medium` | ★★★★★ | ~500 MB | Máxima precisión |

## Tecnologías

- **GUI**: WPF / .NET 8 — interfaz nativa Windows con tema oscuro
- **Audio**: [NAudio](https://github.com/naudio/NAudio) — captura y decodificación multiplataforma
- **Transcripción**: [Whisper.net](https://github.com/sandrohanea/whisper.net) — bindings .NET para whisper.cpp (100% local, sin Python)
- **Traducción y resumen**: [Anthropic Claude API](https://docs.anthropic.com) (claude-sonnet-4-6)
- **Preprocesado de audio**: filtro paso-alto 80 Hz + normalización RMS configurable

## Estructura

```
grabadora-clases/
├── GrabadoraClases/         # App C# + WPF
│   ├── MainWindow.xaml      # UI principal
│   ├── MainWindow.xaml.cs   # Lógica: grabación, transcripción, Claude API
│   ├── AppSettings.cs       # Persistencia de configuración
│   ├── SettingsWindow.xaml  # Diálogo de ajustes
│   └── GrabadoraClases.csproj
├── grabadora.py             # Versión CLI Python (referencia)
├── src/main.rs              # Versión Rust anterior (referencia)
└── grabaciones/             # Salida: .wav + .md por sesión
```

## Licencia

MIT
