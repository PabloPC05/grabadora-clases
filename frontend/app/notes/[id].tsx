import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import { notesApi, type Note } from '../../services/api';

export default function NoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!id) return;
    notesApi.get(Number(id))
      .then(({ data }) => setNote(data))
      .catch(() => setError('No se pudo cargar el apunte.'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  if (error || !note) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error ?? 'Apunte no encontrado.'}</Text>
        <Pressable style={styles.button} onPress={() => router.back()}>
          <Text style={styles.buttonText}>Volver</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Conceptos clave */}
      {note.key_concepts.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Conceptos clave</Text>
          <View style={styles.chips}>
            {note.key_concepts.map((c, i) => (
              <View key={i} style={styles.chip}>
                <Text style={styles.chipText}>{c}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Apuntes en Markdown */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Apuntes</Text>
        <Markdown style={markdownStyles}>{note.content_markdown}</Markdown>
      </View>

      {/* Preguntas de repaso */}
      {note.review_questions.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Preguntas de repaso</Text>
          {note.review_questions.map((q, i) => (
            <View key={i} style={styles.questionCard}>
              <Text style={styles.questionNumber}>{i + 1}</Text>
              <Text style={styles.questionText}>{q}</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={styles.timestamp}>
        Generado el{' '}
        {new Date(note.created_at).toLocaleDateString('es-ES', {
          day: '2-digit', month: 'long', year: 'numeric',
        })}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f5f9' },
  content: { padding: 20, paddingBottom: 48 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  errorText: { fontSize: 16, color: '#ef4444', marginBottom: 16, textAlign: 'center' },
  button: { backgroundColor: '#6366f1', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 28 },
  buttonText: { color: '#fff', fontWeight: '600' },
  section: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16,
    marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#6366f1', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: '#eef2ff', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  chipText: { fontSize: 13, color: '#6366f1', fontWeight: '500' },
  questionCard: {
    flexDirection: 'row', gap: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  questionNumber: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: '#6366f1',
    color: '#fff', fontSize: 12, fontWeight: '700', textAlign: 'center', lineHeight: 24,
  },
  questionText: { flex: 1, fontSize: 15, color: '#334155', lineHeight: 22 },
  timestamp: { fontSize: 12, color: '#94a3b8', textAlign: 'center', marginTop: 8 },
});

const markdownStyles = StyleSheet.create({
  body: { color: '#334155', fontSize: 15, lineHeight: 24 },
  heading1: { fontSize: 22, fontWeight: '700', color: '#1e293b', marginVertical: 12 },
  heading2: { fontSize: 18, fontWeight: '700', color: '#1e293b', marginVertical: 10 },
  heading3: { fontSize: 16, fontWeight: '600', color: '#334155', marginVertical: 8 },
  strong: { fontWeight: '700', color: '#1e293b' },
  bullet_list_icon: { color: '#6366f1' },
  code_inline: { backgroundColor: '#f1f5f9', color: '#6366f1', borderRadius: 4, paddingHorizontal: 4 },
  fence: { backgroundColor: '#f8fafc', borderRadius: 8, padding: 12 },
});
