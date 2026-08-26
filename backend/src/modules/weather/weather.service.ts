import { Inject, Injectable, Logger } from '@nestjs/common';

import { Coordinates, haversineDistanceKm, samplePolyline } from '@/common/types/geo.types';

import { NEUTRAL_WEATHER, WEATHER_PROVIDER, WeatherData, WeatherProvider } from './providers/weather.provider';

export interface WeatherSample {
  coordinates: Coordinates;
  weather: WeatherData;
}

export interface RouteWeather {
  samples: WeatherSample[];
  /** Peor factor de intensidad encontrado a lo largo de la ruta. */
  worstIntensity: number;
  /** Media de los factores, para el resumen que se guarda con la ruta. */
  averageIntensity: number;
  /** Descripciones distintas encontradas, para mostrarlas al usuario. */
  conditions: string[];
  /** true si algún tramo se evaluó sin datos reales por un fallo del proveedor. */
  degraded: boolean;
}

/**
 * Un punto de muestreo cada 25 km. Es el orden de magnitud en el que cambian las
 * condiciones de un frente meteorológico; muestrear más fino multiplica las llamadas
 * a la API sin aportar información nueva.
 */
const SAMPLE_STEP_KM = 25;

/** Umbral de intensidad a partir del cual se emite alerta al usuario. */
export const WEATHER_ALERT_THRESHOLD = 0.3;

@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);

  constructor(@Inject(WEATHER_PROVIDER) private readonly provider: WeatherProvider) {}

  async getWeatherAt(coordinates: Coordinates): Promise<WeatherData> {
    try {
      return await this.provider.getWeather(coordinates);
    } catch (error) {
      this.logger.warn(
        `Sin datos meteorológicos para (${coordinates.latitude}, ${coordinates.longitude}): ` +
          `${(error as Error).message}`,
      );
      return { ...NEUTRAL_WEATHER };
    }
  }

  /**
   * Muestrea el clima a lo largo de una traza (RF-007).
   *
   * Las consultas van en paralelo y los fallos individuales se absorben con condiciones
   * neutras: que el proveedor no responda para un punto no puede impedir el cálculo de
   * la ruta completa (RNF-017).
   */
  async getRouteWeather(geometry: Coordinates[]): Promise<RouteWeather> {
    const points = samplePolyline(geometry, SAMPLE_STEP_KM);

    if (points.length === 0) {
      return {
        samples: [],
        worstIntensity: 0,
        averageIntensity: 0,
        conditions: [],
        degraded: false,
      };
    }

    const results = await Promise.allSettled(
      points.map((point) => this.provider.getWeather(point)),
    );

    let degraded = false;
    const samples: WeatherSample[] = results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return { coordinates: points[index], weather: result.value };
      }

      degraded = true;
      this.logger.warn(
        `Muestra meteorológica ${index} fallida: ${(result.reason as Error)?.message}`,
      );
      return { coordinates: points[index], weather: { ...NEUTRAL_WEATHER } };
    });

    const intensities = samples.map((sample) => sample.weather.intensityFactor);
    const conditions = [...new Set(samples.map((s) => s.weather.description))].filter(
      (description) => description !== NEUTRAL_WEATHER.description,
    );

    return {
      samples,
      worstIntensity: Math.max(...intensities),
      averageIntensity: intensities.reduce((sum, value) => sum + value, 0) / intensities.length,
      conditions,
      degraded,
    };
  }

  /**
   * Clima aplicable a un punto: el de la muestra más cercana.
   *
   * Interpolar entre muestras daría una falsa sensación de precisión — el dato de
   * partida ya es una celda de ~1 km del proveedor.
   */
  nearestSample(samples: WeatherSample[], point: Coordinates): WeatherData {
    if (samples.length === 0) return { ...NEUTRAL_WEATHER };

    let best = samples[0];
    let bestDistance = haversineDistanceKm(best.coordinates, point);

    for (let i = 1; i < samples.length; i += 1) {
      const distance = haversineDistanceKm(samples[i].coordinates, point);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = samples[i];
      }
    }

    return best.weather;
  }
}
