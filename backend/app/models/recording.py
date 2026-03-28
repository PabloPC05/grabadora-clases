import enum
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, Float, DateTime, ForeignKey, Enum
from sqlalchemy.orm import relationship

from app.db.base import Base


class RecordingStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class Recording(Base):
    """
    Archivo de audio grabado en la app.

    Ciclo de vida del status:
      pending → processing → completed
                           ↘ failed
    """

    __tablename__ = "recordings"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    subject_id = Column(Integer, ForeignKey("subjects.id", ondelete="SET NULL"), nullable=True, index=True)

    topic = Column(String(500), nullable=True)
    audio_path = Column(String(1000), nullable=False)
    duration_seconds = Column(Float, nullable=True)
    status = Column(Enum(RecordingStatus, values_callable=lambda x: [e.value for e in x]), default=RecordingStatus.PENDING, nullable=False, index=True)

    # Resultado de Deepgram STT
    raw_transcript = Column(Text, nullable=True)
    language_detected = Column(String(10), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relaciones
    user = relationship("User", back_populates="recordings")
    subject = relationship("Subject", back_populates="recordings")
    note = relationship("Note", back_populates="recording", uselist=False, cascade="all, delete-orphan")
    task = relationship("Task", back_populates="recording", uselist=False, cascade="all, delete-orphan")
