'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { vehiclesApi } from '@/lib/api/endpoints';

export const VEHICLES_KEY = ['vehicles'] as const;
export const VEHICLE_TYPES_KEY = ['vehicles', 'types'] as const;

export function useVehicles() {
  return useQuery({
    queryKey: VEHICLES_KEY,
    queryFn: vehiclesApi.list,
    staleTime: 60_000,
  });
}

export function useVehicleTypes() {
  return useQuery({
    queryKey: VEHICLE_TYPES_KEY,
    queryFn: vehiclesApi.types,
    // El catálogo es prácticamente inmutable: no tiene sentido revalidarlo cada minuto.
    staleTime: 24 * 60 * 60 * 1000,
  });
}

export function useCreateVehicle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: vehiclesApi.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: VEHICLES_KEY }),
  });
}

export function useUpdateVehicle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      ...payload
    }: {
      id: string;
      currentFuelLiters?: number;
      customFuelConsumptionLPer100Km?: number;
      isActive?: boolean;
    }) => vehiclesApi.update(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: VEHICLES_KEY }),
  });
}

export function useDeactivateVehicle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: vehiclesApi.remove,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: VEHICLES_KEY }),
  });
}
