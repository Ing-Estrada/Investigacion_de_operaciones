import {
  Coordinates,
  fromGeoJSONPoint,
  haversineDistanceKm,
  polylineLengthKm,
  samplePolyline,
  toGeoJSONPoint,
} from './geo.types';

describe('haversineDistanceKm', () => {
  it('vale 0 entre un punto y sí mismo', () => {
    const point: Coordinates = { latitude: 2.9273, longitude: -75.2819 };
    expect(haversineDistanceKm(point, point)).toBe(0);
  });

  it('calcula un grado de latitud como ~111 km', () => {
    const distance = haversineDistanceKm(
      { latitude: 0, longitude: 0 },
      { latitude: 1, longitude: 0 },
    );

    expect(distance).toBeGreaterThan(110);
    expect(distance).toBeLessThan(112);
  });

  it('reproduce una distancia conocida: Pitalito - Neiva ≈ 175 km', () => {
    const distance = haversineDistanceKm(
      { latitude: 1.8536, longitude: -76.0511 },
      { latitude: 2.9273, longitude: -75.2819 },
    );

    // Distancia en línea recta; por carretera es bastante mayor.
    expect(distance).toBeGreaterThan(140);
    expect(distance).toBeLessThan(160);
  });

  it('es simétrica', () => {
    const a = { latitude: 10, longitude: 20 };
    const b = { latitude: -30, longitude: 100 };

    expect(haversineDistanceKm(a, b)).toBeCloseTo(haversineDistanceKm(b, a), 10);
  });

  it('maneja puntos antipodales sin devolver NaN', () => {
    const distance = haversineDistanceKm(
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 180 },
    );

    expect(Number.isFinite(distance)).toBe(true);
    // Media circunferencia terrestre.
    expect(distance).toBeCloseTo(20_015, -2);
  });

  it('cruza correctamente el antimeridiano', () => {
    const distance = haversineDistanceKm(
      { latitude: 0, longitude: 179.9 },
      { latitude: 0, longitude: -179.9 },
    );

    // Son 0,2 grados de separación real, no 359,8.
    expect(distance).toBeLessThan(30);
  });
});

describe('conversión GeoJSON', () => {
  it('invierte el orden a [longitud, latitud]', () => {
    const point = toGeoJSONPoint({ latitude: 2.5, longitude: -75.1 });

    expect(point.type).toBe('Point');
    expect(point.coordinates).toEqual([-75.1, 2.5]);
  });

  it('la ida y vuelta conserva los valores', () => {
    const original: Coordinates = { latitude: -33.4489, longitude: -70.6693 };
    expect(fromGeoJSONPoint(toGeoJSONPoint(original))).toEqual(original);
  });
});

describe('polylineLengthKm', () => {
  it('vale 0 para menos de dos puntos', () => {
    expect(polylineLengthKm([])).toBe(0);
    expect(polylineLengthKm([{ latitude: 1, longitude: 1 }])).toBe(0);
  });

  it('acumula la distancia de todos los tramos', () => {
    const points: Coordinates[] = [
      { latitude: 0, longitude: 0 },
      { latitude: 1, longitude: 0 },
      { latitude: 2, longitude: 0 },
    ];

    const total = polylineLengthKm(points);
    const firstLeg = haversineDistanceKm(points[0], points[1]);

    expect(total).toBeCloseTo(firstLeg * 2, 1);
  });
});

describe('samplePolyline', () => {
  const line: Coordinates[] = Array.from({ length: 100 }, (_, i) => ({
    latitude: i * 0.1,
    longitude: 0,
  }));

  it('devuelve una lista vacía si no hay puntos', () => {
    expect(samplePolyline([], 25)).toEqual([]);
  });

  it('devuelve el único punto disponible', () => {
    const single = [{ latitude: 1, longitude: 1 }];
    expect(samplePolyline(single, 25)).toEqual(single);
  });

  it('conserva siempre el primer y el último punto', () => {
    const samples = samplePolyline(line, 100);

    expect(samples[0]).toEqual(line[0]);
    expect(samples[samples.length - 1]).toEqual(line[line.length - 1]);
  });

  it('reduce drásticamente el número de puntos', () => {
    const samples = samplePolyline(line, 100);

    expect(samples.length).toBeLessThan(line.length);
    expect(samples.length).toBeGreaterThan(1);
  });

  it('con un paso mayor devuelve menos muestras', () => {
    expect(samplePolyline(line, 500).length).toBeLessThanOrEqual(samplePolyline(line, 50).length);
  });

  it('no duplica el último punto si ya cayó en una muestra', () => {
    const samples = samplePolyline(line, 0.0001);
    const last = samples[samples.length - 1];
    const penultimate = samples[samples.length - 2];

    expect(last).not.toEqual(penultimate);
  });
});
