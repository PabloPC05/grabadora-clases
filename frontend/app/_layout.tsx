import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from '../context/ThemeContext';
import { initDb } from '../services/localDb';
import { useAuthStore } from '../store/authStore';

function AuthGuard() {
  const { token, isLoading, loadToken } = useAuthStore();
  const router = useRouter();
  const segments = useSegments();
  const theme = useTheme();

  useEffect(() => { loadToken(); }, []);
  useEffect(() => {
    if (isLoading) return;
    const inAuthGroup = segments[0] === '(auth)';
    if (!token && !inAuthGroup) router.replace('/(auth)/login');
    else if (token && inAuthGroup) router.replace('/(tabs)');
  }, [token, isLoading, segments]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.background }}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return <Slot />;
}

export default function RootLayout() {
  useEffect(() => { initDb(); }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthGuard />
        <StatusBar style="auto" />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
