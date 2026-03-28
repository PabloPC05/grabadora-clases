from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.base import get_db
from app.models.note import Note
from app.schemas.note import NoteOut

router = APIRouter(prefix="/notes", tags=["notes"])

MOCK_USER_ID = 1


@router.get("/{note_id}", response_model=NoteOut)
def get_note(note_id: int, db: Session = Depends(get_db)):
    """Devuelve el apunte completo en Markdown con conceptos clave y preguntas de repaso."""
    note = (
        db.query(Note)
        .join(Note.recording)
        .filter(Note.id == note_id)
        .first()
    )
    if not note:
        raise HTTPException(status_code=404, detail="Apunte no encontrado")
    return note
