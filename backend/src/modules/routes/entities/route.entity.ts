import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { RouteStatus } from '@/common/enums';
import { decimal2, decimal4 } from '@/common/transformers/decimal.transformer';
import { GeoJSONPoint } from '@/common/types/geo.types';
import { User } from '@/modules/auth/entities/user.entity';
import { Vehicle } from '@/modules/vehicles/entities/vehicle.entity';

import { RouteSegment } from './route-segment.entity';

/** Geometría de la traza completa de la ruta. */
export interface GeoJSONLineString {
  type: 'LineString';
  coordinates: [number, number][];
}

/**
 * Ruta calculada (RF-005, RF-006).
 *
 * NOTA DE DISEÑO — desviación deliberada de la especificación: las rutas alternativas
 * (RF-004) se modelan con la autorreferencia `parentRouteId` en lugar de la tabla
 * puente `alternative_routes`. La relación entre una ruta y sus alternativas es 1:N,
 * no N:M: una alternativa pertenece a exactamente una ruta principal. Una tabla puente
 * permitiría estados imposibles (una alternativa colgando de dos rutas, o de sí misma)
 * que habría que prohibir con constraints adicionales, y obliga a un JOIN extra en la
 * consulta más frecuente del sistema.
 */
@Entity('routes')
@Check('chk_routes_distance', 'distance_km > 0')
@Check('chk_routes_duration', 'estimated_duration_minutes > 0')
@Check('chk_routes_score', 'optimization_score >= 0 AND optimization_score <= 100')
@Check(
  'chk_routes_alternative_consistency',
  '(parent_route_id IS NULL AND alternative_rank IS NULL) OR ' +
    '(parent_route_id IS NOT NULL AND alternative_rank IS NOT NULL AND alternative_rank > 0)',
)
export class Route {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_routes_user_id')
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Index('idx_routes_vehicle_id')
  @Column({ type: 'uuid', name: 'vehicle_id' })
  vehicleId: string;

  @ManyToOne(() => Vehicle, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'vehicle_id' })
  vehicle: Vehicle;

  // --- Alternativas (RF-004) ------------------------------------------------
  @Index('idx_routes_parent_route_id')
  @Column({ type: 'uuid', name: 'parent_route_id', nullable: true })
  parentRouteId: string | null;

  @ManyToOne(() => Route, (route) => route.alternatives, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parent_route_id' })
  parentRoute: Route | null;

  @OneToMany(() => Route, (route) => route.parentRoute)
  alternatives: Route[];

  @ApiProperty({ required: false, nullable: true, description: '1 = mejor alternativa' })
  @Column({ type: 'smallint', name: 'alternative_rank', nullable: true })
  alternativeRank: number | null;

  // --- Geografía ------------------------------------------------------------
  @Index('idx_routes_origin', { spatial: true })
  @Column({ type: 'geometry', spatialFeatureType: 'Point', srid: 4326, name: 'origin_point' })
  originPoint: GeoJSONPoint;

  @Index('idx_routes_destination', { spatial: true })
  @Column({ type: 'geometry', spatialFeatureType: 'Point', srid: 4326, name: 'destination_point' })
  destinationPoint: GeoJSONPoint;

  /** Traza completa, para poder repintar la ruta sin recalcularla. */
  @Column({
    type: 'geometry',
    spatialFeatureType: 'LineString',
    srid: 4326,
    nullable: true,
  })
  path: GeoJSONLineString | null;

  @ApiProperty({ required: false, nullable: true })
  @Column({ type: 'varchar', length: 255, name: 'origin_address', nullable: true })
  originAddress: string | null;

  @ApiProperty({ required: false, nullable: true })
  @Column({ type: 'varchar', length: 255, name: 'destination_address', nullable: true })
  destinationAddress: string | null;

  // --- Métricas -------------------------------------------------------------
  @ApiProperty({ example: 187.4 })
  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'distance_km', transformer: decimal2 })
  distanceKm: number;

  @ApiProperty({ example: 154 })
  @Column({ type: 'integer', name: 'estimated_duration_minutes' })
  estimatedDurationMinutes: number;

  @ApiProperty({ example: 42.31 })
  @Column({
    type: 'decimal',
    precision: 8,
    scale: 2,
    name: 'fuel_consumption_liters',
    transformer: decimal2,
  })
  fuelConsumptionLiters: number;

  @ApiProperty({ example: 44.43 })
  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'fuel_cost', transformer: decimal2 })
  fuelCost: number;

  /**
   * Precio por litro aplicado al calcular esta ruta.
   *
   * Se congela aquí en lugar de releerlo de la configuración al consultar la ruta: el
   * precio del combustible cambia, y mostrar el de hoy junto a un coste calculado hace
   * un mes daría dos cifras que no cuadran entre sí. Nullable por las rutas anteriores
   * a la migración cuyo consumo fue 0 y no permiten despejarlo.
   */
  @ApiPropertyOptional({ example: 1.05, nullable: true })
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 4,
    name: 'fuel_price_per_liter',
    nullable: true,
    transformer: decimal4,
  })
  fuelPricePerLiter: number | null;

  @ApiProperty({ example: 8.5 })
  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'toll_cost', transformer: decimal2 })
  tollCost: number;

  @ApiProperty({ example: 52.93 })
  @Column({ type: 'decimal', precision: 12, scale: 2, name: 'total_cost', transformer: decimal2 })
  totalCost: number;

  @ApiProperty({ example: 'USD' })
  @Column({ type: 'char', length: 3, default: 'USD' })
  currency: string;

  @ApiProperty({ example: 78.4, description: 'Puntuación multicriterio 0-100' })
  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    name: 'optimization_score',
    transformer: decimal2,
  })
  optimizationScore: number;

  @ApiProperty({ example: 'dijkstra' })
  @Column({ type: 'varchar', length: 30, default: 'dijkstra' })
  algorithm: string;

  @ApiProperty({ enum: RouteStatus })
  @Index('idx_routes_status')
  @Column({
    type: 'enum',
    enum: RouteStatus,
    name: 'route_status',
    default: RouteStatus.Calculated,
  })
  routeStatus: RouteStatus;

  /** Resumen meteorológico agregado de la ruta, para no releer todos los segmentos. */
  @Column({ type: 'jsonb', name: 'weather_summary', nullable: true })
  weatherSummary: Record<string, unknown> | null;

  @ApiProperty({ description: 'Milisegundos que tardó el cálculo (RNF-008: objetivo < 2000)' })
  @Column({ type: 'integer', name: 'computation_time_ms', default: 0 })
  computationTimeMs: number;

  @ApiProperty()
  @Index('idx_routes_created_at')
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => RouteSegment, (segment) => segment.route, { cascade: ['insert'] })
  segments: RouteSegment[];
}
