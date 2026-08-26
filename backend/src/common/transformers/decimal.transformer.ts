import { ValueTransformer } from 'typeorm';

/**
 * El driver `pg` devuelve NUMERIC/DECIMAL como string para no perder precisión en
 * valores que exceden el rango seguro de un double. Nuestros importes y distancias
 * caben de sobra en un `number`, así que convertimos en la frontera del ORM y evitamos
 * que un `"12.50" + 1` se convierta en `"12.501"` más arriba en la aplicación.
 */
export class DecimalTransformer implements ValueTransformer {
  constructor(private readonly precision = 2) {}

  to(value: number | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    return Number(value.toFixed(this.precision));
  }

  from(value: string | null): number | null {
    if (value === null || value === undefined) return null;
    return Number.parseFloat(value);
  }
}

export const decimal2 = new DecimalTransformer(2);
