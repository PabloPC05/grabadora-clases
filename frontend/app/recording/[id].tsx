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
import { recordingsApi, type Recording } from '../../services/api';

export default function RecordingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [recording, setRecording] = useState<Recording | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!id) return;
    recordingsApi.get(Number(id))
      .then(({ data }) => setRecording(data))
      .catch(() => setError('No se pudo cargar la transcripción.'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  if (error || !recording) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error ?? 'Grabación no encontrada.'}</Text>
        <Pressable style={styles.button} onPress={() => router.replace('/(tabs)')}>
          <Text style={styles.buttonText}>Volver al inicio</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {recording.topic && (
        <Text style={styles.topic}>{recording.topic}</Text>
      )}

      <Text style={styles.date}>
        {new Date(recording.created_at).toLocaleDateString('es-ES', {
          day: '2-digit', month: 'long', year: 'numeric',
        })}
      </Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Transcripción</Text>
        {recording.raw_transcript ? (
          <Text style={styles.transcript}>{recording.raw_transcript}</Text>
        ) : (
          <Text style={styles.empty}>No hay transcripción disponible.</Text>
        )}
      </View>

      <Pressable style={styles.button} onPress={() => router.replace('/(tabs)')}>
        <Text style={styles.buttonText}>Volver al inicio</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f5f9' },
  content: { padding: 20, paddingBottom: 48 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  topic: { fontSize: 22, fontWeight: '700', color: '#1e293b', marginBottom: 4 },
  date: { fontSize: 13, color: '#94a3b8', marginBottom: 20 },
  section: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16,
    marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#6366f1', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
  transcript: { fontSize: 15, color: '#334155', lineHeight: 26 },
  empty: { fontSize: 14, color: '#94a3b8', fontStyle: 'italic' },
  errorText: { fontSize: 16, color: '#ef4444', marginBottom: 16, textAlign: 'center' },
  button: { backgroundColor: '#6366f1', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
