import * as SQLite from 'expo-sqlite';
import type { Recording, Note, Subject } from './api';

const db = SQLite.openDatabaseSync('grabadora.db');

export function initDb() {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS recordings_cache (
      id INTEGER PRIMARY KEY,
      topic TEXT,
      status TEXT,
      raw_transcript TEXT,
      language_detected TEXT,
      created_at TEXT,
      subject_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS notes_cache (
      id INTEGER PRIMARY KEY,
      recording_id INTEGER,
      content_markdown TEXT,
      key_concepts TEXT,
      review_questions TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS subjects_cache (
      id INTEGER PRIMARY KEY,
      name TEXT,
      description TEXT
    );
  `);
}

// ── Recordings ─────────────────────────────────────────────────────────────

export function saveRecordings(recordings: Recording[]) {
  for (const r of recordings) {
    db.runSync(
      `INSERT OR REPLACE INTO recordings_cache
       (id, topic, status, raw_transcript, language_detected, created_at, subject_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [r.id, r.topic ?? null, r.status, r.raw_transcript ?? null,
       r.language_detected ?? null, r.created_at, (r as any).subject_id ?? null],
    );
  }
}

export function getCachedRecordings(): Recording[] {
  return (db.getAllSync('SELECT * FROM recordings_cache ORDER BY created_at DESC') as any[]).map(
    (r) => ({ ...r, subject_id: r.subject_id ?? undefined }),
  );
}

export function saveRecording(r: Recording) {
  db.runSync(
    `INSERT OR REPLACE INTO recordings_cache
     (id, topic, status, raw_transcript, language_detected, created_at, subject_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [r.id, r.topic ?? null, r.status, r.raw_transcript ?? null,
     r.language_detected ?? null, r.created_at, (r as any).subject_id ?? null],
  );
}

// ── Notes ───────────────────────────────────────────────────────────────────

export function saveNote(note: Note) {
  db.runSync(
    `INSERT OR REPLACE INTO notes_cache
     (id, recording_id, content_markdown, key_concepts, review_questions, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [note.id, note.recording_id, note.content_markdown,
     JSON.stringify(note.key_concepts), JSON.stringify(note.review_questions), note.created_at],
  );
}

export function getCachedNote(noteId: number): Note | null {
  const row = db.getFirstSync('SELECT * FROM notes_cache WHERE id = ?', [noteId]) as any;
  if (!row) return null;
  return {
    ...row,
    key_concepts: JSON.parse(row.key_concepts ?? '[]'),
    review_questions: JSON.parse(row.review_questions ?? '[]'),
  };
}

// ── Subjects ────────────────────────────────────────────────────────────────

export function saveSubjects(subjects: Subject[]) {
  for (const s of subjects) {
    db.runSync(
      `INSERT OR REPLACE INTO subjects_cache (id, name, description) VALUES (?, ?, ?)`,
      [s.id, s.name, s.description ?? null],
    );
  }
}

export function getCachedSubjects(): Pick<Subject, 'id' | 'name' | 'description'>[] {
  return db.getAllSync('SELECT * FROM subjects_cache ORDER BY name ASC') as any[];
}

export function deleteCachedSubject(id: number) {
  db.runSync('DELETE FROM subjects_cache WHERE id = ?', [id]);
}
