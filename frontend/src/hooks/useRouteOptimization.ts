'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { routesApi } from '@/lib/api/endpoints';
import type { OptimizeRouteRequest, RouteStatus } from '@/lib/types/api.types';
import { useRouteStore } from '@/store/useRouteStore';

export const ROUTES_KEY = ['routes'] as const;

/**
 * Cálculo de la ruta óptima.
 *
 * No se reintenta automáticamente: cada intento consume cuota de los proveedores
 * externos y CPU de optimización, y el backend limita a 50 cálculos por hora y usuario.
 * Reintentar en silencio agotaría esa cuota sin que el usuario se entere.
 */
export function useOptimizeRoute() {
  const queryClient = useQueryClient();
  const setResult = useRouteStore((state) => state.setResult);

  return useMutation({
    mutationFn: (payload: OptimizeRouteRequest) => routesApi.optimize(payload),
    retry: false,
    onSuccess: (response) => {
      setResult(response);
      queryClient.invalidateQueries({ queryKey: ROUTES_KEY });
    },
  });
}

export function useRouteHistory(params: {
  page?: number;
  limit?: number;
  status?: RouteStatus;
}) {
  return useQuery({
    queryKey: [...ROUTES_KEY, 'list', params],
    queryFn: () => routesApi.list(params),
    staleTime: 30_000,
  });
}

export function useRouteDetail(id: string | null) {
  return useQuery({
    queryKey: [...ROUTES_KEY, 'detail', id],
    queryFn: () => routesApi.get(id as string),
    enabled: Boolean(id),
  });
}

export function useUpdateRouteStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: RouteStatus }) =>
      routesApi.updateStatus(id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ROUTES_KEY }),
  });
}
