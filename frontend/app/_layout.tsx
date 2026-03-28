import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useAuthStore } from '../store/authStore';

/**
 * Root layout — guarda de autenticación.
 *
 * Flujo:
 *  1. Al montar, llama a loadToken() para leer el JWT de SecureStore.
 *  2. Mientras isLoading === true, muestra un spinner.
 *  3. Sin token  → redirige a /(auth)/login
 *     Con token  → redirige a /(tabs)
 */
export default function RootLayout() {
  const { token, isLoading, loadToken } = useAuthStore();
  const router = useRouter();
  const segments = useSegments();

  // Carga el token almacenado una sola vez al arrancar la app
  useEffect(() => {
    loadToken();
  }, []);

  // Redirige según el estado de autenticación
  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!token && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (token && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [token, isLoading, segments]);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#6366f1" />
        <StatusBar style="auto" />
      </View>
    );
  }

  return (
    <>
      <Slot />
      <StatusBar style="auto" />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
