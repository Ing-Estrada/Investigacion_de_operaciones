import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '@/lib/api/client';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('cliente de API', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('desenvuelve el sobre de respuesta del backend', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        success: true,
        data: { id: 'abc', distanceKm: 187.4 },
        timestamp: '2026-08-26T10:00:00.000Z',
        path: '/api/v1/routes/abc',
      }),
    );

    // El componente recibe el dato, no el sobre.
    await expect(api.get('/routes/abc')).resolves.toEqual({ id: 'abc', distanceKm: 187.4 });
  });

  it('devuelve el cuerpo tal cual si no viene envuelto', async () => {
    // El health check no se envuelve: su contrato lo consumen los orquestadores.
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { status: 'ok', uptimeSeconds: 12 }));

    await expect(api.get('/health/live')).resolves.toEqual({ status: 'ok', uptimeSeconds: 12 });
  });

  it('envía siempre las credenciales para que viajen las cookies httpOnly', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true, data: null }));

    await api.get('/auth/me');

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include' });
  });

  it('serializa el cuerpo y fija el content-type en POST', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { success: true, data: {} }));

    await api.post('/vehicles', { plate: 'ABC-123' });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"plate":"ABC-123"}');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('construye la query omitiendo los valores indefinidos', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true, data: [] }));

    await api.get('/routes', { page: 2, limit: 20, status: undefined });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('page=2');
    expect(url).toContain('limit=20');
    expect(url).not.toContain('status');
  });

  it('devuelve undefined ante un 204 sin intentar parsear JSON', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204 } as Response);

    await expect(api.delete('/vehicles/abc')).resolves.toBeUndefined();
  });

  it('lanza ApiError con el estado y el mensaje del backend', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(422, {
        success: false,
        statusCode: 422,
        error: 'Route Not Found',
        message: 'No existe una ruta transitable.',
        path: '/api/v1/routes/optimize',
        timestamp: '2026-08-26T10:00:00.000Z',
      }),
    );

    const error = await api.post('/routes/optimize', {}).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(422);
    expect((error as ApiError).message).toBe('No existe una ruta transitable.');
  });

  it('une los mensajes cuando la validación devuelve una lista', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, {
        success: false,
        statusCode: 400,
        error: 'Bad Request',
        message: ['La latitud debe estar entre -90 y 90.', 'vehicleId must be a UUID'],
        path: '/api/v1/routes/optimize',
        timestamp: '2026-08-26T10:00:00.000Z',
      }),
    );

    const error = (await api
      .post('/routes/optimize', {})
      .catch((caught: unknown) => caught)) as ApiError;

    expect(error.validationMessages).toHaveLength(2);
    expect(error.message).toContain('La latitud debe estar entre -90 y 90.');
  });

  it('renueva la sesión ante un 401 y repite la petición', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { message: 'expirado' }))
      .mockResolvedValueOnce(jsonResponse(200, { success: true, data: { renewed: true } }))
      .mockResolvedValueOnce(jsonResponse(200, { success: true, data: { id: 'abc' } }));

    await expect(api.get('/routes/abc')).resolves.toEqual({ id: 'abc' });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toContain('/auth/refresh');
  });

  it('no intenta renovar si el 401 viene del propio login', async () => {
    // Reintentar aquí gastaría cuota del rate limit de /auth/login sin ninguna
    // posibilidad de éxito: no hay sesión que renovar.
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { message: 'credenciales inválidas' }));

    await expect(api.post('/auth/login', {})).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('propaga el 401 si la renovación también falla', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { message: 'expirado' }))
      .mockResolvedValueOnce(jsonResponse(401, { message: 'refresh inválido' }));

    const error = (await api.get('/routes').catch((caught: unknown) => caught)) as ApiError;

    expect(error.isUnauthorized).toBe(true);
  });

  it('identifica el error de límite de peticiones', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(429, {
        success: false,
        statusCode: 429,
        error: 'Too Many Requests',
        message: 'Has superado el límite de peticiones.',
        retryAfterSec: 42,
        path: '/api/v1/routes/optimize',
        timestamp: '2026-08-26T10:00:00.000Z',
      }),
    );

    const error = (await api
      .post('/routes/optimize', {})
      .catch((caught: unknown) => caught)) as ApiError;

    expect(error.isRateLimited).toBe(true);
    expect(error.body?.retryAfterSec).toBe(42);
  });
});
