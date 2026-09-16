/**
 * Authenticated HTTP layer for the public web app.
 *
 * Wraps `fetch` with the API base URL, bearer access token, JSON handling and a
 * single transparent refresh-cookie retry on 401. Unauthenticated public calls
 * keep using the existing `publicMapApi` fetcher.
 */
import { clearTokens, getAccessToken, setAccessToken } from '../lib/tokenStorage';
import type { SessionResponse } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function getApiBaseUrl(): string {
  if (typeof API_BASE_URL !== 'string' || API_BASE_URL.trim() === '') {
    throw new Error('Missing VITE_API_BASE_URL');
  }

  return API_BASE_URL.replace(/\/+$/, '');
}

const sessionClearedListeners = new Set<() => void>();

export function onSessionCleared(listener: () => void): () => void {
  sessionClearedListeners.add(listener);
  return () => sessionClearedListeners.delete(listener);
}

function notifySessionCleared(): void {
  clearTokens();
  for (const listener of sessionClearedListeners) {
    listener();
  }
}

async function parseError(response: Response): Promise<ApiError> {
  let message = `Request failed (${response.status})`;
  try {
    const body = (await response.json()) as {
      message?: unknown;
      issues?: { formErrors?: string[]; fieldErrors?: Record<string, string[] | undefined> };
    };
    if (typeof body?.message === 'string' && body.message.trim() !== '') {
      message = body.message;
    } else if (body?.issues?.formErrors?.[0]) {
      message = body.issues.formErrors[0];
    } else if (body?.issues?.fieldErrors) {
      const firstField = Object.values(body.issues.fieldErrors).find((msgs) => msgs && msgs.length > 0);
      if (firstField?.[0]) message = firstField[0];
    }
  } catch {
    // Non-JSON error body; keep the generic message.
  }
  return new ApiError(response.status, message);
}

export async function publicGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: 'GET',
    credentials: 'include',
    signal,
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  return response.json() as Promise<T>;
}

export async function publicJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  return response.json() as Promise<T>;
}

let refreshInFlight: Promise<string | null> | null = null;

export async function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const session = await publicJson<SessionResponse>('/auth/refresh', {});
        if (!session.accessToken) {
          notifySessionCleared();
          return null;
        }
        setAccessToken(session.accessToken);
        return session.accessToken;
      } catch (error) {
        // Only clear the local session on a genuine auth failure.
        // Network / 5xx must not force sign-out.
        if (isUnauthorizedError(error)) {
          notifySessionCleared();
        }
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();
  }

  return refreshInFlight;
}

type AuthFetchOptions = {
  readonly method?: string;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
};

export async function authJson<T>(path: string, options: AuthFetchOptions = {}): Promise<T> {
  const send = async (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;

    return fetch(`${getApiBaseUrl()}${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  };

  let response = await send(getAccessToken());

  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      response = await send(refreshed);
    }
  }

  if (!response.ok) {
    throw await parseError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export { notifySessionCleared };
