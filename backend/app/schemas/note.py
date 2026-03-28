from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class NoteOut(BaseModel):
    id: int
    recording_id: int
    content_markdown: str
    key_concepts: Optional[List[str]] = []
    review_questions: Optional[List[str]] = []
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
