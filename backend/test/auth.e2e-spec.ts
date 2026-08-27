import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '@/app.module';
import { Role } from '@/common/enums';
import { RedisService } from '@/infrastructure/redis/redis.service';
import { User } from '@/modules/auth/entities/user.entity';

/**
 * Pruebas de extremo a extremo del flujo de autenticación contra PostgreSQL real.
 *
 * Requiere base de datos y migraciones aplicadas (`npm run migration:run`). En CI lo
 * levanta el job `backend` del workflow; en local, `docker compose up -d postgres redis`.
 */
describe('Auth (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let redis: RedisService;

  const credentials = {
    email: `e2e-${Date.now()}@example.com`,
    password: 'Sup3rS3gura!2026',
    firstName: 'Ana',
    lastName: 'Torres',
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());

    // Solo el pipe: el filtro de errores y el interceptor de respuesta ya los registra
    // AppModule con APP_FILTER y APP_INTERCEPTOR. Añadirlos aquí de nuevo envolvería
    // cada respuesta dos veces —`{ data: { data: … } }`— y el test estaría validando
    // una forma que la aplicación real nunca produce.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live'] });

    await app.init();
    dataSource = app.get(DataSource);
    redis = app.get(RedisService);
  }, 60_000);

  /**
   * Los límites de producción son deliberadamente estrictos —3 registros por hora y por
   * IP— y esta suite hace más peticiones que eso desde una única IP. Se reinicia la
   * cuota antes de cada test para que el rate limiter no invalide por 429 asserciones
   * que van sobre otra cosa.
   *
   * Los límites NO se relajan en el entorno de test: se prueban tal cual en su propio
   * bloque, más abajo. Bajarlos aquí significaría no probarlos nunca.
   */
  beforeEach(async () => {
    await redis.deleteByPrefix('ratelimit:');
  });

  afterAll(async () => {
    // Se limpia solo lo que creó esta suite; no se vacía la base entera.
    if (dataSource?.isInitialized) {
      await dataSource
        .getRepository(User)
        .createQueryBuilder()
        .delete()
        .where('email LIKE :pattern', { pattern: 'e2e-%@example.com' })
        .execute();
    }
    await app?.close();
  });

  describe('POST /auth/register', () => {
    it('crea la cuenta y emite cookies httpOnly', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(credentials)
        .expect(201);

      expect(response.body.data.accessToken).toBeDefined();
      expect(response.body.data.user.email).toBe(credentials.email);
      // El rol nunca lo decide el cliente.
      expect(response.body.data.user.role).toBe(Role.Customer);
      // La respuesta jamás debe contener el hash de la contraseña.
      expect(JSON.stringify(response.body)).not.toContain('passwordHash');

      const cookies = response.headers['set-cookie'] as unknown as string[];
      expect(cookies.some((c) => c.startsWith('access_token=') && c.includes('HttpOnly'))).toBe(
        true,
      );
      expect(cookies.some((c) => c.startsWith('refresh_token=') && c.includes('HttpOnly'))).toBe(
        true,
      );
    });

    it('rechaza una contraseña que no cumple la política', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ ...credentials, email: `e2e-weak-${Date.now()}@example.com`, password: 'corta' })
        .expect(400);

      expect(JSON.stringify(response.body.message)).toMatch(/contraseña/i);
    });

    it('rechaza un email con formato inválido', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ ...credentials, email: 'no-es-un-email' })
        .expect(400);
    });

    it('ignora un intento de escalada de privilegios en el cuerpo', async () => {
      // `forbidNonWhitelisted` rechaza la petición entera: el campo `role` no existe en
      // el DTO, así que ni siquiera llega al servicio.
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ ...credentials, email: `e2e-esc-${Date.now()}@example.com`, role: 'admin' })
        .expect(400);
    });
  });

  describe('POST /auth/login', () => {
    it('devuelve tokens con credenciales correctas', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: credentials.email, password: credentials.password })
        .expect(200);

      expect(response.body.data.accessToken).toBeDefined();
      expect(response.body.data.expiresIn).toBe(900);
    });

    it('rechaza una contraseña incorrecta sin filtrar si el email existe', async () => {
      const wrongPassword = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: credentials.email, password: 'Incorrecta!2026' })
        .expect(401);

      const unknownEmail = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'no-existe@example.com', password: 'Incorrecta!2026' })
        .expect(401);

      expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
    });
  });

  describe('Rutas protegidas', () => {
    let accessToken: string;

    beforeAll(async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: credentials.email, password: credentials.password });
      accessToken = response.body.data.accessToken;
    });

    it('rechaza sin token', async () => {
      await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    });

    it('rechaza con un token manipulado', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken.slice(0, -5)}xxxxx`)
        .expect(401);
    });

    it('acepta el token válido en la cabecera Authorization', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.data.email).toBe(credentials.email);
    });

    it('deniega con 403 el acceso a un endpoint reservado a ADMIN', async () => {
      // El usuario recién registrado es CUSTOMER: RolesGuard debe cortarlo.
      await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403);
    });

    it('lista el historial de rutas paginado', async () => {
      // Cubre `getManyAndCount` con skip/take sobre la relación to-many de tramos: es
      // la combinación que rompía con un ORDER BY escrito con el nombre de la columna.
      const response = await request(app.getHttpServer())
        .get('/api/v1/routes?page=1&limit=5')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.data).toMatchObject({ page: 1, limit: 5 });
      expect(Array.isArray(response.body.data.items)).toBe(true);
      expect(typeof response.body.data.total).toBe('number');
    });

    it('acota el tamaño de página al máximo permitido', async () => {
      // Sin techo, `?limit=100000` es un DoS trivial contra la base de datos.
      const response = await request(app.getHttpServer())
        .get('/api/v1/routes?page=1&limit=100000')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400);

      expect(response.body.statusCode).toBe(400);
    });

    it('valida los parámetros de entrada de los endpoints protegidos', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/routes/optimize')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          // Latitud fuera de rango.
          origin: { latitude: 200, longitude: 0 },
          destination: { latitude: 0, longitude: 0 },
          vehicleId: '00000000-0000-4000-8000-000000000000',
        })
        .expect(400);
    });
  });

  describe('Rate limiting', () => {
    it('corta el registro masivo tras 3 intentos por IP', async () => {
      const attempt = (suffix: number) =>
        request(app.getHttpServer())
          .post('/api/v1/auth/register')
          .send({ ...credentials, email: `e2e-rl-${Date.now()}-${suffix}@example.com` });

      // Las tres primeras entran dentro de cuota, con independencia de si el registro
      // en sí tiene éxito: el limitador cuenta peticiones, no altas.
      for (let i = 0; i < 3; i += 1) {
        const response = await attempt(i);
        expect(response.status).not.toBe(429);
      }

      const blocked = await attempt(99);

      expect(blocked.status).toBe(429);
      expect(blocked.body.retryAfterSec).toBeGreaterThan(0);
      // El cliente necesita saber cuándo reintentar; sin la cabecera solo puede adivinar.
      expect(blocked.headers['retry-after']).toBeDefined();
    });

    it('publica la cuota restante en las cabeceras', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: credentials.email, password: credentials.password });

      expect(response.headers['x-ratelimit-limit']).toBe('5');
      expect(Number(response.headers['x-ratelimit-remaining'])).toBeLessThan(5);
    });
  });

  describe('GET /health', () => {
    it('responde sin autenticación y sin el sobre de respuesta', async () => {
      const response = await request(app.getHttpServer()).get('/health/live').expect(200);

      // El contrato de la sonda lo consumen los orquestadores: no se envuelve.
      expect(response.body.status).toBe('ok');
      expect(response.body.data).toBeUndefined();
    });
  });
});
