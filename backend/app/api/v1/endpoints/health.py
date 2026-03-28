from fastapi import APIRouter

router = APIRouter()


@router.get("/health", tags=["health"])
def health_check():
    """Endpoint de prueba para verificar que la API está activa."""
    return {"status": "ok", "service": "grabadora-clases-api"}
