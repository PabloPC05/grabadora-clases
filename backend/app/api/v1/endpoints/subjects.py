from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.base import get_db
from app.models.subject import Subject, GlossaryTerm
from app.schemas.subject import SubjectCreate, SubjectOut

router = APIRouter(prefix="/subjects", tags=["subjects"])

# TODO: reemplazar con usuario autenticado real (JWT)
MOCK_USER_ID = 1


@router.get("/", response_model=List[SubjectOut])
def list_subjects(db: Session = Depends(get_db)):
    return db.query(Subject).filter(Subject.user_id == MOCK_USER_ID).all()


@router.post("/", response_model=SubjectOut, status_code=status.HTTP_201_CREATED)
def create_subject(payload: SubjectCreate, db: Session = Depends(get_db)):
    subject = Subject(
        user_id=MOCK_USER_ID,
        name=payload.name,
        description=payload.description,
    )
    db.add(subject)
    db.flush()  # obtener ID sin cerrar la transacción

    for term_data in payload.glossary_terms:
        db.add(GlossaryTerm(subject_id=subject.id, **term_data.model_dump()))

    db.commit()
    db.refresh(subject)
    return subject


@router.get("/{subject_id}", response_model=SubjectOut)
def get_subject(subject_id: int, db: Session = Depends(get_db)):
    subject = db.query(Subject).filter(Subject.id == subject_id, Subject.user_id == MOCK_USER_ID).first()
    if not subject:
        raise HTTPException(status_code=404, detail="Asignatura no encontrada")
    return subject


@router.delete("/{subject_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_subject(subject_id: int, db: Session = Depends(get_db)):
    subject = db.query(Subject).filter(Subject.id == subject_id, Subject.user_id == MOCK_USER_ID).first()
    if not subject:
        raise HTTPException(status_code=404, detail="Asignatura no encontrada")
    db.delete(subject)
    db.commit()
