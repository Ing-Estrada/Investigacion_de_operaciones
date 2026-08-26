-- ===========================================================================
-- Inicialización del cluster PostgreSQL para Route Optimizer.
-- Se ejecuta UNA SOLA VEZ, al crear el volumen de datos.
-- Las tablas NO se crean aquí: las gestiona TypeORM en backend/src/database/migrations.
-- ===========================================================================

-- Extensiones geoespaciales (RF-002, búsquedas de proximidad con índices GIST)
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- gen_random_uuid() para claves primarias UUID
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Búsqueda difusa de direcciones y placas (índices trigram)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Timezone explícita: todos los timestamps se persisten en UTC.
-- ALTER DATABASE no acepta una expresión como nombre, hay que construirlo dinámicamente.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO ''UTC''', current_database());
END
$$;
