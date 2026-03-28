import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { tasksApi, type TaskStatus } from '../../services/api';

const POLL_INTERVAL_MS = 3000;

const STEP_MESSAGES: Record<string, string> = {
  pending: 'Tarea en cola...',
  processing: 'Transcribiendo audio...',
  completed: '¡Transcripción lista!',
  failed: 'Ha ocurrido un error.',
};

export default function ProcessingScreen() {
  const { task_id } = useLocalSearchParams<{ task_id: string }>();
  const [taskStatus, setTaskStatus] = useState<TaskStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!task_id) {
      setError('task_id no encontrado.');
      return;
    }

    const poll = async () => {
      try {
        const { data } = await tasksApi.getStatus(task_id);
        setTaskStatus(data);

        if (data.status === 'completed') {
          stopPolling();
          setTimeout(() => {
            if (data.note_id) {
              router.replace(`/notes/${data.note_id}`);
            } else {
              router.replace(`/recording/${data.recording_id}`);
            }
          }, 1200);
        } else if (data.status === 'failed') {
          stopPolling();
          setError(data.error_message ?? 'El procesamiento ha fallado.');
        }
      } catch {
        // errores de red: seguir intentando (se parará cuando falle demasiado)
      }
    };

    const stopPolling = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    poll(); // llamada inmediata
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return stopPolling;
  }, [task_id]);

  const status = taskStatus?.status ?? 'pending';
  const isError = status === 'failed' || !!error;

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        {isError ? (
          <>
            <Text style={styles.errorIcon}>✕</Text>
            <Text style={styles.title}>Algo salió mal</Text>
            <Text style={styles.detail}>{error ?? 'Error desconocido.'}</Text>
            <Pressable style={styles.button} onPress={() => router.replace('/(tabs)')}>
              <Text style={styles.buttonText}>Volver al inicio</Text>
            </Pressable>
          </>
        ) : status === 'completed' ? (
          <>
            <Text style={styles.successIcon}>✓</Text>
            <Text style={styles.title}>¡Apuntes listos!</Text>
            <Text style={styles.detail}>Abriendo tu resumen...</Text>
          </>
        ) : (
          <>
            <ActivityIndicator size="large" color="#6366f1" style={styles.spinner} />
            <Text style={styles.title}>Procesando clase</Text>
            <Text style={styles.detail}>{STEP_MESSAGES[status]}</Text>

            <View style={styles.steps}>
              <StepRow label="Transcripción (Deepgram)" done={status !== 'pending'} />
            </View>

            <Text style={styles.hint}>
              Esto puede tardar entre 30 y 90 segundos según la duración de la clase.
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

function StepRow({ label, done }: { label: string; done: boolean }) {
  return (
    <View style={stepStyles.row}>
      <View style={[stepStyles.dot, done && stepStyles.dotDone]} />
      <Text style={[stepStyles.label, done && stepStyles.labelDone]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f5f9', justifyContent: 'center', padding: 24 },
  card: {
    backgroundColor: '#fff', borderRadius: 20, padding: 32, alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 16, elevation: 4,
  },
  spinner: { marginBottom: 20 },
  title: { fontSize: 22, fontWeight: '700', color: '#1e293b', marginBottom: 8, textAlign: 'center' },
  detail: { fontSize: 14, color: '#64748b', textAlign: 'center', marginBottom: 24 },
  steps: { width: '100%', gap: 12, marginBottom: 24 },
  hint: { fontSize: 12, color: '#94a3b8', textAlign: 'center' },
  successIcon: { fontSize: 52, color: '#10b981', marginBottom: 12 },
  errorIcon: { fontSize: 52, color: '#ef4444', marginBottom: 12 },
  button: { backgroundColor: '#6366f1', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32, marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

const stepStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#e2e8f0', borderWidth: 2, borderColor: '#94a3b8' },
  dotDone: { backgroundColor: '#10b981', borderColor: '#10b981' },
  label: { fontSize: 14, color: '#94a3b8' },
  labelDone: { color: '#10b981', fontWeight: '600' },
});
