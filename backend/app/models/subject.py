from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship

from app.db.base import Base


class Subject(Base):
    """Asignatura del usuario. Agrupa grabaciones y tiene su propio glosario."""

    __tablename__ = "subjects"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relaciones
    owner = relationship("User", back_populates="subjects")
    glossary_terms = relationship("GlossaryTerm", back_populates="subject", cascade="all, delete-orphan")
    recordings = relationship("Recording", back_populates="subject")


class GlossaryTerm(Base):
    """
    Término técnico del glosario de una asignatura.
    Se envían como `keywords` a Deepgram para reducir alucinaciones STT.
    """

    __tablename__ = "glossary_terms"

    id = Column(Integer, primary_key=True, index=True)
    subject_id = Column(Integer, ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False, index=True)
    term = Column(String(255), nullable=False)
    definition = Column(Text, nullable=True)

    # Relaciones
    subject = relationship("Subject", back_populates="glossary_terms")
