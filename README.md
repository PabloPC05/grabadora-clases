# Grabadora de Clases — App Móvil

Aplicación móvil para estudiantes universitarios que graba clases, transcribe el audio con inyección de contexto técnico (glosarios), y usa un LLM para generar apuntes estructurados y preguntas de repaso.

---

## Stack Tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | React Native + Expo |
| Backend | Python + FastAPI |
| Base de Datos | PostgreSQL + SQLAlchemy |
| STT | Deepgram API (keywords/glosarios) |
| LLM | Gemini 1.5 Flash (`google-generativeai`) |
| Audio (móvil) | expo-av + compresión OPUS/MP3 mono 64kbps |
| Cola de tareas | FastAPI BackgroundTasks (o Celery + Redis) |

---

## Arquitectura General

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Expo)                          │
│                                                                 │
│  [Pantalla Grabación]  →  graba audio (expo-av)                 │
│  [Pantalla Contexto]   →  asignatura, tema, glosario            │
│  [Pantalla Apuntes]    →  polling/WebSocket → muestra .md       │
└────────────────────────────┬────────────────────────────────────┘
                             │ POST /api/v1/recordings/upload
                             │ (audio comprimido + metadata)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                        BACKEND (FastAPI)                        │
│                                                                 │
│  POST /upload  ──►  guarda audio  ──►  encola tarea             │
│                      en disco           (BackgroundTask)        │
│                         │                                       │
│                  devuelve {task_id}                             │
│                                                                 │
│  Worker ──►  Deepgram STT (con keywords del glosario)           │
│         ──►  Gemini 1.5 Flash (limpia, estructura, preguntas)   │
│         ──►  guarda Apunte en PostgreSQL                        │
│                                                                 │
│  GET /tasks/{id}  ──►  {status, note_id?}   (polling)          │
│  GET /notes/{id}  ──►  apunte completo en Markdown             │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      PostgreSQL                                 │
│  users · subjects · glossary_terms · recordings · notes        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Flujo de Datos Detallado

```
1. Usuario abre app
   └─ selecciona/crea Asignatura + añade términos al Glosario

2. Pulsa [Grabar]
   └─ expo-av graba audio crudo
   └─ compresión en cliente → OPUS mono 64kbps

3. Pulsa [Procesar]
   └─ POST /api/v1/recordings/upload
      body: { audio: <multipart>, subject_id, topic, keywords: ["FFT","Nyquist",...] }
   └─ backend responde: { task_id: "uuid" }

4. Backend (BackgroundTask)
   a. Guarda .opus en storage local / S3
   b. Llama Deepgram STT con keywords del glosario
      → transcripción en bruto
   c. Llama Gemini 1.5 Flash:
      prompt_sistema: "Limpia errores, aplica Markdown, extrae conceptos clave,
                       genera 3 preguntas de repaso"
      → apunte estructurado en Markdown
   d. Persiste Recording + Note en PostgreSQL
   e. Actualiza estado de tarea → "completed"

5. Frontend hace polling cada 3s
   GET /api/v1/tasks/{task_id}
   └─ {status: "completed", note_id: 42}
   └─ GET /api/v1/notes/42  →  renderiza Markdown
```

---

## Estructura de Carpetas

```
grabadora-clases/
├── backend/
│   ├── app/
│   │   ├── api/v1/endpoints/   # routers FastAPI
│   │   ├── core/               # config, seguridad, dependencias
│   │   ├── db/                 # sesión SQLAlchemy, base declarativa
│   │   ├── models/             # modelos ORM
│   │   ├── schemas/            # Pydantic schemas (request/response)
│   │   └── services/           # lógica: deepgram, gemini, audio
│   ├── alembic/                # migraciones de base de datos
│   ├── tests/
│   ├── requirements.txt
│   └── main.py
└── frontend/
    ├── src/
    │   ├── screens/            # pantallas principales
    │   ├── components/         # componentes reutilizables
    │   ├── hooks/              # custom hooks (grabación, polling)
    │   ├── services/           # llamadas a la API REST
    │   ├── navigation/         # React Navigation
    │   ├── store/              # estado global (Zustand / Context)
    │   └── types/              # TypeScript types
    ├── assets/
    ├── app.json
    └── package.json
```

---

## Variables de Entorno (backend/.env)

```env
DATABASE_URL=postgresql://user:pass@localhost:5432/grabadora
DEEPGRAM_API_KEY=...
GOOGLE_API_KEY=...
SECRET_KEY=change_me_in_production
AUDIO_STORAGE_PATH=./storage/audio
```

---

## Esquema de Base de Datos

```
users
  id, email, hashed_password, full_name, created_at

subjects
  id, user_id (FK), name, description, created_at

glossary_terms
  id, subject_id (FK), term, definition

recordings
  id, user_id (FK), subject_id (FK), topic, audio_path,
  duration_seconds, status (pending|processing|completed|failed),
  raw_transcript, language_detected, created_at

notes
  id, recording_id (FK 1:1), content_markdown, key_concepts (JSON),
  review_questions (JSON), created_at, updated_at

tasks
  id (UUID), recording_id (FK), status, error_message, created_at, updated_at
```

---

## Puesta en Marcha Rápida (Backend)

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # editar con tus credenciales
alembic upgrade head           # crear tablas
uvicorn main:app --reload
```

API disponible en `http://localhost:8000` · Docs en `http://localhost:8000/docs`
