import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Recording, recordingsApi } from '../../services/api';

export default function HomeScreen() {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();

  const fetchRecordings = async () => {
    try {
      const { data } = await recordingsApi.list();
      setRecordings(data);
    } catch {
      // silencioso — el interceptor manejará errores 401
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchRecordings();
  }, []);

  const STATUS_LABEL: Record<string, string> = {
    pending: 'Pendiente',
    processing: 'Procesando...',
    completed: 'Listo',
    failed: 'Error',
  };
  const STATUS_COLOR: Record<string, string> = {
    pending: '#f59e0b',
    processing: '#3b82f6',
    completed: '#10b981',
    failed: '#ef4444',
  };

  const renderItem = ({ item }: { item: Recording }) => (
    <Pressable
      style={styles.card}
      onPress={() => {
        if (item.status === 'completed') {
          // La note tiene el mismo recording_id; navegar a notes con recording id
          // En la siguiente fase se buscará el note_id real desde la API
          router.push(`/notes/${item.id}`);
        }
      }}
    >
      <View style={styles.cardRow}>
        <Text style={styles.topic} numberOfLines={1}>
          {item.topic ?? 'Sin título'}
        </Text>
        <View style={[styles.badge, { backgroundColor: STATUS_COLOR[item.status] }]}>
          <Text style={styles.badgeText}>{STATUS_LABEL[item.status]}</Text>
        </View>
      </View>
      <Text style={styles.date}>
        {new Date(item.created_at).toLocaleDateString('es-ES', {
          day: '2-digit', month: 'short', year: 'numeric',
        })}
      </Text>
    </Pressable>
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={recordings}
        keyExtractor={(r) => String(r.id)}
        renderItem={renderItem}
        contentContainerStyle={recordings.length === 0 && styles.empty}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); fetchRecordings(); }}
            tintColor="#6366f1"
          />
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyText}>Sin grabaciones aún.</Text>
            <Text style={styles.emptyHint}>
              Pulsa el botón + para empezar tu primera clase.
            </Text>
          </View>
        }
      />

      {/* FAB — nueva grabación */}
      <Pressable style={styles.fab} onPress={() => router.push('/recording/new')}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f5f9' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { flex: 1 },
  emptyText: { fontSize: 18, fontWeight: '600', color: '#475569', marginBottom: 8 },
  emptyHint: { fontSize: 14, color: '#94a3b8', textAlign: 'center' },
  card: {
    backgroundColor: '#fff', marginHorizontal: 16, marginVertical: 6,
    borderRadius: 12, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  topic: { fontSize: 16, fontWeight: '600', color: '#1e293b', flex: 1, marginRight: 8 },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  date: { fontSize: 12, color: '#94a3b8', marginTop: 6 },
  fab: {
    position: 'absolute', bottom: 24, right: 24,
    backgroundColor: '#6366f1', width: 56, height: 56, borderRadius: 28,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#6366f1', shadowOpacity: 0.4, shadowRadius: 12, elevation: 6,
  },
  fabText: { color: '#fff', fontSize: 28, lineHeight: 30 },
});
