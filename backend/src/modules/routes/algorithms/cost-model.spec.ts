import { CostModel } from './cost-model';
import { DEFAULT_COST_CONTEXT, makeCostModel, makeEdge } from './__fixtures__/graph.fixture';

describe('CostModel', () => {
  describe('validación de pesos', () => {
    it('rechaza pesos que no suman 1', () => {
      expect(() =>
        makeCostModel({ weights: { distance: 0.5, time: 0.3, cost: 0.2, risk: 0.1 } }),
      ).toThrow(/suman/);
    });

    it('rechaza pesos negativos', () => {
      // Un peso negativo produciría arcos de coste negativo y Dijkstra dejaría de ser
      // correcto sin dar ningún síntoma visible: devolvería caminos subóptimos en silencio.
      expect(() =>
        makeCostModel({ weights: { distance: 0.8, time: 0.4, cost: -0.2, risk: 0.0 } }),
      ).toThrow(/negativos/);
    });

    it('acepta la combinación 40/30/20/10 de la especificación', () => {
      expect(() => new CostModel(DEFAULT_COST_CONTEXT)).not.toThrow();
    });
  });

  describe('consumo de combustible', () => {
    it('aplica consumo x distancia sin ajuste climático', () => {
      const model = makeCostModel({ consumptionLPer100Km: 7.5 });
      const edge = makeEdge({ from: 'A', to: 'B', distanceKm: 100 });

      expect(model.fuelLiters(edge)).toBeCloseTo(7.5, 5);
    });

    it('incrementa el consumo con el factor climático', () => {
      // Caso de la especificación: 7,5 L/100 km x 100 km x (1 + 0,1) = 8,25 L.
      const model = makeCostModel({ consumptionLPer100Km: 7.5 });
      const edge = makeEdge({ from: 'A', to: 'B', distanceKm: 100, weatherIntensity: 0.1 });

      expect(model.fuelLiters(edge)).toBeCloseTo(8.25, 2);
    });

    it('escala linealmente con la distancia', () => {
      const model = makeCostModel({ consumptionLPer100Km: 30 });
      const short = makeEdge({ from: 'A', to: 'B', distanceKm: 50 });
      const long = makeEdge({ from: 'A', to: 'B', distanceKm: 150 });

      expect(model.fuelLiters(long)).toBeCloseTo(model.fuelLiters(short) * 3, 5);
    });
  });

  describe('coste monetario', () => {
    it('suma combustible y peaje', () => {
      const model = makeCostModel({ consumptionLPer100Km: 10, fuelPricePerLiter: 2 });
      const edge = makeEdge({ from: 'A', to: 'B', distanceKm: 100, tollCost: 5 });

      // 10 L x 2 + 5 = 25
      expect(model.monetaryCost(edge)).toBeCloseTo(25, 5);
    });

    it('la aversión a peajes no altera el coste informado', () => {
      const neutral = makeCostModel({ consumptionLPer100Km: 10, fuelPricePerLiter: 2 });
      const averse = makeCostModel({
        consumptionLPer100Km: 10,
        fuelPricePerLiter: 2,
        tollAversionMultiplier: 25,
      });
      const edge = makeEdge({ from: 'A', to: 'B', distanceKm: 100, tollCost: 5 });

      expect(averse.monetaryCost(edge)).toBeCloseTo(neutral.monetaryCost(edge), 10);
      // Pero sí el peso con el que se decide la ruta.
      expect(averse.edgeWeight(edge)).toBeGreaterThan(neutral.edgeWeight(edge));
    });
  });

  describe('duración efectiva', () => {
    it('sin clima ni incidentes coincide con la duración base', () => {
      const model = makeCostModel();
      const edge = makeEdge({ from: 'A', to: 'B', distanceKm: 80, durationMinutes: 60 });

      expect(model.effectiveDurationMinutes(edge)).toBeCloseTo(60, 5);
    });

    it('la penaliza con clima adverso', () => {
      const model = makeCostModel();
      const edge = makeEdge({
        from: 'A',
        to: 'B',
        distanceKm: 80,
        durationMinutes: 60,
        weatherIntensity: 1,
      });

      expect(model.effectiveDurationMinutes(edge)).toBeGreaterThan(60);
    });

    it('la penaliza con incidentes', () => {
      const model = makeCostModel();
      const edge = makeEdge({
        from: 'A',
        to: 'B',
        distanceKm: 80,
        durationMinutes: 60,
        riskFactor: 1,
      });

      expect(model.effectiveDurationMinutes(edge)).toBeGreaterThan(100);
    });
  });

  describe('peso del arco', () => {
    it('nunca es negativo — requisito de corrección de Dijkstra', () => {
      const model = makeCostModel();

      for (const spec of [
        { distanceKm: 0 },
        { distanceKm: 1000, tollCost: 500 },
        { distanceKm: 1, weatherIntensity: 1, riskFactor: 1 },
      ]) {
        const edge = makeEdge({ from: 'A', to: 'B', ...spec });
        expect(model.edgeWeight(edge)).toBeGreaterThanOrEqual(0);
      }
    });

    it('crece con la distancia manteniendo lo demás igual', () => {
      const model = makeCostModel();
      const short = makeEdge({ from: 'A', to: 'B', distanceKm: 10 });
      const long = makeEdge({ from: 'A', to: 'B', distanceKm: 100 });

      expect(model.edgeWeight(long)).toBeGreaterThan(model.edgeWeight(short));
    });
  });

  describe('heurística de A*', () => {
    it('nunca sobreestima el coste de un arco que cubre esa distancia', () => {
      const model = makeCostModel();

      for (const distanceKm of [1, 10, 100, 500]) {
        // El arco recorre exactamente la distancia en línea recta a la máxima velocidad:
        // es el mejor caso posible, y la heurística debe quedarse por debajo o igual.
        const edge = makeEdge({
          from: 'A',
          to: 'B',
          distanceKm,
          durationMinutes: (distanceKm / 120) * 60,
        });

        expect(model.heuristic(distanceKm, 120)).toBeLessThanOrEqual(
          model.edgeWeight(edge) + 1e-12,
        );
      }
    });

    it('vale 0 cuando ya se está en el destino', () => {
      expect(makeCostModel().heuristic(0, 100)).toBe(0);
    });
  });

  describe('puntuación', () => {
    it('una ruta ideal se acerca a 100', () => {
      const model = makeCostModel();

      const score = model.score({
        distanceKm: 0,
        durationMinutes: 0,
        fuelLiters: 0,
        fuelCost: 0,
        tollCost: 0,
        totalCost: 0,
        riskFactor: 0,
      });

      expect(score.total).toBeCloseTo(100, 5);
    });

    it('satura en 0 en lugar de volverse negativa con valores extremos', () => {
      // La fórmula de la especificación (`100 - distancia/100`) daba puntuaciones
      // negativas para rutas largas, lo que rompía cualquier ordenación posterior.
      const model = makeCostModel();

      const score = model.score({
        distanceKm: 100_000,
        durationMinutes: 100_000,
        fuelLiters: 5000,
        fuelCost: 90_000,
        tollCost: 10_000,
        totalCost: 100_000,
        riskFactor: 1,
      });

      expect(score.total).toBeGreaterThanOrEqual(0);
      expect(score.distanceScore).toBe(0);
      expect(score.safetyScore).toBe(0);
    });

    it('siempre está dentro del rango 0-100', () => {
      const model = makeCostModel();

      for (let i = 0; i < 200; i += 1) {
        const score = model.score({
          distanceKm: Math.random() * 5000,
          durationMinutes: Math.random() * 5000,
          fuelLiters: Math.random() * 500,
          fuelCost: Math.random() * 2000,
          tollCost: Math.random() * 500,
          totalCost: Math.random() * 2500,
          riskFactor: Math.random(),
        });

        expect(score.total).toBeGreaterThanOrEqual(0);
        expect(score.total).toBeLessThanOrEqual(100);
      }
    });

    it('puntúa mejor una ruta corta y barata que una larga y cara', () => {
      const model = makeCostModel();

      const good = model.score({
        distanceKm: 100,
        durationMinutes: 90,
        fuelLiters: 30,
        fuelCost: 31.5,
        tollCost: 3,
        totalCost: 34.5,
        riskFactor: 0,
      });

      const bad = model.score({
        distanceKm: 400,
        durationMinutes: 420,
        fuelLiters: 120,
        fuelCost: 126,
        tollCost: 40,
        totalCost: 166,
        riskFactor: 0.5,
      });

      expect(good.total).toBeGreaterThan(bad.total);
    });
  });

  describe('métricas agregadas', () => {
    it('suma las métricas de todos los arcos del camino', () => {
      const model = makeCostModel({ consumptionLPer100Km: 10, fuelPricePerLiter: 1 });
      const edges = [
        makeEdge({ from: 'A', to: 'B', distanceKm: 100, tollCost: 5 }),
        makeEdge({ from: 'B', to: 'C', distanceKm: 200, tollCost: 3 }),
      ];

      const metrics = model.pathMetrics({ nodeIds: ['A', 'B', 'C'], edges, weight: 0 });

      expect(metrics.distanceKm).toBeCloseTo(300, 5);
      expect(metrics.fuelLiters).toBeCloseTo(30, 5);
      expect(metrics.tollCost).toBeCloseTo(8, 5);
      expect(metrics.totalCost).toBeCloseTo(38, 5);
    });

    it('pondera el riesgo por distancia', () => {
      const model = makeCostModel();
      const edges = [
        // 1 km con riesgo máximo y 99 km limpios: el riesgo medio debe ser ~0,01,
        // no 0,5 como daría una media aritmética simple.
        makeEdge({ from: 'A', to: 'B', distanceKm: 1, riskFactor: 1 }),
        makeEdge({ from: 'B', to: 'C', distanceKm: 99, riskFactor: 0 }),
      ];

      const metrics = model.pathMetrics({ nodeIds: ['A', 'B', 'C'], edges, weight: 0 });

      expect(metrics.riskFactor).toBeCloseTo(0.01, 4);
    });

    it('un camino vacío no divide por cero', () => {
      const metrics = makeCostModel().pathMetrics({ nodeIds: ['A'], edges: [], weight: 0 });

      expect(metrics.distanceKm).toBe(0);
      expect(metrics.riskFactor).toBe(0);
    });
  });
});
