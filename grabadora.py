#!/usr/bin/env python3
"""
Grabadora de clases con transcripción (Whisper), traducción y resumen (Claude API).

Modos:
    python grabadora.py                        # graba con el micro del PC
    python grabadora.py --vigilar              # espera audios en OneDrive y los procesa
    python grabadora.py --procesar ARCHIVO     # procesa un archivo de audio concreto
"""

import os
import sys
import time
import argparse
import datetime
import queue
import glob

import numpy as np
import sounddevice as sd
from scipy.io.wavfile import write as wav_write
import whisper
import anthropic

# ── Configuración ──────────────────────────────────────────────────────────────
SAMPLE_RATE = 16000
CHANNELS = 1
WHISPER_MODEL = "medium"     # tiny | base | small | medium | large
OUTPUT_DIR = "grabaciones"

ONEDRIVE_AUDIO_DIR = os.path.expanduser(
    r"~\OneDrive - Universidad Complutense de Madrid (UCM)\Clases"
)
AUDIO_EXTENSIONS = (".m4a", ".wav", ".mp3", ".ogg", ".flac", ".aac")

IDIOMAS = {
    "en": "inglés", "fr": "francés", "de": "alemán", "it": "italiano",
    "pt": "portugués", "zh": "chino", "ja": "japonés", "ko": "coreano",
    "ar": "árabe", "ru": "ruso", "nl": "neerlandés", "pl": "polaco",
    "tr": "turco", "sv": "sueco", "da": "danés", "fi": "finlandés",
    "cs": "checo", "ro": "rumano", "hu": "húngaro", "uk": "ucraniano",
    "ca": "catalán", "eu": "euskera", "gl": "gallego",
}
# ──────────────────────────────────────────────────────────────────────────────


def grabar(output_path: str) -> None:
    frames: list[np.ndarray] = []
    q: queue.Queue = queue.Queue()

    def callback(indata, frame_count, time_info, status):
        q.put(indata.copy())

    print("\n🎙  Grabando... Pulsa [Enter] para detener.\n")
    with sd.InputStream(samplerate=SAMPLE_RATE, channels=CHANNELS,
                        dtype="int16", callback=callback):
        input()

    while not q.empty():
        frames.append(q.get())

    if not frames:
        print("No se grabó audio.")
        sys.exit(1)

    audio = np.concatenate(frames, axis=0)
    wav_write(output_path, SAMPLE_RATE, audio)
    duracion = len(audio) / SAMPLE_RATE
    print(f"✅ Grabación guardada: {output_path}  ({duracion:.1f} s)")


def transcribir(audio_path: str, model_name: str = WHISPER_MODEL) -> tuple[str, str]:
    """
    Transcribe el audio sin forzar idioma para que Whisper lo detecte automáticamente.
    Devuelve (texto, código_idioma_detectado).
    """
    print(f"\n📝 Cargando modelo Whisper '{model_name}'...")
    model = whisper.load_model(model_name)
    print("🔍 Transcribiendo y detectando idioma (puede tardar unos minutos)...")
    try:
        result = model.transcribe(
            audio_path,
            verbose=False,
            temperature=0,
            beam_size=5,
            best_of=5,
            condition_on_previous_text=True,
        )
    except Exception as e:
        print(f"\n❌ Error al transcribir: {e}")
        print("   Asegúrate de que ffmpeg está instalado: winget install Gyan.FFmpeg")
        sys.exit(1)

    idioma_detectado = result.get("language", "desconocido")
    nombre_idioma = IDIOMAS.get(idioma_detectado, idioma_detectado)
    print(f"🌐 Idioma detectado: {nombre_idioma} ({idioma_detectado})")
    return result["text"].strip(), idioma_detectado


def traducir(texto: str, idioma_origen: str) -> str | None:
    """
    Traduce el texto al español usando Claude cuando el idioma detectado no es español.
    Devuelve el texto traducido, o None si no se puede traducir.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("⚠️  Sin ANTHROPIC_API_KEY: no se puede traducir. Se usará la transcripción original.")
        return None

    nombre_idioma = IDIOMAS.get(idioma_origen, idioma_origen)
    print(f"\n🌍 Traduciendo del {nombre_idioma} al español...")

    cliente = anthropic.Anthropic(api_key=api_key)
    prompt = (
        f"Traduce el siguiente texto del {nombre_idioma} al español. "
        "Mantén el estilo académico, conserva los términos técnicos si tienen traducción establecida "
        "y entre paréntesis indica el término original cuando sea relevante.\n\n"
        f"TEXTO:\n{texto}"
    )

    mensaje = cliente.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )
    return mensaje.content[0].text.strip()


def resumir(texto: str) -> str:
    """Genera un resumen estructurado en español usando Claude."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return (
            "[Resumen no disponible: define la variable de entorno ANTHROPIC_API_KEY]\n"
            "Puedes exportarla con:  export ANTHROPIC_API_KEY='sk-ant-...'"
        )

    cliente = anthropic.Anthropic(api_key=api_key)
    prompt = (
        "Eres un asistente especializado en resumir explicaciones de clase universitaria.\n"
        "A continuación tienes la transcripción de una clase (ya en español). Por favor:\n"
        "1. Escribe un resumen claro y estructurado con los conceptos clave.\n"
        "2. Lista los puntos más importantes como viñetas.\n"
        "3. Si hay definiciones o fórmulas relevantes, inclúyelas.\n"
        "4. Responde siempre en español.\n\n"
        f"TRANSCRIPCIÓN:\n{texto}"
    )

    print("\n🤖 Generando resumen con Claude...")
    mensaje = cliente.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}],
    )
    return mensaje.content[0].text.strip()


def guardar_resultado(
    audio_path: str,
    transcripcion: str,
    resumen: str,
    idioma_original: str,
    traduccion: str | None = None,
) -> str:
    ruta = os.path.splitext(audio_path)[0] + ".md"
    nombre_idioma = IDIOMAS.get(idioma_original, idioma_original)

    with open(ruta, "w", encoding="utf-8") as f:
        f.write(f"# Clase — {datetime.datetime.now().strftime('%Y-%m-%d %H:%M')}\n\n")
        f.write(f"**Audio:** `{os.path.basename(audio_path)}`  \n")
        f.write(f"**Idioma original:** {nombre_idioma} (`{idioma_original}`)\n\n")

        f.write("## Resumen\n\n")
        f.write(resumen + "\n\n")
        f.write("---\n\n")

        if traduccion:
            f.write("## Transcripción (traducida al español)\n\n")
            f.write(traduccion + "\n\n")
            f.write("---\n\n")
            f.write(f"## Transcripción original ({nombre_idioma})\n\n")
            f.write(transcripcion + "\n")
        else:
            f.write("## Transcripción completa\n\n")
            f.write(transcripcion + "\n")

    print(f"📄 Resultado guardado: {ruta}")
    return ruta


def procesar_archivo(audio_path: str, modelo: str) -> None:
    print(f"\n▶  Procesando: {audio_path}")

    transcripcion, idioma = transcribir(audio_path, modelo)

    # Traducir si el idioma no es español
    traduccion: str | None = None
    texto_para_resumen = transcripcion

    if idioma != "es":
        traduccion = traducir(transcripcion, idioma)
        if traduccion:
            texto_para_resumen = traduccion

    print("\n── TRANSCRIPCIÓN ──────────────────────────────────────")
    texto_mostrar = traduccion if traduccion else transcripcion
    print(texto_mostrar[:600] + ("..." if len(texto_mostrar) > 600 else ""))
    print("───────────────────────────────────────────────────────")

    resumen = resumir(texto_para_resumen)
    print("\n── RESUMEN ────────────────────────────────────────────")
    print(resumen)
    print("───────────────────────────────────────────────────────")

    guardar_resultado(audio_path, transcripcion, resumen, idioma, traduccion)


def vigilar_carpeta(carpeta: str, modelo: str) -> None:
    """
    Observa la carpeta de OneDrive. Cuando detecta un audio nuevo
    (que no tenga ya su .md generado) lo procesa automáticamente.
    """
    os.makedirs(carpeta, exist_ok=True)
    print(f"\n👀 Vigilando carpeta: {carpeta}")
    print("   Sube tus grabaciones de Voice Memos a esa carpeta y se procesarán solas.")
    print("   Pulsa Ctrl+C para salir.\n")

    procesados: set[str] = set()

    # Marcar como ya procesados los que ya tienen .md
    for ext in AUDIO_EXTENSIONS:
        for f in glob.glob(os.path.join(carpeta, f"*{ext}")):
            md = os.path.splitext(f)[0] + ".md"
            if os.path.exists(md):
                procesados.add(f)

    try:
        while True:
            for ext in AUDIO_EXTENSIONS:
                for audio in glob.glob(os.path.join(carpeta, f"*{ext}")):
                    if audio not in procesados:
                        # Espera a que el archivo termine de subirse (tamaño estable)
                        time.sleep(3)
                        try:
                            procesar_archivo(audio, modelo)
                        except Exception as e:
                            print(f"⚠️  Error procesando {audio}: {e}")
                        finally:
                            procesados.add(audio)
            time.sleep(5)
    except KeyboardInterrupt:
        print("\nVigilancia detenida.")


def main():
    parser = argparse.ArgumentParser(description="Grabadora de clases con IA")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--vigilar", action="store_true",
                       help="Vigila la carpeta OneDrive y procesa nuevos audios automáticamente")
    group.add_argument("--procesar", metavar="ARCHIVO",
                       help="Procesa un archivo de audio concreto")
    parser.add_argument("--modelo", default=WHISPER_MODEL,
                        choices=["tiny", "base", "small", "medium", "large"],
                        help=f"Modelo Whisper (default: {WHISPER_MODEL})")
    parser.add_argument("--carpeta", default=ONEDRIVE_AUDIO_DIR,
                        help="Carpeta a vigilar (default: OneDrive/Clases)")
    args = parser.parse_args()

    if args.vigilar:
        vigilar_carpeta(args.carpeta, args.modelo)
    elif args.procesar:
        procesar_archivo(args.procesar, args.modelo)
    else:
        # Modo grabación con micro del PC
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        audio_path = os.path.join(OUTPUT_DIR, f"clase_{timestamp}.wav")
        grabar(audio_path)
        procesar_archivo(audio_path, args.modelo)


if __name__ == "__main__":
    main()
