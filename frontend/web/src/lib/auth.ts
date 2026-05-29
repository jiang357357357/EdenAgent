export interface AuthUser {
  id: number;
  username: string;
  ws_session_id?: string | null;
  is_staff: boolean;
  is_superuser: boolean;
  date_joined?: string;
  last_login?: string | null;
}

export interface LoginResponse {
  message: string;
  user: AuthUser;
  token: string;
  expires_at: string;
  expires_in: number;
}

export interface VerifyTokenResponse {
  valid: boolean;
  user: AuthUser;
  token_info?: {
    valid: boolean;
    user: string;
    created_at: string;
    expires_at: string;
    remaining_hours: number;
  };
}

declare const __MON_AUTH_MODE__: string | undefined

const browserCoreBaseUrl = (import.meta as unknown as { env?: { DEV?: boolean; VITE_CORE_BASE_URL?: string } }).env?.DEV
  ? '/core-api'
  : ((import.meta as unknown as { env?: { VITE_CORE_BASE_URL?: string } }).env?.VITE_CORE_BASE_URL ?? 'http://127.0.0.1:40011');

const TOKEN_KEY = 'agent.auth_token';
const USER_KEY = 'agent.auth_user';
const EXPIRES_KEY = 'agent.auth_expires_at';

function parseJsonSafely<T>(text: string) {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

export function getErrorMessage(error: unknown, fallback = '请求失败') {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  if (error && typeof error === 'object') {
    const candidate = error as { message?: unknown; error?: unknown; cause?: unknown };
    if (typeof candidate.message === 'string' && candidate.message.trim()) {
      return candidate.message;
    }
    if (typeof candidate.error === 'string' && candidate.error.trim()) {
      return candidate.error;
    }
    if (typeof candidate.cause === 'string' && candidate.cause.trim()) {
      return candidate.cause;
    }
  }

  return fallback;
}

function isTauriRuntime() {
  return '__TAURI_INTERNALS__' in window;
}

async function invokeTauri<T>(command: string, args?: Record<string, unknown>) {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

async function request<T>(path: string, init?: RequestInit, token?: string): Promise<T> {
  const response = await fetch(`${browserCoreBaseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { Authorization: `Token ${token}` } : {}),
      ...init?.headers,
    },
  });

  const text = await response.text().catch(() => '');
  const data = parseJsonSafely<T & { error?: string; message?: string }>(text);

  if (!response.ok) {
    const errorMessage = (data && typeof data === 'object' && 'error' in data && data.error) || (data && typeof data === 'object' && 'message' in data && data.message) || `${response.status} ${response.statusText}`;
    throw new Error(String(errorMessage));
  }

  return data as T;
}

export function getStoredToken() {
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getAuthMode(): 'development' | 'production' {
  if (typeof __MON_AUTH_MODE__ !== 'undefined' && __MON_AUTH_MODE__ === 'development') {
    return 'development'
  }
  return 'production'
}

export function getStoredUser() {
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function clearAuth() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
  window.localStorage.removeItem(EXPIRES_KEY);
}

export function saveAuth(payload: { token: string; user: AuthUser; expiresAt?: string }) {
  window.localStorage.setItem(TOKEN_KEY, payload.token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(payload.user));
  if (payload.expiresAt) {
    window.localStorage.setItem(EXPIRES_KEY, payload.expiresAt);
  }
}

export async function loginWithCore(username: string, password: string) {
  if (isTauriRuntime()) {
    const response = await invokeTauri<LoginResponse>('core_login', { request: { username, password } });
    saveAuth({
      token: response.token,
      user: response.user,
      expiresAt: response.expires_at,
    });
    return response;
  }

  const response = await request<LoginResponse>('/api/users/login/', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });

  saveAuth({
    token: response.token,
    user: response.user,
    expiresAt: response.expires_at,
  });

  return response;
}

export async function verifyTokenWithCore(token: string) {
  if (isTauriRuntime()) {
    const response = await invokeTauri<VerifyTokenResponse>('core_verify_token', { token });
    if (!response.valid) {
      throw new Error('Token无效');
    }
    saveAuth({
      token,
      user: response.user,
      expiresAt: response.token_info?.expires_at,
    });
    return response;
  }

  const response = await request<VerifyTokenResponse>('/api/users/verify-token/', { method: 'GET' }, token);
  if (!response.valid) {
    throw new Error('Token无效');
  }
  saveAuth({
    token,
    user: response.user,
    expiresAt: response.token_info?.expires_at,
  });
  return response;
}

export async function logoutWithCore(token: string | null) {
  if (!token) {
    clearAuth();
    return;
  }

  try {
    if (isTauriRuntime()) {
      await invokeTauri<{ message: string }>('core_logout', { token });
      return;
    }
    await request<{ message: string }>('/api/users/logout/', { method: 'POST' }, token);
  } finally {
    clearAuth();
  }
}

export interface DevAccount {
  username: string;
  password: string;
}

export async function getDevAccount(): Promise<DevAccount | null> {
  if (!isTauriRuntime()) return null;
  return invokeTauri<DevAccount | null>('get_dev_account');
}
