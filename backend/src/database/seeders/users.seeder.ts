import { Algorithm, hash } from '@node-rs/argon2';
import { DataSource } from 'typeorm';

import { Role } from '@/common/enums';
import { PASSWORD_PATTERN } from '@/modules/auth/dto/auth.dto';
import { User } from '@/modules/auth/entities/user.entity';

const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

/**
 * Crea la cuenta de administrador inicial.
 *
 * La contraseña se toma SIEMPRE del entorno y nunca tiene valor por defecto. Un seeder
 * con credenciales fijas en el código es la vía por la que acaban en producción
 * sistemas con `admin/admin123`, y además el hash quedaría versionado en el repositorio.
 */
export async function seedAdminUser(dataSource: DataSource): Promise<boolean> {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'Define SEED_ADMIN_EMAIL y SEED_ADMIN_PASSWORD para crear el administrador inicial. ' +
        'Ejemplo: SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD="..." npm run seed',
    );
  }

  if (!PASSWORD_PATTERN.test(password)) {
    throw new Error(
      'SEED_ADMIN_PASSWORD no cumple la política: mínimo 12 caracteres con minúscula, ' +
        'mayúscula, dígito y carácter especial.',
    );
  }

  const repository = dataSource.getRepository(User);
  const normalizedEmail = email.trim().toLowerCase();

  const existing = await repository.findOne({ where: { email: normalizedEmail } });
  if (existing) return false;

  await repository.save(
    repository.create({
      email: normalizedEmail,
      passwordHash: await hash(password, ARGON2_OPTIONS),
      firstName: process.env.SEED_ADMIN_FIRST_NAME ?? 'Administrador',
      lastName: process.env.SEED_ADMIN_LAST_NAME ?? 'del Sistema',
      role: Role.Admin,
      isActive: true,
      tokensValidFrom: new Date(),
    }),
  );

  return true;
}
