'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Badge, Button, EmptyState, LoadingSpinner } from '@/components/common/ui';
import { useRouteHistory } from '@/hooks/useRouteOptimization';
import type { RouteStatus } from '@/lib/types/api.types';
import {
  formatCurrency,
  formatDate,
  formatDistance,
  formatDuration,
  formatNumber,
  ROUTE_STATUS_LABELS,
} from '@/lib/utils/format';

const STATUS_TONES: Record<RouteStatus, 'neutral' | 'accent' | 'success' | 'warning' | 'danger'> = {
  pending: 'neutral',
  calculated: 'accent',
  in_progress: 'warning',
  completed: 'success',
  cancelled: 'danger',
};

const PAGE_SIZE = 20;

export default function RoutesHistoryPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<RouteStatus | ''>('');

  const { data, isPending, isFetching } = useRouteHistory({
    page,
    limit: PAGE_SIZE,
    status: status || undefined,
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Historial de rutas</h1>
          <p className="text-sm text-content-muted">
            Solo rutas principales; las alternativas aparecen en el detalle de cada una.
          </p>
        </div>

        <div>
          <label htmlFor="status-filter" className="label">
            Estado
          </label>
          <select
            id="status-filter"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as RouteStatus | '');
              // Volver a la primera página: mantener la 4 tras filtrar suele dejar la
              // tabla vacía y parece un error.
              setPage(1);
            }}
            className="input w-48"
          >
            <option value="">Todos</option>
            {Object.entries(ROUTE_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isPending ? (
        <LoadingSpinner label="Cargando el historial" />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="Sin rutas registradas"
          description="Las rutas que calcules aparecerán aquí."
          action={
            <Link href="/dashboard" className="btn-primary">
              Ir al planificador
            </Link>
          }
        />
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Historial de rutas calculadas</caption>
              <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-content-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Fecha
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Trayecto
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Distancia
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Tiempo
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Coste
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Score
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Estado
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((route) => (
                  <tr key={route.id} className="border-b border-border last:border-0 hover:bg-surface">
                    <td className="whitespace-nowrap px-4 py-3 text-content-muted">
                      {formatDate(route.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/routes/${route.id}`}
                        className="font-medium text-accent hover:underline"
                      >
                        {route.origin.address ?? 'Origen'} → {route.destination.address ?? 'Destino'}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {formatDistance(route.distanceKm)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {formatDuration(route.durationMinutes)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {formatCurrency(route.cost.totalCost, route.cost.currency)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {formatNumber(route.score.total, 1)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONES[route.status]}>
                        {ROUTE_STATUS_LABELS[route.status] ?? route.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm">
            <p className="text-content-muted">
              {data.total} ruta{data.total === 1 ? '' : 's'} · página {data.page} de {totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={page <= 1 || isFetching}
                onClick={() => setPage((current) => current - 1)}
              >
                Anterior
              </Button>
              <Button
                variant="secondary"
                disabled={page >= totalPages || isFetching}
                onClick={() => setPage((current) => current + 1)}
              >
                Siguiente
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
