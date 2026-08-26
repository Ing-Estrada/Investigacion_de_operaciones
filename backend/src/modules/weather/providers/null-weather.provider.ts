import { Injectable } from '@nestjs/common';

import { NEUTRAL_WEATHER, WeatherData, WeatherProvider } from './weather.provider';

/**
 * Proveedor nulo (patrón Null Object) para cuando `WEATHER_PROVIDER=none`, típicamente
 * en tests y en entornos sin clave de API.
 *
 * Devuelve condiciones neutras con factor 0 en lugar de lanzar. Así el resto del sistema
 * no necesita ramas del tipo `if (weatherService)`: la ruta se calcula igual, sin el
 * ajuste meteorológico.
 */
@Injectable()
export class NullWeatherProvider implements WeatherProvider {
  readonly name = 'none';

  async getWeather(): Promise<WeatherData> {
    return { ...NEUTRAL_WEATHER };
  }
}
