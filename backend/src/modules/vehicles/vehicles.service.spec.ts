import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { AuditAction, Role, RoadType } from '@/common/enums';
import { VehicleRestrictionException } from '@/common/exceptions/domain.exceptions';
import { AuthenticatedUser, RequestWithUser } from '@/common/types/authenticated-user';
import { AuditService } from '@/modules/audit/audit.service';
import { RoadEdge } from '@/modules/routes/algorithms/graph.model';

import { VehicleType } from './entities/vehicle-type.entity';
import { Vehicle } from './entities/vehicle.entity';
import { VehiclesService } from './vehicles.service';

const REQUEST = {
  headers: { 'user-agent': 'jest' },
} as unknown as RequestWithUser;

function makeAuthUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'user-1',
    email: 'operador@example.com',
    role: Role.Customer,
    ...overrides,
  } as AuthenticatedUser;
}

function makeType(overrides: Partial<VehicleType> = {}): VehicleType {
  return {
    id: 'type-1',
    name: 'Tractocamión 5 ejes',
    axles: 5,
    maxWeightKg: 48_000,
    maxHeightMeters: 4.1,
    maxWidthMeters: 2.6,
    avgFuelConsumptionLPer100Km: 35,
    ...overrides,
  } as VehicleType;
}

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 'vehicle-1',
    userId: 'user-1',
    vehicleTypeId: 'type-1',
    vehicleType: makeType(),
    plate: 'ABC-123',
    manufacturer: 'Kenworth',
    model: 'T680',
    year: 2024,
    currentFuelLiters: 100,
    fuelCapacityLiters: 400,
    customFuelConsumptionLPer100Km: null,
    isActive: true,
    ...overrides,
  } as Vehicle;
}

function makeEdge(overrides: Partial<RoadEdge> = {}): RoadEdge {
  return {
    id: 'edge-1',
    from: 'A',
    to: 'B',
    distanceKm: 10,
    baseDurationMinutes: 8,
    roadType: RoadType.Principal,
    roadName: 'Vía A-B',
    tollCost: 0,
    weatherIntensity: 0,
    riskFactor: 0,
    geometry: [],
    ...overrides,
  } as RoadEdge;
}

/** Ejecuta la comprobación y devuelve la lista de restricciones incumplidas. */
function captureRestrictions(run: () => void): string[] {
  try {
    run();
  } catch (error) {
    return (error as VehicleRestrictionException).restrictions;
  }
  throw new Error('Se esperaba VehicleRestrictionException y no se lanzó ninguna.');
}

const CREATE_DTO = {
  plate: 'XYZ-987',
  vehicleTypeId: 'type-1',
  manufacturer: 'Volvo',
  model: 'FH16',
  year: 2023,
  fuelCapacityLiters: 400,
};

describe('VehiclesService', () => {
  let service: VehiclesService;
  // `jest.Mock` en vez de `jest.Mocked<Repository>`: los métodos de TypeORM están
  // sobrecargados y reproducir sus firmas en un doble no aporta seguridad al test.
  let vehicleRepository: { find: jest.Mock; findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let typeRepository: { find: jest.Mock; findOne: jest.Mock };
  let auditService: { record: jest.Mock; extractIp: jest.Mock };

  beforeEach(() => {
    vehicleRepository = {
      find: jest.fn(async () => []),
      findOne: jest.fn(async () => makeVehicle()),
      create: jest.fn((entity: Partial<Vehicle>) => entity as Vehicle),
      save: jest.fn(async (entity: Partial<Vehicle>) => ({ id: 'vehicle-1', ...entity }) as Vehicle),
    };

    typeRepository = {
      find: jest.fn(async () => [makeType()]),
      findOne: jest.fn(async () => makeType()),
    };

    auditService = {
      record: jest.fn(async () => undefined),
      extractIp: jest.fn(() => '203.0.113.5'),
    };

    service = new VehiclesService(
      vehicleRepository as unknown as Repository<Vehicle>,
      typeRepository as unknown as Repository<VehicleType>,
      auditService as unknown as AuditService,
    );
  });

  describe('findAllTypes', () => {
    it('devuelve el catálogo ordenado por peso máximo ascendente', async () => {
      await service.findAllTypes();

      expect(typeRepository.find).toHaveBeenCalledWith({ order: { maxWeightKg: 'ASC' } });
    });
  });

  describe('findAllForUser', () => {
    it('filtra por propietario a un cliente', async () => {
      await service.findAllForUser(makeAuthUser({ role: Role.Customer }));

      expect(vehicleRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1' } }),
      );
    });

    it('filtra por propietario a un conductor', async () => {
      await service.findAllForUser(makeAuthUser({ role: Role.Driver }));

      expect(vehicleRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1' } }),
      );
    });

    it.each([Role.Admin, Role.Dispatcher])('no filtra a un %s: ve toda la flota', async (role) => {
      await service.findAllForUser(makeAuthUser({ role }));

      expect(vehicleRepository.find).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    });
  });

  describe('findOneForUser', () => {
    it('devuelve el vehículo propio', async () => {
      const vehicle = await service.findOneForUser('vehicle-1', makeAuthUser());

      expect(vehicle.id).toBe('vehicle-1');
    });

    it('responde 404 si el vehículo no existe', async () => {
      vehicleRepository.findOne.mockResolvedValue(null);

      await expect(service.findOneForUser('inexistente', makeAuthUser())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('responde 404 —y no 403— ante un vehículo ajeno', async () => {
      // Un 403 confirmaría que ese id existe y permitiría enumerar la flota ajena
      // probando UUIDs (OWASP A01, control de acceso a nivel de objeto).
      vehicleRepository.findOne.mockResolvedValue(makeVehicle({ userId: 'otro-usuario' }));

      await expect(service.findOneForUser('vehicle-1', makeAuthUser())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it.each([Role.Admin, Role.Dispatcher])('permite a un %s ver un vehículo ajeno', async (role) => {
      vehicleRepository.findOne.mockResolvedValue(makeVehicle({ userId: 'otro-usuario' }));

      await expect(
        service.findOneForUser('vehicle-1', makeAuthUser({ role })),
      ).resolves.toMatchObject({ id: 'vehicle-1' });
    });
  });

  describe('create', () => {
    it('asigna el vehículo al usuario autenticado', async () => {
      await service.create(CREATE_DTO, makeAuthUser(), REQUEST);

      expect(vehicleRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', plate: 'XYZ-987' }),
      );
    });

    it('rechaza un tipo de vehículo inexistente', async () => {
      typeRepository.findOne.mockResolvedValue(null);

      await expect(service.create(CREATE_DTO, makeAuthUser(), REQUEST)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(vehicleRepository.save).not.toHaveBeenCalled();
    });

    it('rechaza un depósito con más combustible del que cabe', async () => {
      await expect(
        service.create(
          { ...CREATE_DTO, currentFuelLiters: 500 },
          makeAuthUser(),
          REQUEST,
        ),
      ).rejects.toThrow('El combustible actual no puede superar la capacidad del depósito.');
    });

    it('admite el depósito exactamente lleno', async () => {
      await expect(
        service.create({ ...CREATE_DTO, currentFuelLiters: 400 }, makeAuthUser(), REQUEST),
      ).resolves.toBeDefined();
    });

    it('deja el consumo personalizado a null si no se indica', async () => {
      await service.create(CREATE_DTO, makeAuthUser(), REQUEST);

      expect(vehicleRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ customFuelConsumptionLPer100Km: null, currentFuelLiters: 0 }),
      );
    });

    it('registra el alta en auditoría', async () => {
      await service.create(CREATE_DTO, makeAuthUser(), REQUEST);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.Create,
          entityType: 'vehicle',
          userId: 'user-1',
        }),
      );
    });
  });

  describe('update', () => {
    it('actualiza los campos indicados y deja el resto intactos', async () => {
      vehicleRepository.findOne.mockResolvedValue(
        makeVehicle({ currentFuelLiters: 100, isActive: true }),
      );

      const updated = await service.update(
        'vehicle-1',
        { currentFuelLiters: 250 },
        makeAuthUser(),
        REQUEST,
      );

      expect(updated.currentFuelLiters).toBe(250);
      expect(updated.isActive).toBe(true);
    });

    it('rechaza superar la capacidad del depósito', async () => {
      await expect(
        service.update('vehicle-1', { currentFuelLiters: 401 }, makeAuthUser(), REQUEST),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('permite poner el consumo personalizado a null para volver al del catálogo', async () => {
      const updated = await service.update(
        'vehicle-1',
        { customFuelConsumptionLPer100Km: null },
        makeAuthUser(),
        REQUEST,
      );

      expect(updated.customFuelConsumptionLPer100Km).toBeNull();
    });

    it('prohíbe a un dispatcher modificar un vehículo ajeno aunque pueda verlo', async () => {
      // Ver toda la flota (para asignar rutas) no implica poder alterarla.
      vehicleRepository.findOne.mockResolvedValue(makeVehicle({ userId: 'otro-usuario' }));

      await expect(
        service.update(
          'vehicle-1',
          { isActive: false },
          makeAuthUser({ role: Role.Dispatcher }),
          REQUEST,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('permite a un admin modificar un vehículo ajeno', async () => {
      vehicleRepository.findOne.mockResolvedValue(makeVehicle({ userId: 'otro-usuario' }));

      await expect(
        service.update('vehicle-1', { isActive: false }, makeAuthUser({ role: Role.Admin }), REQUEST),
      ).resolves.toMatchObject({ isActive: false });
    });

    it('audita el cambio con los valores anteriores', async () => {
      vehicleRepository.findOne.mockResolvedValue(makeVehicle({ currentFuelLiters: 100 }));

      await service.update('vehicle-1', { currentFuelLiters: 250 }, makeAuthUser(), REQUEST);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.Update,
          oldValues: expect.objectContaining({ currentFuelLiters: 100 }),
          newValues: expect.objectContaining({ currentFuelLiters: 250 }),
        }),
      );
    });
  });

  describe('deactivate', () => {
    it('da de baja lógicamente sin borrar la fila', async () => {
      await service.deactivate('vehicle-1', makeAuthUser(), REQUEST);

      // Baja lógica: las rutas históricas conservan la referencia al vehículo.
      expect(vehicleRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'vehicle-1', isActive: false }),
      );
    });

    it('prohíbe la baja a quien no es propietario ni admin', async () => {
      vehicleRepository.findOne.mockResolvedValue(makeVehicle({ userId: 'otro-usuario' }));

      await expect(
        service.deactivate('vehicle-1', makeAuthUser({ role: Role.Dispatcher }), REQUEST),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('registra la baja en auditoría', async () => {
      await service.deactivate('vehicle-1', makeAuthUser(), REQUEST);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.Delete, entityType: 'vehicle' }),
      );
    });
  });

  describe('assertCanTraverse (RF-014)', () => {
    const vehicle = makeVehicle({ vehicleType: makeType({ maxHeightMeters: 4.1, maxWeightKg: 48_000 }) });

    it('acepta una ruta sin restricciones declaradas', () => {
      expect(() => service.assertCanTraverse(vehicle, [makeEdge(), makeEdge()])).not.toThrow();
    });

    it('acepta un tramo cuyo límite iguala exactamente la cota del vehículo', () => {
      const edges = [makeEdge({ maxHeightMeters: 4.1, maxWeightKg: 48_000 })];

      expect(() => service.assertCanTraverse(vehicle, edges)).not.toThrow();
    });

    it('rechaza un gálibo insuficiente', () => {
      const edges = [makeEdge({ maxHeightMeters: 3.5, roadName: 'Túnel del Sur' })];

      expect(() => service.assertCanTraverse(vehicle, edges)).toThrow(VehicleRestrictionException);
    });

    it('rechaza un límite de peso insuficiente', () => {
      const edges = [makeEdge({ maxWeightKg: 20_000, roadName: 'Puente viejo' })];

      expect(() => service.assertCanTraverse(vehicle, edges)).toThrow(VehicleRestrictionException);
    });

    it('nombra el tramo y ambas magnitudes en la violación', () => {
      const edges = [makeEdge({ maxHeightMeters: 3.5, maxWeightKg: 20_000, roadName: 'Puente viejo' })];

      try {
        service.assertCanTraverse(vehicle, edges);
        fail('Debería haber lanzado VehicleRestrictionException');
      } catch (error) {
        const violations = (error as VehicleRestrictionException).getResponse() as {
          violations: string[];
        };
        expect(violations.violations).toHaveLength(2);
        expect(violations.violations[0]).toContain('Puente viejo');
        expect(violations.violations[0]).toContain('4.1');
      }
    });

    it('cae al identificador del arco si el tramo no tiene nombre', () => {
      const edges = [makeEdge({ maxHeightMeters: 3, roadName: undefined, id: 'edge-42' })];

      try {
        service.assertCanTraverse(vehicle, edges);
        fail('Debería haber lanzado VehicleRestrictionException');
      } catch (error) {
        const response = (error as VehicleRestrictionException).getResponse() as {
          violations: string[];
        };
        expect(response.violations[0]).toContain('edge-42');
      }
    });

    it('limita la lista a 10 violaciones', () => {
      // Una ruta larga con restricción en cada tramo generaría una respuesta enorme.
      const edges = Array.from({ length: 40 }, (_, index) =>
        makeEdge({ id: `edge-${index}`, maxHeightMeters: 3 }),
      );

      try {
        service.assertCanTraverse(vehicle, edges);
        fail('Debería haber lanzado VehicleRestrictionException');
      } catch (error) {
        const response = (error as VehicleRestrictionException).getResponse() as {
          violations: string[];
        };
        expect(response.violations).toHaveLength(10);
      }
    });

    it('ignora los tramos sin restricción declarada en lugar de suponerlos libres', () => {
      // Ausencia de dato es "límite desconocido", no "sin límite": el tramo no se
      // evalúa, pero tampoco se da por transitable en el mensaje de error.
      const edges = [makeEdge({ maxHeightMeters: null, maxWeightKg: null })];

      expect(() => service.assertCanTraverse(vehicle, edges)).not.toThrow();
    });
  });
});
