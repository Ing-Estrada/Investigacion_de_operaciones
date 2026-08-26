import { beforeEach, describe, expect, it } from 'vitest';

import type { OptimizedRouteResponse, RouteResult } from '@/lib/types/api.types';
import { selectActiveRoute, useRouteStore } from '@/store/useRouteStore';

const ORIGIN = { latitude: 1.8536, longitude: -76.0511, address: 'Pitalito' };
const DESTINATION = { latitude: 2.9273, longitude: -75.2819, address: 'Neiva' };

function makeRoute(id: string, rank: number | null = null): RouteResult {
  return {
    id,
    parentRouteId: rank ? 'primary' : null,
    alternativeRank: rank,
    distanceKm: 187.4,
    durationMinutes: 154,
    cost: {
      fuelLiters: 42.3,
      fuelCost: 44.4,
      tollCost: 8.5,
      totalCost: 52.9,
      currency: 'USD',
      fuelPricePerLiter: 1.05,
    },
    score: {
      distanceScore: 81,
      timeScore: 87,
      costScore: 89,
      safetyScore: 100,
      total: 85.4,
    },
    origin: ORIGIN,
    destination: DESTINATION,
    geometry: [
      [1.85, -76.05],
      [2.93, -75.28],
    ],
    segments: [],
    tollBreakdown: [],
    incidents: [],
    weather: {
      worstIntensity: 0,
      averageIntensity: 0,
      conditions: [],
      alert: false,
      degraded: false,
    },
    status: 'calculated',
    algorithm: 'astar',
    computationTimeMs: 42,
    createdAt: '2026-08-26T10:00:00.000Z',
  };
}

const RESULT: OptimizedRouteResponse = {
  route: makeRoute('primary'),
  alternatives: [makeRoute('alt-1', 1), makeRoute('alt-2', 2)],
};

describe('useRouteStore', () => {
  beforeEach(() => {
    useRouteStore.getState().reset();
  });

  it('empieza en modo de selección de origen', () => {
    expect(useRouteStore.getState().pickingMode).toBe('origin');
    expect(useRouteStore.getState().origin).toBeNull();
  });

  it('pasa a seleccionar destino tras fijar el origen', () => {
    useRouteStore.getState().setOrigin(ORIGIN);

    expect(useRouteStore.getState().origin).toEqual(ORIGIN);
    expect(useRouteStore.getState().pickingMode).toBe('destination');
  });

  it('no encadena al destino si ya estaba puesto', () => {
    useRouteStore.getState().setDestination(DESTINATION);
    useRouteStore.getState().setOrigin(ORIGIN);

    expect(useRouteStore.getState().pickingMode).toBeNull();
  });

  it('invalida el resultado al cambiar un extremo', () => {
    // Seguir mostrando la ruta anterior haría creer que corresponde a los puntos nuevos.
    useRouteStore.getState().setResult(RESULT);
    expect(useRouteStore.getState().result).not.toBeNull();

    useRouteStore.getState().setOrigin(ORIGIN);
    expect(useRouteStore.getState().result).toBeNull();
    expect(useRouteStore.getState().selectedRouteId).toBeNull();
  });

  it('intercambia origen y destino', () => {
    useRouteStore.getState().setOrigin(ORIGIN);
    useRouteStore.getState().setDestination(DESTINATION);
    useRouteStore.getState().swapEndpoints();

    expect(useRouteStore.getState().origin).toEqual(DESTINATION);
    expect(useRouteStore.getState().destination).toEqual(ORIGIN);
  });

  it('selecciona la ruta principal al recibir el resultado', () => {
    useRouteStore.getState().setResult(RESULT);

    expect(useRouteStore.getState().selectedRouteId).toBe('primary');
    expect(useRouteStore.getState().pickingMode).toBeNull();
  });

  it('acota las alternativas al rango admitido por el backend', () => {
    useRouteStore.getState().setAlternatives(10);
    expect(useRouteStore.getState().alternatives).toBe(4);

    useRouteStore.getState().setAlternatives(-3);
    expect(useRouteStore.getState().alternatives).toBe(0);
  });

  it('invalida el resultado al cambiar las opciones de cálculo', () => {
    useRouteStore.getState().setResult(RESULT);
    useRouteStore.getState().setAvoidTolls(true);

    expect(useRouteStore.getState().result).toBeNull();
  });

  it('reset devuelve el store a su estado inicial', () => {
    useRouteStore.getState().setOrigin(ORIGIN);
    useRouteStore.getState().setDestination(DESTINATION);
    useRouteStore.getState().setResult(RESULT);

    useRouteStore.getState().reset();

    expect(useRouteStore.getState().origin).toBeNull();
    expect(useRouteStore.getState().destination).toBeNull();
    expect(useRouteStore.getState().result).toBeNull();
  });
});

describe('selectActiveRoute', () => {
  beforeEach(() => {
    useRouteStore.getState().reset();
  });

  it('devuelve null sin resultado', () => {
    expect(selectActiveRoute(useRouteStore.getState())).toBeNull();
  });

  it('devuelve la ruta principal por defecto', () => {
    useRouteStore.getState().setResult(RESULT);
    expect(selectActiveRoute(useRouteStore.getState())?.id).toBe('primary');
  });

  it('devuelve la alternativa seleccionada', () => {
    useRouteStore.getState().setResult(RESULT);
    useRouteStore.getState().selectRoute('alt-2');

    expect(selectActiveRoute(useRouteStore.getState())?.id).toBe('alt-2');
  });

  it('cae a la ruta principal si el id seleccionado no existe', () => {
    useRouteStore.getState().setResult(RESULT);
    useRouteStore.getState().selectRoute('inexistente');

    expect(selectActiveRoute(useRouteStore.getState())?.id).toBe('primary');
  });
});
