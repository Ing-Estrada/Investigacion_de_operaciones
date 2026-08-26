import { Coordinates } from '@/common/types/geo.types';

/**
 * Tope de vértices que se envían a PostGIS en una consulta espacial.
 *
 * La geometría completa de una ruta larga puede tener miles de puntos; incrustarlos
 * todos en el WKT genera consultas de cientos de kilobytes que hay que parsear en cada
 * llamada. Reducir a ~500 vértices no cambia el resultado de un `ST_DWithin` con radio
 * de kilómetros, y mantiene la consulta manejable.
 */
const MAX_VERTICES = 500;

/**
 * Construye un LINESTRING WKT con SRID explícito.
 *
 * El SRID va en el literal (`SRID=4326;...`) porque `ST_GeogFromText` sin él asume
 * 4326 pero `ST_GeomFromText` falla; declararlo evita depender de cuál se use al otro lado.
 */
export function toLineStringWkt(points: Coordinates[]): string | null {
  const reduced = reduceVertices(points, MAX_VERTICES);

  // Un LINESTRING necesita dos vértices distintos como mínimo.
  if (reduced.length < 2) return null;

  const body = reduced
    .map((point) => `${point.longitude.toFixed(6)} ${point.latitude.toFixed(6)}`)
    .join(',');

  return `SRID=4326;LINESTRING(${body})`;
}

export function toPointWkt(point: Coordinates): string {
  return `SRID=4326;POINT(${point.longitude.toFixed(6)} ${point.latitude.toFixed(6)})`;
}

/** Submuestreo uniforme conservando siempre el primer y el último vértice. */
function reduceVertices(points: Coordinates[], max: number): Coordinates[] {
  if (points.length <= max) return points;

  const step = Math.ceil(points.length / max);
  const reduced: Coordinates[] = [];

  for (let i = 0; i < points.length; i += step) {
    reduced.push(points[i]);
  }

  const last = points[points.length - 1];
  const tail = reduced[reduced.length - 1];
  if (tail.latitude !== last.latitude || tail.longitude !== last.longitude) {
    reduced.push(last);
  }

  return reduced;
}
