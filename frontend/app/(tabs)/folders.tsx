import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { subjectsApi, type Subject } from '../../services/api';
import { deleteCachedSubject, getCachedSubjects, saveSubjects } from '../../services/localDb';

export default function FoldersScreen() {
  const [folders, setFolders] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const theme = useTheme();

  const fetchFolders = async () => {
    try {
      const { data } = await subjectsApi.list();
      saveSubjects(data);
      setFolders(data);
    } catch {
      const cached = getCachedSubjects() as Subject[];
      setFolders(cached);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchFolders(); }, []);

  const createFolder = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await subjectsApi.create(newName.trim(), newDesc.trim() || undefined);
      setNewName('');
      setNewDesc('');
      setModalVisible(false);
      fetchFolders();
    } catch {
      Alert.alert('Error', 'No se pudo crear la carpeta.');
    } finally {
      setSaving(false);
    }
  };

  const deleteFolder = (folder: Subject) => {
    Alert.alert(
      'Eliminar carpeta',
      `¿Eliminar "${folder.name}"? Las grabaciones no se borrarán.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar', style: 'destructive',
          onPress: async () => {
            try {
              await subjectsApi.delete(folder.id);
              deleteCachedSubject(folder.id);
              setFolders((prev) => prev.filter((f) => f.id !== folder.id));
            } catch {
              Alert.alert('Error', 'No se pudo eliminar la carpeta.');
            }
          },
        },
      ],
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
      <FlatList
        data={folders}
        keyExtractor={(f) => String(f.id)}
        contentContainerStyle={folders.length === 0 ? styles.empty : { paddingVertical: 8 }}
        renderItem={({ item }) => (
          <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
            <Ionicons name="folder" size={28} color={theme.colors.primary} style={{ marginRight: 12 }} />
            <View style={styles.cardContent}>
              <Text style={[styles.folderName, { color: theme.colors.text }]}>{item.name}</Text>
              {item.description ? (
                <Text style={[styles.folderDesc, { color: theme.colors.textTertiary }]} numberOfLines={1}>
                  {item.description}
                </Text>
              ) : null}
            </View>
            <Pressable onPress={() => deleteFolder(item)} hitSlop={12}>
              <Ionicons name="trash-outline" size={20} color={theme.colors.error} />
            </Pressable>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons name="folder-open-outline" size={48} color={theme.colors.textTertiary} style={{ marginBottom: 16 }} />
            <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>Sin carpetas aún.</Text>
            <Text style={[styles.emptyHint, { color: theme.colors.textTertiary }]}>
              Crea carpetas para organizar tus grabaciones.
            </Text>
          </View>
        }
      />

      <Pressable
        style={[styles.fab, { backgroundColor: theme.colors.primary }]}
        onPress={() => setModalVisible(true)}
      >
        <Ionicons name="add" size={32} color="#fff" />
      </Pressable>

      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <Pressable style={styles.overlay} onPress={() => setModalVisible(false)} />
        <View style={[styles.sheet, { backgroundColor: theme.colors.surface }]}>
          <Text style={[styles.sheetTitle, { color: theme.colors.text }]}>Nueva carpeta</Text>

          <TextInput
            style={[styles.input, { backgroundColor: theme.colors.inputBg, borderColor: theme.colors.border, color: theme.colors.text }]}
            placeholder="Nombre de la carpeta"
            placeholderTextColor={theme.colors.textTertiary}
            value={newName}
            onChangeText={setNewName}
            autoFocus
          />
          <TextInput
            style={[styles.input, { backgroundColor: theme.colors.inputBg, borderColor: theme.colors.border, color: theme.colors.text }]}
            placeholder="Descripción (opcional)"
            placeholderTextColor={theme.colors.textTertiary}
            value={newDesc}
            onChangeText={setNewDesc}
          />

          <View style={styles.sheetButtons}>
            <Pressable
              style={[styles.sheetBtn, { backgroundColor: theme.colors.border }]}
              onPress={() => setModalVisible(false)}
            >
              <Text style={[styles.sheetBtnText, { color: theme.colors.textSecondary }]}>Cancelar</Text>
            </Pressable>
            <Pressable
              style={[styles.sheetBtn, { backgroundColor: theme.colors.primary, opacity: saving ? 0.6 : 1 }]}
              onPress={createFolder}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color="#fff" />
                : <Text style={[styles.sheetBtnText, { color: '#fff' }]}>Crear</Text>
              }
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  empty: { flex: 1 },
  emptyText: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
  emptyHint: { fontSize: 14, textAlign: 'center' },
  card: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginVertical: 6, borderRadius: 12, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  cardContent: { flex: 1 },
  folderName: { fontSize: 16, fontWeight: '600' },
  folderDesc: { fontSize: 13, marginTop: 2 },
  fab: {
    position: 'absolute', bottom: 24, right: 24,
    width: 56, height: 56, borderRadius: 28,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#6366f1', shadowOpacity: 0.4, shadowRadius: 12, elevation: 6,
  },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 40,
  },
  sheetTitle: { fontSize: 20, fontWeight: '700', marginBottom: 20 },
  input: {
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, marginBottom: 14,
  },
  sheetButtons: { flexDirection: 'row', gap: 12, marginTop: 8 },
  sheetBtn: { flex: 1, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  sheetBtnText: { fontSize: 16, fontWeight: '600' },
});
