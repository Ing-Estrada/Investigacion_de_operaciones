'use client';

import { RouteForm } from '@/components/forms/RouteForm';
import { RouteMap } from '@/components/map/RouteMap';
import { RouteResults } from '@/components/results/RouteResults';

export default function PlannerPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Planificador de rutas</h1>
        <p className="text-sm text-content-muted">
          Optimización multicriterio sobre la red vial real: 40% distancia, 30% tiempo, 20% coste y
          10% riesgo.
        </p>
      </div>

      {/*
        Tres columnas en pantallas grandes: parámetros, mapa y resultados. En móvil se
        apilan, con el mapa con altura fija para que no colapse a cero — un contenedor de
        Leaflet sin altura explícita no renderiza nada.
      */}
      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
        <div className="xl:sticky xl:top-20 xl:self-start">
          <RouteForm />
        </div>

        <RouteMap className="h-[420px] xl:h-[calc(100vh-9rem)]" />

        <div className="xl:max-h-[calc(100vh-9rem)] xl:overflow-y-auto xl:pr-1">
          <RouteResults />
        </div>
      </div>
    </div>
  );
}
