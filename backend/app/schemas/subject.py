from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class GlossaryTermBase(BaseModel):
    term: str
    definition: Optional[str] = None


class GlossaryTermCreate(GlossaryTermBase):
    pass


class GlossaryTermOut(GlossaryTermBase):
    id: int
    subject_id: int

    class Config:
        from_attributes = True


class SubjectBase(BaseModel):
    name: str
    description: Optional[str] = None


class SubjectCreate(SubjectBase):
    glossary_terms: List[GlossaryTermCreate] = []


class SubjectOut(SubjectBase):
    id: int
    user_id: int
    created_at: datetime
    glossary_terms: List[GlossaryTermOut] = []

    class Config:
        from_attributes = True
