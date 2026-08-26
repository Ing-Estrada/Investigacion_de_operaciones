import { registerAs } from '@nestjs/config';

export interface SecurityConfig {
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtl: string;
    refreshTtl: string;
  };
  cookie: {
    domain: string;
    secure: boolean;
    sameSite: 'lax' | 'strict' | 'none';
  };
  corsOrigins: string[];
  rateLimit: {
    defaultMax: number;
    defaultWindowSec: number;
  };
  argon2: {
    memoryCost: number;
    timeCost: number;
    parallelism: number;
  };
}

export default registerAs<SecurityConfig>('security', () => ({
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET as string,
    refreshSecret: process.env.JWT_REFRESH_SECRET as string,
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
  },
  cookie: {
    domain: process.env.COOKIE_DOMAIN ?? 'localhost',
    // Sin HTTPS el navegador descarta las cookies `secure`, así que en dev va en false.
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
  },
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  rateLimit: {
    defaultMax: Number(process.env.RATE_LIMIT_DEFAULT_MAX ?? 100),
    defaultWindowSec: Number(process.env.RATE_LIMIT_DEFAULT_WINDOW_SEC ?? 60),
  },
  // Parámetros OWASP Password Storage Cheat Sheet para Argon2id: 19 MiB, t=2, p=1.
  argon2: {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  },
}));
