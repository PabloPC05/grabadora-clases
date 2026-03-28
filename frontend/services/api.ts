import axios from 'axios';
import { API_BASE_URL } from '../constants/Config';
import { useAuthStore } from '../store/authStore';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15_000,
});

// Interceptor: inyecta el JWT en cada petición si existe en el store
apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ─────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────

export interface GlossaryTerm {
  id: number;
  term: string;
  definition?: string;
}

export interface Subject {
  id: number;
  name: string;
  description?: string;
  glossary_terms: GlossaryTerm[];
}

export interface Recording {
  id: number;
  topic?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  language_detected?: string;
  created_at: string;
}

export interface TaskStatus {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  recording_id: number;
  note_id?: number;
  error_message?: string;
}

export interface Note {
  id: number;
  recording_id: number;
  content_markdown: string;
  key_concepts: string[];
  review_questions: string[];
  created_at: string;
}

export interface UploadResponse {
  task_id: string;
  recording_id: number;
  message: string;
}

// ─────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────

export const authApi = {
  register: (email: string, password: string, full_name?: string) =>
    apiClient.post('/auth/register', { email, password, full_name }),

  login: (email: string, password: string) => {
    const form = new URLSearchParams();
    form.append('username', email);
    form.append('password', password);
    return apiClient.post<{ access_token: string; expires_in: number }>(
      '/auth/login',
      form.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
  },

  me: () => apiClient.get('/auth/me'),
};

// ─────────────────────────────────────────────
// Subjects
// ─────────────────────────────────────────────

export const subjectsApi = {
  list: () => apiClient.get<Subject[]>('/subjects'),

  create: (name: string, description?: string, glossary_terms: { term: string }[] = []) =>
    apiClient.post<Subject>('/subjects', { name, description, glossary_terms }),
};

// ─────────────────────────────────────────────
// Recordings
// ─────────────────────────────────────────────

export const recordingsApi = {
  list: () => apiClient.get<Recording[]>('/recordings'),

  upload: (audioUri: string, meta: { subject_id?: number; topic?: string; keywords?: string[] }) => {
    const form = new FormData();
    form.append('audio', { uri: audioUri, name: 'clase.m4a', type: 'audio/mp4' } as any);
    if (meta.subject_id) form.append('subject_id', String(meta.subject_id));
    if (meta.topic) form.append('topic', meta.topic);
    if (meta.keywords?.length) form.append('keywords', meta.keywords.join(','));
    return apiClient.post<UploadResponse>('/recordings/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120_000,
    });
  },
};

// ─────────────────────────────────────────────
// Tasks & Notes
// ─────────────────────────────────────────────

export const tasksApi = {
  getStatus: (taskId: string) => apiClient.get<TaskStatus>(`/tasks/${taskId}`),
};

export const notesApi = {
  get: (noteId: number) => apiClient.get<Note>(`/notes/${noteId}`),
};
