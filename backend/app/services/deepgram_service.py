"""
Servicio de transcripción de audio con Deepgram nova-2.

Expone:
  transcribe_audio(audio_path, glossary_terms) -> tuple[str, str]
    → (transcript_text, language_code)

La función interna es async para aprovechar el cliente AsyncDeepgramClient.
El worker sincrónico la invoca con asyncio.run().
"""

import asyncio
import logging
from pathlib import Path
from typing import List, Tuple

from deepgram import DeepgramClient, DeepgramApiError, DeepgramError, FileSource, PrerecordedOptions

from app.core.config import settings

logger = logging.getLogger(__name__)


def _build_client() -> DeepgramClient:
    return DeepgramClient(api_key=settings.DEEPGRAM_API_KEY)


def _format_diarized_transcript(response) -> str:
    """
    Formatea la respuesta con diarización en bloques etiquetados por speaker.

    Salida:
        [Speaker 0]: Buenos días, hoy veremos la transformada de Fourier...
        [Speaker 1]: ¿Podría repetir la definición de convolución?
        [Speaker 0]: Por supuesto...

    Gemini usará esta estructura para distinguir explicaciones del profesor
    de las preguntas de los alumnos.
    Cae de vuelta al transcript plano si utterances no está disponible.
    """
    try:
        utterances = response.results.utterances
        if utterances:
            lines = [f"[Speaker {u.speaker}]: {u.transcript.strip()}" for u in utterances if u.transcript.strip()]
            if lines:
                return "\n".join(lines)
    except (AttributeError, TypeError):
        pass

    # Fallback: transcript plano del primer canal/alternativa
    try:
        return response.results.channels[0].alternatives[0].transcript
    except (AttributeError, IndexError, TypeError) as exc:
        raise ValueError("No se pudo extraer el transcript de la respuesta de Deepgram") from exc


async def _transcribe_async(
    audio_path: str,
    glossary_terms: List[str],
) -> Tuple[str, str]:
    """
    Llama a la API de Deepgram de forma asíncrona.

    Args:
        audio_path:      Ruta absoluta al archivo de audio en disco.
        glossary_terms:  Lista de términos técnicos del glosario.

    Returns:
        (transcript_text, language_code) — ej. ("La FFT es...", "es")

    Raises:
        FileNotFoundError: Si el archivo de audio no existe.
        DeepgramApiError:  Si la API devuelve un error HTTP.
        ValueError:        Si la respuesta no contiene transcript.
    """
    path = Path(audio_path)
    if not path.exists():
        raise FileNotFoundError(f"Archivo de audio no encontrado: {audio_path}")

    # Cada término del glosario se intensifica con boost :2
    # para forzar al modelo a preferir esa transcripción sobre homófonos
    boosted_keywords = [f"{term}:2" for term in glossary_terms if term.strip()]

    options = PrerecordedOptions(
        model="nova-2",
        language="es",
        smart_format=True,
        diarize=True,
        keywords=boosted_keywords if boosted_keywords else None,
    )

    client = _build_client()

    logger.info(
        "Enviando '%s' a Deepgram (%.1f MB, %d keywords)",
        path.name,
        path.stat().st_size / (1024 * 1024),
        len(boosted_keywords),
    )

    audio_bytes = path.read_bytes()
    payload: FileSource = {"buffer": audio_bytes, "mimetype": _infer_mimetype(path.suffix)}

    try:
        response = await client.listen.asyncprerecorded.v("1").transcribe_file(payload, options)
    except DeepgramApiError as exc:
        logger.error("Deepgram API error: %s", exc)
        raise
    except DeepgramError as exc:
        logger.error("Deepgram SDK error: %s", exc)
        raise

    transcript = _format_diarized_transcript(response)

    if not transcript.strip():
        raise ValueError("Deepgram devolvió una transcripción vacía. Verifica la calidad del audio.")

    logger.info("Transcripción completada: %d caracteres", len(transcript))
    return transcript, "es"


def _infer_mimetype(suffix: str) -> str:
    return {
        ".mp3": "audio/mpeg",
        ".opus": "audio/opus",
        ".ogg": "audio/ogg",
        ".wav": "audio/wav",
        ".m4a": "audio/mp4",
        ".mp4": "audio/mp4",
    }.get(suffix.lower(), "audio/mpeg")


def transcribe_audio(audio_path: str, glossary_terms: List[str]) -> Tuple[str, str]:
    """
    Punto de entrada sincrónico para el worker de background.

    Crea un event loop propio (el worker corre en un thread pool, no en el
    loop de FastAPI, por lo que asyncio.run() es seguro aquí).

    Returns:
        (transcript_text, language_code)
    """
    return asyncio.run(_transcribe_async(audio_path, glossary_terms))
