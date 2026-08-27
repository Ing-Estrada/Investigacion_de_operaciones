import { DataSource } from 'typeorm';

import { FuelType, TollCategory, WeightCategory } from '@/common/enums';
import { VehicleType } from '@/modules/vehicles/entities/vehicle-type.entity';

/**
 * Catálogo base de tipos de vehículo (RF-012).
 *
 * Los consumos son valores de referencia del sector para vehículo cargado en
 * condiciones normales. Son un punto de partida: el consumo real de cada unidad se
 * ajusta con `custom_fuel_consumption_l_per_100km` en la ficha del vehículo.
 */
const VEHICLE_TYPES: Omit<VehicleType, 'id' | 'createdAt' | 'vehicles'>[] = [
  {
    name: 'Furgoneta ligera',
    weightCategory: WeightCategory.Light,
    axles: 2,
    maxWeightKg: 3500,
    maxHeightMeters: 2.6,
    maxWidthMeters: 2.0,
    avgFuelConsumptionLPer100Km: 9.5,
    tollCategory: TollCategory.CategoryI,
    fuelType: FuelType.Gasoline,
  },
  {
    name: 'Camión rígido 2 ejes',
    weightCategory: WeightCategory.Medium,
    axles: 2,
    maxWeightKg: 12_000,
    maxHeightMeters: 3.6,
    maxWidthMeters: 2.5,
    avgFuelConsumptionLPer100Km: 22.0,
    tollCategory: TollCategory.CategoryII,
    fuelType: FuelType.Diesel,
  },
  {
    name: 'Camión rígido 3 ejes',
    weightCategory: WeightCategory.Heavy,
    axles: 3,
    maxWeightKg: 26_000,
    maxHeightMeters: 4.0,
    maxWidthMeters: 2.55,
    avgFuelConsumptionLPer100Km: 28.5,
    tollCategory: TollCategory.CategoryIII,
    fuelType: FuelType.Diesel,
  },
  {
    name: 'Tractocamión 5 ejes',
    weightCategory: WeightCategory.Heavy,
    axles: 5,
    maxWeightKg: 40_000,
    maxHeightMeters: 4.1,
    maxWidthMeters: 2.6,
    avgFuelConsumptionLPer100Km: 35.0,
    tollCategory: TollCategory.CategoryIV,
    fuelType: FuelType.Diesel,
  },
  {
    name: 'Tren de carretera 6+ ejes',
    weightCategory: WeightCategory.ExtraHeavy,
    axles: 6,
    maxWeightKg: 52_000,
    maxHeightMeters: 4.2,
    maxWidthMeters: 2.6,
    avgFuelConsumptionLPer100Km: 42.0,
    tollCategory: TollCategory.CategoryV,
    fuelType: FuelType.Diesel,
  },
];

/**
 * Idempotente: se puede ejecutar tantas veces como haga falta. Un seeder que duplica
 * datos al reejecutarse es inservible en un pipeline de despliegue.
 */
export async function seedVehicleTypes(dataSource: DataSource): Promise<number> {
  const repository = dataSource.getRepository(VehicleType);
  let inserted = 0;

  for (const type of VEHICLE_TYPES) {
    const existing = await repository.findOne({ where: { name: type.name } });
    if (existing) continue;

    await repository.save(repository.create(type));
    inserted += 1;
  }

  return inserted;
}
