import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  HealthIndicatorResult,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';

import { Public } from '@/common/decorators';
import { ResilientHttpService } from '@/external-services/resilient-http.service';
import { RedisService } from '@/infrastructure/redis/redis.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: TypeOrmHealthIndicator,
    private readonly redis: RedisService,
    private readonly http: ResilientHttpService,
  ) {}

  /**
   * Sonda de disponibilidad para el orquestador.
   *
   * Solo la base de datos es crítica: sin ella no se puede autenticar ni persistir nada.
   * Redis se reporta pero no tumba el check — la aplicación funciona sin caché, y
   * marcar el contenedor como no sano por eso provocaría un reinicio en bucle que
   * empeora justo el problema que se pretende señalar.
   */
  @Public()
  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Estado del servicio y sus dependencias' })
  async check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.database.pingCheck('database', { timeout: 3000 }),
      () => this.checkRedis(),
      () => this.checkProviders(),
    ]);
  }

  /** Liveness: el proceso responde. No consulta dependencias. */
  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  live(): { status: string; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  private async checkRedis(): Promise<HealthIndicatorResult> {
    const available = this.redis.isAvailable;
    return {
      redis: {
        status: 'up',
        connected: available,
        // Se marca 'up' siempre a propósito: es información, no un criterio de salud.
        note: available ? undefined : 'Sin caché distribuida; el servicio opera degradado.',
      },
    };
  }

  private async checkProviders(): Promise<HealthIndicatorResult> {
    return {
      externalProviders: {
        status: 'up',
        circuits: this.http.circuitSnapshot(),
      },
    };
  }
}
