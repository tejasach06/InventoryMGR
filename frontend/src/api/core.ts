export const API_PREFIX = '/api';
export const CSRF_COOKIE = 'inventorymgr_csrf';

export function readCookie(name: string): string | null {
  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of document.cookie.split(';')) {
    const value = part.trim();
    if (value.startsWith(prefix)) return decodeURIComponent(value.slice(prefix.length));
  }
  return null;
}

export function isStateChanging(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    super(typeof detail === 'string' ? detail : `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

export async function parseResponse(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

let refreshInFlight: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  refreshInFlight ??= fetch(`${API_PREFIX}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

export async function apiRequest<T>(path: string, options: RequestInit = {}, _retried = false): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers = new Headers(options.headers);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  if (!(options.body instanceof FormData) && options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (isStateChanging(method)) {
    const token = readCookie(CSRF_COOKIE);
    if (token) headers.set('X-CSRF-Token', token);
  }


  try {
    const response = await fetch(`${API_PREFIX}${path}`, {
      ...options,
      method,
      headers,
      credentials: 'include',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.status === 401 && !_retried) {
      if (await refreshSession()) {
        return apiRequest<T>(path, options, true);
      }
    }
    const data = await parseResponse(response);

    if (!response.ok) {
      const detail = typeof data === 'object' && data !== null && 'detail' in data
        ? (data as { detail: unknown }).detail : data;
      throw new ApiError(response.status, detail);
    }

    return data as T;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export function detailMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (typeof error.detail === 'string') return error.detail;
    if (Array.isArray(error.detail)) {
      return error.detail.map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'msg' in item) return String((item as { msg: unknown }).msg);
        return 'Request validation failed';
      }).join('; ');
    }
  }
  return error instanceof Error ? error.message : 'Unexpected error';
}
