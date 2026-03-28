#!/bin/sh
set -e

echo "⏳ Esperando a que PostgreSQL esté listo..."
# Reintento simple hasta que la DB acepte conexiones
until python -c "
import sqlalchemy, os
e = sqlalchemy.create_engine(os.environ['DATABASE_URL'])
e.connect().close()
" 2>/dev/null; do
  echo "   PostgreSQL no disponible aún, reintentando en 2s..."
  sleep 2
done

echo "✅ PostgreSQL listo. Aplicando migraciones..."
alembic upgrade head

echo "🚀 Arrancando servidor FastAPI..."
exec uvicorn main:app --host 0.0.0.0 --port 8000
