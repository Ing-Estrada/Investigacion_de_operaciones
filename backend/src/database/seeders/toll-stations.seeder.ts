import { DataSource } from 'typeorm';

import { TollCategory } from '@/common/enums';
import { toGeoJSONPoint } from '@/common/types/geo.types';
import { TollRate } from '@/modules/tolls/entities/toll-rate.entity';
import { TollStation } from '@/modules/tolls/entities/toll-station.entity';

/**
 * Estaciones de peaje de ejemplo sobre el corredor Pitalito - Neiva (Huila, Colombia),
 * que es el escenario que usa la especificación.
 *
 * Son datos de demostración con ubicaciones aproximadas: sirven para que el sistema sea
 * ejecutable de extremo a extremo desde el primer arranque, no como fuente autoritativa.
 * En producción, esta tabla se alimenta de los pliegos tarifarios del operador de la vía.
 */
const STATIONS = [
  {
    name: 'Peaje Los Cauchos',
    highwayName: 'Ruta 45 - Pitalito/Garzón',
    operator: 'Concesión Vial',
    latitude: 2.0521,
    longitude: -75.9312,
    rates: {
      [TollCategory.CategoryI]: 3.1,
      [TollCategory.CategoryII]: 5.4,
      [TollCategory.CategoryIII]: 8.2,
      [TollCategory.CategoryIV]: 11.6,
      [TollCategory.CategoryV]: 14.8,
    },
  },
  {
    name: 'Peaje El Juncal',
    highwayName: 'Ruta 45 - Garzón/Neiva',
    operator: 'Concesión Vial',
    latitude: 2.6104,
    longitude: -75.5893,
    rates: {
      [TollCategory.CategoryI]: 2.9,
      [TollCategory.CategoryII]: 5.1,
      [TollCategory.CategoryIII]: 7.8,
      [TollCategory.CategoryIV]: 10.9,
      [TollCategory.CategoryV]: 13.9,
    },
  },
  {
    name: 'Peaje Santa Helena',
    highwayName: 'Ruta 45 - Acceso Neiva',
    operator: 'Concesión Vial',
    latitude: 2.8935,
    longitude: -75.3204,
    rates: {
      [TollCategory.CategoryI]: 3.4,
      [TollCategory.CategoryII]: 5.9,
      [TollCategory.CategoryIII]: 8.9,
      [TollCategory.CategoryIV]: 12.4,
      [TollCategory.CategoryV]: 15.7,
    },
  },
];

export async function seedTollStations(dataSource: DataSource): Promise<number> {
  const stationRepository = dataSource.getRepository(TollStation);
  const rateRepository = dataSource.getRepository(TollRate);

  // Fecha de vigencia en el pasado para que las tarifas apliquen desde el primer día.
  const effectiveDate = '2025-01-01';
  let inserted = 0;

  for (const definition of STATIONS) {
    let station = await stationRepository.findOne({ where: { name: definition.name } });

    if (!station) {
      station = await stationRepository.save(
        stationRepository.create({
          name: definition.name,
          highwayName: definition.highwayName,
          operator: definition.operator,
          location: toGeoJSONPoint({
            latitude: definition.latitude,
            longitude: definition.longitude,
          }),
        }),
      );
      inserted += 1;
    }

    for (const [category, amount] of Object.entries(definition.rates)) {
      const existing = await rateRepository.findOne({
        where: {
          tollStationId: station.id,
          vehicleCategory: category as TollCategory,
          effectiveDate,
        },
      });
      if (existing) continue;

      await rateRepository.save(
        rateRepository.create({
          tollStationId: station.id,
          vehicleCategory: category as TollCategory,
          rateAmount: amount,
          currency: 'USD',
          effectiveDate,
          expirationDate: null,
        }),
      );
    }
  }

  return inserted;
}
