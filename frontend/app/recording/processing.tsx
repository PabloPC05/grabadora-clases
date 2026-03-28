import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { tasksApi, type TaskStatus } from '../../services/api';

const POLL_INTERVAL_MS = 3000;

export default function ProcessingScreen() {
  const { task_id } = useLocalSearchParams<{ task_id: string }>();
  const [taskStatus, setTaskStatus] = useState<TaskStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const router = useRouter();
  const theme = useTheme();

  useEffect(() => {
    if (!task_id) { setError('task_id no encontrado.'); return; }

    const stopPolling = () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    };

    const poll = async () => {
      try {
        const { data } = await tasksApi.getStatus(task_id);
        setTaskStatus(data);
        if (data.status === 'completed') {
          stopPolling();
          setTimeout(() => {
            if (data.note_id) router.replace(`/notes/${data.note_id}`);
            else router.replace(`/recording/${data.recording_id}`);
          }, 1200);
        } else if (data.status === 'failed') {
          stopPolling();
          setError(data.error_message ?? 'El procesamiento ha fallado.');
        }
      } catch { /* errores de red: seguir intentando */ }
    };

    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return stopPolling;
  }, [task_id]);

  const status = taskStatus?.status ?? 'pending';
  const isError = status === 'failed' || !!error;
  const isCompleted = status === 'completed';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <View style={styles.container}>
        <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
          {isError ? (
            <>
              <Ionicons name="close-circle" size={56} color={theme.colors.error} style={styles.icon} />
              <Text style={[styles.title, { color: theme.colors.text }]}>Algo salió mal</Text>
              <Text style={[styles.detail, { color: theme.colors.textSecondary }]}>{error ?? 'Error desconocido.'}</Text>
              <Pressable style={[styles.button, { backgroundColor: theme.colors.primary }]} onPress={() => router.replace('/(tabs)')}>
                <Text style={styles.buttonText}>Volver al inicio</Text>
              </Pressable>
            </>
          ) : isCompleted ? (
            <>
              <Ionicons name="checkmark-circle" size={56} color={theme.colors.success} style={styles.icon} />
              <Text style={[styles.title, { color: theme.colors.text }]}>¡Transcripción lista!</Text>
              <Text style={[styles.detail, { color: theme.colors.textSecondary }]}>Abriendo resultado...</Text>
            </>
          ) : (
            <>
              <ActivityIndicator size="large" color={theme.colors.primary} style={styles.icon} />
              <Text style={[styles.title, { color: theme.colors.text }]}>Procesando clase</Text>
              <Text style={[styles.detail, { color: theme.colors.textSecondary }]}>
                {status === 'pending' ? 'Tarea en cola...' : 'Transcribiendo audio...'}
              </Text>
              <View style={[styles.stepRow, { borderColor: theme.colors.border }]}>
                <View style={[styles.stepDot, status !== 'pending' && { backgroundColor: theme.colors.success, borderColor: theme.colors.success }]} />
                <Text style={[styles.stepLabel, status !== 'pending' && { color: theme.colors.success, fontWeight: '600' }]}>
                  Transcripción (Deepgram)
                </Text>
              </View>
              <Text style={[styles.hint, { color: theme.colors.textTertiary }]}>
                Esto puede tardar entre 30 y 90 segundos según la duración de la clase.
              </Text>
            </>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1, justifyContent: 'center', padding: 24 },
  card: {
    borderRadius: 20, padding: 32, alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 16, elevation: 4,
  },
  icon: { marginBottom: 16 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  detail: { fontSize: 14, textAlign: 'center', marginBottom: 24 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%', marginBottom: 24 },
  stepDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: 'transparent', borderWidth: 2, borderColor: '#94a3b8' },
  stepLabel: { fontSize: 14, color: '#94a3b8' },
  hint: { fontSize: 12, textAlign: 'center' },
  button: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32, marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
