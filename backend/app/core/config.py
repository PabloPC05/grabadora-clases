from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Base
    PROJECT_NAME: str = "Grabadora de Clases API"
    API_V1_STR: str = "/api/v1"

    # Base de datos
    DATABASE_URL: str = "postgresql://user:pass@localhost:5432/grabadora"

    # Servicios externos
    DEEPGRAM_API_KEY: str = ""
    GOOGLE_API_KEY: str = ""

    # Seguridad
    SECRET_KEY: str = "change_me_in_production"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 días

    # Almacenamiento de audio
    AUDIO_STORAGE_PATH: str = "./storage/audio"
    MAX_AUDIO_SIZE_MB: int = 200

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
