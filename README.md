# Sistema Inteligente de Optimización de Rutas de Distribución

Optimización multicriterio de rutas sobre la red vial real, con integración de
condiciones meteorológicas, incidentes viales y peajes por categoría de vehículo.

El sistema no se limita a pedirle una ruta a un proveedor de mapas: construye un grafo
con las trazas que devuelve, lo enriquece con datos externos y ejecuta su propia
optimización ponderando **distancia (40%), tiempo (30%), coste (20%) y riesgo (10%)**.

---

## Tabla de contenidos

- [Estado](#estado)
- [Arranque rápido](#arranque-rápido)
- [Arquitectura](#arquitectura)
- [El motor de optimización](#el-motor-de-optimización)
- [Seguridad](#seguridad)
- [Estructura del proyecto](#estructura-del-proyecto)
- [API](#api)
- [Testing](#testing)
- [Despliegue](#despliegue)
- [Resolución de problemas](#resolución-de-problemas)
- [Decisiones técnicas](#decisiones-técnicas)
- [Licencia](#licencia)

---

## Estado

| Componente | Typecheck | Lint | Tests | Build |
| --- | --- | --- | --- | --- |
| Backend (NestJS) | OK | limpio | 220 unitarios + 16 e2e | OK |
| Frontend (Next.js) | OK | limpio | 61 unitarios | OK |

Los e2e corren contra PostgreSQL con PostGIS y Redis reales (`docker compose up -d postgres redis`
y `npm run migration:run`), no contra dobles.

### Prueba de humo verificada

El flujo completo se ha ejecutado de extremo a extremo contra la API en marcha y el OSRM
público, con el corredor Pitalito → Neiva y un tractocamión de 5 ejes:

```text
Distancia .......... 188,71 km
Tiempo estimado .... 2 h 17 min
Combustible ........ 66,05 L
Coste combustible .. 69,35 USD
Coste peajes ....... 34,90 USD  (3 estaciones, categoría IV)
COSTE TOTAL ........ 104,25 USD
Puntuación ......... 84,86/100
Algoritmo .......... astar — optimización en 2 ms sobre 55 tramos
```

Dos observaciones de esa ejecución que conviene conocer de antemano:

- **El OSRM público devuelve una sola ruta** para ese par origen-destino, incluso
  pidiéndole alternativas. Sin bifurcaciones en el grafo, Yen no puede construir un
  camino sin bucles distinto y el sistema devuelve **0 alternativas**. No es un fallo: es
  el resultado correcto para una red vial sin opciones. Con una instancia propia de OSRM,
  o entre puntos con varias vías reales, sí aparecen.
- El peaje **baja la puntuación de 86,25 a 84,86** frente a la misma ruta sin peajes: el
  criterio de coste pesa un 20% y el sistema lo refleja en el ranking.

---

## Arranque rápido

### Requisitos

- Node.js ≥ 20
- Docker y Docker Compose (recomendado), o bien PostgreSQL 16 + PostGIS 3.4 y Redis 7

### Opción A — Docker Compose

```bash
cp .env.example .env
# Genera los dos secretos JWT (deben ser distintos y de 32+ caracteres):
#   openssl rand -base64 48
# Edita .env y sustituye todos los valores CHANGE_ME.

docker compose up -d postgres redis
docker compose up -d --build backend frontend
```

Aplica el esquema y carga los datos maestros:

```bash
cd backend
npm ci
npm run migration:run
SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD='TuClaveSegura!2026' npm run seed
```

- Aplicación: <http://localhost:3000>
- API: <http://localhost:3001/api/v1>
- Documentación OpenAPI: <http://localhost:3001/api/v1/docs> (solo fuera de producción)

### Opción B — desarrollo local

```bash
docker compose up -d postgres redis    # solo la infraestructura

cd backend
cp .env.example .env                   # rellena los CHANGE_ME
npm ci && npm run migration:run && npm run seed
npm run start:dev

cd ../frontend
cp .env.example .env.local
npm ci && npm run dev
```

### Sin claves de API

El sistema arranca y calcula rutas **sin ninguna clave**:

- **Red vial**: OSRM público sobre OpenStreetMap. No requiere clave.
- **Geocodificación**: Nominatim. No requiere clave, pero su política de uso exige un
  `NOMINATIM_USER_AGENT` con un contacto real y limita a ~1 petición por segundo.
- **Meteorología**: sin `OPENWEATHER_API_KEY` se activa el proveedor nulo. Las rutas se
  calculan igual, sin el ajuste por clima, y la interfaz lo indica explícitamente.

Las instancias públicas de OSRM y Nominatim son de cortesía y no admiten carga de
producción. Para un despliegue real hay que levantar instancias propias.

---

## Arquitectura

Arquitectura en capas con dominios separados (Layered + DDD).

```text
┌─────────────────────────── Presentación ───────────────────────────┐
│  Next.js 14 · React 18 · TypeScript · Tailwind                     │
│  Leaflet (mapa) · TanStack Query (estado remoto) · Zustand (UI)    │
└────────────────────────────────┬───────────────────────────────────┘
                                 │ HTTPS · cookies httpOnly
┌────────────────────────────────▼───────────────────────────────────┐
│                       NGINX (TLS, caché, rate limit de borde)      │
└────────────────────────────────┬───────────────────────────────────┘
┌────────────────────────────────▼───────────────────────────────────┐
│                      Aplicación — NestJS 10                        │
│  Guards: RateLimit → JWT → Roles     Filtros · Interceptores       │
├────────────────────────────────────────────────────────────────────┤
│                            Dominio                                 │
│  Optimización de rutas │ Vehículos │ Clima │ Peajes │ Incidentes   │
│  Identidad y accesos   │ Auditoría │ Analítica                     │
├────────────────────────────────────────────────────────────────────┤
│                        Infraestructura                             │
│  PostgreSQL 16 + PostGIS 3.4 │ Redis 7 │ HTTP resiliente           │
│  OSRM · Nominatim · OpenWeather                                    │
└────────────────────────────────────────────────────────────────────┘
```

### Flujo de una optimización

```text
POST /routes/optimize
  1. Autenticación JWT + autorización por rol + rate limit
  2. Validación del DTO y comprobación de propiedad del vehículo
  3. Red vial: OSRM devuelve la ruta principal y sus alternativas
  4. Construcción del grafo: las trazas se fusionan por nodos comunes
  5. Enriquecimiento en paralelo:
       · clima muestreado cada 25 km
       · incidentes activos (PostGIS, radio propio de cada incidente)
       · peajes vigentes según la categoría del vehículo (PostGIS)
  6. Optimización multicriterio (A* por defecto) + Yen para las alternativas
  7. Validación de restricciones de circulación del vehículo
  8. Persistencia transaccional de la ruta y sus alternativas
  9. Registro en auditoría
```

El paso 5 ocurre **antes** del 6 deliberadamente: si el enriquecimiento fuera posterior,
el algoritmo elegiría el camino ignorando lluvia, accidentes y peajes, y esos datos
serían decorativos. Al incorporarlos al peso de cada arco, un tramo con un accidente
grave o un peaje caro deja de ser atractivo y la ruta se desvía sola.

---

## El motor de optimización

Todo el código está en [`backend/src/modules/routes/algorithms/`](backend/src/modules/routes/algorithms/).

### Función objetivo

El problema es multiobjetivo: la ruta más corta, la más rápida y la más barata rara vez
coinciden. Se resuelve por **suma ponderada escalarizada**, que reduce los cuatro
objetivos a un escalar y permite aplicar algoritmos de camino mínimo.

```text
peso(arco) = 0,40 · (km / 1000)
           + 0,30 · (minutos_efectivos / 1200)
           + 0,20 · (coste / 500)
           + 0,10 · riesgo
```

El precio por litro sale del combustible del tipo de vehículo —diésel o gasolina— y de la
tabla `fuel_prices`, versionada por fecha de vigencia. El que se aplicó se **congela** en
la ruta (`routes.fuel_price_per_liter`), de modo que releer una ruta antigua muestra el
precio de entonces y no el de hoy. Ambos se editan en la pestaña **Tarifas**.

Los cuatro términos se **normalizan** antes de sumarse. Sin normalizar, mezclar
kilómetros con minutos y con dólares hace que domine el criterio de mayor magnitud
numérica con independencia de su peso: los pesos dejarían de significar nada.

- `minutos_efectivos` incorpora la penalización por clima e incidentes.
- `coste` = combustible (consumo × distancia × factor climático × precio) + peajes.
- `riesgo` ∈ [0,1] según la severidad del peor incidente activo en el tramo.

**Invariante**: el peso nunca es negativo. Es una suma de magnitudes no negativas por
pesos no negativos, condición necesaria para que Dijkstra sea correcto.

### Algoritmos

| Algoritmo | Uso | Complejidad |
| --- | --- | --- |
| **Dijkstra** | Camino mínimo, referencia de corrección | O(E log V) |
| **A\*** | Por defecto; heurística de Haversine | O(E log V), muy inferior en la práctica |
| **Yen** | K caminos más cortos sin bucles (alternativas) | O(K·V·E log V) |

La heurística de A\* es **admisible y consistente**: usa la distancia del gran círculo
(nunca mayor que la real por carretera) y la velocidad máxima observada en el grafo, y
omite los términos de coste y riesgo cuyo mínimo real es 0. Por eso A\* devuelve
exactamente el mismo óptimo que Dijkstra explorando menos nodos — hay un test de
propiedad que lo comprueba sobre 50 grafos generados al azar.

### Estructuras

- **Listas de adyacencia**, no matriz: una red vial es dispersa (2-5 vecinos por
  intersección). Una matriz de 50 000 nodos ocuparía ~20 GB de ceros.
- **Heap binario** con invalidación perezosa en lugar de *decrease-key*: sube el heap de
  O(V) a O(E), pero evita mantener un índice nodo→posición que hay que actualizar en
  cada intercambio.

### Puntuación (0-100)

Cada criterio se satura en su escala de normalización en lugar de crecer sin límite.
Sin ese recorte, una ruta más larga que la escala produciría una puntuación negativa y
el ranking dejaría de tener sentido.

---

## Seguridad

| Control | Implementación |
| --- | --- |
| Contraseñas | Argon2id, 19 MiB / t=2 / p=1 (parámetros OWASP) |
| Sesiones | JWT HS256 · access 15 min · refresh 7 días en cookie httpOnly |
| Rotación de refresh | Persistido como hash SHA-256; reutilizar un token rotado revoca la familia entera |
| Revocación inmediata | `tokens_valid_from` invalida en bloque los access tokens vivos |
| RBAC | 4 roles, guard global; los intentos denegados se auditan |
| Enumeración de cuentas | Verificación ficticia que iguala el tiempo de respuesta |
| Fuerza bruta | 5 intentos → bloqueo 15 min · rate limit Redis · límite de borde en NGINX |
| Mass assignment | `whitelist` + `forbidNonWhitelisted`; el rol nunca se lee del cuerpo |
| Inyección SQL | Consultas parametrizadas en el 100% del código, incluido el SQL espacial |
| Cabeceras | helmet: CSP, HSTS, nosniff, frame-options, referrer-policy |
| CORS | Lista blanca explícita; con `credentials: true` el comodín queda prohibido |
| Auditoría | Tabla `audit_logs` con redacción recursiva de contraseñas, tokens y claves |
| Secretos | Nunca en el repositorio; validación de longitud y unicidad en el arranque |

Detalles y justificación de cada decisión: [`docs/DECISIONES-TECNICAS.md`](docs/DECISIONES-TECNICAS.md).

**El proceso no arranca** si falta un secreto, si los dos secretos JWT coinciden, si
miden menos de 32 caracteres o si en producción `CORS_ORIGINS` contiene `*`.

---

## Estructura del proyecto

```text
.
├── backend/                     API NestJS
│   └── src/
│       ├── common/              guards, filtros, interceptores, decoradores, utilidades
│       ├── config/              configuración tipada + validación del entorno
│       ├── database/            migraciones, seeders, DataSource
│       ├── external-services/   HTTP resiliente, OSRM, Nominatim
│       ├── infrastructure/      cliente Redis
│       └── modules/
│           ├── auth/            JWT, Argon2, rotación de refresh tokens
│           ├── users/           gestión de usuarios (ADMIN)
│           ├── vehicles/        flota y catálogo de tipos
│           ├── routes/
│           │   ├── algorithms/  Dijkstra · A* · Yen · modelo de costes
│           │   └── services/    constructor de grafo · enriquecimiento
│           ├── weather/         proveedores de meteorología
│           ├── tolls/           peajes y tarifas (consultas PostGIS)
│           ├── incidents/       incidentes viales
│           ├── analytics/       indicadores agregados
│           ├── audit/           registro de auditoría
│           └── health/          sondas para el orquestador
│
├── frontend/                    Aplicación Next.js
│   └── src/
│       ├── app/                 rutas del App Router
│       ├── components/          mapa, formularios, resultados, gráficas, UI
│       ├── hooks/               auth, vehículos, optimización, geocodificación
│       ├── lib/                 cliente de API, tipos, formateadores
│       └── store/               estado del planificador (Zustand)
│
├── infra/
│   ├── nginx/                   proxy inverso, TLS, caché, rate limit
│   └── postgres/                inicialización de extensiones
│
├── docs/                        decisiones técnicas y trazabilidad
├── .github/workflows/           CI/CD
└── docker-compose.yml
```

---

## API

Documentación interactiva en `/api/v1/docs` (Swagger UI, deshabilitado en producción).

| Método | Endpoint | Rol | Descripción |
| --- | --- | --- | --- |
| POST | `/auth/register` | público | Alta de cuenta (3/hora por IP) |
| POST | `/auth/login` | público | Inicio de sesión (5/min por IP) |
| POST | `/auth/refresh` | público | Rotación del refresh token |
| POST | `/auth/logout` | autenticado | Revoca la sesión actual |
| GET | `/auth/me` | autenticado | Perfil |
| POST | `/auth/change-password` | autenticado | Cambia la contraseña y cierra todas las sesiones |
| GET | `/users` | ADMIN | Lista de usuarios |
| PATCH | `/users/:id` | ADMIN | Cambia rol o estado (revoca sesiones) |
| GET | `/vehicles/types` | autenticado | Catálogo de tipos de vehículo |
| GET/POST | `/vehicles` | autenticado | Flota propia |
| PATCH/DELETE | `/vehicles/:id` | propietario/ADMIN | Actualiza o da de baja |
| **POST** | **`/routes/optimize`** | ADMIN·DISPATCHER·CUSTOMER | **Calcula la ruta óptima (50/hora)** |
| GET | `/routes` | autenticado | Historial paginado |
| GET | `/routes/:id` | propietario/gestión | Detalle con alternativas |
| PATCH | `/routes/:id/status` | propietario/gestión | Cambia el estado |
| GET | `/geocoding/search` | autenticado | Autocompletado de direcciones |
| GET | `/incidents` | autenticado | Incidentes activos en un rectángulo |
| POST/PATCH | `/incidents` | DISPATCHER·ADMIN | Alta y actualización |
| GET | `/tolls/stations` | autenticado | Peajes cercanos con tarifa |
| GET/POST/PATCH | `/tolls/admin/stations` | ADMIN·DISPATCHER | Alta y mantenimiento de estaciones |
| POST/PATCH | `/tolls/admin/…/rates` | ADMIN·DISPATCHER | Tarifas por categoría |
| GET | `/fuel/prices/current` | autenticado | Precio vigente de diésel y gasolina |
| GET/POST/PATCH | `/fuel/prices` | ADMIN·DISPATCHER | Histórico y alta de precios |
| GET | `/analytics/*` | autenticado | Indicadores agregados |
| GET | `/health`, `/health/live` | público | Sondas |

Toda respuesta correcta viaja envuelta como `{ success, data, timestamp, path }`, salvo
`/health*`, cuyo contrato consumen los orquestadores. Los errores comparten forma:
`{ success: false, statusCode, error, message, path, timestamp }`.

---

## Testing

```bash
# Backend
cd backend
npm run test:unit          # 220 tests
npm run test:unit -- --coverage
npm run test:e2e           # requiere PostgreSQL + migraciones aplicadas
npm run typecheck && npm run lint

# Frontend
cd frontend
npm run test:unit          # 61 tests
npm run typecheck && npm run lint
```

Los tests de los algoritmos son la parte más densa a propósito: cubren la corrección de
Dijkstra, la equivalencia A\*↔Dijkstra sobre grafos aleatorios, las propiedades de Yen
(caminos distintos, sin bucles, ordenados), la no negatividad del peso, la admisibilidad
de la heurística y la saturación de la puntuación.

Después van los dos puntos donde un fallo silencioso sería más caro: la rotación de
refresh tokens (`token.service.spec.ts` — detección de reutilización, revocación de la
familia, confusión de secretos) y el control de acceso a nivel de objeto junto con las
restricciones de circulación (`vehicles.service.spec.ts` — RF-014).

---

## Despliegue

### Lista de comprobación previa

- [ ] `.env` con todos los `CHANGE_ME` sustituidos por valores generados
- [ ] `JWT_ACCESS_SECRET` ≠ `JWT_REFRESH_SECRET`, ambos de 32+ caracteres
- [ ] `NODE_ENV=production`
- [ ] `CORS_ORIGINS` con los dominios reales, sin comodines
- [ ] Certificados TLS en `infra/nginx/certs/` (`fullchain.pem`, `privkey.pem`)
- [ ] Migraciones aplicadas (`npm run migration:run`)
- [ ] Datos maestros cargados (`npm run seed`)
- [ ] Instancias propias de OSRM y Nominatim, o proveedor comercial contratado
- [ ] Copias de seguridad de PostgreSQL configuradas y **restauración probada**

### Reversión

Las migraciones son reversibles (`npm run migration:revert`), pero una reversión
**destruye los datos** de las columnas que elimina. El procedimiento seguro es:
copia de seguridad → desplegar la versión anterior de la aplicación → revertir la
migración solo si el esquema nuevo es incompatible.

### CI/CD

[`.github/workflows/ci-cd.yml`](.github/workflows/ci-cd.yml): escaneo de secretos y
dependencias, tests de backend contra PostGIS real, tests y build de frontend, y
construcción de las imágenes Docker. Los jobs de despliegue están declarados pero
**sin destino configurado** a propósito: hay que apuntarlos a la infraestructura real
antes de habilitarlos.

---

## Resolución de problemas

| Síntoma | Causa habitual | Solución |
| --- | --- | --- |
| `Configuración de entorno inválida` al arrancar | Falta una variable o un secreto es corto | El mensaje lista la variable concreta |
| `JWT_ACCESS_SECRET y JWT_REFRESH_SECRET deben ser distintos` | Ambos secretos copiados iguales | Genera dos con `openssl rand -base64 48` |
| `type "geometry" does not exist` | PostGIS no instalado en esa base de datos | La migración crea la extensión; comprueba permisos de superusuario |
| Rutas sin ajuste meteorológico | Sin `OPENWEATHER_API_KEY` | Es el comportamiento previsto; la interfaz lo indica |
| 502 al calcular una ruta | `OSRM_BASE_URL` con `http://` | La instancia pública ya no atiende el puerto 80: el log muestra `ECONNREFUSED …:80`. Tiene que ser `https://` |
| 502 al calcular una ruta | OSRM público caído o saturado | Reintentos y circuit breaker actúan solos; para producción, instancia propia |
| 502 al buscar una dirección | `NOMINATIM_USER_AGENT` sin contacto real | Nominatim responde 403 a los User-Agent de plantilla. Pon un correo tuyo, o fija los puntos en el mapa |
| 429 al calcular rutas | Límite de 50/hora por usuario | Espera o ajusta el límite en el decorador `@RateLimit` |
| El mapa aparece en blanco | Leaflet sin altura de contenedor | El contenedor necesita altura explícita; ver `RouteMap` |
| Devuelve 0 alternativas | El proveedor solo encontró una ruta | Correcto si la red vial no ofrece opciones. Comprueba cuántas devuelve OSRM para ese par antes de sospechar de Yen |
| Devuelve 0 peajes en una vía de pago | Las coordenadas de la estación no caen sobre el trazado | El radio de captura es de 500 m. Comprueba la distancia real con `ST_Distance(s.location::geography, r.path::geography)` |
| `Redis conectado` nunca aparece en el log | Redis inaccesible | El sistema funciona degradado, sin caché; revisa `REDIS_HOST` |

---

## Decisiones técnicas

Las desviaciones deliberadas respecto de la especificación original, con su
justificación, y las correcciones a errores del documento fuente están recogidas en
[`docs/DECISIONES-TECNICAS.md`](docs/DECISIONES-TECNICAS.md).

En resumen: el SQL de la especificación no era ejecutable en PostgreSQL (usaba sintaxis
de MySQL), la fórmula de puntuación producía valores negativos, el modelo de rutas
alternativas admitía estados imposibles, y el método propuesto para generar alternativas
no garantizaba ni que fueran las mejores ni que estuvieran bien ordenadas. Todo ello está
corregido y documentado.

---

## Licencia

MIT — ver [`LICENSE`](LICENSE).
