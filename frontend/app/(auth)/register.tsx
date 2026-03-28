import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { authApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';

export default function RegisterScreen() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const login = useAuthStore((s) => s.login);

  const handleRegister = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Error', 'Email y contraseña son obligatorios.');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Error', 'La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    setLoading(true);
    try {
      // Registrar y hacer login automáticamente
      const { data: registeredUser } = await authApi.register(email.trim(), password, fullName.trim() || undefined);
      const { data: tokenData } = await authApi.login(email.trim(), password);
      await login(tokenData.access_token, registeredUser);
    } catch (err: any) {
      const msg = err?.response?.data?.detail ?? 'No se pudo crear la cuenta.';
      Alert.alert('Error al registrarse', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Crear cuenta</Text>

        <TextInput
          style={styles.input}
          placeholder="Nombre completo (opcional)"
          placeholderTextColor="#9ca3af"
          value={fullName}
          onChangeText={setFullName}
          autoCapitalize="words"
        />
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#9ca3af"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
        />
        <TextInput
          style={styles.input}
          placeholder="Contraseña (mín. 8 caracteres)"
          placeholderTextColor="#9ca3af"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <Pressable
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleRegister}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Registrarse</Text>
          )}
        </Pressable>

        <Link href="/(auth)/login" asChild>
          <Pressable style={styles.linkContainer}>
            <Text style={styles.link}>¿Ya tienes cuenta? Inicia sesión</Text>
          </Pressable>
        </Link>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f5f9', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 24, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, elevation: 4 },
  title: { fontSize: 26, fontWeight: '700', color: '#1e293b', marginBottom: 24, textAlign: 'center' },
  input: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 14, fontSize: 16, color: '#1e293b' },
  button: { backgroundColor: '#6366f1', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  linkContainer: { marginTop: 20, alignItems: 'center' },
  link: { color: '#6366f1', fontSize: 14 },
});
