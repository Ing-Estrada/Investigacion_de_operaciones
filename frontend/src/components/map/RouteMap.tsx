'use client';

import dynamic from 'next/dynamic';
import { Layers, MapPin, TriangleAlert } from 'lucide-react';

import { LoadingSpinner } from '@/components/common/ui';
import { cn } from '@/lib/utils/cn';
import { useRouteStore } from '@/store/useRouteStore';

/**
 * Leaflet se carga solo en el navegador.
 *
 * La librería accede a `window` y a `document` en el momento de importarse, así que
 * renderizarla en el servidor rompe el build de Next. `ssr: false` la deja fuera del
 * bundle de servidor y evita además el desajuste de hidratación entre el HTML generado
 * y el mapa real.
 */
const MapCanvas = dynamic(() => import('./MapCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-surface">
      <LoadingSpinner label="Cargando el mapa" />
    </div>
  ),
});

export function RouteMap({ className }: { className?: string }) {
  const pickingMode = useRouteStore((state) => state.pickingMode);
  const setPickingMode = useRouteStore((state) => state.setPickingMode);
  const showIncidents = useRouteStore((state) => state.showIncidents);
  const showTolls = useRouteStore((state) => state.showTolls);
  const toggleIncidents = useRouteStore((state) => state.toggleIncidents);
  const toggleTolls = useRouteStore((state) => state.toggleTolls);

  return (
    <div className={cn('relative overflow-hidden rounded-xl border border-border', className)}>
      <div data-testid="route-map" className="h-full w-full">
        <MapCanvas />
      </div>

      {/* z-index por encima de los paneles de Leaflet (400) y por debajo de la cabecera (500). */}
      <div className="absolute right-3 top-3 z-[450] flex flex-col gap-2">
        <div className="flex overflow-hidden rounded-lg border border-border bg-surface-raised shadow-sm">
          <button
            type="button"
            onClick={() => setPickingMode(pickingMode === 'origin' ? null : 'origin')}
            aria-pressed={pickingMode === 'origin'}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors',
              pickingMode === 'origin'
                ? 'bg-success text-white'
                : 'text-content-muted hover:bg-surface',
            )}
          >
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            Origen
          </button>
          <button
            type="button"
            onClick={() => setPickingMode(pickingMode === 'destination' ? null : 'destination')}
            aria-pressed={pickingMode === 'destination'}
            className={cn(
              'flex items-center gap-1.5 border-l border-border px-3 py-2 text-xs font-medium transition-colors',
              pickingMode === 'destination'
                ? 'bg-danger text-white'
                : 'text-content-muted hover:bg-surface',
            )}
          >
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            Destino
          </button>
        </div>

        <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface-raised shadow-sm">
          <button
            type="button"
            onClick={toggleIncidents}
            aria-pressed={showIncidents}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-xs transition-colors',
              showIncidents ? 'text-content' : 'text-content-muted',
            )}
          >
            <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
            Incidentes
          </button>
          <button
            type="button"
            onClick={toggleTolls}
            aria-pressed={showTolls}
            className={cn(
              'flex items-center gap-1.5 border-t border-border px-3 py-2 text-xs transition-colors',
              showTolls ? 'text-content' : 'text-content-muted',
            )}
          >
            <Layers className="h-3.5 w-3.5" aria-hidden="true" />
            Peajes
          </button>
        </div>
      </div>

      {pickingMode && (
        <div
          role="status"
          className="pointer-events-none absolute left-1/2 top-3 z-[450] -translate-x-1/2 rounded-full border border-border bg-surface-raised/95 px-3 py-1.5 text-xs font-medium shadow"
        >
          Haz clic en el mapa para fijar el {pickingMode === 'origin' ? 'origen' : 'destino'}
        </div>
      )}
    </div>
  );
}
