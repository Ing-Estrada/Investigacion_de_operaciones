import { create } from 'zustand';

import type { LocationPoint, OptimizedRouteResponse, RouteResult } from '@/lib/types/api.types';

/** Qué extremo de la ruta fija el siguiente clic en el mapa. */
export type PickingMode = 'origin' | 'destination' | null;

interface RouteState {
  origin: LocationPoint | null;
  destination: LocationPoint | null;
  vehicleId: string | null;
  alternatives: number;
  avoidTolls: boolean;
  algorithm: 'astar' | 'dijkstra';

  result: OptimizedRouteResponse | null;
  /** Ruta resaltada en el mapa: la principal o una de las alternativas. */
  selectedRouteId: string | null;

  pickingMode: PickingMode;
  showIncidents: boolean;
  showTolls: boolean;

  setOrigin: (point: LocationPoint | null) => void;
  setDestination: (point: LocationPoint | null) => void;
  swapEndpoints: () => void;
  setVehicleId: (id: string | null) => void;
  setAlternatives: (count: number) => void;
  setAvoidTolls: (value: boolean) => void;
  setAlgorithm: (algorithm: 'astar' | 'dijkstra') => void;

  setResult: (result: OptimizedRouteResponse | null) => void;
  selectRoute: (id: string) => void;

  setPickingMode: (mode: PickingMode) => void;
  toggleIncidents: () => void;
  toggleTolls: () => void;

  reset: () => void;
}

const INITIAL = {
  origin: null,
  destination: null,
  vehicleId: null,
  alternatives: 2,
  avoidTolls: false,
  algorithm: 'astar' as const,
  result: null,
  selectedRouteId: null,
  pickingMode: 'origin' as PickingMode,
  showIncidents: true,
  showTolls: true,
};

/**
 * Estado del planificador de rutas.
 *
 * Vive en un store global y no en el estado del componente porque lo comparten piezas
 * que están en ramas distintas del árbol —el mapa, el formulario y el panel de
 * resultados— y pasarlo por props obligaría a elevarlo hasta la página y volver a
 * bajarlo por media docena de niveles.
 */
export const useRouteStore = create<RouteState>((set, get) => ({
  ...INITIAL,

  setOrigin: (point) =>
    set({
      origin: point,
      // Cambiar un extremo invalida el resultado: seguir mostrando la ruta anterior
      // haría creer que corresponde a los nuevos puntos.
      result: null,
      selectedRouteId: null,
      // Tras fijar el origen, el siguiente clic fija el destino: es la secuencia natural.
      pickingMode: point && !get().destination ? 'destination' : null,
    }),

  setDestination: (point) =>
    set({
      destination: point,
      result: null,
      selectedRouteId: null,
      pickingMode: point && !get().origin ? 'origin' : null,
    }),

  swapEndpoints: () =>
    set((state) => ({
      origin: state.destination,
      destination: state.origin,
      result: null,
      selectedRouteId: null,
    })),

  setVehicleId: (id) => set({ vehicleId: id }),
  setAlternatives: (count) => set({ alternatives: Math.min(4, Math.max(0, count)), result: null }),
  setAvoidTolls: (value) => set({ avoidTolls: value, result: null }),
  setAlgorithm: (algorithm) => set({ algorithm, result: null }),

  setResult: (result) =>
    set({ result, selectedRouteId: result?.route.id ?? null, pickingMode: null }),

  selectRoute: (id) => set({ selectedRouteId: id }),

  setPickingMode: (mode) => set({ pickingMode: mode }),
  toggleIncidents: () => set((state) => ({ showIncidents: !state.showIncidents })),
  toggleTolls: () => set((state) => ({ showTolls: !state.showTolls })),

  reset: () => set(INITIAL),
}));

/** Ruta actualmente resaltada, buscando entre la principal y las alternativas. */
export function selectActiveRoute(state: RouteState): RouteResult | null {
  if (!state.result) return null;
  if (state.selectedRouteId === state.result.route.id) return state.result.route;

  return (
    state.result.alternatives.find((route) => route.id === state.selectedRouteId) ??
    state.result.route
  );
}
