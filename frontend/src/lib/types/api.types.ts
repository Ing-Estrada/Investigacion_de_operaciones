export type Role = 'admin' | 'dispatcher' | 'driver' | 'customer';

export type RouteStatus =
  | 'pending'
  | 'calculated'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export type RoadType = 'highway' | 'principal' | 'secondary' | 'tertiary';

export type IncidentType =
  | 'accident'
  | 'construction'
  | 'weather'
  | 'restriction'
  | 'traffic_jam';

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';

export type TollCategory = 'I' | 'II' | 'III' | 'IV' | 'V';

/** Sobre uniforme que devuelve el backend en toda respuesta correcta. */
export interface ApiEnvelope<T> {
  success: true;
  data: T;
  timestamp: string;
  path: string;
}

export interface ApiErrorBody {
  success: false;
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface UserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuthResponse {
  accessToken: string;
  expiresIn: number;
  user: UserProfile;
}

export interface VehicleType {
  id: string;
  name: string;
  weightCategory: string;
  axles: number;
  maxWeightKg: number;
  maxHeightMeters: number;
  maxWidthMeters: number;
  avgFuelConsumptionLPer100Km: number;
  tollCategory: TollCategory;
  fuelType: FuelType;
}

export type FuelType = 'diesel' | 'gasoline';

/** Precio vigente de un combustible, con el origen del dato. */
export interface ResolvedFuelPrice {
  fuelType: FuelType;
  pricePerLiter: number;
  currency: string;
  /** `configured` = no hay precio cargado y se está usando el del entorno. */
  origin: 'database' | 'configured';
  effectiveDate: string | null;
  source: string | null;
}

export interface FuelPrice {
  id: string;
  fuelType: FuelType;
  pricePerLiter: number;
  currency: string;
  effectiveDate: string;
  expirationDate: string | null;
  source: string | null;
  createdAt: string;
}

export interface TollRate {
  id: string;
  tollStationId: string;
  vehicleCategory: TollCategory;
  rateAmount: number;
  currency: string;
  effectiveDate: string;
  expirationDate: string | null;
}

export interface TollStationAdmin {
  id: string;
  name: string;
  highwayName: string;
  operator: string | null;
  isActive: boolean;
  location: { type: 'Point'; coordinates: [number, number] };
  rates: TollRate[];
}

export interface Vehicle {
  id: string;
  plate: string;
  manufacturer: string;
  model: string;
  year: number;
  currentFuelLiters: number;
  fuelCapacityLiters: number;
  customFuelConsumptionLPer100Km: number | null;
  isActive: boolean;
  vehicleType: VehicleType;
  createdAt: string;
}

export interface LocationPoint {
  latitude: number;
  longitude: number;
  address?: string;
}

export interface CostBreakdown {
  fuelLiters: number;
  fuelCost: number;
  tollCost: number;
  totalCost: number;
  currency: string;
  fuelPricePerLiter: number;
}

export interface RouteScore {
  distanceScore: number;
  timeScore: number;
  costScore: number;
  safetyScore: number;
  total: number;
}

export interface RouteSegment {
  order: number;
  distanceKm: number;
  durationMinutes: number;
  roadType: RoadType;
  roadName: string | null;
  hasToll: boolean;
  tollCost: number | null;
  weatherCondition: string | null;
  weatherIntensityFactor: number;
  incidentPresent: boolean;
  incidentSeverity: IncidentSeverity | null;
  /** [latitud, longitud][] */
  geometry: [number, number][];
}

export interface TollBreakdownItem {
  stationId: string;
  name: string;
  highwayName: string;
  amount: number | null;
  latitude: number;
  longitude: number;
}

export interface IncidentSummary {
  id: string;
  incidentType: IncidentType;
  severity: IncidentSeverity;
  description: string;
  latitude: number;
  longitude: number;
}

export interface WeatherSummary {
  worstIntensity: number;
  averageIntensity: number;
  conditions: string[];
  alert: boolean;
  degraded: boolean;
}

export interface RouteResult {
  id: string;
  parentRouteId: string | null;
  alternativeRank: number | null;
  distanceKm: number;
  durationMinutes: number;
  cost: CostBreakdown;
  score: RouteScore;
  origin: LocationPoint;
  destination: LocationPoint;
  /** [latitud, longitud][] */
  geometry: [number, number][];
  segments: RouteSegment[];
  tollBreakdown: TollBreakdownItem[];
  incidents: IncidentSummary[];
  weather: WeatherSummary;
  status: RouteStatus;
  algorithm: string;
  computationTimeMs: number;
  createdAt: string;
}

export interface OptimizedRouteResponse {
  route: RouteResult;
  alternatives: RouteResult[];
}

export interface OptimizeRouteRequest {
  origin: LocationPoint;
  destination: LocationPoint;
  vehicleId: string;
  alternatives?: number;
  algorithm?: 'astar' | 'dijkstra';
  avoidTolls?: boolean;
}

export interface GeocodingResult {
  displayName: string;
  coordinates: { latitude: number; longitude: number };
  category: string | null;
  importance: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface AnalyticsSummary {
  periodDays: number;
  totalRoutes: number;
  totalDistanceKm: number;
  totalFuelLiters: number;
  totalCost: number;
  totalTollCost: number;
  averageScore: number;
  averageDurationMinutes: number;
  averageComputationTimeMs: number;
  routesByStatus: Record<RouteStatus, number>;
}

export interface RoutesOverTime {
  day: string;
  routes: number;
  distanceKm: number;
  totalCost: number;
}

export interface CostByRoadType {
  roadType: string;
  distanceKm: number;
  tollCost: number;
  segments: number;
}
