'use client';

import { Fuel, Plus, Receipt } from 'lucide-react';
import { useState } from 'react';

import { Alert, Badge, Button, EmptyState, Field, LoadingSpinner } from '@/components/common/ui';
import { useCurrentUser } from '@/hooks/useAuth';
import {
  useCreateFuelPrice,
  useCreateTollRate,
  useCreateTollStation,
  useCurrentFuelPrices,
  useExpireFuelPrice,
  useToggleTollStation,
  useTollStations,
  useUpdateTollRate,
} from '@/hooks/useTariffs';
import { ApiError } from '@/lib/api/client';
import type { FuelType, TollCategory } from '@/lib/types/api.types';
import { cn } from '@/lib/utils/cn';
import { formatCurrency, formatDay, FUEL_TYPE_LABELS } from '@/lib/utils/format';

const CATEGORIES: TollCategory[] = ['I', 'II', 'III', 'IV', 'V'];
const FUEL_TYPES: FuelType[] = ['diesel', 'gasoline'];

/**
 * Hoy en formato YYYY-MM-DD, que es lo que espera un `<input type="date">`.
 *
 * Se compone con los componentes locales y no con `toISOString()`, que trabaja en UTC:
 * a partir de las 19:00 en UTC-5 ya sería el día siguiente, y el formulario propondría
 * una fecha de entrada en vigor de mañana sin que el usuario lo hubiese pedido.
 */
function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

// --- Combustible -------------------------------------------------------------

function FuelSection({ canEdit }: { canEdit: boolean }) {
  const { data: prices, isPending } = useCurrentFuelPrices();
  const createPrice = useCreateFuelPrice();
  const expirePrice = useExpireFuelPrice();

  const [isOpen, setIsOpen] = useState(false);
  const [fuelType, setFuelType] = useState<FuelType>('diesel');
  const [pricePerLiter, setPricePerLiter] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [source, setSource] = useState('');

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    createPrice.mutate(
      {
        fuelType,
        pricePerLiter: Number(pricePerLiter),
        effectiveDate,
        source: source.trim() || null,
      },
      {
        onSuccess: () => {
          setPricePerLiter('');
          setSource('');
          setIsOpen(false);
        },
      },
    );
  };

  return (
    <section className="card p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <Fuel className="h-4 w-4 text-content-muted" aria-hidden="true" />
            Precio del combustible
          </h2>
          <p className="mt-1 text-sm text-content-muted">
            Cada tipo de vehículo consume diésel o gasolina, y se le aplica el precio de su
            combustible.
          </p>
        </div>
        {canEdit && (
          <Button variant="secondary" onClick={() => setIsOpen((open) => !open)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Nuevo precio
          </Button>
        )}
      </div>

      {isPending ? (
        <LoadingSpinner label="Cargando precios" />
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(prices ?? []).map((price) => (
            <article key={price.fuelType} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{FUEL_TYPE_LABELS[price.fuelType]}</span>
                <Badge tone={price.origin === 'database' ? 'success' : 'warning'}>
                  {price.origin === 'database' ? 'Cargado' : 'Por defecto'}
                </Badge>
              </div>

              <p className="mt-1 text-xl font-semibold tabular-nums">
                {formatCurrency(price.pricePerLiter, price.currency)}
                <span className="ml-1 text-sm font-normal text-content-muted">/ L</span>
              </p>

              {price.origin === 'configured' ? (
                // Sin este aviso, un precio del entorno se confundiría con uno real y el
                // coste informado parecería más fiable de lo que es.
                <p className="mt-1 text-xs text-warning">
                  Sin precio cargado: se está usando el del entorno. Los costes son
                  orientativos.
                </p>
              ) : (
                <p className="mt-1 text-xs text-content-muted">
                  Vigente desde {price.effectiveDate ? formatDay(price.effectiveDate) : '—'}
                  {price.source && ` · ${price.source}`}
                </p>
              )}
            </article>
          ))}
        </div>
      )}

      {isOpen && canEdit && (
        <form onSubmit={handleSubmit} className="mt-4 space-y-3 rounded-lg border border-border p-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="fuelType" className="label">
                Combustible
              </label>
              <select
                id="fuelType"
                value={fuelType}
                onChange={(event) => setFuelType(event.target.value as FuelType)}
                className="input"
              >
                {FUEL_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {FUEL_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>

            <Field
              label="Precio por litro"
              name="pricePerLiter"
              type="number"
              step="0.0001"
              min={0.0001}
              required
              value={pricePerLiter}
              onChange={(event) => setPricePerLiter(event.target.value)}
            />
            <Field
              label="Entra en vigor"
              name="effectiveDate"
              type="date"
              required
              value={effectiveDate}
              onChange={(event) => setEffectiveDate(event.target.value)}
            />
            <Field
              label="Fuente"
              name="source"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder="Resolución, boletín…"
              hint="Opcional, pero permite auditar el dato."
            />
          </div>

          {createPrice.error && (
            <Alert tone="danger">
              {errorMessage(createPrice.error, 'No se pudo guardar el precio.')}
            </Alert>
          )}

          <div className="flex gap-2">
            <Button type="submit" loading={createPrice.isPending}>
              Guardar
            </Button>
            <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {expirePrice.error && (
        <Alert tone="danger" className="mt-3">
          {errorMessage(expirePrice.error, 'No se pudo caducar el precio.')}
        </Alert>
      )}
    </section>
  );
}

// --- Peajes ------------------------------------------------------------------

function TollSection({ canEdit }: { canEdit: boolean }) {
  const [includeInactive, setIncludeInactive] = useState(false);
  const { data: stations, isPending } = useTollStations(includeInactive);
  const createStation = useCreateTollStation();
  const toggleStation = useToggleTollStation();
  const createRate = useCreateTollRate();
  const updateRate = useUpdateTollRate();

  const [isStationFormOpen, setIsStationFormOpen] = useState(false);
  const [station, setStation] = useState({
    name: '',
    latitude: '',
    longitude: '',
    highwayName: '',
    operator: '',
  });
  const [rateDrafts, setRateDrafts] = useState<Record<string, string>>({});

  const handleStationSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    createStation.mutate(
      {
        name: station.name,
        latitude: Number(station.latitude),
        longitude: Number(station.longitude),
        highwayName: station.highwayName,
        operator: station.operator.trim() || null,
      },
      {
        onSuccess: () => {
          setStation({ name: '', latitude: '', longitude: '', highwayName: '', operator: '' });
          setIsStationFormOpen(false);
        },
      },
    );
  };

  /** Tarifa vigente de una estación para una categoría, o null si no hay. */
  function currentRate(rates: { vehicleCategory: TollCategory; expirationDate: string | null }[]) {
    return (category: TollCategory) =>
      rates.find((rate) => rate.vehicleCategory === category && rate.expirationDate === null) ??
      null;
  }

  return (
    <section className="card p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <Receipt className="h-4 w-4 text-content-muted" aria-hidden="true" />
            Peajes y tarifas
          </h2>
          <p className="mt-1 text-sm text-content-muted">
            El importe se aplica según la categoría tarifaria del vehículo. Una estación solo
            se cobra si cae a menos de 500 m del trazado.
          </p>
        </div>
        {canEdit && (
          <Button variant="secondary" onClick={() => setIsStationFormOpen((open) => !open)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Nueva estación
          </Button>
        )}
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm text-content-muted">
        <input
          type="checkbox"
          checked={includeInactive}
          onChange={(event) => setIncludeInactive(event.target.checked)}
          className="h-4 w-4 rounded border-border accent-accent"
        />
        Mostrar también las estaciones dadas de baja
      </label>

      {isStationFormOpen && canEdit && (
        <form
          onSubmit={handleStationSubmit}
          className="mt-3 space-y-3 rounded-lg border border-border p-3"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field
              label="Nombre"
              name="name"
              required
              value={station.name}
              onChange={(event) => setStation((s) => ({ ...s, name: event.target.value }))}
              placeholder="Peaje Los Cauchos"
            />
            <Field
              label="Vía"
              name="highwayName"
              required
              value={station.highwayName}
              onChange={(event) => setStation((s) => ({ ...s, highwayName: event.target.value }))}
              placeholder="Ruta 45"
            />
            <Field
              label="Operador"
              name="operator"
              value={station.operator}
              onChange={(event) => setStation((s) => ({ ...s, operator: event.target.value }))}
            />
            <Field
              label="Latitud"
              name="latitude"
              type="number"
              step="0.000001"
              required
              value={station.latitude}
              onChange={(event) => setStation((s) => ({ ...s, latitude: event.target.value }))}
              hint="Debe caer sobre el trazado real, con 500 m de margen."
            />
            <Field
              label="Longitud"
              name="longitude"
              type="number"
              step="0.000001"
              required
              value={station.longitude}
              onChange={(event) => setStation((s) => ({ ...s, longitude: event.target.value }))}
            />
          </div>

          {createStation.error && (
            <Alert tone="danger">
              {errorMessage(createStation.error, 'No se pudo crear la estación.')}
            </Alert>
          )}

          <div className="flex gap-2">
            <Button type="submit" loading={createStation.isPending}>
              Guardar
            </Button>
            <Button type="button" variant="ghost" onClick={() => setIsStationFormOpen(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {(createRate.error || updateRate.error || toggleStation.error) && (
        <Alert tone="danger" className="mt-3">
          {errorMessage(
            createRate.error ?? updateRate.error ?? toggleStation.error,
            'No se pudo aplicar el cambio.',
          )}
        </Alert>
      )}

      {isPending ? (
        <div className="mt-4">
          <LoadingSpinner label="Cargando estaciones" />
        </div>
      ) : !stations || stations.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="Sin estaciones de peaje"
            description="Da de alta una estación para que sus tarifas entren en el coste de las rutas."
          />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {stations.map((s) => {
            const rateFor = currentRate(s.rates);

            return (
              <article key={s.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium">
                      {s.name}
                      {!s.isActive && <Badge tone="neutral">De baja</Badge>}
                    </p>
                    <p className="text-xs text-content-muted">
                      {s.highwayName}
                      {s.operator && ` · ${s.operator}`} ·{' '}
                      <span className="tabular-nums">
                        {s.location.coordinates[1].toFixed(4)},{' '}
                        {s.location.coordinates[0].toFixed(4)}
                      </span>
                    </p>
                  </div>

                  {canEdit && (
                    <Button
                      variant="ghost"
                      className={cn('text-xs', s.isActive && 'text-danger')}
                      loading={toggleStation.isPending && toggleStation.variables?.id === s.id}
                      onClick={() => toggleStation.mutate({ id: s.id, isActive: !s.isActive })}
                    >
                      {s.isActive ? 'Dar de baja' : 'Reactivar'}
                    </Button>
                  )}
                </div>

                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[520px] text-xs">
                    <thead>
                      <tr className="text-left text-content-muted">
                        <th className="pb-1 font-normal">Categoría</th>
                        {CATEGORIES.map((category) => (
                          <th key={category} className="pb-1 text-right font-normal">
                            {category}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-border">
                        <td className="py-2 text-content-muted">Tarifa vigente</td>
                        {CATEGORIES.map((category) => {
                          const rate = rateFor(category) as
                            | { id: string; rateAmount: number; currency: string }
                            | null;
                          const draftKey = `${s.id}:${category}`;

                          return (
                            <td key={category} className="py-2 text-right tabular-nums">
                              {rate ? (
                                canEdit ? (
                                  <input
                                    type="number"
                                    step="0.01"
                                    min={0.01}
                                    aria-label={`Tarifa categoría ${category} de ${s.name}`}
                                    defaultValue={rate.rateAmount}
                                    onBlur={(event) => {
                                      const value = Number(event.target.value);
                                      if (value > 0 && value !== rate.rateAmount) {
                                        updateRate.mutate({ rateId: rate.id, rateAmount: value });
                                      }
                                    }}
                                    className="input w-24 py-1 text-right text-xs"
                                  />
                                ) : (
                                  formatCurrency(rate.rateAmount, rate.currency)
                                )
                              ) : canEdit ? (
                                <span className="flex items-center justify-end gap-1">
                                  <input
                                    type="number"
                                    step="0.01"
                                    min={0.01}
                                    aria-label={`Nueva tarifa categoría ${category} de ${s.name}`}
                                    placeholder="—"
                                    value={rateDrafts[draftKey] ?? ''}
                                    onChange={(event) =>
                                      setRateDrafts((drafts) => ({
                                        ...drafts,
                                        [draftKey]: event.target.value,
                                      }))
                                    }
                                    className="input w-24 py-1 text-right text-xs"
                                  />
                                  <Button
                                    variant="ghost"
                                    className="px-1.5 py-1 text-xs"
                                    disabled={!Number(rateDrafts[draftKey])}
                                    onClick={() =>
                                      createRate.mutate(
                                        {
                                          stationId: s.id,
                                          vehicleCategory: category,
                                          rateAmount: Number(rateDrafts[draftKey]),
                                          effectiveDate: today(),
                                        },
                                        {
                                          onSuccess: () =>
                                            setRateDrafts((drafts) => ({
                                              ...drafts,
                                              [draftKey]: '',
                                            })),
                                        },
                                      )
                                    }
                                  >
                                    Añadir
                                  </Button>
                                </span>
                              ) : (
                                <span className="text-content-muted">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>

                {CATEGORIES.some((category) => !rateFor(category)) && (
                  // Una estación sin tarifa para una categoría se cuenta como 0 en el
                  // coste: el importe informado saldría por debajo del real.
                  <p className="mt-2 text-xs text-warning">
                    Faltan tarifas para alguna categoría. Los vehículos de esas categorías
                    cruzarán esta estación con coste 0.
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

// --- Página ------------------------------------------------------------------

export default function TariffsPage() {
  const { data: user } = useCurrentUser();
  const canEdit = user?.role === 'admin' || user?.role === 'dispatcher';

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Tarifas</h1>
        <p className="text-sm text-content-muted">
          El coste que informa el sistema es tan bueno como estos datos. El combustible y los
          peajes son el 20% de la puntuación multicriterio.
        </p>
      </div>

      {!canEdit && (
        <Alert tone="info">
          Puedes consultar las tarifas, pero solo un administrador o un gestor de flota puede
          modificarlas.
        </Alert>
      )}

      <FuelSection canEdit={canEdit} />
      <TollSection canEdit={canEdit} />
    </div>
  );
}
