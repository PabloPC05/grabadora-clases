import os
import uuid
from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_current_user
from app.db.base import get_db
from app.models.recording import Recording, RecordingStatus
from app.models.task import Task, TaskStatus
from app.models.user import User
from app.schemas.recording import RecordingOut, UploadResponse

router = APIRouter(prefix="/recordings", tags=["recordings"])

ALLOWED_AUDIO_TYPES = {"audio/mpeg", "audio/ogg", "audio/opus", "audio/wav", "audio/mp4", "audio/x-m4a"}


def _process_audio_task(recording_id: int, keywords: List[str], db_url: str):
    """
    Tarea en segundo plano:
      1. Transcribir con Deepgram nova-2 (inyectando keywords del glosario)
      2. Persistir raw_transcript en Recording
      3. Post-procesar con Gemini 1.5 Flash
      4. Persistir Note y marcar Task como COMPLETED
    """
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    engine = create_engine(db_url)
    SessionBg = sessionmaker(bind=engine)
    db = SessionBg()

    try:
        task = db.query(Task).filter(Task.recording_id == recording_id).first()
        recording = db.query(Recording).filter(Recording.id == recording_id).first()

        if not task or not recording:
            return

        task.status = TaskStatus.PROCESSING
        recording.status = RecordingStatus.PROCESSING
        db.commit()

        # --- Contexto de asignatura (necesario tanto para Deepgram como para Gemini) ---
        from app.models.subject import GlossaryTerm, Subject
        subject_name = "General"
        glossary_terms: list[str] = list(keywords)
        if recording.subject_id:
            subject = db.query(Subject).filter(Subject.id == recording.subject_id).first()
            if subject:
                subject_name = subject.name
                db_terms = db.query(GlossaryTerm.term).filter(GlossaryTerm.subject_id == subject.id).all()
                glossary_terms = list({t[0] for t in db_terms} | set(keywords))

        # --- Paso 1: Transcripción con Deepgram ---
        from app.services.deepgram_service import transcribe_audio
        raw_transcript, language_detected = transcribe_audio(recording.audio_path, glossary_terms)
        recording.raw_transcript = raw_transcript
        recording.language_detected = language_detected
        db.commit()

        # --- Paso 2: Post-procesado con Gemini ---
        from app.services.gemini_service import generate_notes
        note_data = generate_notes(
            raw_transcript=raw_transcript,
            subject_name=subject_name,
            glossary_terms=glossary_terms,
        )

        from app.models.note import Note
        note = Note(
            recording_id=recording_id,
            content_markdown=note_data["content_markdown"],
            key_concepts=note_data["key_concepts"],
            review_questions=note_data["review_questions"],
        )
        db.add(note)
        recording.status = RecordingStatus.COMPLETED
        task.status = TaskStatus.COMPLETED
        db.commit()

    except Exception as exc:
        db.rollback()
        task = db.query(Task).filter(Task.recording_id == recording_id).first()
        recording = db.query(Recording).filter(Recording.id == recording_id).first()
        if task:
            task.status = TaskStatus.FAILED
            task.error_message = str(exc)
        if recording:
            recording.status = RecordingStatus.FAILED
        db.commit()
    finally:
        db.close()


@router.post("/upload", response_model=UploadResponse, status_code=status.HTTP_202_ACCEPTED)
async def upload_recording(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    subject_id: int | None = Form(None),
    topic: str | None = Form(None),
    keywords: str = Form(""),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Recibe un archivo de audio, lo guarda en disco, crea la Recording y la Task,
    y encola el procesamiento asíncrono. Devuelve un task_id para polling.
    """
    if audio.content_type not in ALLOWED_AUDIO_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Formato de audio no soportado: {audio.content_type}",
        )

    # Verificar que el subject_id pertenece al usuario actual
    if subject_id is not None:
        from app.models.subject import Subject
        subject = db.query(Subject).filter(
            Subject.id == subject_id,
            Subject.user_id == current_user.id,
        ).first()
        if not subject:
            raise HTTPException(status_code=404, detail="Asignatura no encontrada")

    os.makedirs(settings.AUDIO_STORAGE_PATH, exist_ok=True)
    file_ext = os.path.splitext(audio.filename or "audio.opus")[1] or ".opus"
    filename = f"{uuid.uuid4()}{file_ext}"
    audio_path = os.path.join(settings.AUDIO_STORAGE_PATH, filename)

    content = await audio.read()
    if len(content) > settings.MAX_AUDIO_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Archivo demasiado grande")

    with open(audio_path, "wb") as f:
        f.write(content)

    recording = Recording(
        user_id=current_user.id,
        subject_id=subject_id,
        topic=topic,
        audio_path=audio_path,
        status=RecordingStatus.PENDING,
    )
    db.add(recording)
    db.flush()

    task = Task(recording_id=recording.id)
    db.add(task)
    db.commit()
    db.refresh(task)

    keyword_list = [k.strip() for k in keywords.split(",") if k.strip()]
    background_tasks.add_task(
        _process_audio_task,
        recording.id,
        keyword_list,
        settings.DATABASE_URL,
    )

    return UploadResponse(task_id=task.id, recording_id=recording.id)


@router.get("/", response_model=List[RecordingOut])
def list_recordings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return (
        db.query(Recording)
        .filter(Recording.user_id == current_user.id)
        .order_by(Recording.created_at.desc())
        .all()
    )


@router.get("/{recording_id}", response_model=RecordingOut)
def get_recording(
    recording_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    recording = (
        db.query(Recording)
        .filter(Recording.id == recording_id, Recording.user_id == current_user.id)
        .first()
    )
    if not recording:
        raise HTTPException(status_code=404, detail="Grabación no encontrada")
    return recording
