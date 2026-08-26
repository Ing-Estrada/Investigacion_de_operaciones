import dataSource from '../data-source';

import { seedTollStations } from './toll-stations.seeder';
import { seedAdminUser } from './users.seeder';
import { seedVehicleTypes } from './vehicle-types.seeder';

/**
 * Punto de entrada de los seeders (`npm run seed`).
 *
 * Todos los seeders son idempotentes, así que reejecutarlo es seguro. El catálogo de
 * tipos de vehículo y las tarifas de peaje son datos maestros sin los que el sistema no
 * puede calcular una ruta: forman parte del despliegue, no de las pruebas.
 */
async function run(): Promise<void> {
  const skipAdmin = process.argv.includes('--skip-admin');

  await dataSource.initialize();
  // eslint-disable-next-line no-console
  const log = console.log;

  try {
    const vehicleTypes = await seedVehicleTypes(dataSource);
    log(`Tipos de vehículo: ${vehicleTypes} nuevo(s).`);

    const tollStations = await seedTollStations(dataSource);
    log(`Estaciones de peaje: ${tollStations} nueva(s) (con sus tarifas por categoría).`);

    if (skipAdmin) {
      log('Administrador: omitido (--skip-admin).');
    } else {
      const created = await seedAdminUser(dataSource);
      log(
        created
          ? `Administrador creado: ${process.env.SEED_ADMIN_EMAIL}`
          : 'Administrador: ya existía, sin cambios.',
      );
    }

    log('Seed completado.');
  } finally {
    await dataSource.destroy();
  }
}

run().catch((error: unknown) => {
  console.error('El seed falló:', error instanceof Error ? error.message : error);
  process.exit(1);
});
