import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:3000/api/v1';

/** API server origin (strips the /api/v1 suffix) — for static files like /uploads */
export const API_ORIGIN = API_URL.replace(/\/api\/v1\/?$/, '');

export const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// --- Access-token refresh on 401 -------------------------------------------
// The access token is short-lived (15 min). When a request comes back 401 we
// transparently exchange the stored refresh token for a fresh pair (the API
// rotates the refresh token), then retry the original request once. Concurrent
// 401s share a single in-flight refresh. If refresh fails, we clear the session
// and bounce to /login.

function clearSession() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
}

let refreshing: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) throw new Error('No refresh token');
  // Use bare axios (not `api`) so this request skips the interceptors below.
  const r = await axios.post(`${API_URL}/auth/refresh`, { refreshToken });
  localStorage.setItem('accessToken', r.data.accessToken);
  localStorage.setItem('refreshToken', r.data.refreshToken);
  return r.data.accessToken as string;
}

function getFreshToken(): Promise<string> {
  if (!refreshing) {
    refreshing = refreshAccessToken().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as
      | (InternalAxiosRequestConfig & { _retried?: boolean })
      | undefined;
    const url = original?.url ?? '';
    const isAuthCall = url.includes('/auth/login') || url.includes('/auth/refresh');

    if (
      error.response?.status === 401 &&
      original &&
      !original._retried &&
      !isAuthCall &&
      localStorage.getItem('refreshToken')
    ) {
      original._retried = true;
      try {
        const newToken = await getFreshToken();
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch (e) {
        clearSession();
        if (!location.pathname.startsWith('/login')) location.href = '/login';
        return Promise.reject(e);
      }
    }
    return Promise.reject(error);
  },
);
