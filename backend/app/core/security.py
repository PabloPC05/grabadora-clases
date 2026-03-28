"""
Utilidades de seguridad: hashing de contraseñas y tokens JWT (HS256).

Implementación deliberadamente sin dependencias de terceros para JWT:
usa stdlib (hmac, hashlib, base64, json) para evitar conflictos con el
paquete `cryptography` del sistema. Passlib se sustituye por bcrypt directo.
"""

import base64
import hashlib
import hmac
import json
import time
from datetime import timedelta
from typing import Any

import bcrypt

from app.core.config import settings

ALGORITHM = "HS256"


# ---------------------------------------------------------------------------
# Excepción propia (sustituye JWTError de librerías externas)
# ---------------------------------------------------------------------------

class JWTError(Exception):
    """Token inválido, mal firmado o expirado."""


# ---------------------------------------------------------------------------
# Contraseñas
# ---------------------------------------------------------------------------

def hash_password(plain_password: str) -> str:
    return bcrypt.hashpw(plain_password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode(), hashed_password.encode())


# ---------------------------------------------------------------------------
# JWT HS256 — implementación con stdlib
# ---------------------------------------------------------------------------

def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(s: str) -> bytes:
    padding = (4 - len(s) % 4) % 4
    return base64.urlsafe_b64decode(s + "=" * padding)


def _sign(signing_input: str) -> str:
    return _b64url_encode(
        hmac.new(settings.SECRET_KEY.encode(), signing_input.encode(), hashlib.sha256).digest()
    )


def create_access_token(subject: Any, expires_delta: timedelta | None = None) -> str:
    """
    Genera un JWT HS256 firmado.

    Args:
        subject:       Valor para el claim `sub` (normalmente user.id).
        expires_delta: Duración del token; si es None usa ACCESS_TOKEN_EXPIRE_MINUTES.
    """
    exp = int(time.time()) + int(
        (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)).total_seconds()
    )
    header = _b64url_encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = _b64url_encode(json.dumps({"sub": str(subject), "exp": exp}).encode())
    signing_input = f"{header}.{payload}"
    return f"{signing_input}.{_sign(signing_input)}"


def decode_access_token(token: str) -> dict:
    """
    Decodifica y valida un JWT. Lanza JWTError si es inválido o expirado.
    """
    parts = token.split(".")
    if len(parts) != 3:
        raise JWTError("Formato de token inválido")

    header_b64, payload_b64, signature_b64 = parts
    signing_input = f"{header_b64}.{payload_b64}"

    expected = _sign(signing_input)
    if not hmac.compare_digest(expected, signature_b64):
        raise JWTError("Firma inválida")

    try:
        data = json.loads(_b64url_decode(payload_b64))
    except Exception as exc:
        raise JWTError("Payload inválido") from exc

    if "exp" in data and data["exp"] < time.time():
        raise JWTError("Token expirado")

    return data
