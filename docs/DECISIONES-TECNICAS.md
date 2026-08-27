# Decisiones técnicas y desviaciones de la especificación

Este documento recoge las decisiones que se apartan de la especificación funcional
original, con su justificación, y las correcciones aplicadas a errores del documento
fuente. Está pensado para que quien revise el sistema pueda distinguir entre "aquí falta
algo" y "aquí se decidió otra cosa a propósito".

---

## 1. Correcciones a errores de la especificación

### 1.1 El SQL no era ejecutable en PostgreSQL

La especificación declaraba columnas como `role ENUM('admin', 'dispatcher', ...)`. Eso
es sintaxis de MySQL. PostgreSQL exige crear el tipo primero:

```sql
CREATE TYPE users_role_enum AS ENUM ('admin', 'dispatcher', 'driver', 'customer');
-- y después
"role" users_role_enum NOT NULL DEFAULT 'customer'
```

Todas las enumeraciones se crean así en
[`1756200000000-InitialSchema.ts`](../backend/src/database/migrations/1756200000000-InitialSchema.ts).

### 1.2 La expresión regular de validación de email aceptaba direcciones inválidas

El CHECK propuesto usaba la clase `[A-Z|a-z]`, que incluye la barra vertical como
carácter literal. Corregido a `[A-Za-z]`. La validación real vive en el DTO
(`class-validator`): la base de datos es la última línea de defensa, no la primera.

### 1.3 `audit_logs.user_id` era una combinación imposible

Se declaraba `NOT NULL` con `ON DELETE SET NULL`. Al borrar el usuario, la actualización
violaría el `NOT NULL` y el borrado fallaría.

Además, se ha eliminado la clave foránea por completo. Un registro de auditoría debe
sobrevivir al borrado del usuario al que señala: `ON DELETE SET NULL` destruiría la única
prueba de quién hizo qué. La columna es nullable, sin FK, y se conserva `user_email` como
copia desnormalizada.

### 1.4 `estimated_duration_minutes SMALLINT` desbordaba

`SMALLINT` tiene techo en 32 767, unas 546 horas. Un trayecto transcontinental o una ruta
con un error de cálculo lo desbordaría, y un desbordamiento silencioso en un campo de
duración es peor que un error. Cambiado a `INTEGER`.

### 1.5 La fórmula de puntuación producía valores negativos

La especificación proponía `distancia_score = 100 - (distancia / 100)`. Para una ruta de
12 000 km da −20. Cualquier ordenación posterior por puntuación quedaría corrupta.

La implementación normaliza contra una escala y **satura** en el rango [0, 100]:

```text
score = 100 · (1 − min(1, valor / escala))
```

Hay un test que fuerza valores extremos y comprueba que la puntuación se mantiene en
rango ([`cost-model.spec.ts`](../backend/src/modules/routes/algorithms/cost-model.spec.ts)).

### 1.6 El radio de captura de peajes era demasiado ancho

La especificación sugería un buffer de 5 km alrededor de la ruta. Con la geometría precisa
que devuelve el proveedor, un radio de kilómetros captura peajes de carreteras paralelas
por las que el vehículo no pasa, e inflar el coste estimado con peajes inexistentes es un
error de negocio, no de precisión.

Reducido a **500 m**, configurable en `TollsService.findAlongPath`.

---

## 2. Desviaciones de diseño deliberadas

### 2.1 Rutas alternativas: autorreferencia en lugar de tabla puente

**Especificación**: tabla `alternative_routes(primary_route_id, alternative_route_id, rank)`.

**Implementación**: columnas `parent_route_id` y `alternative_rank` en `routes`.

La relación entre una ruta y sus alternativas es 1:N, no N:M — una alternativa pertenece a
exactamente una ruta principal. Modelarla como N:M permite estados imposibles (una
alternativa colgando de dos rutas principales, o de sí misma) que habría que prohibir con
constraints adicionales, y obliga a un JOIN extra en la consulta más frecuente del sistema.

La versión implementada añade además dos garantías que la tabla puente no daba:

```sql
CHECK ((parent_route_id IS NULL AND alternative_rank IS NULL) OR
       (parent_route_id IS NOT NULL AND alternative_rank IS NOT NULL AND alternative_rank > 0))
CHECK (parent_route_id IS DISTINCT FROM id)   -- una ruta no es alternativa de sí misma
CREATE UNIQUE INDEX ... ON routes (parent_route_id, alternative_rank) WHERE parent_route_id IS NOT NULL
```

### 2.2 Algoritmo de Yen en lugar de la heurística propuesta

**Especificación**: «excluir el mejor nodo de cada segmento de la ruta óptima y aplicar
Dijkstra de nuevo».

**Implementación**: [algoritmo de Yen](../backend/src/modules/routes/algorithms/yen-k-shortest.algorithm.ts)
para los K caminos más cortos sin bucles.

Lo propuesto es una aproximación heurística de la misma idea que no garantiza ni que las
rutas obtenidas sean las K mejores ni que estén correctamente ordenadas. Yen sí lo
garantiza y cuesta lo mismo implementarlo bien. Los tests comprueban las tres propiedades:
caminos distintos entre sí, sin nodos repetidos, y ordenados por coste creciente.

Se añade un filtro posterior: dos alternativas que comparten más del 75% de su recorrido
son, para el conductor, la misma ruta, y se descartan.

### 2.3 A\* como algoritmo por defecto

La especificación describía Dijkstra como principal y A\* como «optimización local».
Ambos están implementados y son intercambiables por configuración (`algorithm` en el DTO),
pero **A\* es el predeterminado**: con una heurística admisible y consistente devuelve
exactamente el mismo óptimo explorando bastantes menos nodos.

La equivalencia no se asume, se comprueba: hay un test de propiedad que genera 50 grafos
aleatorios y verifica que A\* y Dijkstra coinciden en coste
([`astar.algorithm.spec.ts`](../backend/src/modules/routes/algorithms/astar.algorithm.spec.ts)).

La especificación afirmaba que la heurística de Haversine «no admite la curvatura de la
tierra». Es al revés: Haversine calcula precisamente la distancia sobre la esfera. Lo que
no modela es el relieve ni el trazado real de la carretera, y esa es justamente la razón
por la que nunca sobreestima y por tanto es admisible.

### 2.4 OSRM/OpenStreetMap en lugar de Google Maps

La especificación admitía explícitamente «una versión gratuita de mapas como open maps».
El proveedor por defecto es OSRM sobre OpenStreetMap: sin clave, sin coste y sin cuota
contractual.

La interfaz [`RoutingProvider`](../backend/src/external-services/routing/routing.provider.ts)
deja la sustitución preparada. Si se selecciona `ROUTING_PROVIDER=google` sin haber
implementado el adaptador, **el arranque falla de forma explícita** en lugar de degradarse
en silencio a otro proveedor.

### 2.5 El proveedor de rutas no decide la ruta

Es la desviación conceptual más importante. OSRM aporta la **red vial** —geometría,
distancias y duraciones—, no la decisión. Sus alternativas se fusionan en un único grafo
por nodos comunes, de modo que la optimización puede componer un camino que use el
principio de una alternativa y el final de otra, algo que el proveedor no ofrece.

La optimización multicriterio, el enriquecimiento y el ranking son propios. Es lo que hace
que el sistema sea un optimizador y no un cliente de una API de direcciones.

### 2.6 `avoid_tolls` penaliza, no prohíbe

Bloquear todas las vías de pago puede dejar el destino inalcanzable. Cuando el usuario
pide evitar peajes, el importe se multiplica por 25 **solo en la función objetivo**; el
coste que se informa sigue siendo el real. Devolver "esta ruta tiene un peaje" es mejor
respuesta que "no hay ruta".

Esta separación entre "lo que se optimiza" y "lo que se informa" está implementada como
dos métodos distintos en `CostModel` (`optimizationCost` y `monetaryCost`) y verificada
por test.

### 2.7 Tarifas de peaje por categoría, no por tipo de vehículo

**Especificación**: `toll_rates(toll_station_id, vehicle_type_id, rate)`.

**Implementación**: `toll_rates(toll_station_id, vehicle_category, rate)`.

Los operadores publican precios por categoría tarifaria, y varios tipos de vehículo
comparten categoría. Indexar por tipo obligaría a duplicar cada tarifa N veces y a
mantener las copias sincronizadas a mano.

---

## 3. Componentes de la especificación no implementados

Se declaran abiertamente en lugar de dejarlos como huecos silenciosos.

| Componente | Estado | Motivo |
| --- | --- | --- |
| **Kafka / RabbitMQ** | No implementado | Ningún requisito funcional necesita procesamiento asíncrono. Añadir un broker sin consumidores es infraestructura muerta que hay que operar, monitorizar y parchear. Cuando aparezca el primer caso real (recálculo masivo nocturno, notificaciones a conductores), es el momento de introducirlo. |
| **Elasticsearch** | No implementado | Las búsquedas del sistema son geoespaciales, y PostGIS con índices GIST las resuelve mejor que Elasticsearch. Las búsquedas de texto que hay (usuarios, placas) las cubre `pg_trgm`, ya instalado. |
| **WebSocket en tiempo real** | Preparado, no implementado | NGINX ya proxea `/socket.io/`. No hay requisito funcional que lo exija: RF-007 y RF-008 son consultas, no suscripciones. |
| **INRIX / TomTom** | No implementado | APIs comerciales de pago. Los incidentes se gestionan por la tabla `road_incidents`, alimentable manualmente o por integración. El campo `source` está previsto para distinguir el origen. |
| **Restricciones horarias de acceso** (RF-011) | Parcial | El modelo de arcos admite `maxHeightMeters` y `maxWeightKg`, y `VehiclesService.assertCanTraverse` los valida. Las restricciones **horarias** requieren un origen de datos que OSM no expone de forma fiable y homogénea. |
| **Despliegue en AWS** | Declarado, sin destino | Los jobs de CI/CD existen pero no apuntan a ninguna infraestructura. Dejarlos apuntando a un bucket inventado daría una falsa sensación de estar desplegando. |

---

## 4. Decisiones de implementación con consecuencias

### 4.1 El rate limiting falla abierto

Si Redis cae, el guard deja pasar las peticiones y registra un error. Es una decisión
consciente: NGINX mantiene un límite en el borde
([`infra/nginx/nginx.conf`](../infra/nginx/nginx.conf)), así que la protección no
desaparece, y fallar cerrado convertiría una caída de la caché en una caída total del
servicio.

El bloqueo de cuentas por intentos fallidos vive en PostgreSQL, no en Redis, y por tanto
sigue activo aunque la caché no lo esté.

### 4.2 La precisión de fusión de nodos del grafo es el parámetro más delicado

`GraphBuilderService` fusiona nodos con 4 decimales de grado (~11 m). Demasiado fino y dos
rutas que pasan por la misma rotonda generan nodos distintos, dejando el grafo desconectado;
demasiado grueso y se fusionan cruces que no conectan, inventando atajos inexistentes.

Si al ampliar a otra geografía aparecen rutas absurdamente cortas o "no hay ruta" con
puntos claramente conectados, este es el primer parámetro que revisar.

### 4.3 El clima se muestrea cada 25 km

Es el orden de magnitud en el que cambian las condiciones de un frente meteorológico.
Consultar cada vértice de la geometría serían miles de llamadas por ruta y agotaría
cualquier cuota. Cada tramo recibe el parte de la muestra más cercana; no se interpola,
porque el dato de partida ya es una celda de ~1 km del proveedor y interpolar daría una
falsa sensación de precisión.

### 4.4 `synchronize` de TypeORM está desactivado sin excepción

En producción reescribiría el esquema a partir de las entidades y puede llegar a borrar
columnas con datos. El esquema lo gobiernan exclusivamente las migraciones versionadas.

### 4.5 La validación de entorno no depende de la metadata del compilador

Los campos numéricos de `EnvironmentVariables` llevan `@Type(() => Number)` explícito en
lugar de apoyarse en `enableImplicitConversion`. Esa conversión implícita lee la metadata
`design:type` que emite el compilador, y **cualquier pipeline que transpile sin
información de tipos —ts-jest en modo aislado, SWC, esbuild— la emite como `Object`**. El
resultado es que `PORT` sigue siendo la cadena `"3001"`, `@IsInt()` falla y el proceso no
arranca, con un error que apunta a la configuración y no a la causa real.

Lo detectaron los tests e2e, que corren sobre ts-jest. Merece la pena señalarlo porque
muchos equipos migran Nest a SWC por velocidad de compilación y se encontrarían el mismo
fallo en despliegue, no en desarrollo.

### 4.6 Los datos de peajes de ejemplo caen sobre el trazado real

Las coordenadas del seeder están tomadas de la geometría que devuelve el proveedor para
el corredor Pitalito - Neiva, no elegidas «por la zona». Con un radio de captura de 500 m,
unas coordenadas aproximadas a 4-12 km de la carretera —que es lo que salía al inventarlas—
no se capturan nunca, y la primera ruta que calcule quien despliegue el sistema mostraría
cero peajes. La función pareceria rota cuando el fallo estaría en los datos de demostración.

### 4.7 El seeder de administrador no tiene contraseña por defecto

`SEED_ADMIN_PASSWORD` es obligatoria y se valida contra la política de contraseñas. Un
seeder con credenciales fijas en el código es la vía por la que acaban en producción
sistemas con `admin/admin123`, y además el hash quedaría versionado en el repositorio.

---

## 5. Trazabilidad de requisitos

| Requisito | Implementación |
| --- | --- |
| RF-001 Selección en mapa | `frontend/src/components/map/MapCanvas.tsx` · `RouteMap.tsx` |
| RF-002 Análisis de red vial | `external-services/routing/osrm.provider.ts` · `services/graph-builder.service.ts` |
| RF-003 Enrutamiento multicriterio | `algorithms/cost-model.ts` · `dijkstra.algorithm.ts` · `astar.algorithm.ts` |
| RF-004 Rutas alternativas | `algorithms/yen-k-shortest.algorithm.ts` |
| RF-005 Distancia, tiempo, consumo | `CostModel.pathMetrics` |
| RF-006 Costes totales | `CostModel.monetaryCost` |
| RF-007 Condiciones climáticas | `modules/weather/` |
| RF-008 Incidentes viales | `modules/incidents/` (PostGIS) |
| RF-009 Tarifas de peaje | `modules/tolls/tolls.service.ts` (PostGIS) |
| RF-010 Clasificación de vías | `RoadType` · `classifyRoad` en el proveedor OSRM |
| RF-011 Restricciones de acceso | Parcial — ver sección 3 |
| RF-012 Catálogo de vehículos | `modules/vehicles/entities/vehicle-type.entity.ts` |
| RF-013 Perfiles de consumo | `Vehicle.effectiveConsumptionLPer100Km` |
| RF-014 Validación de restricciones | `VehiclesService.assertCanTraverse` |
| RF-015 Peajes por categoría | `TollRate.vehicleCategory` |
| RF-016 Autenticación JWT | `modules/auth/` |
| RF-017 RBAC | `common/guards/roles.guard.ts` |
| RF-018 Auditoría | `modules/audit/` |
| RF-019 Gestión de sesiones | `modules/auth/token.service.ts` (rotación + revocación) |
| RNF-001 TLS | `infra/nginx/nginx.conf` |
| RNF-002 Argon2 | `modules/auth/password.service.ts` |
| RNF-003 OWASP Top 10 | Ver tabla de seguridad del README |
| RNF-004 Secretos fuera del repo | `.gitignore` · validación de arranque · gitleaks en CI |
| RNF-005 Validación de entradas | `ValidationPipe` global + DTOs |
| RNF-006 Rate limiting | `common/guards/rate-limit.guard.ts` + NGINX |
| RNF-007 CORS y cabeceras | `main.ts` (helmet, CORS) |
| RNF-008 Cálculo < 2 s | Medido y registrado en `computation_time_ms`; alerta en el log al superarlo |
| RNF-011 Caché distribuida | `infrastructure/redis/redis.service.ts` |
| RNF-014 Índices | Migración inicial: GIST espaciales, parciales y compuestos |
| RNF-017 Fallback ante API caída | Circuit breaker + degradación a condiciones neutras |
