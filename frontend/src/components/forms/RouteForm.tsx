'use client';

import { ArrowUpDown, Navigation, Truck } from 'lucide-react';
import Link from 'next/link';

import { LocationInput } from '@/components/forms/LocationInput';
import { Alert, Button, LoadingSpinner } from '@/components/common/ui';
import { useOptimizeRoute } from '@/hooks/useRouteOptimization';
import { useVehicles } from '@/hooks/useVehicles';
import { ApiError } from '@/lib/api/client';
import { useRouteStore } from '@/store/useRouteStore';

export function RouteForm() {
  const {
    origin,
    destination,
    vehicleId,
    alternatives,
    avoidTolls,
    algorithm,
    pickingMode,
    setOrigin,
    setDestination,
    swapEndpoints,
    setVehicleId,
    setAlternatives,
    setAvoidTolls,
    setAlgorithm,
    setPickingMode,
  } = useRouteStore();

  const { data: vehicles, isPending: loadingVehicles } = useVehicles();
  const optimize = useOptimizeRoute();

  const activeVehicles = (vehicles ?? []).filter((vehicle) => vehicle.isActive);
  const canSubmit = Boolean(origin && destination && vehicleId);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!origin || !destination || !vehicleId) return;

    optimize.mutate({
      origin,
      destination,
      vehicleId,
      alternatives,
      algorithm,
      avoidTolls,
    });
  };

  const error = optimize.error;

  return (
    <form onSubmit={handleSubmit} className="card space-y-4 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-content-muted">
        Planificar ruta
      </h2>

      <LocationInput
        label="Origen"
        value={origin}
        onChange={setOrigin}
        isPicking={pickingMode === 'origin'}
        onPickOnMap={() => setPickingMode(pickingMode === 'origin' ? null : 'origin')}
      />

      <div className="flex justify-center">
        <button
          type="button"
          onClick={swapEndpoints}
          disabled={!origin && !destination}
          aria-label="Intercambiar origen y destino"
          className="btn-ghost px-2 py-1"
        >
          <ArrowUpDown className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <LocationInput
        label="Destino"
        value={destination}
        onChange={setDestination}
        isPicking={pickingMode === 'destination'}
        onPickOnMap={() => setPickingMode(pickingMode === 'destination' ? null : 'destination')}
      />

      <div>
        <label htmlFor="vehicle" className="label">
          Vehículo
        </label>

        {loadingVehicles ? (
          <LoadingSpinner label="Cargando vehículos" />
        ) : activeVehicles.length === 0 ? (
          <Alert tone="warning">
            No tienes vehículos activos.{' '}
            <Link href="/dashboard/vehicles" className="font-medium text-accent hover:underline">
              Da de alta uno
            </Link>{' '}
            para poder calcular rutas.
          </Alert>
        ) : (
          <select
            id="vehicle"
            value={vehicleId ?? ''}
            onChange={(event) => setVehicleId(event.target.value || null)}
            className="input"
            required
          >
            <option value="">Selecciona un vehículo</option>
            {activeVehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.plate} · {vehicle.manufacturer} {vehicle.model} ({vehicle.vehicleType.name})
              </option>
            ))}
          </select>
        )}
      </div>

      <details className="group">
        <summary className="cursor-pointer text-sm font-medium text-content-muted hover:text-content">
          Opciones avanzadas
        </summary>

        <div className="mt-3 space-y-3">
          <div>
            <label htmlFor="alternatives" className="label">
              Rutas alternativas: {alternatives}
            </label>
            <input
              id="alternatives"
              type="range"
              min={0}
              max={4}
              step={1}
              value={alternatives}
              onChange={(event) => setAlternatives(Number(event.target.value))}
              className="w-full accent-accent"
            />
          </div>

          <div>
            <label htmlFor="algorithm" className="label">
              Algoritmo
            </label>
            <select
              id="algorithm"
              value={algorithm}
              onChange={(event) => setAlgorithm(event.target.value as 'astar' | 'dijkstra')}
              className="input"
            >
              <option value="astar">A* (heurística de Haversine)</option>
              <option value="dijkstra">Dijkstra</option>
            </select>
            <p className="mt-1 text-xs text-content-muted">
              Ambos devuelven el mismo óptimo; A* explora menos nodos.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm text-content">
            <input
              type="checkbox"
              checked={avoidTolls}
              onChange={(event) => setAvoidTolls(event.target.checked)}
              className="h-4 w-4 rounded border-border accent-accent"
            />
            Penalizar rutas con peaje
          </label>
        </div>
      </details>

      {error && (
        <Alert tone="danger" title="No se pudo calcular la ruta">
          {error instanceof ApiError
            ? error.status === 422
              ? error.message
              : error.status === 502 || error.status === 503
                ? 'El proveedor de cartografía no está disponible. Inténtalo en unos minutos.'
                : error.isRateLimited
                  ? 'Has alcanzado el límite de cálculos por hora.'
                  : error.message
            : 'Error inesperado.'}
        </Alert>
      )}

      <Button
        type="submit"
        loading={optimize.isPending}
        disabled={!canSubmit}
        className="w-full"
      >
        {optimize.isPending ? (
          'Optimizando…'
        ) : (
          <>
            <Navigation className="h-4 w-4" aria-hidden="true" />
            Calcular ruta óptima
          </>
        )}
      </Button>

      {!canSubmit && !optimize.isPending && (
        <p className="flex items-center gap-1.5 text-xs text-content-muted">
          <Truck className="h-3.5 w-3.5" aria-hidden="true" />
          Selecciona origen, destino y vehículo.
        </p>
      )}
    </form>
  );
}
