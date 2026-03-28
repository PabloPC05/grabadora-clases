from datetime import datetime

from sqlalchemy import Column, Integer, Text, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship

from app.db.base import Base


class Note(Base):
    """
    Apunte estructurado generado por Gemini a partir de la transcripción.

    - content_markdown: texto completo en Markdown (limpio, con encabezados, bullets)
    - key_concepts: lista de conceptos clave extraídos   → ["FFT", "Teorema de Nyquist", ...]
    - review_questions: preguntas de repaso generadas    → ["¿Qué es...?", ...]
    """

    __tablename__ = "notes"

    id = Column(Integer, primary_key=True, index=True)
    recording_id = Column(Integer, ForeignKey("recordings.id", ondelete="CASCADE"), unique=True, nullable=False)

    content_markdown = Column(Text, nullable=False)
    key_concepts = Column(JSON, nullable=True)       # List[str]
    review_questions = Column(JSON, nullable=True)   # List[str]

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relaciones
    recording = relationship("Recording", back_populates="note")
