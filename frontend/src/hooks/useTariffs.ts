'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fuelApi, tollsApi } from '@/lib/api/endpoints';
import type { FuelType, TollCategory } from '@/lib/types/api.types';

export const FUEL_CURRENT_KEY = ['fuel', 'current'] as const;
export const FUEL_HISTORY_KEY = ['fuel', 'history'] as const;
export const TOLL_STATIONS_KEY = ['tolls', 'stations'] as const;

/**
 * Un cambio de tarifa altera el coste de las rutas que se calculen después, así que
 * tras cada mutación se invalidan también las rutas: dejarlas en caché mostraría
 * importes calculados con el precio anterior.
 */
function useTariffMutation<TArgs, TResult>(mutationFn: (args: TArgs) => Promise<TResult>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: FUEL_CURRENT_KEY }),
        queryClient.invalidateQueries({ queryKey: FUEL_HISTORY_KEY }),
        queryClient.invalidateQueries({ queryKey: TOLL_STATIONS_KEY }),
        queryClient.invalidateQueries({ queryKey: ['routes'] }),
      ]);
    },
  });
}

export function useCurrentFuelPrices() {
  return useQuery({ queryKey: FUEL_CURRENT_KEY, queryFn: fuelApi.current, staleTime: 60_000 });
}

export function useFuelHistory(fuelType?: FuelType) {
  return useQuery({
    queryKey: [...FUEL_HISTORY_KEY, fuelType ?? 'all'],
    queryFn: () => fuelApi.history(fuelType),
    staleTime: 60_000,
  });
}

export function useTollStations(includeInactive = false) {
  return useQuery({
    queryKey: [...TOLL_STATIONS_KEY, includeInactive],
    queryFn: () => tollsApi.stations(includeInactive),
    staleTime: 60_000,
  });
}

export function useCreateFuelPrice() {
  return useTariffMutation(fuelApi.create);
}

export function useExpireFuelPrice() {
  return useTariffMutation(fuelApi.expire);
}

export function useCreateTollStation() {
  return useTariffMutation(tollsApi.createStation);
}

export function useToggleTollStation() {
  return useTariffMutation(({ id, isActive }: { id: string; isActive: boolean }) =>
    tollsApi.updateStation(id, { isActive }),
  );
}

export function useCreateTollRate() {
  return useTariffMutation(
    ({
      stationId,
      ...payload
    }: {
      stationId: string;
      vehicleCategory: TollCategory;
      rateAmount: number;
      effectiveDate: string;
      expirationDate?: string | null;
    }) => tollsApi.createRate(stationId, payload),
  );
}

export function useUpdateTollRate() {
  return useTariffMutation(({ rateId, rateAmount }: { rateId: string; rateAmount: number }) =>
    tollsApi.updateRate(rateId, { rateAmount }),
  );
}
