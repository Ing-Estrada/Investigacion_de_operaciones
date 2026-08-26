import { registerAs } from '@nestjs/config';

/**
 * Pesos del modelo multicriterio (RF-003). Suman 1.0 y la suma se verifica al arrancar.
 * Origen de los pesos: la especificación funcional del sistema.
 */
export interface CostModelConfig {
  weights: {
    distance: number;
    time: number;
    cost: number;
    risk: number;
  };
  /**
   * Escalas de normalización para el scoring 0-100. Una ruta que iguala la escala
   * obtiene 0 puntos en ese criterio; una de coste cero obtiene 100.
   */
  normalization: {
    distanceKm: number;
    timeMinutes: number;
    costUnits: number;
  };
  fuel: {
    defaultPricePerLiter: number;
    currency: string;
  };
  /** Velocidad de respaldo por tipo de vía cuando el proveedor no reporta duración. */
  fallbackSpeedKmh: Record<string, number>;
}

export default registerAs<CostModelConfig>('costModel', () => ({
  weights: {
    distance: 0.4,
    time: 0.3,
    cost: 0.2,
    risk: 0.1,
  },
  normalization: {
    distanceKm: 1000,
    timeMinutes: 1200,
    costUnits: 500,
  },
  fuel: {
    defaultPricePerLiter: Number(process.env.DEFAULT_FUEL_PRICE_PER_LITER ?? 1.05),
    currency: process.env.DEFAULT_CURRENCY ?? 'USD',
  },
  fallbackSpeedKmh: {
    highway: 90,
    principal: 70,
    secondary: 50,
    tertiary: 35,
  },
}));
