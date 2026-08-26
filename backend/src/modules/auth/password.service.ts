import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Algorithm, hash, verify } from '@node-rs/argon2';

import securityConfig from '@/config/security.config';

/**
 * Hashing de contraseñas con Argon2id (RNF-002).
 *
 * Argon2id y no bcrypt porque es el algoritmo recomendado por OWASP: bcrypt tiene un
 * coste de memoria fijo y bajo, lo que lo hace barato de atacar con GPU/ASIC. Argon2id
 * combina resistencia a canal lateral (Argon2i) y a GPU (Argon2d).
 *
 * La sal la genera la propia librería por hash y va embebida en el digest resultante,
 * junto con los parámetros: cambiar el coste en el futuro no invalida los hashes viejos.
 */
@Injectable()
export class PasswordService {
  private readonly options: {
    algorithm: Algorithm;
    memoryCost: number;
    timeCost: number;
    parallelism: number;
  };

  /**
   * Digest de una contraseña ficticia. Se verifica contra él cuando el email no existe,
   * de modo que un login con usuario inexistente tarde lo mismo que uno con contraseña
   * incorrecta. Sin esto, la diferencia de tiempo permite enumerar cuentas registradas.
   */
  private dummyHash: string | null = null;

  constructor(@Inject(securityConfig.KEY) config: ConfigType<typeof securityConfig>) {
    this.options = {
      algorithm: Algorithm.Argon2id,
      memoryCost: config.argon2.memoryCost,
      timeCost: config.argon2.timeCost,
      parallelism: config.argon2.parallelism,
    };
  }

  async hash(plaintext: string): Promise<string> {
    return hash(plaintext, this.options);
  }

  /** Devuelve false ante un digest corrupto en lugar de lanzar: es un dato, no un fallo. */
  async verify(digest: string, plaintext: string): Promise<boolean> {
    try {
      return await verify(digest, plaintext, this.options);
    } catch {
      return false;
    }
  }

  /** Consume el mismo tiempo de CPU que una verificación real, y siempre falla. */
  async verifyDummy(plaintext: string): Promise<false> {
    if (!this.dummyHash) {
      this.dummyHash = await this.hash('contraseña-inexistente-para-igualar-tiempos');
    }
    await this.verify(this.dummyHash, plaintext);
    return false;
  }
}
