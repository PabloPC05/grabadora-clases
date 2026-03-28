"""
Servicio de post-procesado LLM con Gemini 1.5 Flash.

Recibe la transcripción cruda de Deepgram junto con el contexto de la
asignatura (nombre + glosario) y devuelve un dict listo para crear un Note:
  {
      "content_markdown": str,
      "key_concepts": List[str],
      "review_questions": List[str],
  }
"""

import json
import logging
from typing import List

import google.generativeai as genai

from app.core.config import settings

logger = logging.getLogger(__name__)

# Configurar la API key una sola vez al importar el módulo
genai.configure(api_key=settings.GOOGLE_API_KEY)

_model = genai.GenerativeModel(
    model_name="gemini-2.0-flash",
    generation_config={"response_mime_type": "application/json"},
)


def generate_notes(
    raw_transcript: str,
    subject_name: str,
    glossary_terms: List[str],
) -> dict:
    """
    Envía la transcripción a Gemini y devuelve el apunte estructurado.

    Args:
        raw_transcript:  Texto crudo devuelto por Deepgram.
        subject_name:    Nombre de la asignatura (ej. "Procesado de Señales").
        glossary_terms:  Lista de términos del glosario (ej. ["FFT", "Nyquist"]).

    Returns:
        Dict con claves: content_markdown, key_concepts, review_questions.

    Raises:
        ValueError: Si la respuesta de Gemini no es un JSON válido o le faltan campos.
        google.api_core.exceptions.GoogleAPIError: Ante errores de la API.
    """
    prompt = f"""
Actúa como un profesor universitario experto en la asignatura '{subject_name}'.
A continuación recibirás una transcripción cruda (audio a texto) de una de tus clases. Debido al ruido de fondo, puede haber errores de reconocimiento.

Contexto clave (Glosario): Presta especial atención a estos términos que probablemente se hayan mencionado y corrígelos si la transcripción automática falló: {glossary_terms}.

Tu tarea es:
1. Limpiar la transcripción, eliminando muletillas, tartamudeos y corrigiendo la coherencia.
2. Redactar unos apuntes de estudio estructurados y detallados basados ÚNICAMENTE en lo que se ha dicho en la clase.
3. Identificar los conceptos más importantes.
4. Crear de 3 a 5 preguntas de examen para repasar.

Devuelve ÚNICAMENTE un objeto JSON válido con esta estructura exacta (sin bloques de código Markdown alrededor):
{{
    "content_markdown": "Los apuntes completos aquí, formateados en Markdown (usa ## para secciones, negritas para resaltar y listas con - para enumerar).",
    "key_concepts": ["Concepto 1", "Concepto 2", "Concepto 3"],
    "review_questions": ["¿Pregunta 1?", "¿Pregunta 2?", "¿Pregunta 3?"]
}}

Transcripción de la clase:
{raw_transcript}
"""

    logger.info("Enviando transcripción a Gemini 1.5 Flash (subject='%s', terms=%d)", subject_name, len(glossary_terms))

    response = _model.generate_content(prompt)

    try:
        data = json.loads(response.text)
    except json.JSONDecodeError as exc:
        logger.error("Gemini devolvió JSON inválido: %s", response.text[:500])
        raise ValueError(f"La respuesta de Gemini no es JSON válido: {exc}") from exc

    required_keys = {"content_markdown", "key_concepts", "review_questions"}
    missing = required_keys - data.keys()
    if missing:
        raise ValueError(f"Faltan campos en la respuesta de Gemini: {missing}")

    if not isinstance(data["key_concepts"], list):
        raise ValueError("'key_concepts' debe ser una lista")
    if not isinstance(data["review_questions"], list):
        raise ValueError("'review_questions' debe ser una lista")

    logger.info(
        "Apunte generado: %d chars markdown, %d conceptos, %d preguntas",
        len(data["content_markdown"]),
        len(data["key_concepts"]),
        len(data["review_questions"]),
    )

    return {
        "content_markdown": data["content_markdown"],
        "key_concepts": data["key_concepts"],
        "review_questions": data["review_questions"],
    }
