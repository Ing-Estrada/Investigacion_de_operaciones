import { ConfigType } from '@nestjs/config';

import securityConfig from '@/config/security.config';

import { PasswordService } from './password.service';

const TEST_CONFIG = {
  jwt: { accessSecret: 'x', refreshSecret: 'y', accessTtl: '15m', refreshTtl: '7d' },
  cookie: { domain: 'localhost', secure: false, sameSite: 'lax' as const },
  corsOrigins: [],
  rateLimit: { defaultMax: 100, defaultWindowSec: 60 },
  // Parámetros mínimos: con los de producción (19 MiB, t=2) cada hash tarda ~50 ms y
  // esta suite haría decenas. La corrección del algoritmo no depende del coste.
  argon2: { memoryCost: 8192, timeCost: 1, parallelism: 1 },
} as unknown as ConfigType<typeof securityConfig>;

describe('PasswordService', () => {
  const service = new PasswordService(TEST_CONFIG);

  it('produce un digest Argon2id', async () => {
    const digest = await service.hash('Sup3rS3gura!2026');

    expect(digest.startsWith('$argon2id$')).toBe(true);
  });

  it('nunca deja la contraseña en claro dentro del digest', async () => {
    const digest = await service.hash('Sup3rS3gura!2026');

    expect(digest).not.toContain('Sup3rS3gura!2026');
  });

  it('genera digests distintos para la misma contraseña', async () => {
    // La sal es aleatoria por hash; si dos hashes coincidieran, una tabla rainbow
    // valdría para toda la base de usuarios.
    const [a, b] = await Promise.all([service.hash('misma'), service.hash('misma')]);

    expect(a).not.toBe(b);
  });

  it('verifica correctamente la contraseña buena', async () => {
    const digest = await service.hash('Sup3rS3gura!2026');

    await expect(service.verify(digest, 'Sup3rS3gura!2026')).resolves.toBe(true);
  });

  it('rechaza una contraseña incorrecta', async () => {
    const digest = await service.hash('Sup3rS3gura!2026');

    await expect(service.verify(digest, 'Sup3rS3gura!2025')).resolves.toBe(false);
  });

  it('distingue mayúsculas de minúsculas', async () => {
    const digest = await service.hash('Sup3rS3gura!2026');

    await expect(service.verify(digest, 'sup3rs3gura!2026')).resolves.toBe(false);
  });

  it('devuelve false ante un digest corrupto en lugar de lanzar', async () => {
    await expect(service.verify('esto-no-es-un-hash', 'lo-que-sea')).resolves.toBe(false);
    await expect(service.verify('', 'lo-que-sea')).resolves.toBe(false);
  });

  it('verifyDummy siempre devuelve false', async () => {
    await expect(service.verifyDummy('cualquier-cosa')).resolves.toBe(false);
  });

  it('admite contraseñas con unicode y símbolos', async () => {
    const password = 'Contraseñá-Ñandú€2026!';
    const digest = await service.hash(password);

    await expect(service.verify(digest, password)).resolves.toBe(true);
  });
});
