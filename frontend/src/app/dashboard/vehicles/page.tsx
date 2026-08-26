'use client';

import { Plus, Truck } from 'lucide-react';
import { useState } from 'react';

import { Alert, Badge, Button, EmptyState, Field, LoadingSpinner } from '@/components/common/ui';
import {
  useCreateVehicle,
  useDeactivateVehicle,
  useVehicleTypes,
  useVehicles,
} from '@/hooks/useVehicles';
import { ApiError } from '@/lib/api/client';
import { formatNumber } from '@/lib/utils/format';

const EMPTY_FORM = {
  plate: '',
  vehicleTypeId: '',
  manufacturer: '',
  model: '',
  year: String(new Date().getFullYear()),
  fuelCapacityLiters: '',
  currentFuelLiters: '',
  customFuelConsumptionLPer100Km: '',
};

export default function VehiclesPage() {
  const { data: vehicles, isPending } = useVehicles();
  const { data: types } = useVehicleTypes();
  const createVehicle = useCreateVehicle();
  const deactivate = useDeactivateVehicle();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const update = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((previous) => ({ ...previous, [field]: event.target.value }));

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    createVehicle.mutate(
      {
        plate: form.plate,
        vehicleTypeId: form.vehicleTypeId,
        manufacturer: form.manufacturer,
        model: form.model,
        year: Number(form.year),
        fuelCapacityLiters: Number(form.fuelCapacityLiters),
        // Los campos opcionales se omiten si están vacíos: enviar `NaN` o cadena vacía
        // haría fallar la validación del backend con un error poco claro.
        ...(form.currentFuelLiters ? { currentFuelLiters: Number(form.currentFuelLiters) } : {}),
        ...(form.customFuelConsumptionLPer100Km
          ? { customFuelConsumptionLPer100Km: Number(form.customFuelConsumptionLPer100Km) }
          : {}),
      },
      {
        onSuccess: () => {
          setForm(EMPTY_FORM);
          setIsFormOpen(false);
        },
      },
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Flota</h1>
          <p className="text-sm text-content-muted">
            El tipo de vehículo determina el consumo base, los límites de circulación y la categoría
            de peaje.
          </p>
        </div>
        <Button onClick={() => setIsFormOpen((open) => !open)} variant="secondary">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Añadir vehículo
        </Button>
      </div>

      {isFormOpen && (
        <form onSubmit={handleSubmit} className="card space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field
              label="Placa"
              name="plate"
              required
              value={form.plate}
              onChange={update('plate')}
              placeholder="ABC-123"
            />

            <div>
              <label htmlFor="vehicleTypeId" className="label">
                Tipo de vehículo
              </label>
              <select
                id="vehicleTypeId"
                required
                value={form.vehicleTypeId}
                onChange={(event) =>
                  setForm((previous) => ({ ...previous, vehicleTypeId: event.target.value }))
                }
                className="input"
              >
                <option value="">Selecciona…</option>
                {(types ?? []).map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name} · {formatNumber(type.avgFuelConsumptionLPer100Km, 1)} L/100 km ·
                    peaje {type.tollCategory}
                  </option>
                ))}
              </select>
            </div>

            <Field
              label="Fabricante"
              name="manufacturer"
              required
              value={form.manufacturer}
              onChange={update('manufacturer')}
            />
            <Field
              label="Modelo"
              name="model"
              required
              value={form.model}
              onChange={update('model')}
            />
            <Field
              label="Año"
              name="year"
              type="number"
              min={1900}
              max={new Date().getFullYear() + 1}
              required
              value={form.year}
              onChange={update('year')}
            />
            <Field
              label="Capacidad del depósito (L)"
              name="fuelCapacityLiters"
              type="number"
              min={1}
              step="0.1"
              required
              value={form.fuelCapacityLiters}
              onChange={update('fuelCapacityLiters')}
            />
            <Field
              label="Combustible actual (L)"
              name="currentFuelLiters"
              type="number"
              min={0}
              step="0.1"
              value={form.currentFuelLiters}
              onChange={update('currentFuelLiters')}
            />
            <Field
              label="Consumo medido (L/100 km)"
              name="customFuelConsumptionLPer100Km"
              type="number"
              min={0.1}
              step="0.1"
              value={form.customFuelConsumptionLPer100Km}
              onChange={update('customFuelConsumptionLPer100Km')}
              hint="Opcional. Si se deja vacío se usa el del tipo de vehículo."
            />
          </div>

          {createVehicle.error && (
            <Alert tone="danger">
              {createVehicle.error instanceof ApiError
                ? createVehicle.error.status === 409
                  ? 'Esa placa ya está registrada.'
                  : createVehicle.error.message
                : 'No se pudo dar de alta el vehículo.'}
            </Alert>
          )}

          <div className="flex gap-2">
            <Button type="submit" loading={createVehicle.isPending}>
              Guardar
            </Button>
            <Button type="button" variant="ghost" onClick={() => setIsFormOpen(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {isPending ? (
        <LoadingSpinner label="Cargando la flota" />
      ) : !vehicles || vehicles.length === 0 ? (
        <EmptyState
          title="Sin vehículos"
          description="Da de alta al menos un vehículo para poder calcular rutas."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {vehicles.map((vehicle) => (
            <article key={vehicle.id} className="card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-semibold">
                    <Truck className="h-4 w-4 text-content-muted" aria-hidden="true" />
                    {vehicle.plate}
                  </p>
                  <p className="truncate text-sm text-content-muted">
                    {vehicle.manufacturer} {vehicle.model} · {vehicle.year}
                  </p>
                </div>
                <Badge tone={vehicle.isActive ? 'success' : 'neutral'}>
                  {vehicle.isActive ? 'Activo' : 'De baja'}
                </Badge>
              </div>

              <dl className="mt-3 space-y-1 text-xs">
                <div className="flex justify-between">
                  <dt className="text-content-muted">Tipo</dt>
                  <dd className="text-right">{vehicle.vehicleType.name}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-content-muted">Consumo</dt>
                  <dd className="tabular-nums">
                    {formatNumber(
                      vehicle.customFuelConsumptionLPer100Km ??
                        vehicle.vehicleType.avgFuelConsumptionLPer100Km,
                      1,
                    )}{' '}
                    L/100 km
                    {vehicle.customFuelConsumptionLPer100Km !== null && (
                      <span className="ml-1 text-content-muted">(medido)</span>
                    )}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-content-muted">Depósito</dt>
                  <dd className="tabular-nums">
                    {formatNumber(vehicle.currentFuelLiters, 0)} /{' '}
                    {formatNumber(vehicle.fuelCapacityLiters, 0)} L
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-content-muted">Categoría de peaje</dt>
                  <dd>{vehicle.vehicleType.tollCategory}</dd>
                </div>
              </dl>

              {vehicle.isActive && (
                <Button
                  variant="ghost"
                  className="mt-3 w-full text-danger"
                  loading={deactivate.isPending && deactivate.variables === vehicle.id}
                  onClick={() => deactivate.mutate(vehicle.id)}
                >
                  Dar de baja
                </Button>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
