import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Esquema inicial completo.
 *
 * Notas sobre la especificación original, cuyo SQL no era ejecutable en PostgreSQL:
 *
 *  - `ENUM('a','b')` en línea es sintaxis de MySQL. En PostgreSQL hay que crear el tipo
 *    con `CREATE TYPE ... AS ENUM` y luego referenciarlo.
 *  - El CHECK de email usaba la clase `[A-Z|a-z]`, que incluye la barra vertical como
 *    carácter literal y acepta direcciones inválidas. Aquí se corrige, aunque la
 *    validación real vive en el DTO: la base de datos es la última línea, no la primera.
 *  - `estimated_duration_minutes SMALLINT` desborda a las 546 horas de trayecto. Se usa
 *    INTEGER.
 *  - `audit_logs.user_id` se declaraba NOT NULL con ON DELETE SET NULL, combinación
 *    imposible: al borrar el usuario, la actualización violaría el NOT NULL. Aquí la
 *    columna es nullable y sin clave foránea, para que el registro sobreviva al borrado.
 */
export class InitialSchema1756200000000 implements MigrationInterface {
  name = 'InitialSchema1756200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- Extensiones ---------------------------------------------------------
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS postgis`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    // --- Tipos enumerados ----------------------------------------------------
    await queryRunner.query(
      `CREATE TYPE "users_role_enum" AS ENUM ('admin', 'dispatcher', 'driver', 'customer')`,
    );
    await queryRunner.query(
      `CREATE TYPE "vehicle_types_weight_category_enum" AS ENUM ('light', 'medium', 'heavy', 'extra_heavy')`,
    );
    await queryRunner.query(
      `CREATE TYPE "vehicle_types_toll_category_enum" AS ENUM ('I', 'II', 'III', 'IV', 'V')`,
    );
    await queryRunner.query(
      `CREATE TYPE "toll_rates_vehicle_category_enum" AS ENUM ('I', 'II', 'III', 'IV', 'V')`,
    );
    await queryRunner.query(
      `CREATE TYPE "routes_route_status_enum" AS ENUM ('pending', 'calculated', 'in_progress', 'completed', 'cancelled')`,
    );
    await queryRunner.query(
      `CREATE TYPE "route_segments_road_type_enum" AS ENUM ('highway', 'principal', 'secondary', 'tertiary')`,
    );
    await queryRunner.query(
      `CREATE TYPE "route_segments_incident_severity_enum" AS ENUM ('low', 'medium', 'high', 'critical')`,
    );
    await queryRunner.query(
      `CREATE TYPE "road_incidents_incident_type_enum" AS ENUM ('accident', 'construction', 'weather', 'restriction', 'traffic_jam')`,
    );
    await queryRunner.query(
      `CREATE TYPE "road_incidents_severity_enum" AS ENUM ('low', 'medium', 'high', 'critical')`,
    );
    await queryRunner.query(
      `CREATE TYPE "audit_logs_action_enum" AS ENUM (
        'login', 'login_failed', 'logout', 'register', 'token_refresh',
        'password_change', 'role_change', 'create', 'update', 'delete',
        'read', 'access_denied'
      )`,
    );

    // --- users ---------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "email"                 varchar(255) NOT NULL,
        "password_hash"         varchar(255) NOT NULL,
        "first_name"            varchar(100) NOT NULL,
        "last_name"             varchar(100) NOT NULL,
        "role"                  "users_role_enum" NOT NULL DEFAULT 'customer',
        "is_active"             boolean NOT NULL DEFAULT true,
        "failed_login_attempts" smallint NOT NULL DEFAULT 0,
        "locked_until"          timestamptz,
        "last_login_at"         timestamptz,
        "tokens_valid_from"     timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "created_at"            timestamptz NOT NULL DEFAULT now(),
        "updated_at"            timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_users_email" UNIQUE ("email"),
        CONSTRAINT "chk_users_email_format"
          CHECK ("email" ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$')
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "idx_users_email" ON "users" ("email")`);
    await queryRunner.query(
      `CREATE INDEX "idx_users_role_active" ON "users" ("role") WHERE "is_active" = true`,
    );

    // --- refresh_tokens ------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "refresh_tokens" (
        "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"        uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "token_hash"     char(64) NOT NULL,
        "family_id"      uuid NOT NULL,
        "expires_at"     timestamptz NOT NULL,
        "revoked_at"     timestamptz,
        "replaced_by_id" uuid,
        "ip_address"     inet,
        "user_agent"     varchar(255),
        "created_at"     timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_refresh_tokens_hash" ON "refresh_tokens" ("token_hash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_tokens_user_id" ON "refresh_tokens" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_tokens_family" ON "refresh_tokens" ("family_id")`,
    );
    // Índice parcial: la purga de tokens caducados solo mira los que siguen vivos.
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_tokens_expires_active" ON "refresh_tokens" ("expires_at")
       WHERE "revoked_at" IS NULL`,
    );

    // --- vehicle_types -------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "vehicle_types" (
        "id"                                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name"                              varchar(50) NOT NULL,
        "weight_category"                   "vehicle_types_weight_category_enum" NOT NULL,
        "axles"                             smallint NOT NULL,
        "max_weight_kg"                     integer NOT NULL,
        "max_height_meters"                 numeric(4,2) NOT NULL,
        "max_width_meters"                  numeric(4,2) NOT NULL,
        "avg_fuel_consumption_l_per_100km"  numeric(5,2) NOT NULL,
        "toll_category"                     "vehicle_types_toll_category_enum" NOT NULL,
        "created_at"                        timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_vehicle_types_name" UNIQUE ("name"),
        CONSTRAINT "chk_vehicle_types_axles" CHECK ("axles" > 0 AND "axles" <= 12),
        CONSTRAINT "chk_vehicle_types_consumption" CHECK ("avg_fuel_consumption_l_per_100km" > 0)
      )
    `);

    // --- vehicles ------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "vehicles" (
        "id"                                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"                               uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "vehicle_type_id"                       uuid NOT NULL REFERENCES "vehicle_types"("id") ON DELETE RESTRICT,
        "plate"                                 varchar(20) NOT NULL,
        "manufacturer"                          varchar(100) NOT NULL,
        "model"                                 varchar(100) NOT NULL,
        "year"                                  smallint NOT NULL,
        "current_fuel_liters"                   numeric(7,2) NOT NULL DEFAULT 0,
        "fuel_capacity_liters"                  numeric(7,2) NOT NULL,
        "custom_fuel_consumption_l_per_100km"   numeric(5,2),
        "is_active"                             boolean NOT NULL DEFAULT true,
        "created_at"                            timestamptz NOT NULL DEFAULT now(),
        "updated_at"                            timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_vehicles_plate" UNIQUE ("plate"),
        CONSTRAINT "chk_vehicles_year"
          CHECK ("year" >= 1900 AND "year" <= EXTRACT(YEAR FROM CURRENT_DATE) + 1),
        CONSTRAINT "chk_vehicles_fuel_level"
          CHECK ("current_fuel_liters" >= 0 AND "current_fuel_liters" <= "fuel_capacity_liters"),
        CONSTRAINT "chk_vehicles_capacity" CHECK ("fuel_capacity_liters" > 0)
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_vehicles_user_id" ON "vehicles" ("user_id")`);
    await queryRunner.query(
      `CREATE INDEX "idx_vehicles_vehicle_type_id" ON "vehicles" ("vehicle_type_id")`,
    );

    // --- toll_stations -------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "toll_stations" (
        "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name"         varchar(100) NOT NULL,
        "location"     geometry(Point, 4326) NOT NULL,
        "highway_name" varchar(100) NOT NULL,
        "operator"     varchar(100),
        "is_active"    boolean NOT NULL DEFAULT true,
        "created_at"   timestamptz NOT NULL DEFAULT now()
      )
    `);
    // GIST: sin este índice, cada ST_DWithin recorre la tabla entera.
    await queryRunner.query(
      `CREATE INDEX "idx_toll_stations_location" ON "toll_stations" USING GIST ("location")`,
    );

    // --- toll_rates ----------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "toll_rates" (
        "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "toll_station_id"  uuid NOT NULL REFERENCES "toll_stations"("id") ON DELETE CASCADE,
        "vehicle_category" "toll_rates_vehicle_category_enum" NOT NULL,
        "rate_amount"      numeric(10,2) NOT NULL,
        "currency"         char(3) NOT NULL DEFAULT 'USD',
        "effective_date"   date NOT NULL,
        "expiration_date"  date,
        "created_at"       timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_toll_rates_station_category_date"
          UNIQUE ("toll_station_id", "vehicle_category", "effective_date"),
        CONSTRAINT "chk_toll_rates_amount" CHECK ("rate_amount" > 0),
        CONSTRAINT "chk_toll_rates_dates"
          CHECK ("expiration_date" IS NULL OR "expiration_date" >= "effective_date")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_toll_rates_station_id" ON "toll_rates" ("toll_station_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_toll_rates_effective_date" ON "toll_rates" ("effective_date")`,
    );
    // Índice compuesto para la búsqueda de tarifa vigente, que es la consulta caliente.
    await queryRunner.query(
      `CREATE INDEX "idx_toll_rates_lookup"
       ON "toll_rates" ("toll_station_id", "vehicle_category", "effective_date" DESC)`,
    );

    // --- road_incidents ------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "road_incidents" (
        "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "incident_location"  geometry(Point, 4326) NOT NULL,
        "incident_type"      "road_incidents_incident_type_enum" NOT NULL,
        "description"        text NOT NULL,
        "severity"           "road_incidents_severity_enum" NOT NULL,
        "is_active"          boolean NOT NULL DEFAULT true,
        "start_time"         timestamptz NOT NULL,
        "estimated_end_time" timestamptz,
        "affected_radius_km" numeric(6,2) NOT NULL DEFAULT 2.0,
        "source"             varchar(50) NOT NULL DEFAULT 'manual',
        "created_at"         timestamptz NOT NULL DEFAULT now(),
        "updated_at"         timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_incidents_radius" CHECK ("affected_radius_km" > 0),
        CONSTRAINT "chk_incidents_time_window"
          CHECK ("estimated_end_time" IS NULL OR "estimated_end_time" >= "start_time")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_road_incidents_location" ON "road_incidents" USING GIST ("incident_location")`,
    );
    // Índice parcial: las consultas de ruta solo miran incidentes activos, que son una
    // fracción minúscula del histórico acumulado.
    await queryRunner.query(
      `CREATE INDEX "idx_road_incidents_active" ON "road_incidents" ("start_time" DESC)
       WHERE "is_active" = true`,
    );

    // --- routes --------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "routes" (
        "id"                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"                    uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "vehicle_id"                 uuid NOT NULL REFERENCES "vehicles"("id") ON DELETE RESTRICT,
        "parent_route_id"            uuid REFERENCES "routes"("id") ON DELETE CASCADE,
        "alternative_rank"           smallint,
        "origin_point"               geometry(Point, 4326) NOT NULL,
        "destination_point"          geometry(Point, 4326) NOT NULL,
        "path"                       geometry(LineString, 4326),
        "origin_address"             varchar(255),
        "destination_address"        varchar(255),
        "distance_km"                numeric(10,2) NOT NULL,
        "estimated_duration_minutes" integer NOT NULL,
        "fuel_consumption_liters"    numeric(8,2) NOT NULL,
        "fuel_cost"                  numeric(12,2) NOT NULL,
        "toll_cost"                  numeric(12,2) NOT NULL,
        "total_cost"                 numeric(12,2) NOT NULL,
        "currency"                   char(3) NOT NULL DEFAULT 'USD',
        "optimization_score"         numeric(5,2) NOT NULL,
        "algorithm"                  varchar(30) NOT NULL DEFAULT 'dijkstra',
        "route_status"               "routes_route_status_enum" NOT NULL DEFAULT 'calculated',
        "weather_summary"            jsonb,
        "computation_time_ms"        integer NOT NULL DEFAULT 0,
        "created_at"                 timestamptz NOT NULL DEFAULT now(),
        "updated_at"                 timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_routes_distance" CHECK ("distance_km" > 0),
        CONSTRAINT "chk_routes_duration" CHECK ("estimated_duration_minutes" > 0),
        CONSTRAINT "chk_routes_score"
          CHECK ("optimization_score" >= 0 AND "optimization_score" <= 100),
        CONSTRAINT "chk_routes_costs"
          CHECK ("fuel_cost" >= 0 AND "toll_cost" >= 0 AND "total_cost" >= 0),
        CONSTRAINT "chk_routes_alternative_consistency" CHECK (
          ("parent_route_id" IS NULL AND "alternative_rank" IS NULL) OR
          ("parent_route_id" IS NOT NULL AND "alternative_rank" IS NOT NULL AND "alternative_rank" > 0)
        ),
        CONSTRAINT "chk_routes_no_self_parent" CHECK ("parent_route_id" IS DISTINCT FROM "id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_routes_user_id" ON "routes" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "idx_routes_vehicle_id" ON "routes" ("vehicle_id")`);
    await queryRunner.query(
      `CREATE INDEX "idx_routes_parent_route_id" ON "routes" ("parent_route_id")`,
    );
    await queryRunner.query(`CREATE INDEX "idx_routes_created_at" ON "routes" ("created_at" DESC)`);
    await queryRunner.query(`CREATE INDEX "idx_routes_status" ON "routes" ("route_status")`);
    await queryRunner.query(
      `CREATE INDEX "idx_routes_origin" ON "routes" USING GIST ("origin_point")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_routes_destination" ON "routes" USING GIST ("destination_point")`,
    );
    // Cubre la consulta del historial: rutas principales de un usuario por fecha.
    await queryRunner.query(
      `CREATE INDEX "idx_routes_user_primary_recent"
       ON "routes" ("user_id", "created_at" DESC) WHERE "parent_route_id" IS NULL`,
    );
    // Una ruta principal no puede tener dos alternativas con el mismo rango.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_routes_parent_rank"
       ON "routes" ("parent_route_id", "alternative_rank") WHERE "parent_route_id" IS NOT NULL`,
    );

    // --- route_segments ------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "route_segments" (
        "id"                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "route_id"                 uuid NOT NULL REFERENCES "routes"("id") ON DELETE CASCADE,
        "segment_order"            smallint NOT NULL,
        "start_point"              geometry(Point, 4326) NOT NULL,
        "end_point"                geometry(Point, 4326) NOT NULL,
        "segment_distance_km"      numeric(10,2) NOT NULL,
        "segment_duration_minutes" numeric(8,2) NOT NULL,
        "road_type"                "route_segments_road_type_enum" NOT NULL,
        "road_name"                varchar(150),
        "has_toll"                 boolean NOT NULL DEFAULT false,
        "toll_cost"                numeric(10,2),
        "toll_station_id"          uuid,
        "weather_condition"        varchar(80),
        "weather_intensity_factor" numeric(4,3) NOT NULL DEFAULT 0,
        "incident_present"         boolean NOT NULL DEFAULT false,
        "incident_severity"        "route_segments_incident_severity_enum",
        "created_at"               timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_route_segments_order" UNIQUE ("route_id", "segment_order"),
        CONSTRAINT "chk_route_segments_distance" CHECK ("segment_distance_km" >= 0),
        CONSTRAINT "chk_route_segments_weather"
          CHECK ("weather_intensity_factor" >= 0 AND "weather_intensity_factor" <= 1),
        CONSTRAINT "chk_route_segments_toll_consistency"
          CHECK (("has_toll" = false AND "toll_cost" IS NULL) OR "has_toll" = true)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_route_segments_route_id" ON "route_segments" ("route_id", "segment_order")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_route_segments_road_type" ON "route_segments" ("road_type")`,
    );

    // --- audit_logs ----------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"     uuid,
        "user_email"  varchar(255),
        "action"      "audit_logs_action_enum" NOT NULL,
        "entity_type" varchar(50) NOT NULL,
        "entity_id"   uuid,
        "old_values"  jsonb,
        "new_values"  jsonb,
        "success"     boolean NOT NULL DEFAULT true,
        "reason"      varchar(255),
        "ip_address"  inet,
        "user_agent"  varchar(255),
        "created_at"  timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_audit_logs_user_id" ON "audit_logs" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "idx_audit_logs_action" ON "audit_logs" ("action")`);
    await queryRunner.query(
      `CREATE INDEX "idx_audit_logs_entity" ON "audit_logs" ("entity_type", "entity_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_audit_logs_created_at" ON "audit_logs" ("created_at" DESC)`,
    );
    // Los fallos de acceso son la consulta habitual del equipo de seguridad.
    await queryRunner.query(
      `CREATE INDEX "idx_audit_logs_failures" ON "audit_logs" ("created_at" DESC)
       WHERE "success" = false`,
    );

    // --- Mantenimiento de updated_at ----------------------------------------
    // Un trigger y no la aplicación: así una actualización hecha desde psql o desde una
    // futura integración tampoco puede dejar `updated_at` desfasado.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    for (const table of ['users', 'vehicles', 'routes', 'road_incidents']) {
      await queryRunner.query(`
        CREATE TRIGGER "trg_${table}_updated_at"
        BEFORE UPDATE ON "${table}"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['users', 'vehicles', 'routes', 'road_incidents']) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_${table}_updated_at" ON "${table}"`);
    }
    await queryRunner.query(`DROP FUNCTION IF EXISTS set_updated_at()`);

    // Orden inverso al de creación para respetar las claves foráneas.
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "route_segments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "routes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "road_incidents"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "toll_rates"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "toll_stations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "vehicles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "vehicle_types"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "refresh_tokens"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);

    for (const type of [
      'audit_logs_action_enum',
      'road_incidents_severity_enum',
      'road_incidents_incident_type_enum',
      'route_segments_incident_severity_enum',
      'route_segments_road_type_enum',
      'routes_route_status_enum',
      'toll_rates_vehicle_category_enum',
      'vehicle_types_toll_category_enum',
      'vehicle_types_weight_category_enum',
      'users_role_enum',
    ]) {
      await queryRunner.query(`DROP TYPE IF EXISTS "${type}"`);
    }
  }
}
