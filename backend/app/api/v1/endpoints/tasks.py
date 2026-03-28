from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.base import get_db
from app.models.task import Task
from app.schemas.task import TaskStatusOut

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("/{task_id}", response_model=TaskStatusOut)
def get_task_status(task_id: str, db: Session = Depends(get_db)):
    """
    Devuelve el estado actual de una tarea de procesamiento.
    El frontend hace polling aquí cada ~3 segundos.
    Cuando status == 'completed', note_id estará disponible.
    """
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Tarea no encontrada")

    note_id = None
    if task.recording and task.recording.note:
        note_id = task.recording.note.id

    return TaskStatusOut(
        id=task.id,
        status=task.status,
        recording_id=task.recording_id,
        note_id=note_id,
        error_message=task.error_message,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )
