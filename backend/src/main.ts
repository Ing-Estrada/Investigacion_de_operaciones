import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // El log de arranque se emite antes de que exista configuración, así que se dejan
    // solo los niveles que importan para diagnosticar un fallo de arranque.
    logger: ['error', 'warn', 'log'],
  });

  const config = app.get(ConfigService);
  const isProduction = config.get<string>('NODE_ENV') === 'production';
  const port = Number(config.get<string>('PORT') ?? 3001);
  const apiPrefix = config.get<string>('API_PREFIX') ?? 'api/v1';

  // Detrás de NGINX, sin esto `req.ip` sería la IP del proxy y el rate limiting por IP
  // trataría a todo el tráfico como un único cliente.
  app.set('trust proxy', 1);

  // --- Cabeceras de seguridad (RNF-003, RNF-007) -----------------------------
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          // Swagger UI inyecta estilos en línea; sin esto la documentación se ve rota.
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: isProduction ? [] : null,
        },
      },
      hsts: isProduction ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      crossOriginResourcePolicy: { policy: 'same-site' },
      // Oculta la cabecera X-Powered-By, que anuncia gratis el stack a un atacante.
      hidePoweredBy: true,
    }),
  );

  app.use(cookieParser());

  // --- CORS ------------------------------------------------------------------
  const corsOrigins = (config.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    // Lista blanca explícita. Con `credentials: true` el comodín no es válido y, sobre
    // todo, permitiría a cualquier web enviar peticiones autenticadas con las cookies
    // del usuario.
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    maxAge: 600,
  });

  // --- Validación global (RNF-005) -------------------------------------------
  app.useGlobalPipes(
    new ValidationPipe({
      // Elimina propiedades no declaradas en el DTO: impide el mass assignment, por
      // ejemplo colar `"role": "admin"` en el cuerpo de un registro.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      // En producción no se devuelven los valores recibidos en el mensaje de error.
      disableErrorMessages: false,
      validationError: { target: false, value: false },
    }),
  );

  app.setGlobalPrefix(apiPrefix, {
    // El health check tiene que ser alcanzable sin versión: los orquestadores lo
    // consultan con una URL fija.
    exclude: ['health', 'health/live'],
  });

  // Límite de tamaño del cuerpo: un JSON de 100 MB es un DoS de memoria.
  app.useBodyParser('json', { limit: '256kb' });
  app.useBodyParser('urlencoded', { limit: '256kb', extended: true });

  // --- Documentación OpenAPI --------------------------------------------------
  if (!isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Route Optimization API')
      .setDescription(
        'Sistema inteligente de optimización de rutas de distribución.\n\n' +
          'Optimización multicriterio (distancia, tiempo, coste y riesgo) sobre la red ' +
          'vial real, con integración de clima, incidentes y peajes por categoría de vehículo.',
      )
      .setVersion('1.0.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT', in: 'header' }, 'JWT')
      .addCookieAuth('access_token')
      .addTag('Auth', 'Autenticación, sesiones y contraseñas')
      .addTag('Users', 'Gestión de usuarios (solo ADMIN)')
      .addTag('Vehicles', 'Flota y catálogo de tipos de vehículo')
      .addTag('Routes', 'Cálculo y consulta de rutas optimizadas')
      .addTag('Geocoding', 'Búsqueda de direcciones y geocodificación inversa')
      .addTag('Incidents', 'Incidentes viales')
      .addTag('Tolls', 'Estaciones de peaje y tarifas')
      .addTag('Analytics', 'Indicadores agregados')
      .addTag('Health', 'Estado del servicio')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(`${apiPrefix}/docs`, app, document, {
      swaggerOptions: { persistAuthorization: true },
    });

    logger.log(`Documentación disponible en http://localhost:${port}/${apiPrefix}/docs`);
  }

  // Cierra conexiones a Postgres y Redis al recibir SIGTERM en lugar de matarlas de golpe.
  app.enableShutdownHooks();

  await app.listen(port, '0.0.0.0');
  logger.log(`API escuchando en el puerto ${port} (entorno: ${config.get('NODE_ENV')})`);
}

bootstrap().catch((error) => {
  // Un fallo de arranque no puede quedar como una promesa rechazada sin capturar:
  // el proceso debe morir con código distinto de cero para que el orquestador lo sepa.
  new Logger('Bootstrap').error(
    'Fallo al arrancar la aplicación',
    error instanceof Error ? error.stack : String(error),
  );
  process.exit(1);
});
