import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tipo de combustible por tipo de vehículo y precios versionados por combustible.
 *
 * Hasta aquí el sistema aplicaba un único precio global (`DEFAULT_FUEL_PRICE_PER_LITER`)
 * a toda la flota, de modo que un tractocamión diésel y un turismo de gasolina costaban
 * lo mismo por litro. El coste de combustible es el término que más pesa dentro del
 * criterio económico, así que ese atajo desplaza el resultado de la optimización.
 *
 * `fuel_prices` se versiona igual que `toll_rates` —con `effective_date` y
 * `expiration_date`— en lugar de guardar un único valor mutable: el precio del
 * combustible cambia con frecuencia y una ruta calculada el mes pasado tiene que poder
 * explicarse con el precio que estaba vigente entonces.
 */
export class FuelTypesAndPrices1756300000000 implements MigrationInterface {
  name = 'FuelTypesAndPrices1756300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "fuel_type_enum" AS ENUM ('diesel', 'gasoline')`);

    // DEFAULT 'diesel': el catálogo actual son camiones. El default se retira después
    // para que un alta nueva tenga que declarar el combustible explícitamente.
    await queryRunner.query(
      `ALTER TABLE "vehicle_types"
       ADD COLUMN "fuel_type" "fuel_type_enum" NOT NULL DEFAULT 'diesel'`,
    );
    /*
     * Los vehículos ligeros pasan a gasolina.
     *
     * Sin esto, el backfill dejaría el catálogo entero en diésel y el precio de la
     * gasolina no se aplicaría nunca, con lo que distinguir los combustibles no
     * cambiaría ningún resultado. Es una heurística —una furgoneta ligera puede ser
     * diésel— pero acierta en la mayoría de los casos y es corregible desde la ficha del
     * tipo de vehículo. El resto del catálogo, de camión hacia arriba, es diésel con
     * mucha menos ambigüedad.
     */
    await queryRunner.query(
      `UPDATE "vehicle_types" SET "fuel_type" = 'gasoline' WHERE "weight_category" = 'light'`,
    );

    await queryRunner.query(`ALTER TABLE "vehicle_types" ALTER COLUMN "fuel_type" DROP DEFAULT`);

    await queryRunner.query(`
      CREATE TABLE "fuel_prices" (
        "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "fuel_type"       "fuel_type_enum" NOT NULL,
        "price_per_liter" numeric(10,4) NOT NULL,
        "currency"        char(3) NOT NULL DEFAULT 'USD',
        "effective_date"  date NOT NULL,
        "expiration_date" date,
        "source"          varchar(120),
        "created_at"      timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_fuel_prices_type_date" UNIQUE ("fuel_type", "effective_date"),
        CONSTRAINT "chk_fuel_prices_amount" CHECK ("price_per_liter" > 0),
        CONSTRAINT "chk_fuel_prices_dates"
          CHECK ("expiration_date" IS NULL OR "expiration_date" >= "effective_date")
      )
    `);

    // Misma forma que idx_toll_rates_lookup: la consulta caliente es "precio vigente
    // para este combustible", que ordena por effective_date descendente.
    await queryRunner.query(
      `CREATE INDEX "idx_fuel_prices_lookup"
       ON "fuel_prices" ("fuel_type", "effective_date" DESC)`,
    );

    /*
     * El precio se congela en la ruta.
     *
     * Sin esta columna, releer una ruta de hace un mes informaría del precio vigente
     * hoy junto al coste que se calculó entonces: dos cifras que no se corresponden, y
     * un `fuelCost / fuelLiters` que no da el precio mostrado. Guardarlo es lo que
     * permite justificar un coste pasado.
     *
     * El backfill despeja el precio de las rutas ya existentes a partir de los datos que
     * ellas mismas guardan (`fuel_cost / fuel_consumption_liters`) en vez de estampar el
     * valor del entorno: recupera el precio exacto que se aplicó, aunque el del entorno
     * haya cambiado desde entonces. Queda NULL donde el consumo fue 0, porque ahí el
     * cociente no está definido y no hay precio que recuperar.
     */
    await queryRunner.query(`ALTER TABLE "routes" ADD COLUMN "fuel_price_per_liter" numeric(10,4)`);
    await queryRunner.query(
      `UPDATE "routes"
       SET "fuel_price_per_liter" = CASE
         WHEN "fuel_consumption_liters" > 0 THEN ROUND("fuel_cost" / "fuel_consumption_liters", 4)
         ELSE NULL
       END`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "routes" DROP COLUMN IF EXISTS "fuel_price_per_liter"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_fuel_prices_lookup"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "fuel_prices"`);
    await queryRunner.query(`ALTER TABLE "vehicle_types" DROP COLUMN IF EXISTS "fuel_type"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "fuel_type_enum"`);
  }
}
