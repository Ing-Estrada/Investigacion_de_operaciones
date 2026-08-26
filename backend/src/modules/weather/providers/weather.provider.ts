import { Coordinates } from '@/common/types/geo.types';

export interface WeatherData {
  temperatureCelsius: number;
  description: string;
  windSpeedKmh: number;
  humidityPercent: number;
  /** Precipitación de la última hora, en mm. */
  rainMmLastHour: number;
  visibilityMeters: number;
  cloudsPercent: number;
  /**
   * Factor 0-1 que resume el impacto de estas condiciones sobre consumo y tiempo.
   * 0 = condiciones ideales; 1 = lo peor que el modelo contempla.
   */
  intensityFactor: number;
}

export interface WeatherProvider {
  readonly name: string;
  getWeather(coordinates: Coordinates): Promise<WeatherData>;
}

export const WEATHER_PROVIDER = Symbol('WEATHER_PROVIDER');

/** Condiciones neutras: se usan cuando no hay proveedor de clima configurado. */
export const NEUTRAL_WEATHER: WeatherData = {
  temperatureCelsius: 20,
  description: 'sin datos',
  windSpeedKmh: 0,
  humidityPercent: 50,
  rainMmLastHour: 0,
  visibilityMeters: 10_000,
  cloudsPercent: 0,
  intensityFactor: 0,
};
