import { createAuthClient } from 'https://esm.sh/@neondatabase/neon-js/auth?target=es2022&browser&bundle';

const TOKEN_KEY = 'sentinel_auth_token';
const USER_KEY = 'sentinel_auth_user';

let authClientPromise = null;

async function fetchAuthConfig() {
  const response = await fetch('/api/auth/config', { credentials: 'omit' });
  if (!response.ok) {
    throw new Error('No se pudo cargar configuracion de auth');
  }
  const config = await response.json();
  if (!config.authEnabled || !config.authUrl) {
    throw new Error('Auth no esta configurado en el backend');
  }
  return config;
}

export async function getAuthClient() {
  if (!authClientPromise) {
    authClientPromise = fetchAuthConfig().then((config) => createAuthClient(config.authUrl));
  }
  return authClientPromise;
}

function extractTokenFromSessionData(sessionData) {
  const session = sessionData?.session || sessionData || {};
  return (
    session.accessToken ||
    session.access_token ||
    session.token ||
    session.idToken ||
    session.id_token ||
    session.sessionToken ||
    session.session_token ||
    null
  );
}

function extractUserFromSessionData(sessionData) {
  return sessionData?.user || null;
}

export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function getStoredUser() {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearStoredAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

function storeAuth(sessionData) {
  const token = extractTokenFromSessionData(sessionData);
  const user = extractUserFromSessionData(sessionData);
  if (!token || !user) {
    clearStoredAuth();
    return null;
  }

  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  return { token, user };
}

export async function syncSession() {
  const client = await getAuthClient();
  const result = await client.getSession();
  if (result?.error || !result?.data) {
    clearStoredAuth();
    return null;
  }
  return storeAuth(result.data);
}

export async function signIn(email, password) {
  const client = await getAuthClient();
  const result = await client.signIn.email({ email, password });
  if (result?.error) {
    throw new Error(result.error.message || 'No se pudo iniciar sesion');
  }
  return syncSession();
}

export async function signUp(email, password, name) {
  const client = await getAuthClient();
  const result = await client.signUp.email({ email, password, name });
  if (result?.error) {
    throw new Error(result.error.message || 'No se pudo crear la cuenta');
  }
  return syncSession();
}

export async function signOut() {
  try {
    const client = await getAuthClient();
    await client.signOut();
  } catch {
    // Ignore provider errors, still clear local state.
  }
  clearStoredAuth();
}

export async function getAuthorizedOptions(method = 'GET', body = null) {
  const token = getStoredToken();
  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  return {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  };
}
