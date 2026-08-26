const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
};

/**
 * Convierte una duración estilo JWT ("15m", "7d", "3600") a segundos.
 *
 * Existe porque el TTL se configura una sola vez en formato humano pero se necesita en
 * segundos en tres sitios distintos —expiración del JWT, `maxAge` de la cookie y el
 * campo `expiresIn` de la respuesta— y calcularlo a mano en cada uno es la forma
 * clásica de que la cookie sobreviva al token.
 */
export function parseDurationToSeconds(duration: string): number {
  const trimmed = duration.trim();

  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  const match = /^(\d+)\s*([smhd])$/i.exec(trimmed);
  if (!match) {
    throw new Error(`Duración inválida: "${duration}". Formatos válidos: 30s, 15m, 2h, 7d.`);
  }

  const [, amount, unit] = match;
  return Number.parseInt(amount, 10) * UNIT_SECONDS[unit.toLowerCase()];
}
