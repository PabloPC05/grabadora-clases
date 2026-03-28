import axios from "axios";

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 10_000,
});

// --- Tipos ---
export interface Subject {
  id: number;
  name: string;
  description?: string;
  glossary_terms: { id: number; term: string; definition?: string }[];
}

export interface UploadResponse {
  task_id: string;
  recording_id: number;
  message: string;
}

export interface TaskStatus {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
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
}

// --- Subjects ---
export const getSubjects = () => apiClient.get<Subject[]>("/subjects").then((r) => r.data);

export const createSubject = (payload: {
  name: string;
  description?: string;
  glossary_terms?: { term: string; definition?: string }[];
}) => apiClient.post<Subject>("/subjects", payload).then((r) => r.data);

// --- Recordings ---
export const uploadRecording = (
  audioUri: string,
  meta: { subject_id?: number; topic?: string; keywords?: string[] }
) => {
  const form = new FormData();
  form.append("audio", { uri: audioUri, name: "clase.opus", type: "audio/opus" } as any);
  if (meta.subject_id) form.append("subject_id", String(meta.subject_id));
  if (meta.topic) form.append("topic", meta.topic);
  if (meta.keywords?.length) form.append("keywords", meta.keywords.join(","));

  return apiClient
    .post<UploadResponse>("/recordings/upload", form, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 60_000,
    })
    .then((r) => r.data);
};

// --- Tasks (polling) ---
export const getTaskStatus = (taskId: string) =>
  apiClient.get<TaskStatus>(`/tasks/${taskId}`).then((r) => r.data);

// --- Notes ---
export const getNote = (noteId: number) =>
  apiClient.get<Note>(`/notes/${noteId}`).then((r) => r.data);
