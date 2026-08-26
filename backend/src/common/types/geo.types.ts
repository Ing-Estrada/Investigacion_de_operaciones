/**
 * Punto GeoJSON tal y como lo entrega y espera PostGIS a través de TypeORM.
 * OJO con el orden: GeoJSON es [longitud, latitud], al revés de como se habla.
 */
export interface GeoJSONPoint {
  type: 'Point';
  coordinates: [number, number];
}

/** Par lat/lon en el orden humano habitual. */
export interface Coordinates {
  latitude: number;
  longitude: number;
}

export function toGeoJSONPoint(coords: Coordinates): GeoJSONPoint {
  return { type: 'Point', coordinates: [coords.longitude, coords.latitude] };
}

export function fromGeoJSONPoint(point: GeoJSONPoint): Coordinates {
  const [longitude, latitude] = point.coordinates;
  return { latitude, longitude };
}

export const EARTH_RADIUS_KM = 6371.0088;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Distancia del gran círculo entre dos coordenadas.
 *
 * Es la heurística de A* (`h`): al ser siempre menor o igual a la distancia real por
 * carretera, nunca sobreestima el coste restante y por tanto es admisible — condición
 * necesaria para que A* devuelva el óptimo y no solo un camino bueno.
 */
export function haversineDistanceKm(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);

  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Longitud acumulada de una polilínea, en kilómetros. */
export function polylineLengthKm(points: Coordinates[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversineDistanceKm(points[i - 1], points[i]);
  }
  return total;
}

/**
 * Submuestrea una polilínea tomando un punto cada `stepKm`. Se usa para consultar el
 * clima: pedir un parte meteorológico por cada vértice de la geometría sería absurdo
 * (miles de llamadas), uno cada 25 km cubre el gradiente real de un frente.
 */
export function samplePolyline(points: Coordinates[], stepKm: number): Coordinates[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [points[0]];

  const samples: Coordinates[] = [points[0]];
  let accumulated = 0;

  for (let i = 1; i < points.length; i += 1) {
    accumulated += haversineDistanceKm(points[i - 1], points[i]);
    if (accumulated >= stepKm) {
      samples.push(points[i]);
      accumulated = 0;
    }
  }

  const last = points[points.length - 1];
  const lastSample = samples[samples.length - 1];
  if (lastSample.latitude !== last.latitude || lastSample.longitude !== last.longitude) {
    samples.push(last);
  }

  return samples;
}
