import { describe, expect, it } from 'vitest';

import {
  formatCoordinates,
  formatCurrency,
  formatDay,
  formatDistance,
  formatDuration,
  formatLiters,
  formatNumber,
} from '@/lib/utils/format';

describe('formatDistance', () => {
  it('muestra metros por debajo de un kilómetro', () => {
    // "0,4 km" se lee peor que "400 m" en una lista de tramos.
    expect(formatDistance(0.4)).toBe('400 m');
    expect(formatDistance(0.05)).toBe('50 m');
  });

  it('muestra kilómetros a partir de uno', () => {
    expect(formatDistance(1)).toContain('km');
    expect(formatDistance(187.42)).toContain('187,4');
  });

  it('devuelve un guion ante valores no finitos', () => {
    expect(formatDistance(Number.NaN)).toBe('—');
    expect(formatDistance(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatDuration', () => {
  it('muestra solo minutos por debajo de una hora', () => {
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(0)).toBe('0 min');
  });

  it('muestra horas y minutos', () => {
    expect(formatDuration(154)).toBe('2 h 34 min');
  });

  it('omite los minutos cuando son cero', () => {
    expect(formatDuration(120)).toBe('2 h');
  });

  it('redondea los minutos fraccionarios', () => {
    expect(formatDuration(59.6)).toBe('1 h');
  });

  it('rechaza valores inválidos', () => {
    expect(formatDuration(-5)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
  });
});

describe('formatCurrency', () => {
  it('incluye el símbolo de la moneda', () => {
    const result = formatCurrency(52.93, 'USD');
    expect(result).toContain('52,93');
    expect(result).toMatch(/\$|USD/);
  });

  it('siempre usa dos decimales', () => {
    expect(formatCurrency(10, 'USD')).toContain('10,00');
  });

  it('devuelve un guion ante valores no finitos', () => {
    expect(formatCurrency(Number.NaN)).toBe('—');
  });
});

describe('formatNumber', () => {
  it('respeta los decimales pedidos', () => {
    expect(formatNumber(78.456, 1)).toBe('78,5');
    expect(formatNumber(78.456, 0)).toBe('78');
  });
});

describe('formatLiters', () => {
  it('añade la unidad', () => {
    expect(formatLiters(42.31)).toBe('42,3 L');
  });
});

describe('formatCoordinates', () => {
  it('usa cuatro decimales, suficientes para unos 11 metros', () => {
    expect(formatCoordinates(2.44981234, -76.61971234)).toBe('2.4498, -76.6197');
  });
});

describe('formatDay', () => {
  it('no retrocede un día en zonas por detrás de Greenwich', () => {
    // `new Date('2025-01-01')` es medianoche UTC; formateada en UTC-5 caería en el
    // 31 de diciembre y una tarifa vigente desde enero parecería del año anterior.
    const formatted = formatDay('2025-01-01');

    expect(formatted).toContain('2025');
    expect(formatted).not.toContain('2024');
  });

  it('conserva el día exacto', () => {
    expect(formatDay('2026-08-27')).toContain('27');
  });

  it('no añade una hora que el dato no tiene', () => {
    expect(formatDay('2026-08-27')).not.toContain(':');
  });

  it('devuelve un guion ante un valor que no es una fecha simple', () => {
    expect(formatDay('2026-08-27T12:00:00Z')).toBe('—');
    expect(formatDay('no es una fecha')).toBe('—');
    expect(formatDay('')).toBe('—');
  });
});
