/** Formateadores en es-ES, memoizados: crear un Intl.NumberFormat no es gratis. */
const numberFormatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string | undefined, digits: number): Intl.NumberFormat {
  const key = `${currency ?? 'plain'}:${digits}`;
  let cached = numberFormatters.get(key);

  if (!cached) {
    cached = new Intl.NumberFormat('es-ES', {
      ...(currency ? { style: 'currency', currency } : {}),
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    numberFormatters.set(key, cached);
  }

  return cached;
}

export function formatCurrency(value: number, currency = 'USD'): string {
  if (!Number.isFinite(value)) return '—';
  return formatter(currency, 2).format(value);
}

export function formatNumber(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return formatter(undefined, digits).format(value);
}

export function formatDistance(km: number): string {
  if (!Number.isFinite(km)) return '—';
  // Por debajo de 1 km se muestra en metros: "0,4 km" se lee peor que "400 m".
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${formatNumber(km, 1)} km`;
}

/** Minutos a "2 h 34 min". */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '—';

  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const remaining = total % 60;

  if (hours === 0) return `${remaining} min`;
  if (remaining === 0) return `${hours} h`;
  return `${hours} h ${remaining} min`;
}

export function formatLiters(liters: number): string {
  if (!Number.isFinite(liters)) return '—';
  return `${formatNumber(liters, 1)} L`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

/**
 * Fecha sin hora (`YYYY-MM-DD`), como las de vigencia de tarifas y precios.
 *
 * No se puede usar `formatDate`: `new Date('2025-01-01')` se interpreta como medianoche
 * UTC y, al formatearla en una zona por detrás de Greenwich, retrocede al día anterior —
 * una tarifa vigente desde el 1 de enero aparecería como del 31 de diciembre. Aquí se
 * construye la fecha con los componentes locales, que no admite ese desplazamiento.
 */
export function formatDay(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return '—';

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(date);
}

export function formatCoordinates(latitude: number, longitude: number): string {
  return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
}

/** Etiquetas legibles para los valores de enumerado que llegan del backend. */
export const ROUTE_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  calculated: 'Calculada',
  in_progress: 'En curso',
  completed: 'Completada',
  cancelled: 'Cancelada',
};

export const ROAD_TYPE_LABELS: Record<string, string> = {
  highway: 'Autopista',
  principal: 'Vía principal',
  secondary: 'Vía secundaria',
  tertiary: 'Vía terciaria',
};

export const INCIDENT_TYPE_LABELS: Record<string, string> = {
  accident: 'Accidente',
  construction: 'Obras',
  weather: 'Meteorología',
  restriction: 'Restricción',
  traffic_jam: 'Congestión',
};

export const SEVERITY_LABELS: Record<string, string> = {
  low: 'Leve',
  medium: 'Moderada',
  high: 'Alta',
  critical: 'Crítica',
};

export const FUEL_TYPE_LABELS: Record<string, string> = {
  diesel: 'Diésel',
  gasoline: 'Gasolina',
};

export const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  dispatcher: 'Planificador',
  driver: 'Conductor',
  customer: 'Cliente',
};
