from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel

from app.models.recording import RecordingStatus


class RecordingUploadMeta(BaseModel):
    """Metadata enviada junto al archivo de audio en el formulario multipart."""

    subject_id: Optional[int] = None
    topic: Optional[str] = None
    keywords: List[str] = []


class RecordingOut(BaseModel):
    id: int
    user_id: int
    subject_id: Optional[int]
    topic: Optional[str]
    audio_path: str
    duration_seconds: Optional[float]
    status: RecordingStatus
    raw_transcript: Optional[str]
    language_detected: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class UploadResponse(BaseModel):
    task_id: str
    recording_id: int
    message: str = "Audio recibido. Procesando en segundo plano."
