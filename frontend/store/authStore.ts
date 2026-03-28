import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { SECURE_STORE_TOKEN_KEY } from '../constants/Config';

export interface AuthUser {
  id: number;
  email: string;
  full_name: string | null;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  /** true mientras se lee el token de SecureStore al arrancar la app */
  isLoading: boolean;

  /** Llama esto UNA VEZ en el root layout al montar la app */
  loadToken: () => Promise<void>;
  login: (token: string, user: AuthUser) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  isLoading: true,

  loadToken: async () => {
    try {
      const stored = await SecureStore.getItemAsync(SECURE_STORE_TOKEN_KEY);
      set({ token: stored ?? null });
    } catch {
      set({ token: null });
    } finally {
      set({ isLoading: false });
    }
  },

  login: async (token, user) => {
    await SecureStore.setItemAsync(SECURE_STORE_TOKEN_KEY, token);
    set({ token, user });
  },

  logout: async () => {
    await SecureStore.deleteItemAsync(SECURE_STORE_TOKEN_KEY);
    set({ token: null, user: null });
  },
}));
