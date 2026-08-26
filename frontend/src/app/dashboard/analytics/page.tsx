'use client';

import { useQuery } from '@tanstack/react-query';
import { Coins, Fuel, Gauge, Route as RouteIcon } from 'lucide-react';
import { useState } from 'react';

import { CostByRoadTypeChart, RoutesTimelineChart } from '@/components/charts/AnalyticsCharts';
import { Alert, EmptyState, LoadingSpinner, Metric } from '@/components/common/ui';
import { analyticsApi } from '@/lib/api/endpoints';
import {
  formatCurrency,
  formatDistance,
  formatDuration,
  formatLiters,
  formatNumber,
  ROUTE_STATUS_LABELS,
} from '@/lib/utils/format';

const PERIODS = [
  { days: 7, label: '7 días' },
  { days: 30, label: '30 días' },
  { days: 90, label: '90 días' },
  { days: 365, label: '1 año' },
];

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);

  const summary = useQuery({
    queryKey: ['analytics', 'summary', days],
    queryFn: () => analyticsApi.summary(days),
  });

  const overTime = useQuery({
    queryKey: ['analytics', 'over-time', days],
    queryFn: () => analyticsApi.overTime(days),
  });

  const byRoadType = useQuery({
    queryKey: ['analytics', 'by-road-type', days],
    queryFn: () => analyticsApi.byRoadType(days),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Analíticas</h1>
          <p className="text-sm text-content-muted">
            Agregados sobre rutas principales; las alternativas calculadas no se contabilizan.
          </p>
        </div>

        <div
          role="group"
          aria-label="Periodo"
          className="flex overflow-hidden rounded-lg border border-border"
        >
          {PERIODS.map((period) => (
            <button
              key={period.days}
              type="button"
              onClick={() => setDays(period.days)}
              aria-pressed={days === period.days}
              className={
                days === period.days
                  ? 'bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast'
                  : 'px-3 py-1.5 text-sm text-content-muted hover:bg-surface-raised'
              }
            >
              {period.label}
            </button>
          ))}
        </div>
      </div>

      {summary.isPending ? (
        <LoadingSpinner label="Cargando indicadores" />
      ) : summary.error ? (
        <Alert tone="danger">No se pudieron cargar las analíticas.</Alert>
      ) : summary.data.totalRoutes === 0 ? (
        <EmptyState
          title="Sin datos en este periodo"
          description="Calcula alguna ruta para empezar a ver indicadores."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Rutas"
              value={String(summary.data.totalRoutes)}
              icon={<RouteIcon className="h-3.5 w-3.5" aria-hidden="true" />}
              hint={`${formatDuration(summary.data.averageDurationMinutes)} de media`}
            />
            <Metric
              label="Distancia total"
              value={formatDistance(summary.data.totalDistanceKm)}
              icon={<Gauge className="h-3.5 w-3.5" aria-hidden="true" />}
            />
            <Metric
              label="Combustible"
              value={formatLiters(summary.data.totalFuelLiters)}
              icon={<Fuel className="h-3.5 w-3.5" aria-hidden="true" />}
            />
            <Metric
              label="Coste total"
              value={formatCurrency(summary.data.totalCost)}
              icon={<Coins className="h-3.5 w-3.5" aria-hidden="true" />}
              hint={`${formatCurrency(summary.data.totalTollCost)} en peajes`}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="card p-4">
              <h2 className="text-sm font-semibold">Calidad de las rutas</h2>
              <p className="mt-2 text-3xl font-semibold tabular-nums text-accent">
                {formatNumber(summary.data.averageScore, 1)}
                <span className="text-sm text-content-muted">/100</span>
              </p>
              <p className="mt-1 text-xs text-content-muted">
                Puntuación multicriterio media del periodo.
              </p>
            </div>

            <div className="card p-4">
              <h2 className="text-sm font-semibold">Rendimiento del cálculo</h2>
              <p className="mt-2 text-3xl font-semibold tabular-nums">
                {formatNumber(summary.data.averageComputationTimeMs, 0)}
                <span className="text-sm text-content-muted"> ms</span>
              </p>
              <p className="mt-1 text-xs text-content-muted">
                Tiempo medio de optimización. El objetivo del sistema es mantenerlo por debajo de
                2000 ms.
              </p>
            </div>
          </div>

          <div className="card p-4">
            <h2 className="mb-3 text-sm font-semibold">Rutas por estado</h2>
            <ul className="flex flex-wrap gap-4 text-sm">
              {Object.entries(summary.data.routesByStatus).map(([status, count]) => (
                <li key={status}>
                  <span className="text-content-muted">
                    {ROUTE_STATUS_LABELS[status] ?? status}:{' '}
                  </span>
                  <span className="font-medium tabular-nums">{count}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <div className="card p-4">
              <h2 className="mb-3 text-sm font-semibold">Evolución diaria</h2>
              {overTime.isPending ? (
                <LoadingSpinner />
              ) : (
                <RoutesTimelineChart data={overTime.data ?? []} />
              )}
            </div>

            <div className="card p-4">
              <h2 className="mb-3 text-sm font-semibold">Distancia por tipo de vía</h2>
              {byRoadType.isPending ? (
                <LoadingSpinner />
              ) : (
                <CostByRoadTypeChart data={byRoadType.data ?? []} />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
