// URL base del backend.
// En desarrollo apunta a tu máquina local.
// En producción, reemplaza con la URL del servidor.
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1';

export const SECURE_STORE_TOKEN_KEY = 'auth_token';
