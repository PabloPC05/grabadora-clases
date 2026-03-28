# ── Build stage: instala dependencias en una capa separada ──────────────────
FROM python:3.11-slim AS builder

WORKDIR /app

# Dependencias del sistema mínimas para compilar bcrypt y psycopg2-binary
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


# ── Runtime stage: imagen final ligera ──────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app

# Copiar sólo los paquetes instalados (sin gcc ni libpq-dev)
COPY --from=builder /install /usr/local

# Código fuente
COPY . .

# Crear directorio de almacenamiento de audio
RUN mkdir -p storage/audio

# Usuario no-root para no correr el servidor como root
RUN adduser --disabled-password --gecos "" appuser && chown -R appuser /app
USER appuser

EXPOSE 8000

ENTRYPOINT ["./entrypoint.sh"]
