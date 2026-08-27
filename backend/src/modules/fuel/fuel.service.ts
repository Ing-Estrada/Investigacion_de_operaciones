import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AuditAction, FuelType } from '@/common/enums';
import { AuthenticatedUser, RequestWithUser } from '@/common/types/authenticated-user';
import costModelConfig from '@/config/cost-model.config';
import { AuditService } from '@/modules/audit/audit.service';

import { CreateFuelPriceDto, UpdateFuelPriceDto } from './dto/fuel-price.dto';
import { FuelPrice } from './entities/fuel-price.entity';

/** Precio aplicable a un combustible, con su procedencia. */
export interface ResolvedFuelPrice {
  fuelType: FuelType;
  pricePerLiter: number;
  currency: string;
  /** `configured` significa que no hay precio en base de datos y se usó el del entorno. */
  origin: 'database' | 'configured';
  effectiveDate: string | null;
  source: string | null;
}

@Injectable()
export class FuelService {
  private readonly logger = new Logger(FuelService.name);

  constructor(
    @InjectRepository(FuelPrice) private readonly repository: Repository<FuelPrice>,
    @Inject(costModelConfig.KEY) private readonly costConfig: ConfigType<typeof costModelConfig>,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Precio vigente hoy para un combustible.
   *
   * Si no hay ninguna fila aplicable se cae al valor del entorno en lugar de fallar: un
   * sistema recién desplegado, sin datos maestros cargados, tiene que poder calcular
   * rutas. Se registra en el log porque el coste resultante es una estimación con un
   * precio genérico, no el precio real de ese combustible.
   */
  async currentPrice(fuelType: FuelType): Promise<ResolvedFuelPrice> {
    const row = await this.findCurrentRow(fuelType);

    if (!row) {
      this.logger.warn(
        `Sin precio vigente para ${fuelType}; se usa el del entorno ` +
          `(${this.costConfig.fuel.defaultPricePerLiter} ${this.costConfig.fuel.currency}/L).`,
      );

      return {
        fuelType,
        pricePerLiter: this.costConfig.fuel.defaultPricePerLiter,
        currency: this.costConfig.fuel.currency,
        origin: 'configured',
        effectiveDate: null,
        source: null,
      };
    }

    return {
      fuelType,
      pricePerLiter: row.pricePerLiter,
      currency: row.currency,
      origin: 'database',
      effectiveDate: row.effectiveDate,
      source: row.source,
    };
  }

  /** Precio vigente de cada combustible, para pintarlos juntos en la interfaz. */
  async currentPrices(): Promise<ResolvedFuelPrice[]> {
    return Promise.all(Object.values(FuelType).map((type) => this.currentPrice(type)));
  }

  async findAll(fuelType?: FuelType): Promise<FuelPrice[]> {
    return this.repository.find({
      where: fuelType ? { fuelType } : {},
      order: { fuelType: 'ASC', effectiveDate: 'DESC' },
    });
  }

  async create(
    dto: CreateFuelPriceDto,
    user: AuthenticatedUser,
    request: RequestWithUser,
  ): Promise<FuelPrice> {
    this.assertDateOrder(dto.effectiveDate, dto.expirationDate);

    // La restricción UNIQUE (fuel_type, effective_date) ya lo impide en base de datos;
    // comprobarlo antes convierte un 500 por violación de constraint en un 400 legible.
    const clash = await this.repository.findOne({
      where: { fuelType: dto.fuelType, effectiveDate: dto.effectiveDate },
    });
    if (clash) {
      throw new BadRequestException(
        `Ya existe un precio de ${dto.fuelType} con fecha de entrada en vigor ${dto.effectiveDate}.`,
      );
    }

    const saved = await this.repository.save(
      this.repository.create({
        fuelType: dto.fuelType,
        pricePerLiter: dto.pricePerLiter,
        currency: dto.currency ?? this.costConfig.fuel.currency,
        effectiveDate: dto.effectiveDate,
        expirationDate: dto.expirationDate ?? null,
        source: dto.source ?? null,
      }),
    );

    await this.auditService.record({
      action: AuditAction.Create,
      entityType: 'fuel_price',
      entityId: saved.id,
      userId: user.id,
      userEmail: user.email,
      newValues: {
        fuelType: saved.fuelType,
        pricePerLiter: saved.pricePerLiter,
        effectiveDate: saved.effectiveDate,
      },
      ipAddress: this.auditService.extractIp(request),
      userAgent: request.headers['user-agent'] ?? null,
    });

    return saved;
  }

  async update(
    id: string,
    dto: UpdateFuelPriceDto,
    user: AuthenticatedUser,
    request: RequestWithUser,
  ): Promise<FuelPrice> {
    const price = await this.repository.findOne({ where: { id } });
    if (!price) throw new NotFoundException('Precio de combustible no encontrado.');

    const oldValues = {
      pricePerLiter: price.pricePerLiter,
      expirationDate: price.expirationDate,
      source: price.source,
    };

    if (dto.pricePerLiter !== undefined) price.pricePerLiter = dto.pricePerLiter;
    if (dto.expirationDate !== undefined) price.expirationDate = dto.expirationDate;
    if (dto.source !== undefined) price.source = dto.source;

    this.assertDateOrder(price.effectiveDate, price.expirationDate);

    const saved = await this.repository.save(price);

    await this.auditService.record({
      action: AuditAction.Update,
      entityType: 'fuel_price',
      entityId: saved.id,
      userId: user.id,
      userEmail: user.email,
      oldValues,
      newValues: { ...dto },
      ipAddress: this.auditService.extractIp(request),
      userAgent: request.headers['user-agent'] ?? null,
    });

    return saved;
  }

  /**
   * Cierra el precio vigente poniéndole fecha de caducidad.
   *
   * No se borra la fila: un precio que estuvo vigente es la justificación de los costes
   * ya calculados con él, y borrarlo dejaría esas rutas sin explicación.
   */
  async expire(id: string, user: AuthenticatedUser, request: RequestWithUser): Promise<FuelPrice> {
    const today = new Date().toISOString().slice(0, 10);
    return this.update(id, { expirationDate: today }, user, request);
  }

  private async findCurrentRow(fuelType: FuelType): Promise<FuelPrice | null> {
    // `effective_date <= hoy AND (expiration IS NULL OR expiration >= hoy)`, quedándose
    // con la más reciente. Es la misma forma que la tarifa de peaje vigente.
    return this.repository
      .createQueryBuilder('price')
      .where('price.fuel_type = :fuelType', { fuelType })
      .andWhere('price.effective_date <= CURRENT_DATE')
      .andWhere('(price.expiration_date IS NULL OR price.expiration_date >= CURRENT_DATE)')
      .orderBy('price.effective_date', 'DESC')
      .getOne();
  }

  private assertDateOrder(effective: string, expiration: string | null | undefined): void {
    if (expiration && expiration < effective) {
      throw new BadRequestException(
        'La fecha de caducidad no puede ser anterior a la de entrada en vigor.',
      );
    }
  }
}
