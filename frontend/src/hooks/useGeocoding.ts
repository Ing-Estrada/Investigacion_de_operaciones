'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { geocodingApi } from '@/lib/api/endpoints';

/**
 * Retrasa la propagación de un valor hasta que deja de cambiar durante `delayMs`.
 *
 * Sin esto, escribir "Pitalito" lanzaría ocho búsquedas —una por tecla— contra
 * Nominatim, que admite del orden de una petición por segundo.
 */
export function useDebouncedValue<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

/** Autocompletado de direcciones. Solo consulta a partir de 3 caracteres. */
export function useGeocodingSearch(query: string, enabled = true) {
  const debouncedQuery = useDebouncedValue(query);
  const trimmed = debouncedQuery.trim();

  return useQuery({
    queryKey: ['geocoding', 'search', trimmed],
    queryFn: () => geocodingApi.search(trimmed),
    enabled: enabled && trimmed.length >= 3,
    // Una dirección no cambia de coordenadas: se cachea de forma agresiva.
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
}
