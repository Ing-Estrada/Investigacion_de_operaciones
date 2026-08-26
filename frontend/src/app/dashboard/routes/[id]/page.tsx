'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect } from 'react';

import { Alert, Button, LoadingSpinner } from '@/components/common/ui';
import { RouteMap } from '@/components/map/RouteMap';
import { RouteResults } from '@/components/results/RouteResults';
import { useRouteDetail, useUpdateRouteStatus } from '@/hooks/useRouteOptimization';
import type { RouteStatus } from '@/lib/types/api.types';
import { ROUTE_STATUS_LABELS } from '@/lib/utils/format';
import { useRouteStore } from '@/store/useRouteStore';

/** Transiciones ofrecidas desde cada estado. Un estado terminal no ofrece ninguna. */
const NEXT_STATUSES: Partial<Record<RouteStatus, RouteStatus[]>> = {
  calculated: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  pending: ['calculated', 'cancelled'],
};

export default function RouteDetailPage() {
  const params = useParams<{ id: string }>();
  const routeId = params?.id ?? null;

  const { data, isPending, error } = useRouteDetail(routeId);
  const updateStatus = useUpdateRouteStatus();

  const setResult = useRouteStore((state) => state.setResult);
  const setOrigin = useRouteStore((state) => state.setOrigin);
  const setDestination = useRouteStore((state) => state.setDestination);

  // Se vuelca la ruta persistida en el store del planificador para reutilizar el mismo
  // mapa y el mismo panel de resultados en lugar de duplicar ambos componentes.
  useEffect(() => {
    if (!data) return;

    setResult(data);
    setOrigin(data.route.origin);
    setDestination(data.route.destination);
  }, [data, setResult, setOrigin, setDestination]);

  // Al salir se limpia: si no, volver al planificador mostraría la ruta del historial
  // como si acabara de calcularse.
  useEffect(() => {
    return () => {
      useRouteStore.getState().reset();
    };
  }, []);

  if (isPending) {
    return <LoadingSpinner label="Cargando la ruta" />;
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Alert tone="danger" title="No se pudo cargar la ruta">
          Puede que no exista o que no tengas acceso a ella.
        </Alert>
        <Link href="/dashboard/routes" className="btn-secondary">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Volver al historial
        </Link>
      </div>
    );
  }

  const route = data.route;
  const availableStatuses = NEXT_STATUSES[route.status] ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/dashboard/routes"
            className="mb-1 inline-flex items-center gap-1 text-sm text-content-muted hover:text-content"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Historial
          </Link>
          <h1 className="truncate text-xl font-semibold">
            {route.origin.address ?? 'Origen'} → {route.destination.address ?? 'Destino'}
          </h1>
          <p className="text-sm text-content-muted">
            Estado actual: {ROUTE_STATUS_LABELS[route.status] ?? route.status}
          </p>
        </div>

        {availableStatuses.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {availableStatuses.map((status) => (
              <Button
                key={status}
                variant={status === 'cancelled' ? 'ghost' : 'secondary'}
                loading={updateStatus.isPending && updateStatus.variables?.status === status}
                onClick={() => updateStatus.mutate({ id: route.id, status })}
                className={status === 'cancelled' ? 'text-danger' : undefined}
              >
                Marcar como {ROUTE_STATUS_LABELS[status]?.toLowerCase() ?? status}
              </Button>
            ))}
          </div>
        )}
      </div>

      {updateStatus.error && (
        <Alert tone="danger">No se pudo actualizar el estado de la ruta.</Alert>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <RouteMap className="h-[420px] xl:h-[calc(100vh-12rem)]" />
        <div className="xl:max-h-[calc(100vh-12rem)] xl:overflow-y-auto xl:pr-1">
          <RouteResults />
        </div>
      </div>
    </div>
  );
}
