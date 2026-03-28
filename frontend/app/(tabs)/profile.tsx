import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuthStore } from '../../store/authStore';

export default function ProfileScreen() {
  const { user, logout } = useAuthStore();

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(user?.full_name ?? user?.email ?? '?')[0].toUpperCase()}
          </Text>
        </View>
        <Text style={styles.name}>{user?.full_name ?? 'Sin nombre'}</Text>
        <Text style={styles.email}>{user?.email}</Text>
      </View>

      <Pressable style={styles.logoutButton} onPress={logout}>
        <Text style={styles.logoutText}>Cerrar sesión</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f5f9', padding: 24 },
  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 24,
    alignItems: 'center', marginBottom: 24,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  avatar: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: '#6366f1',
    justifyContent: 'center', alignItems: 'center', marginBottom: 12,
  },
  avatarText: { fontSize: 32, color: '#fff', fontWeight: '700' },
  name: { fontSize: 20, fontWeight: '700', color: '#1e293b', marginBottom: 4 },
  email: { fontSize: 14, color: '#64748b' },
  logoutButton: {
    backgroundColor: '#fee2e2', borderRadius: 12, paddingVertical: 14, alignItems: 'center',
  },
  logoutText: { color: '#ef4444', fontSize: 16, fontWeight: '600' },
});
