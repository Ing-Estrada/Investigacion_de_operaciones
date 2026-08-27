'use client';

import { CloudRain, Coins, Fuel, Gauge, Route as RouteIcon, TriangleAlert } from 'lucide-react';

import { Alert, Badge, EmptyState } from '@/components/common/ui';
import type { RouteResult } from '@/lib/types/api.types';
import { cn } from '@/lib/utils/cn';
import {
  formatCurrency,
  formatDistance,
  formatDuration,
  formatLiters,
  formatNumber,
  INCIDENT_TYPE_LABELS,
  ROAD_TYPE_LABELS,
  SEVERITY_LABELS,
} from '@/lib/utils/format';
import { selectActiveRoute, useRouteStore } from '@/store/useRouteStore';

/** Barra de puntuación de un criterio del modelo multicriterio. */
function ScoreBar({ label, value, weight }: { label: string; value: number; weight: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-content-muted">
          {label} <span className="opacity-60">({weight})</span>
        </span>
        <span className="tabular-nums font-medium text-content">{formatNumber(value, 0)}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface">
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
          role="progressbar"
          aria-valuenow={Math.round(value)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
        />
      </div>
    </div>
  );
}

function RouteSummaryCard({
  route,
  isActive,
  isPrimary,
  onSelect,
}: {
  route: RouteResult;
  isActive: boolean;
  isPrimary: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isActive}
      className={cn(
        'w-full rounded-lg border p-3 text-left transition-colors',
        isActive
          ? 'border-accent bg-accent/5'
          : 'border-border bg-surface-raised hover:border-accent/50',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-content">
          {isPrimary ? 'Ruta óptima' : `Alternativa ${route.alternativeRank}`}
        </span>
        <Badge tone={isPrimary ? 'accent' : 'neutral'}>
          {formatNumber(route.score.total, 1)} pts
        </Badge>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums text-content-muted">
        <span>{formatDistance(route.distanceKm)}</span>
        <span>{formatDuration(route.durationMinutes)}</span>
        <span>{formatCurrency(route.cost.totalCost, route.cost.currency)}</span>
      </div>
    </button>
  );
}

export function RouteResults() {
  const result = useRouteStore((state) => state.result);
  const selectedRouteId = useRouteStore((state) => state.selectedRouteId);
  const selectRoute = useRouteStore((state) => state.selectRoute);
  const selectedSegmentOrder = useRouteStore((state) => state.selectedSegmentOrder);
  const selectSegment = useRouteStore((state) => state.selectSegment);
  const active = useRouteStore(selectActiveRoute);

  if (!result || !active) {
    return (
      <EmptyState
        title="Sin ruta calculada"
        description="Selecciona origen, destino y vehículo, y pulsa «Calcular ruta óptima» para ver aquí el desglose."
      />
    );
  }

  const allRoutes = [result.route, ...result.alternatives];

  return (
    <div className="space-y-4">
      {/* --- Avisos: van arriba porque condicionan la decisión --- */}
      {active.weather.alert && (
        <Alert tone="warning" title="Condiciones meteorológicas adversas">
          <span className="flex items-center gap-1.5">
            <CloudRain className="h-3.5 w-3.5" aria-hidden="true" />
            {active.weather.conditions.join(', ') || 'Meteorología desfavorable en ruta'} · factor{' '}
            {formatNumber(active.weather.worstIntensity, 2)}. El consumo y el tiempo estimados ya lo
            incluyen.
          </span>
        </Alert>
      )}

      {active.weather.degraded && (
        <Alert tone="info">
          No se pudieron obtener datos meteorológicos para toda la ruta. El cálculo se hizo con
          condiciones neutras en los tramos sin datos.
        </Alert>
      )}

      {active.incidents.length > 0 && (
        <Alert tone="danger" title={`${active.incidents.length} incidente(s) en la zona`}>
          <ul className="mt-1 space-y-1">
            {active.incidents.slice(0, 3).map((incident) => (
              <li key={incident.id} className="flex items-start gap-1.5">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                  <strong>
                    {INCIDENT_TYPE_LABELS[incident.incidentType] ?? incident.incidentType}
                  </strong>{' '}
                  ({SEVERITY_LABELS[incident.severity] ?? incident.severity}): {incident.description}
                </span>
              </li>
            ))}
            {active.incidents.length > 3 && (
              <li className="opacity-70">y {active.incidents.length - 3} más…</li>
            )}
          </ul>
        </Alert>
      )}

      {/* --- Selector de ruta --- */}
      {allRoutes.length > 1 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-content-muted">
            Rutas ({allRoutes.length})
          </h3>
          {allRoutes.map((route) => (
            <RouteSummaryCard
              key={route.id}
              route={route}
              isPrimary={route.id === result.route.id}
              isActive={route.id === selectedRouteId}
              onSelect={() => selectRoute(route.id)}
            />
          ))}
        </div>
      )}

      {/* --- Métricas principales --- */}
      <div data-testid="route-metrics" className="grid grid-cols-2 gap-2">
        <div className="card p-3">
          <p className="flex items-center gap-1.5 text-xs text-content-muted">
            <RouteIcon className="h-3.5 w-3.5" aria-hidden="true" />
            Distancia
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {formatDistance(active.distanceKm)}
          </p>
        </div>

        <div className="card p-3">
          <p className="flex items-center gap-1.5 text-xs text-content-muted">
            <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
            Tiempo estimado
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {formatDuration(active.durationMinutes)}
          </p>
        </div>

        <div className="card p-3">
          <p className="flex items-center gap-1.5 text-xs text-content-muted">
            <Fuel className="h-3.5 w-3.5" aria-hidden="true" />
            Combustible
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {formatLiters(active.cost.fuelLiters)}
          </p>
        </div>

        <div className="card p-3">
          <p className="flex items-center gap-1.5 text-xs text-content-muted">
            <Coins className="h-3.5 w-3.5" aria-hidden="true" />
            Coste total
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {formatCurrency(active.cost.totalCost, active.cost.currency)}
          </p>
        </div>
      </div>

      {/* --- Desglose de costes --- */}
      <div className="card p-4">
        <h3 className="mb-3 text-sm font-semibold">Desglose de costes</h3>
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-content-muted">
              Combustible ({formatLiters(active.cost.fuelLiters)} ×{' '}
              {formatCurrency(active.cost.fuelPricePerLiter, active.cost.currency)}/L)
            </dt>
            <dd className="tabular-nums">
              {formatCurrency(active.cost.fuelCost, active.cost.currency)}
            </dd>
          </div>
          <div className="flex justify-between">
            {/* Se compone la cadena entera en una expresión para que sea un único nodo
                de texto: partida en varios trozos, no se puede leer ni buscar como una
                frase, ni por un lector de pantalla ni por un test. */}
            <dt className="text-content-muted">
              {`Peajes (${active.tollBreakdown.length} ${
                active.tollBreakdown.length === 1 ? 'estación' : 'estaciones'
              })`}
            </dt>
            <dd className="tabular-nums">
              {formatCurrency(active.cost.tollCost, active.cost.currency)}
            </dd>
          </div>
          <div className="flex justify-between border-t border-border pt-1.5 font-medium">
            <dt>Total</dt>
            <dd className="tabular-nums">
              {formatCurrency(active.cost.totalCost, active.cost.currency)}
            </dd>
          </div>
        </dl>

        {active.tollBreakdown.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-border pt-3 text-xs">
            {active.tollBreakdown.map((toll) => (
              <li key={toll.stationId} className="flex justify-between gap-2">
                <span className="truncate text-content-muted" title={toll.highwayName}>
                  {toll.name}
                </span>
                <span className="tabular-nums">
                  {toll.amount === null ? (
                    <em className="text-warning">sin tarifa</em>
                  ) : (
                    formatCurrency(toll.amount, active.cost.currency)
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* --- Puntuación multicriterio --- */}
      <div data-testid="route-score" className="card p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold">Puntuación multicriterio</h3>
          <span className="text-lg font-semibold tabular-nums text-accent">
            {formatNumber(active.score.total, 1)}
            <span className="text-xs text-content-muted">/100</span>
          </span>
        </div>

        <div className="space-y-2.5">
          <ScoreBar label="Distancia" value={active.score.distanceScore} weight="40%" />
          <ScoreBar label="Tiempo" value={active.score.timeScore} weight="30%" />
          <ScoreBar label="Coste" value={active.score.costScore} weight="20%" />
          <ScoreBar label="Seguridad" value={active.score.safetyScore} weight="10%" />
        </div>

        <p className="mt-3 border-t border-border pt-2 text-xs text-content-muted">
          Calculada con {active.algorithm === 'astar' ? 'A*' : 'Dijkstra'} en{' '}
          {active.computationTimeMs} ms.
        </p>
      </div>

      {/* --- Tramos --- */}
      {active.segments.length > 0 && (
        <details className="card p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            Tramos ({active.segments.length})
          </summary>
          <p className="mt-2 text-xs text-content-muted">
            Selecciona un tramo para resaltarlo en el mapa.
          </p>
          <ol className="mt-2 space-y-1">
            {active.segments.map((segment) => {
              const isSelected = segment.order === selectedSegmentOrder;

              return (
                <li key={segment.order}>
                  <button
                    type="button"
                    onClick={() => selectSegment(segment.order)}
                    aria-pressed={isSelected}
                    className={cn(
                      'flex w-full items-start justify-between gap-3 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors',
                      isSelected
                        ? 'border-warning bg-warning/10 font-medium'
                        : 'border-transparent hover:bg-surface',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-content">
                        {segment.roadName ?? `Tramo ${segment.order + 1}`}
                      </span>
                      <span className="block text-content-muted">
                        {ROAD_TYPE_LABELS[segment.roadType] ?? segment.roadType}
                        {segment.hasToll && ' · peaje'}
                        {segment.incidentPresent && ' · incidente'}
                        {segment.weatherIntensityFactor > 0 &&
                          ` · clima ${formatNumber(segment.weatherIntensityFactor, 2)}`}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums text-content-muted">
                      {formatDistance(segment.distanceKm)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </details>
      )}
    </div>
  );
}
