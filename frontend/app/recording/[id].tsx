import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { recordingsApi, type Recording } from '../../services/api';
import { getCachedRecordings, saveRecording } from '../../services/localDb';

export default function RecordingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [recording, setRecording] = useState<Recording | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const router = useRouter();
  const theme = useTheme();

  useEffect(() => {
    if (!id) return;
    recordingsApi.get(Number(id))
      .then(({ data }) => {
        saveRecording(data);
        setRecording(data);
      })
      .catch(() => {
        const cached = getCachedRecordings().find((r) => r.id === Number(id));
        if (cached) { setRecording(cached); setOffline(true); }
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

  if (!recording) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: theme.colors.error }]}>Grabación no encontrada.</Text>
          <Pressable style={[styles.button, { backgroundColor: theme.colors.primary }]} onPress={() => router.replace('/(tabs)')}>
            <Text style={styles.buttonText}>Volver al inicio</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]} edges={['bottom']}>
      {offline && (
        <View style={[styles.offlineBanner, { backgroundColor: theme.colors.warning }]}>
          <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
          <Text style={styles.offlineText}>Mostrando datos guardados localmente</Text>
        </View>
      )}
      <ScrollView contentContainerStyle={styles.content}>
        {recording.topic && (
          <Text style={[styles.topic, { color: theme.colors.text }]}>{recording.topic}</Text>
        )}
        <Text style={[styles.date, { color: theme.colors.textTertiary }]}>
          {new Date(recording.created_at).toLocaleDateString('es-ES', {
            day: '2-digit', month: 'long', year: 'numeric',
          })}
        </Text>

        <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>Transcripción</Text>
          {recording.raw_transcript ? (
            <Text style={[styles.transcript, { color: theme.colors.text }]}>
              {recording.raw_transcript}
            </Text>
          ) : (
            <Text style={[styles.empty, { color: theme.colors.textTertiary }]}>
              No hay transcripción disponible.
            </Text>
          )}
        </View>

        <Pressable style={[styles.button, { backgroundColor: theme.colors.primary }]} onPress={() => router.replace('/(tabs)')}>
          <Text style={styles.buttonText}>Volver al inicio</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  offlineBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 8 },
  offlineText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  content: { padding: 20, paddingBottom: 48 },
  topic: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
  date: { fontSize: 13, marginBottom: 20 },
  section: {
    borderRadius: 14, padding: 16, marginBottom: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  sectionTitle: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
  transcript: { fontSize: 15, lineHeight: 26 },
  empty: { fontSize: 14, fontStyle: 'italic' },
  errorText: { fontSize: 16, marginBottom: 16, textAlign: 'center' },
  button: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
