import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { RouteResults } from '@/components/results/RouteResults';
import type { OptimizedRouteResponse, RouteResult } from '@/lib/types/api.types';
import { useRouteStore } from '@/store/useRouteStore';

function makeRoute(overrides: Partial<RouteResult> = {}): RouteResult {
  return {
    id: 'primary',
    parentRouteId: null,
    alternativeRank: null,
    distanceKm: 187.4,
    durationMinutes: 154,
    cost: {
      fuelLiters: 42.31,
      fuelCost: 44.43,
      tollCost: 8.5,
      totalCost: 52.93,
      currency: 'USD',
      fuelPricePerLiter: 1.05,
    },
    score: { distanceScore: 81, timeScore: 87, costScore: 89, safetyScore: 100, total: 85.4 },
    origin: { latitude: 1.85, longitude: -76.05, address: 'Pitalito' },
    destination: { latitude: 2.93, longitude: -75.28, address: 'Neiva' },
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
    ...overrides,
  };
}

const withResult = (result: OptimizedRouteResponse) => useRouteStore.getState().setResult(result);

describe('RouteResults', () => {
  beforeEach(() => {
    useRouteStore.getState().reset();
  });

  it('muestra un estado vacío cuando aún no hay ruta', () => {
    render(<RouteResults />);

    expect(screen.getByText('Sin ruta calculada')).toBeInTheDocument();
  });

  it('muestra las métricas principales de la ruta', () => {
    withResult({ route: makeRoute(), alternatives: [] });
    render(<RouteResults />);

    // Se acota al bloque de métricas: los mismos valores aparecen también en la tarjeta
    // de selección de ruta, y una consulta global encontraría los dos.
    const metrics = within(screen.getByTestId('route-metrics'));

    expect(metrics.getByText('187,4 km')).toBeInTheDocument();
    expect(metrics.getByText('2 h 34 min')).toBeInTheDocument();
    expect(metrics.getByText('42,3 L')).toBeInTheDocument();
  });

  it('desglosa combustible y peajes por separado', () => {
    withResult({ route: makeRoute(), alternatives: [] });
    render(<RouteResults />);

    expect(screen.getByText('Desglose de costes')).toBeInTheDocument();
    expect(screen.getByText('Peajes (0 estaciones)')).toBeInTheDocument();
    expect(screen.getByText(/Combustible \(42,3 L/)).toBeInTheDocument();
  });

  it('muestra las cuatro puntuaciones con su peso', () => {
    withResult({ route: makeRoute(), alternatives: [] });
    render(<RouteResults />);

    const score = within(screen.getByTestId('route-score'));

    for (const [criterion, weight] of [
      ['Distancia', '(40%)'],
      ['Tiempo', '(30%)'],
      ['Coste', '(20%)'],
      ['Seguridad', '(10%)'],
    ]) {
      expect(score.getByText(new RegExp(criterion))).toBeInTheDocument();
      expect(score.getByText(weight)).toBeInTheDocument();
    }
  });

  it('no lista rutas cuando no hay alternativas', () => {
    withResult({ route: makeRoute(), alternatives: [] });
    render(<RouteResults />);

    expect(screen.queryByText(/^Rutas \(/)).not.toBeInTheDocument();
  });

  it('permite seleccionar una alternativa y actualiza el panel', async () => {
    const user = userEvent.setup();

    withResult({
      route: makeRoute(),
      alternatives: [
        makeRoute({
          id: 'alt-1',
          parentRouteId: 'primary',
          alternativeRank: 1,
          distanceKm: 210.8,
          durationMinutes: 190,
        }),
      ],
    });

    render(<RouteResults />);

    expect(within(screen.getByTestId('route-metrics')).getByText('187,4 km')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Alternativa 1/ }));

    const metrics = within(screen.getByTestId('route-metrics'));
    expect(metrics.getByText('210,8 km')).toBeInTheDocument();
    expect(metrics.getByText('3 h 10 min')).toBeInTheDocument();
  });

  it('avisa de meteorología adversa', () => {
    withResult({
      route: makeRoute({
        weather: {
          worstIntensity: 0.5,
          averageIntensity: 0.3,
          conditions: ['lluvia moderada'],
          alert: true,
          degraded: false,
        },
      }),
      alternatives: [],
    });

    render(<RouteResults />);

    expect(screen.getByText('Condiciones meteorológicas adversas')).toBeInTheDocument();
    expect(screen.getByText(/lluvia moderada/)).toBeInTheDocument();
  });

  it('avisa cuando el cálculo se hizo sin datos meteorológicos reales', () => {
    withResult({
      route: makeRoute({
        weather: {
          worstIntensity: 0,
          averageIntensity: 0,
          conditions: [],
          alert: false,
          degraded: true,
        },
      }),
      alternatives: [],
    });

    render(<RouteResults />);

    expect(screen.getByText(/condiciones neutras en los tramos sin datos/)).toBeInTheDocument();
  });

  it('lista los incidentes de la ruta', () => {
    withResult({
      route: makeRoute({
        incidents: [
          {
            id: 'inc-1',
            incidentType: 'accident',
            severity: 'high',
            description: 'Colisión en el km 42',
            latitude: 2.5,
            longitude: -75.6,
          },
        ],
      }),
      alternatives: [],
    });

    render(<RouteResults />);

    expect(screen.getByText('1 incidente(s) en la zona')).toBeInTheDocument();
    expect(screen.getByText(/Colisión en el km 42/)).toBeInTheDocument();
  });

  it('marca las estaciones de peaje sin tarifa registrada', () => {
    // Un peaje sin tarifa hace que el coste informado sea menor que el real; ocultarlo
    // daría un presupuesto silenciosamente equivocado.
    withResult({
      route: makeRoute({
        tollBreakdown: [
          {
            stationId: 'toll-1',
            name: 'Peaje El Juncal',
            highwayName: 'Ruta 45',
            amount: null,
            latitude: 2.6,
            longitude: -75.5,
          },
        ],
      }),
      alternatives: [],
    });

    render(<RouteResults />);

    expect(screen.getByText('sin tarifa')).toBeInTheDocument();
  });
});
