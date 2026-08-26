import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '@/app.module';
import { Role } from '@/common/enums';
import { HttpExceptionFilter } from '@/common/filters/http-exception.filter';
import { ResponseTransformInterceptor } from '@/common/interceptors/response-transform.interceptor';
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
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseTransformInterceptor());
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live'] });

    await app.init();
    dataSource = app.get(DataSource);
  }, 60_000);

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

  describe('GET /health', () => {
    it('responde sin autenticación y sin el sobre de respuesta', async () => {
      const response = await request(app.getHttpServer()).get('/health/live').expect(200);

      // El contrato de la sonda lo consumen los orquestadores: no se envuelve.
      expect(response.body.status).toBe('ok');
      expect(response.body.data).toBeUndefined();
    });
  });
});
