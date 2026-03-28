"""
Fixtures de pytest compartidas por todos los tests.

Usa SQLite en memoria para no requerir PostgreSQL en CI.
Los enums de SQLAlchemy se renderizan como VARCHAR en SQLite automáticamente.
"""

import os

# Apuntar a SQLite ANTES de que cualquier módulo de la app cree el engine
os.environ["DATABASE_URL"] = "sqlite:///./test_grabadora.db"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

TEST_DATABASE_URL = "sqlite:///./test_grabadora.db"

engine = create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(scope="session", autouse=True)
def create_tables():
    """Crea todas las tablas al inicio de la sesión de tests y las elimina al final."""
    from app.db.base import Base
    import app.models  # noqa: F401 — registra todos los modelos en Base.metadata
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def db():
    """Sesión de BD aislada por test: hace rollback al terminar."""
    connection = engine.connect()
    transaction = connection.begin()
    session = TestingSessionLocal(bind=connection)
    yield session
    session.close()
    transaction.rollback()
    connection.close()


@pytest.fixture()
def client(db):
    """TestClient con la dependencia get_db sobreescrita por la sesión de test."""
    from main import app
    from app.db.base import get_db

    def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
