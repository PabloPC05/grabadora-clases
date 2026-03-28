import { Audio } from 'expo-av';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { recordingsApi, subjectsApi, type Subject } from '../../services/api';

type Step = 'context' | 'recording';

export default function NewRecordingScreen() {
  // ── Navegación entre pasos ──────────────────────────────────────────────
  const [step, setStep] = useState<Step>('context');

  // ── Paso 1: Contexto ────────────────────────────────────────────────────
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(null);
  const [topic, setTopic] = useState('');
  const [keywordsText, setKeywordsText] = useState('');
  const [generateSummary, setGenerateSummary] = useState(false);
  const [loadingSubjects, setLoadingSubjects] = useState(true);

  // ── Paso 2: Grabación ───────────────────────────────────────────────────
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0); // segundos
  const [uploading, setUploading] = useState(false);
  const [meterLevels, setMeterLevels] = useState<number[]>(Array(20).fill(0));

  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const router = useRouter();

  // Cargar asignaturas al montar
  useEffect(() => {
    subjectsApi.list()
      .then(({ data }) => setSubjects(data))
      .catch(() => {}) // la lista de asignaturas es opcional
      .finally(() => setLoadingSubjects(false));
  }, []);

  // Limpiar timer al desmontar
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // ── Paso 1: avanzar al paso de grabación ──────────────────────────────
  const goToRecording = () => {
    setStep('recording');
  };

  // ── Paso 2: iniciar grabación ─────────────────────────────────────────
  const startRecording = async () => {
    const { granted } = await Audio.requestPermissionsAsync();
    if (!granted) {
      Alert.alert('Permiso denegado', 'La app necesita acceso al micrófono.');
      return;
    }
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });

    const { recording } = await Audio.Recording.createAsync(
      {
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
      },
      (status) => {
        if (status.isRecording && status.metering !== undefined) {
          // metering va de -160 (silencio) a 0 (máximo). Normalizamos a 0-1.
          const normalized = Math.max(0, (status.metering + 60) / 60);
          setMeterLevels((prev) => [...prev.slice(1), normalized]);
        }
      },
      80, // actualizar cada 80ms
    );
    recordingRef.current = recording;
    setIsRecording(true);
    setRecordingDuration(0);
    setMeterLevels(Array(20).fill(0));

    timerRef.current = setInterval(() => {
      setRecordingDuration((d) => d + 1);
    }, 1000);
  };

  // ── Paso 2: detener y subir ───────────────────────────────────────────
  const stopAndUpload = async () => {
    if (!recordingRef.current) return;

    // Detener timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    setIsRecording(false);
    setUploading(true);

    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      if (!uri) throw new Error('No se pudo obtener el URI del audio.');

      // Verificar que el archivo tiene contenido
      const { File } = await import('expo-file-system/next');
      const file = new File(uri);
      if (!file.exists || file.size < 1000) {
        throw new Error('El archivo de audio está vacío o es demasiado corto. Comprueba que el micrófono funciona.');
      }

      const keywords = keywordsText
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);

      const { data } = await recordingsApi.upload(uri, {
        subject_id: selectedSubjectId ?? undefined,
        topic: topic.trim() || undefined,
        keywords,
        generate_summary: generateSummary,
      });

      // Navegar a la pantalla de espera con el task_id
      router.replace(`/recording/processing?task_id=${data.task_id}`);
    } catch (err: any) {
      Alert.alert('Error al subir', err?.message ?? 'Inténtalo de nuevo.');
      setUploading(false);
    }
  };

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // ── Render ────────────────────────────────────────────────────────────
  if (step === 'context') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Nuevo apunte</Text>
        <Text style={styles.subheading}>
          Añade contexto para mejorar la transcripción.
        </Text>

        <Text style={styles.label}>Tema de la clase (opcional)</Text>
        <TextInput
          style={styles.input}
          placeholder="Ej: Transformada de Fourier"
          placeholderTextColor="#9ca3af"
          value={topic}
          onChangeText={setTopic}
        />

        <Text style={styles.label}>Asignatura</Text>
        {loadingSubjects ? (
          <ActivityIndicator color="#6366f1" style={{ marginVertical: 12 }} />
        ) : subjects.length === 0 ? (
          <Text style={styles.hint}>Sin asignaturas. Créalas desde el perfil.</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
            <Pressable
              style={[styles.chip, selectedSubjectId === null && styles.chipSelected]}
              onPress={() => setSelectedSubjectId(null)}
            >
              <Text style={[styles.chipText, selectedSubjectId === null && styles.chipTextSelected]}>
                Ninguna
              </Text>
            </Pressable>
            {subjects.map((s) => (
              <Pressable
                key={s.id}
                style={[styles.chip, selectedSubjectId === s.id && styles.chipSelected]}
                onPress={() => setSelectedSubjectId(s.id)}
              >
                <Text style={[styles.chipText, selectedSubjectId === s.id && styles.chipTextSelected]}>
                  {s.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        <Text style={styles.label}>Palabras clave / Glosario</Text>
        <TextInput
          style={[styles.input, styles.inputMultiline]}
          placeholder="Ej: FFT, Nyquist, convolución, señal discreta"
          placeholderTextColor="#9ca3af"
          value={keywordsText}
          onChangeText={setKeywordsText}
          multiline
        />
        <Text style={styles.hint}>Separa los términos con comas.</Text>

        <View style={styles.summaryToggle}>
          <View style={styles.summaryToggleText}>
            <Text style={styles.label}>Generar resumen con IA</Text>
            <Text style={styles.hint}>Usa Gemini para crear apuntes y preguntas de repaso a partir de la transcripción.</Text>
          </View>
          <Switch
            value={generateSummary}
            onValueChange={setGenerateSummary}
            trackColor={{ false: '#e2e8f0', true: '#a5b4fc' }}
            thumbColor={generateSummary ? '#6366f1' : '#94a3b8'}
          />
        </View>

        <Pressable style={styles.button} onPress={goToRecording}>
          <Text style={styles.buttonText}>Continuar →</Text>
        </Pressable>
      </ScrollView>
    );
  }

  // Paso 2: Grabación
  return (
    <View style={styles.container}>
      <View style={styles.recorderCard}>
        <Text style={styles.heading}>
          {isRecording ? 'Grabando...' : 'Listo para grabar'}
        </Text>

        {/* Cronómetro */}
        <Text style={styles.timer}>{formatDuration(recordingDuration)}</Text>

        {/* Visualizador de onda con metering real del micrófono */}
        <View style={styles.waveContainer}>
          {meterLevels.map((level, i) => (
            <View
              key={i}
              style={[
                styles.waveBar,
                {
                  height: isRecording ? 6 + level * 42 : 6,
                  opacity: isRecording ? 0.5 + level * 0.5 : 0.2,
                },
              ]}
            />
          ))}
        </View>

        {/* Botón principal */}
        {!uploading ? (
          <Pressable
            style={[styles.recButton, isRecording && styles.recButtonStop]}
            onPress={isRecording ? stopAndUpload : startRecording}
          >
            <View style={isRecording ? styles.stopIcon : styles.micIcon} />
          </Pressable>
        ) : (
          <View style={styles.uploadingContainer}>
            <ActivityIndicator size="large" color="#6366f1" />
            <Text style={styles.uploadingText}>Subiendo audio...</Text>
          </View>
        )}

        <Text style={styles.recHint}>
          {isRecording
            ? 'Toca para detener y procesar'
            : 'Toca para empezar a grabar'}
        </Text>

        {!isRecording && !uploading && (
          <Pressable onPress={() => setStep('context')} style={styles.backLink}>
            <Text style={styles.backLinkText}>← Volver al contexto</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f5f9' },
  content: { padding: 24, paddingBottom: 40 },
  heading: { fontSize: 24, fontWeight: '700', color: '#1e293b', marginBottom: 6 },
  subheading: { fontSize: 14, color: '#64748b', marginBottom: 24 },
  label: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 6, marginTop: 16 },
  input: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: '#1e293b',
  },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
  hint: { fontSize: 12, color: '#94a3b8', marginTop: 4 },
  chips: { marginBottom: 4 },
  chip: {
    borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 7, marginRight: 8, backgroundColor: '#fff',
  },
  chipSelected: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  chipText: { fontSize: 14, color: '#475569' },
  chipTextSelected: { color: '#fff', fontWeight: '600' },
  summaryToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#e2e8f0' },
  summaryToggleText: { flex: 1, marginRight: 12 },
  button: { backgroundColor: '#6366f1', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 16 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // Paso grabación
  recorderCard: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  timer: { fontSize: 56, fontWeight: '200', color: '#1e293b', marginVertical: 24, fontVariant: ['tabular-nums'] },
  waveContainer: { flexDirection: 'row', alignItems: 'center', height: 56, marginBottom: 24, gap: 3 },
  waveBar: { width: 4, backgroundColor: '#6366f1', borderRadius: 2 },
  recButton: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: '#6366f1', justifyContent: 'center', alignItems: 'center',
    shadowColor: '#6366f1', shadowOpacity: 0.4, shadowRadius: 16, elevation: 8,
  },
  recButtonStop: { backgroundColor: '#ef4444', shadowColor: '#ef4444' },
  micIcon: { width: 24, height: 32, backgroundColor: '#fff', borderRadius: 12 },
  stopIcon: { width: 28, height: 28, backgroundColor: '#fff', borderRadius: 4 },
  recHint: { fontSize: 14, color: '#94a3b8', marginTop: 24 },
  uploadingContainer: { alignItems: 'center', gap: 12 },
  uploadingText: { fontSize: 16, color: '#6366f1', fontWeight: '600' },
  backLink: { marginTop: 32 },
  backLinkText: { color: '#6366f1', fontSize: 14 },
});
