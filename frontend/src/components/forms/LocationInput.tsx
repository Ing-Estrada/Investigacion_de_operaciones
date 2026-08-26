'use client';

import { Loader2, MapPin, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useGeocodingSearch } from '@/hooks/useGeocoding';
import type { LocationPoint } from '@/lib/types/api.types';
import { cn } from '@/lib/utils/cn';
import { formatCoordinates } from '@/lib/utils/format';

interface LocationInputProps {
  label: string;
  value: LocationPoint | null;
  onChange: (point: LocationPoint | null) => void;
  onPickOnMap?: () => void;
  isPicking?: boolean;
  placeholder?: string;
}

/**
 * Campo de ubicación con autocompletado sobre el geocodificador.
 *
 * El usuario puede escribir una dirección o fijar el punto directamente en el mapa; en
 * ambos casos el valor resultante es el mismo par de coordenadas, porque el backend
 * necesita coordenadas y no texto.
 */
export function LocationInput({
  label,
  value,
  onChange,
  onPickOnMap,
  isPicking,
  placeholder = 'Escribe una dirección o ciudad',
}: LocationInputProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: suggestions = [], isFetching } = useGeocodingSearch(query, isOpen);

  // Cerrar al hacer clic fuera: sin esto la lista se queda abierta tapando el formulario.
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const selectSuggestion = (displayName: string, latitude: number, longitude: number) => {
    onChange({ latitude, longitude, address: displayName });
    setQuery('');
    setIsOpen(false);
  };

  const inputId = `location-${label.toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <div ref={containerRef} className="relative">
      <div className="mb-1.5 flex items-center justify-between">
        <label htmlFor={inputId} className="text-sm font-medium text-content">
          {label}
        </label>
        {onPickOnMap && (
          <button
            type="button"
            onClick={onPickOnMap}
            className={cn(
              'text-xs font-medium transition-colors',
              isPicking ? 'text-accent' : 'text-content-muted hover:text-accent',
            )}
          >
            {isPicking ? 'Haz clic en el mapa…' : 'Fijar en el mapa'}
          </button>
        )}
      </div>

      {value ? (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-content" title={value.address}>
              {value.address ?? 'Punto seleccionado en el mapa'}
            </p>
            <p className="text-xs tabular-nums text-content-muted">
              {formatCoordinates(value.latitude, value.longitude)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={`Quitar ${label.toLowerCase()}`}
            className="rounded p-0.5 text-content-muted hover:text-danger"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <input
            id={inputId}
            type="text"
            role="combobox"
            aria-expanded={isOpen && suggestions.length > 0}
            aria-controls={`${inputId}-listbox`}
            aria-autocomplete="list"
            autoComplete="off"
            value={query}
            placeholder={placeholder}
            onChange={(event) => {
              setQuery(event.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            className="input pr-8"
          />
          {isFetching && (
            <Loader2
              className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-content-muted"
              aria-hidden="true"
            />
          )}
        </div>
      )}

      {isOpen && !value && suggestions.length > 0 && (
        <ul
          id={`${inputId}-listbox`}
          role="listbox"
          className="absolute z-[600] mt-1 max-h-60 w-full overflow-auto rounded-lg border border-border bg-surface-raised shadow-lg"
        >
          {suggestions.map((suggestion) => (
            <li key={`${suggestion.displayName}-${suggestion.coordinates.latitude}`} role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() =>
                  selectSuggestion(
                    suggestion.displayName,
                    suggestion.coordinates.latitude,
                    suggestion.coordinates.longitude,
                  )
                }
                className="block w-full px-3 py-2 text-left text-sm text-content hover:bg-surface"
              >
                <span className="line-clamp-2">{suggestion.displayName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {isOpen && !value && query.trim().length >= 3 && !isFetching && suggestions.length === 0 && (
        <p className="mt-1 text-xs text-content-muted">Sin resultados para esa búsqueda.</p>
      )}
    </div>
  );
}
