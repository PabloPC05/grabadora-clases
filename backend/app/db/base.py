from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from typing import Generator

Base = declarative_base()

# El engine se crea la primera vez que se necesita (lazy).
# Esto permite a los tests sobreescribir DATABASE_URL antes de importar la app.
_engine = None
_SessionLocal = None


def _init_engine():
    global _engine, _SessionLocal
    if _engine is None:
        from app.core.config import settings
        _engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True)
        _SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)
    return _engine, _SessionLocal


def get_db() -> Generator[Session, None, None]:
    _, SessionLocal = _init_engine()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
