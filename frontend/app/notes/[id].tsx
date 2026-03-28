import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Markdown from 'react-native-markdown-display';
import { useTheme } from '../../context/ThemeContext';
import { notesApi, type Note } from '../../services/api';
import { getCachedNote, saveNote } from '../../services/localDb';

export default function NoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const theme = useTheme();

  useEffect(() => {
    if (!id) return;
    notesApi.get(Number(id))
      .then(({ data }) => { saveNote(data); setNote(data); })
      .catch(() => {
        const cached = getCachedNote(Number(id));
        if (cached) setNote(cached);
        else setError('No se pudo cargar el apunte.');
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (error || !note) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: theme.colors.error }]}>{error ?? 'Apunte no encontrado.'}</Text>
          <Pressable style={[styles.button, { backgroundColor: theme.colors.primary }]} onPress={() => router.back()}>
            <Text style={styles.buttonText}>Volver</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const markdownStyles = {
    body: { color: theme.colors.text, fontSize: 15, lineHeight: 24 },
    heading1: { fontSize: 22, fontWeight: '700' as const, color: theme.colors.text, marginVertical: 12 },
    heading2: { fontSize: 18, fontWeight: '700' as const, color: theme.colors.text, marginVertical: 10 },
    heading3: { fontSize: 16, fontWeight: '600' as const, color: theme.colors.textSecondary, marginVertical: 8 },
    strong: { fontWeight: '700' as const, color: theme.colors.text },
    code_inline: { backgroundColor: theme.colors.primaryLight, color: theme.colors.primary, borderRadius: 4, paddingHorizontal: 4 },
    fence: { backgroundColor: theme.colors.surfaceSecondary, borderRadius: 8, padding: 12 },
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {note.key_concepts.length > 0 && (
          <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>Conceptos clave</Text>
            <View style={styles.chips}>
              {note.key_concepts.map((c, i) => (
                <View key={i} style={[styles.chip, { backgroundColor: theme.colors.primaryLight }]}>
                  <Text style={[styles.chipText, { color: theme.colors.primary }]}>{c}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>Apuntes</Text>
          <Markdown style={markdownStyles}>{note.content_markdown}</Markdown>
        </View>

        {note.review_questions.length > 0 && (
          <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>Preguntas de repaso</Text>
            {note.review_questions.map((q, i) => (
              <View key={i} style={[styles.questionCard, { borderBottomColor: theme.colors.border }]}>
                <View style={[styles.questionNumber, { backgroundColor: theme.colors.primary }]}>
                  <Text style={styles.questionNumberText}>{i + 1}</Text>
                </View>
                <Text style={[styles.questionText, { color: theme.colors.text }]}>{q}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={[styles.timestamp, { color: theme.colors.textTertiary }]}>
          Generado el{' '}
          {new Date(note.created_at).toLocaleDateString('es-ES', {
            day: '2-digit', month: 'long', year: 'numeric',
          })}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  content: { padding: 20, paddingBottom: 48 },
  errorText: { fontSize: 16, marginBottom: 16, textAlign: 'center' },
  button: { borderRadius: 10, paddingVertical: 12, paddingHorizontal: 28 },
  buttonText: { color: '#fff', fontWeight: '600' },
  section: {
    borderRadius: 14, padding: 16, marginBottom: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  sectionTitle: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  chipText: { fontSize: 13, fontWeight: '500' },
  questionCard: { flexDirection: 'row', gap: 12, paddingVertical: 10, borderBottomWidth: 1 },
  questionNumber: { width: 24, height: 24, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  questionNumberText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  questionText: { flex: 1, fontSize: 15, lineHeight: 22 },
  timestamp: { fontSize: 12, textAlign: 'center', marginTop: 8 },
});
