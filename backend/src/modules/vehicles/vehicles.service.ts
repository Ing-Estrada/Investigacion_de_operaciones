import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AuditAction, Role } from '@/common/enums';
import { VehicleRestrictionException } from '@/common/exceptions/domain.exceptions';
import { AuthenticatedUser, RequestWithUser } from '@/common/types/authenticated-user';
import { AuditService } from '@/modules/audit/audit.service';
import { RoadEdge } from '@/modules/routes/algorithms/graph.model';

import { CreateVehicleDto, UpdateVehicleDto } from './dto/vehicle.dto';
import { VehicleType } from './entities/vehicle-type.entity';
import { Vehicle } from './entities/vehicle.entity';

@Injectable()
export class VehiclesService {
  constructor(
    @InjectRepository(Vehicle) private readonly vehicleRepository: Repository<Vehicle>,
    @InjectRepository(VehicleType) private readonly typeRepository: Repository<VehicleType>,
    private readonly auditService: AuditService,
  ) {}

  /** Catálogo de tipos de vehículo (RF-012). */
  async findAllTypes(): Promise<VehicleType[]> {
    return this.typeRepository.find({ order: { maxWeightKg: 'ASC' } });
  }

  async findAllForUser(user: AuthenticatedUser): Promise<Vehicle[]> {
    // Dispatcher y admin necesitan ver toda la flota para asignar rutas; el resto solo la suya.
    const canSeeAll = user.role === Role.Admin || user.role === Role.Dispatcher;

    return this.vehicleRepository.find({
      where: canSeeAll ? {} : { userId: user.id },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Recupera un vehículo comprobando la propiedad.
   *
   * Si no se comprueba aquí, cualquier usuario autenticado podría calcular rutas —y ver
   * los datos— de vehículos ajenos con solo probar UUIDs. Es la vulnerabilidad de
   * control de acceso a nivel de objeto (OWASP A01).
   */
  async findOneForUser(id: string, user: AuthenticatedUser): Promise<Vehicle> {
    const vehicle = await this.vehicleRepository.findOne({ where: { id } });
    if (!vehicle) throw new NotFoundException('Vehículo no encontrado.');

    const canSeeAll = user.role === Role.Admin || user.role === Role.Dispatcher;
    if (!canSeeAll && vehicle.userId !== user.id) {
      // 404 y no 403: responder 403 confirmaría que ese id existe.
      throw new NotFoundException('Vehículo no encontrado.');
    }

    return vehicle;
  }

  async create(
    dto: CreateVehicleDto,
    user: AuthenticatedUser,
    request: RequestWithUser,
  ): Promise<Vehicle> {
    const vehicleType = await this.typeRepository.findOne({ where: { id: dto.vehicleTypeId } });
    if (!vehicleType) {
      throw new BadRequestException('El tipo de vehículo indicado no existe.');
    }

    const currentFuel = dto.currentFuelLiters ?? 0;
    if (currentFuel > dto.fuelCapacityLiters) {
      throw new BadRequestException(
        'El combustible actual no puede superar la capacidad del depósito.',
      );
    }

    const vehicle = this.vehicleRepository.create({
      userId: user.id,
      vehicleTypeId: dto.vehicleTypeId,
      plate: dto.plate,
      manufacturer: dto.manufacturer,
      model: dto.model,
      year: dto.year,
      fuelCapacityLiters: dto.fuelCapacityLiters,
      currentFuelLiters: currentFuel,
      customFuelConsumptionLPer100Km: dto.customFuelConsumptionLPer100Km ?? null,
    });

    const saved = await this.vehicleRepository.save(vehicle);

    await this.auditService.record({
      action: AuditAction.Create,
      entityType: 'vehicle',
      entityId: saved.id,
      userId: user.id,
      userEmail: user.email,
      newValues: { plate: saved.plate, vehicleTypeId: saved.vehicleTypeId },
      ipAddress: this.auditService.extractIp(request),
      userAgent: request.headers['user-agent'] ?? null,
    });

    return this.findOneForUser(saved.id, user);
  }

  async update(
    id: string,
    dto: UpdateVehicleDto,
    user: AuthenticatedUser,
    request: RequestWithUser,
  ): Promise<Vehicle> {
    const vehicle = await this.findOneForUser(id, user);

    if (vehicle.userId !== user.id && user.role !== Role.Admin) {
      throw new ForbiddenException('Solo el propietario o un administrador pueden modificarlo.');
    }

    const oldValues = {
      currentFuelLiters: vehicle.currentFuelLiters,
      customFuelConsumptionLPer100Km: vehicle.customFuelConsumptionLPer100Km,
      isActive: vehicle.isActive,
    };

    if (dto.currentFuelLiters !== undefined) {
      if (dto.currentFuelLiters > vehicle.fuelCapacityLiters) {
        throw new BadRequestException(
          'El combustible actual no puede superar la capacidad del depósito.',
        );
      }
      vehicle.currentFuelLiters = dto.currentFuelLiters;
    }

    if (dto.customFuelConsumptionLPer100Km !== undefined) {
      vehicle.customFuelConsumptionLPer100Km = dto.customFuelConsumptionLPer100Km;
    }

    if (dto.isActive !== undefined) vehicle.isActive = dto.isActive;

    const saved = await this.vehicleRepository.save(vehicle);

    await this.auditService.record({
      action: AuditAction.Update,
      entityType: 'vehicle',
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

  /** Baja lógica: las rutas históricas mantienen la referencia al vehículo. */
  async deactivate(id: string, user: AuthenticatedUser, request: RequestWithUser): Promise<void> {
    const vehicle = await this.findOneForUser(id, user);

    if (vehicle.userId !== user.id && user.role !== Role.Admin) {
      throw new ForbiddenException('Solo el propietario o un administrador pueden darlo de baja.');
    }

    vehicle.isActive = false;
    await this.vehicleRepository.save(vehicle);

    await this.auditService.record({
      action: AuditAction.Delete,
      entityType: 'vehicle',
      entityId: vehicle.id,
      userId: user.id,
      userEmail: user.email,
      oldValues: { isActive: true },
      newValues: { isActive: false },
      ipAddress: this.auditService.extractIp(request),
      userAgent: request.headers['user-agent'] ?? null,
    });
  }

  /**
   * Comprueba que el vehículo puede circular por todos los tramos de una ruta (RF-014).
   *
   * Solo se evalúan los tramos que tienen restricción declarada en nuestros datos: la
   * ausencia de restricción se interpreta como "sin límite conocido", no como "sin
   * límite". La diferencia importa — este método no sustituye a la señalización real.
   */
  assertCanTraverse(vehicle: Vehicle, edges: RoadEdge[]): void {
    const type = vehicle.vehicleType;
    const violations: string[] = [];

    for (const edge of edges) {
      if (edge.maxHeightMeters != null && type.maxHeightMeters > edge.maxHeightMeters) {
        violations.push(
          `${edge.roadName ?? edge.id}: gálibo ${edge.maxHeightMeters} m < ` +
            `altura del vehículo ${type.maxHeightMeters} m`,
        );
      }

      if (edge.maxWeightKg != null && type.maxWeightKg > edge.maxWeightKg) {
        violations.push(
          `${edge.roadName ?? edge.id}: límite ${edge.maxWeightKg} kg < ` +
            `peso del vehículo ${type.maxWeightKg} kg`,
        );
      }
    }

    if (violations.length > 0) {
      throw new VehicleRestrictionException(
        'La ruta calculada tiene tramos por los que este vehículo no puede circular.',
        // Se limita la lista: en una ruta muy restringida la respuesta sería enorme.
        violations.slice(0, 10),
      );
    }
  }
}
