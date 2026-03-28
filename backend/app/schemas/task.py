from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from app.models.task import TaskStatus


class TaskStatusOut(BaseModel):
    id: str
    status: TaskStatus
    recording_id: int
    note_id: Optional[int] = None
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
