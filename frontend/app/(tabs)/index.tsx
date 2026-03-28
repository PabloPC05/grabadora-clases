import { Ionicons } from '@expo/vector-icons';
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
import { useTheme } from '../../context/ThemeContext';
import { Recording, recordingsApi } from '../../services/api';
import { getCachedRecordings, saveRecordings } from '../../services/localDb';

export default function HomeScreen() {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  const router = useRouter();
  const theme = useTheme();

  const fetchRecordings = async (silent = false) => {
    try {
      const { data } = await recordingsApi.list();
      saveRecordings(data);
      setRecordings(data);
      setOffline(false);
    } catch {
      const cached = getCachedRecordings();
      if (cached.length > 0) {
        setRecordings(cached);
        setOffline(true);
      }
    } finally {
      if (!silent) setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchRecordings(); }, []);

  const STATUS_LABEL: Record<string, string> = {
    pending: 'Pendiente',
    processing: 'Procesando...',
    completed: 'Listo',
    failed: 'Error',
  };

  const renderItem = ({ item }: { item: Recording }) => {
    const statusBg = theme.colors.statusBg[item.status] ?? theme.colors.border;
    const statusText = theme.colors.statusText[item.status] ?? theme.colors.text;
    return (
      <Pressable
        style={[styles.card, { backgroundColor: theme.colors.surface }]}
        onPress={() => {
          if (item.status === 'completed') {
            router.push(`/recording/${item.id}`);
          }
        }}
      >
        <View style={styles.cardRow}>
          <Text style={[styles.topic, { color: theme.colors.text }]} numberOfLines={1}>
            {item.topic ?? 'Sin título'}
          </Text>
          <View style={[styles.badge, { backgroundColor: statusBg }]}>
            <Text style={[styles.badgeText, { color: statusText }]}>{STATUS_LABEL[item.status]}</Text>
          </View>
        </View>
        <Text style={[styles.date, { color: theme.colors.textTertiary }]}>
          {new Date(item.created_at).toLocaleDateString('es-ES', {
            day: '2-digit', month: 'short', year: 'numeric',
          })}
        </Text>
      </Pressable>
    );
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {offline && (
        <View style={[styles.offlineBanner, { backgroundColor: theme.colors.warning }]}>
          <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
          <Text style={styles.offlineText}>Sin conexión — mostrando datos guardados</Text>
        </View>
      )}

      <FlatList
        data={recordings}
        keyExtractor={(r) => String(r.id)}
        renderItem={renderItem}
        contentContainerStyle={recordings.length === 0 ? styles.empty : { paddingVertical: 8 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); fetchRecordings(); }}
            tintColor={theme.colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons name="mic-outline" size={48} color={theme.colors.textTertiary} style={{ marginBottom: 16 }} />
            <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>Sin grabaciones aún.</Text>
            <Text style={[styles.emptyHint, { color: theme.colors.textTertiary }]}>
              Pulsa el botón + para empezar tu primera clase.
            </Text>
          </View>
        }
      />

      <Pressable
        style={[styles.fab, { backgroundColor: theme.colors.primary }]}
        onPress={() => router.push('/recording/new')}
      >
        <Ionicons name="add" size={32} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  empty: { flex: 1 },
  emptyText: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
  emptyHint: { fontSize: 14, textAlign: 'center' },
  offlineBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 8,
  },
  offlineText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  card: {
    marginHorizontal: 16, marginVertical: 6,
    borderRadius: 12, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  topic: { fontSize: 16, fontWeight: '600', flex: 1, marginRight: 8 },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  date: { fontSize: 12, marginTop: 6 },
  fab: {
    position: 'absolute', bottom: 24, right: 24,
    width: 56, height: 56, borderRadius: 28,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#6366f1', shadowOpacity: 0.4, shadowRadius: 12, elevation: 6,
  },
});
