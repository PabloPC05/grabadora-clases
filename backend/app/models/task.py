import enum
import uuid
from datetime import datetime

from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Enum, Integer
from sqlalchemy.orm import relationship

from app.db.base import Base


class TaskStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class Task(Base):
    """
    Tarea asíncrona de procesamiento de audio.

    El frontend usa el `id` (UUID) para hacer polling en
    GET /api/v1/tasks/{id} y saber cuándo los apuntes están listos.
    """

    __tablename__ = "tasks"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    recording_id = Column(Integer, ForeignKey("recordings.id", ondelete="CASCADE"), nullable=False, index=True)

    status = Column(Enum(TaskStatus), default=TaskStatus.PENDING, nullable=False, index=True)
    error_message = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relaciones
    recording = relationship("Recording", back_populates="task")
