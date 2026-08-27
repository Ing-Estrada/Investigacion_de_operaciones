import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Repository } from 'typeorm';

import { AuditAction, FuelType } from '@/common/enums';
import { AuthenticatedUser, RequestWithUser } from '@/common/types/authenticated-user';
import costModelConfig from '@/config/cost-model.config';
import { AuditService } from '@/modules/audit/audit.service';

import { FuelPrice } from './entities/fuel-price.entity';
import { FuelService } from './fuel.service';

const CONFIG = {
  fuel: { defaultPricePerLiter: 1.05, currency: 'USD' },
} as unknown as ConfigType<typeof costModelConfig>;

const USER = { id: 'user-1', email: 'admin@example.com' } as AuthenticatedUser;
const REQUEST = { headers: { 'user-agent': 'jest' } } as unknown as RequestWithUser;

function makePrice(overrides: Partial<FuelPrice> = {}): FuelPrice {
  return {
    id: 'price-1',
    fuelType: FuelType.Diesel,
    pricePerLiter: 1.2345,
    currency: 'USD',
    effectiveDate: '2026-01-01',
    expirationDate: null,
    source: 'Boletín oficial',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as FuelPrice;
}

describe('FuelService', () => {
  let service: FuelService;
  // `jest.Mock` en vez de `jest.Mocked<Repository>`: los métodos de TypeORM están
  // sobrecargados y reproducir sus firmas en un doble no aporta seguridad al test.
  let repository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let auditService: { record: jest.Mock; extractIp: jest.Mock };
  let currentRow: FuelPrice | null;

  beforeEach(() => {
    currentRow = makePrice();

    repository = {
      find: jest.fn(async () => []),
      findOne: jest.fn(async () => null),
      create: jest.fn((entity: Partial<FuelPrice>) => entity as FuelPrice),
      save: jest.fn(async (entity: Partial<FuelPrice>) => ({ id: 'price-1', ...entity })),
      // El builder solo tiene que devolver la fila que decida cada test: lo que se
      // verifica aquí es la decisión del servicio, no el SQL, que cubren los e2e.
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getOne: jest.fn(async () => currentRow),
      })),
    };

    auditService = {
      record: jest.fn(async () => undefined),
      extractIp: jest.fn(() => '203.0.113.5'),
    };

    service = new FuelService(
      repository as unknown as Repository<FuelPrice>,
      CONFIG,
      auditService as unknown as AuditService,
    );
  });

  describe('currentPrice', () => {
    it('devuelve el precio cargado en base de datos', async () => {
      const price = await service.currentPrice(FuelType.Diesel);

      expect(price.pricePerLiter).toBe(1.2345);
      expect(price.origin).toBe('database');
      expect(price.effectiveDate).toBe('2026-01-01');
      expect(price.source).toBe('Boletín oficial');
    });

    it('cae al precio del entorno si no hay ninguno vigente', async () => {
      // Un sistema recién desplegado, sin datos maestros, tiene que poder calcular
      // rutas; fallar aquí lo dejaría inservible hasta cargar precios.
      currentRow = null;

      const price = await service.currentPrice(FuelType.Gasoline);

      expect(price.pricePerLiter).toBe(1.05);
      expect(price.currency).toBe('USD');
      expect(price.origin).toBe('configured');
      expect(price.effectiveDate).toBeNull();
    });

    it('marca el origen para que la interfaz pueda advertirlo', async () => {
      currentRow = null;
      const fallback = await service.currentPrice(FuelType.Diesel);

      currentRow = makePrice();
      const loaded = await service.currentPrice(FuelType.Diesel);

      expect(fallback.origin).not.toBe(loaded.origin);
    });
  });

  describe('currentPrices', () => {
    it('devuelve un precio por cada combustible del enum', async () => {
      const prices = await service.currentPrices();

      expect(prices.map((p) => p.fuelType)).toEqual([FuelType.Diesel, FuelType.Gasoline]);
    });
  });

  describe('create', () => {
    const DTO = {
      fuelType: FuelType.Diesel,
      pricePerLiter: 1.42,
      effectiveDate: '2026-06-01',
    };

    it('guarda el precio con la moneda del entorno si no se indica otra', async () => {
      await service.create(DTO, USER, REQUEST);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ currency: 'USD', pricePerLiter: 1.42 }),
      );
    });

    it('respeta la moneda indicada', async () => {
      await service.create({ ...DTO, currency: 'COP' }, USER, REQUEST);

      expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ currency: 'COP' }));
    });

    it('rechaza un duplicado de combustible y fecha con un 400 legible', async () => {
      // La restricción UNIQUE ya lo impide; sin esta comprobación el usuario vería un
      // 500 por violación de constraint en lugar de una explicación.
      repository.findOne.mockResolvedValue(makePrice());

      await expect(service.create(DTO, USER, REQUEST)).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('rechaza una caducidad anterior a la entrada en vigor', async () => {
      await expect(
        service.create({ ...DTO, expirationDate: '2026-05-01' }, USER, REQUEST),
      ).rejects.toThrow('La fecha de caducidad no puede ser anterior a la de entrada en vigor.');
    });

    it('admite una caducidad igual a la entrada en vigor', async () => {
      await expect(
        service.create({ ...DTO, expirationDate: '2026-06-01' }, USER, REQUEST),
      ).resolves.toBeDefined();
    });

    it('registra el alta en auditoría', async () => {
      await service.create(DTO, USER, REQUEST);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.Create, entityType: 'fuel_price' }),
      );
    });
  });

  describe('update', () => {
    it('responde 404 si el precio no existe', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(
        service.update('inexistente', { pricePerLiter: 2 }, USER, REQUEST),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('cambia el importe y audita el valor anterior', async () => {
      repository.findOne.mockResolvedValue(makePrice({ pricePerLiter: 1.2345 }));

      const updated = await service.update('price-1', { pricePerLiter: 1.5 }, USER, REQUEST);

      expect(updated.pricePerLiter).toBe(1.5);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.Update,
          oldValues: expect.objectContaining({ pricePerLiter: 1.2345 }),
        }),
      );
    });

    it('rechaza dejar la caducidad por detrás de la entrada en vigor', async () => {
      repository.findOne.mockResolvedValue(makePrice({ effectiveDate: '2026-06-01' }));

      await expect(
        service.update('price-1', { expirationDate: '2026-01-01' }, USER, REQUEST),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('expire', () => {
    it('pone la fecha de hoy y no borra la fila', async () => {
      // El precio que estuvo vigente justifica los costes ya calculados con él.
      repository.findOne.mockResolvedValue(makePrice({ effectiveDate: '2020-01-01' }));
      const today = new Date().toISOString().slice(0, 10);

      const expired = await service.expire('price-1', USER, REQUEST);

      expect(expired.expirationDate).toBe(today);
      expect(repository.save).toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('filtra por combustible cuando se indica', async () => {
      await service.findAll(FuelType.Gasoline);

      expect(repository.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { fuelType: FuelType.Gasoline } }),
      );
    });

    it('devuelve el histórico completo si no se filtra', async () => {
      await service.findAll();

      expect(repository.find).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    });
  });
});
