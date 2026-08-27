import { DataSource } from 'typeorm';

import { FuelType } from '@/common/enums';
import { FuelPrice } from '@/modules/fuel/entities/fuel-price.entity';

/**
 * Precio de partida de cada combustible.
 *
 * Son valores de referencia, no precios oficiales de ningún mercado: el diésel se
 * cotiza por debajo de la gasolina en la mayoría de países, y esa relación es lo que
 * hace visible el efecto de distinguirlos. Quien despliegue el sistema debe sustituirlos
 * por los precios reales desde la pestaña de Tarifas — el importe informado es tan bueno
 * como estos datos.
 *
 * `source` deja constancia de que son de demostración, para que nadie los confunda con
 * un dato oficial al auditar un coste.
 */
const SEED_PRICES: { fuelType: FuelType; pricePerLiter: number }[] = [
  { fuelType: FuelType.Diesel, pricePerLiter: 1.05 },
  { fuelType: FuelType.Gasoline, pricePerLiter: 1.22 },
];

/** Idempotente: no duplica si ya hay un precio vigente para ese combustible. */
export async function seedFuelPrices(dataSource: DataSource): Promise<number> {
  const repository = dataSource.getRepository(FuelPrice);
  let inserted = 0;

  for (const price of SEED_PRICES) {
    const existing = await repository.findOne({ where: { fuelType: price.fuelType } });
    if (existing) continue;

    await repository.save(
      repository.create({
        fuelType: price.fuelType,
        pricePerLiter: price.pricePerLiter,
        currency: process.env.DEFAULT_CURRENCY ?? 'USD',
        // Fecha fija y anterior a cualquier despliegue: si se usara la de hoy, una ruta
        // calculada con fecha del servidor por detrás quedaría sin precio vigente.
        effectiveDate: '2025-01-01',
        expirationDate: null,
        source: 'Valor de demostración — sustituir por el precio real',
      }),
    );
    inserted += 1;
  }

  return inserted;
}
