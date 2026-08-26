import type { ApiEnvelope, ApiErrorBody } from '@/lib/types/api.types';

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

/** Error de API con el código de estado, para que la UI pueda reaccionar a cada caso. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: ApiErrorBody,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Los errores de validación llegan como lista de mensajes. */
  get validationMessages(): string[] {
    const message = this.body?.message;
    if (Array.isArray(message)) return message;
    return message ? [message] : [];
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Uso interno: evita bucles infinitos de refresco. */
  skipRefresh?: boolean;
}

/**
 * Promesa de refresco en curso.
 *
 * Si tres peticiones reciben 401 a la vez, todas esperan al mismo refresco en lugar de
 * lanzar tres rotaciones simultáneas. Con rotación de refresh tokens eso sería fatal:
 * la segunda rotación presentaría un token ya consumido, el backend lo interpretaría
 * como reutilización y cerraría todas las sesiones del usuario.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }

  return refreshInFlight;
}

/**
 * Cliente HTTP de la API.
 *
 * `credentials: 'include'` en todas las llamadas: la sesión viaja en cookies httpOnly,
 * que el JavaScript de la página no puede leer. Es lo que hace que un XSS no pueda
 * robar el token, a diferencia de guardarlo en localStorage.
 */
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, skipRefresh, headers, ...rest } = options;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // 401: se intenta rotar la sesión una sola vez y se repite la petición original.
  if (response.status === 401 && !skipRefresh && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return request<T>(path, { ...options, skipRefresh: true });
    }
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const errorBody = payload as ApiErrorBody | null;
    const message = Array.isArray(errorBody?.message)
      ? errorBody.message.join(' ')
      : (errorBody?.message ?? `Error ${response.status}`);
    throw new ApiError(response.status, message, errorBody ?? undefined);
  }

  // El backend envuelve todas las respuestas correctas; aquí se desenvuelve para que
  // el resto de la aplicación trabaje con el dato directamente.
  const envelope = payload as ApiEnvelope<T> | T;
  if (envelope && typeof envelope === 'object' && 'success' in envelope && 'data' in envelope) {
    return (envelope as ApiEnvelope<T>).data;
  }

  return envelope as T;
}

const buildQuery = (params: Record<string, string | number | boolean | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
};

export const api = {
  get: <T>(path: string, params?: Record<string, string | number | boolean | undefined>) =>
    request<T>(`${path}${params ? buildQuery(params) : ''}`, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
