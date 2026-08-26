'use client';

import { useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { EmptyState } from '@/components/common/ui';
import type { CostByRoadType, RoutesOverTime } from '@/lib/types/api.types';
import {
  formatCurrency,
  formatDistance,
  formatNumber,
  ROAD_TYPE_LABELS,
} from '@/lib/utils/format';

const AXIS_STYLE = { fill: 'var(--chart-ink)', fontSize: 11 } as const;

/**
 * Escala secuencial de un solo tono, de mayor a menor magnitud.
 *
 * Las barras comparan tamaño, no identidad: pintarlas con colores categóricos daría a
 * entender que "autopista" y "vía secundaria" son series distintas de un mismo gráfico,
 * cuando lo único que las diferencia es cuánto miden.
 */
const SEQUENTIAL_STEPS = [
  'var(--chart-seq-1)',
  'var(--chart-seq-2)',
  'var(--chart-seq-3)',
  'var(--chart-seq-4)',
];

/** Tooltip con los tokens de la aplicación; el de Recharts viene con estilos fijos claros. */
function ChartTooltip({
  active,
  payload,
  label,
  rows,
}: {
  active?: boolean;
  payload?: { payload: Record<string, unknown> }[];
  label?: string | number;
  rows: (datum: Record<string, unknown>) => { label: string; value: string }[];
}) {
  if (!active || !payload?.length) return null;

  const datum = payload[0].payload;

  return (
    <div className="rounded-lg border border-border bg-[var(--chart-tooltip-bg)] px-3 py-2 text-xs shadow-lg">
      {label !== undefined && <p className="mb-1 font-medium text-content">{label}</p>}
      <dl className="space-y-0.5">
        {rows(datum).map((row) => (
          <div key={row.label} className="flex justify-between gap-4">
            <dt className="text-content-muted">{row.label}</dt>
            <dd className="tabular-nums text-content">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Alternancia gráfica/tabla: los datos deben poder leerse sin depender del color. */
function TableToggle({ isTable, onToggle }: { isTable: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isTable}
      className="text-xs font-medium text-content-muted hover:text-accent"
    >
      {isTable ? 'Ver gráfica' : 'Ver tabla'}
    </button>
  );
}

const shortDay = (iso: string): string => {
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? iso
    : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short' }).format(date);
};

// ---------------------------------------------------------------------------
// Evolución diaria
// ---------------------------------------------------------------------------

/**
 * Distancia recorrida por día.
 *
 * Se representa una única magnitud aunque el endpoint devuelva tres. Rutas, kilómetros
 * y coste tienen escalas completamente distintas, y superponerlas exigiría un segundo
 * eje vertical: dos escalas en un mismo marco hacen que el cruce entre las curvas
 * parezca significativo cuando solo depende de dónde se hayan puesto los ceros. Las
 * otras dos magnitudes viajan en el tooltip, donde se leen como números.
 */
export function RoutesTimelineChart({ data }: { data: RoutesOverTime[] }) {
  const [isTable, setIsTable] = useState(false);

  if (data.length === 0) {
    return <EmptyState title="Sin actividad en el periodo" />;
  }

  const chartData = data.map((point) => ({ ...point, dayLabel: shortDay(point.day) }));

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <p className="text-xs text-content-muted">Distancia por día (km)</p>
        <TableToggle isTable={isTable} onToggle={() => setIsTable((value) => !value)} />
      </div>

      {isTable ? (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface-raised text-left text-content-muted">
              <tr>
                <th scope="col" className="py-1 font-medium">
                  Día
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Rutas
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Distancia
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Coste
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((point) => (
                <tr key={point.day} className="border-t border-border">
                  <td className="py-1">{point.day}</td>
                  <td className="py-1 text-right tabular-nums">{point.routes}</td>
                  <td className="py-1 text-right tabular-nums">
                    {formatNumber(point.distanceKm, 1)}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {formatCurrency(point.totalCost)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
            <defs>
              <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-series)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--chart-series)" stopOpacity={0.02} />
              </linearGradient>
            </defs>

            {/* Solo líneas horizontales: las verticales compiten con los datos sin ayudar a leerlos. */}
            <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />

            <XAxis
              dataKey="dayLabel"
              tick={AXIS_STYLE}
              tickLine={false}
              axisLine={{ stroke: 'var(--chart-axis)' }}
              minTickGap={24}
            />
            <YAxis
              tick={AXIS_STYLE}
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={(value: number) => formatNumber(value, 0)}
            />

            <Tooltip
              cursor={{ stroke: 'var(--chart-axis)', strokeWidth: 1 }}
              content={
                <ChartTooltip
                  rows={(datum) => [
                    { label: 'Rutas', value: String(datum.routes) },
                    { label: 'Distancia', value: formatDistance(Number(datum.distanceKm)) },
                    { label: 'Coste', value: formatCurrency(Number(datum.totalCost)) },
                  ]}
                />
              }
            />

            <Area
              type="monotone"
              dataKey="distanceKm"
              stroke="var(--chart-series)"
              strokeWidth={2}
              fill="url(#areaFill)"
              // Punto visible solo al pasar por encima: marcar los 90 días de una serie
              // larga convierte la línea en una ristra de puntos ilegible.
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--chart-tooltip-bg)' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Distancia por tipo de vía
// ---------------------------------------------------------------------------

export function CostByRoadTypeChart({ data }: { data: CostByRoadType[] }) {
  const [isTable, setIsTable] = useState(false);

  if (data.length === 0) {
    return <EmptyState title="Sin tramos en el periodo" />;
  }

  // Orden descendente: en un gráfico de magnitud, ordenar por valor deja la comparación
  // hecha de antemano y evita que el lector tenga que recorrer las barras midiendo.
  const sorted = [...data].sort((a, b) => b.distanceKm - a.distanceKm);
  const chartData = sorted.map((item) => ({
    ...item,
    label: ROAD_TYPE_LABELS[item.roadType] ?? item.roadType,
  }));

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <p className="text-xs text-content-muted">Kilómetros recorridos por clasificación</p>
        <TableToggle isTable={isTable} onToggle={() => setIsTable((value) => !value)} />
      </div>

      {isTable ? (
        <table className="w-full text-xs">
          <thead className="text-left text-content-muted">
            <tr>
              <th scope="col" className="py-1 font-medium">
                Tipo de vía
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Distancia
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Peajes
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Tramos
              </th>
            </tr>
          </thead>
          <tbody>
            {chartData.map((item) => (
              <tr key={item.roadType} className="border-t border-border">
                <td className="py-1">{item.label}</td>
                <td className="py-1 text-right tabular-nums">
                  {formatNumber(item.distanceKm, 1)}
                </td>
                <td className="py-1 text-right tabular-nums">{formatCurrency(item.tollCost)}</td>
                <td className="py-1 text-right tabular-nums">{item.segments}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 4, right: 16, bottom: 0, left: 8 }}
            barCategoryGap={10}
          >
            <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" horizontal={false} />

            <XAxis
              type="number"
              tick={AXIS_STYLE}
              tickLine={false}
              axisLine={{ stroke: 'var(--chart-axis)' }}
              tickFormatter={(value: number) => formatNumber(value, 0)}
            />
            {/* Etiquetas de categoría en el eje, no dentro de las barras: los nombres
                largos no caben en las barras cortas. */}
            <YAxis
              type="category"
              dataKey="label"
              tick={AXIS_STYLE}
              tickLine={false}
              axisLine={false}
              width={92}
            />

            <Tooltip
              cursor={{ fill: 'var(--chart-grid)', fillOpacity: 0.35 }}
              content={
                <ChartTooltip
                  rows={(datum) => [
                    { label: 'Distancia', value: formatDistance(Number(datum.distanceKm)) },
                    { label: 'Peajes', value: formatCurrency(Number(datum.tollCost)) },
                    { label: 'Tramos', value: String(datum.segments) },
                  ]}
                />
              }
            />

            {/* Extremo redondeado solo en el lado del dato; el que apoya en el eje queda recto. */}
            <Bar dataKey="distanceKm" radius={[0, 4, 4, 0]} maxBarSize={28}>
              {chartData.map((item, index) => (
                <Cell
                  key={item.roadType}
                  fill={SEQUENTIAL_STEPS[Math.min(index, SEQUENTIAL_STEPS.length - 1)]}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
