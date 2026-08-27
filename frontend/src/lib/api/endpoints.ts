import { api } from './client';
import type {
  AnalyticsSummary,
  AuthResponse,
  CostByRoadType,
  FuelPrice,
  FuelType,
  GeocodingResult,
  OptimizeRouteRequest,
  OptimizedRouteResponse,
  Paginated,
  ResolvedFuelPrice,
  RouteResult,
  RouteStatus,
  RoutesOverTime,
  TollCategory,
  TollRate,
  TollStationAdmin,
  UserProfile,
  Vehicle,
  VehicleType,
} from '@/lib/types/api.types';

export const authApi = {
  login: (email: string, password: string) =>
    api.post<AuthResponse>('/auth/login', { email, password }),

  register: (payload: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }) => api.post<AuthResponse>('/auth/register', payload),

  logout: () => api.post<void>('/auth/logout'),

  me: () => api.get<UserProfile>('/auth/me'),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<void>('/auth/change-password', { currentPassword, newPassword }),
};

export const vehiclesApi = {
  types: () => api.get<VehicleType[]>('/vehicles/types'),

  list: () => api.get<Vehicle[]>('/vehicles'),

  get: (id: string) => api.get<Vehicle>(`/vehicles/${id}`),

  create: (payload: {
    plate: string;
    vehicleTypeId: string;
    manufacturer: string;
    model: string;
    year: number;
    fuelCapacityLiters: number;
    currentFuelLiters?: number;
    customFuelConsumptionLPer100Km?: number;
  }) => api.post<Vehicle>('/vehicles', payload),

  update: (
    id: string,
    payload: {
      currentFuelLiters?: number;
      customFuelConsumptionLPer100Km?: number;
      isActive?: boolean;
    },
  ) => api.patch<Vehicle>(`/vehicles/${id}`, payload),

  remove: (id: string) => api.delete<void>(`/vehicles/${id}`),
};

export const routesApi = {
  optimize: (payload: OptimizeRouteRequest) =>
    api.post<OptimizedRouteResponse>('/routes/optimize', payload),

  list: (params: { page?: number; limit?: number; status?: RouteStatus } = {}) =>
    api.get<Paginated<RouteResult>>('/routes', params),

  get: (id: string) => api.get<OptimizedRouteResponse>(`/routes/${id}`),

  updateStatus: (id: string, status: RouteStatus) =>
    api.patch<RouteResult>(`/routes/${id}/status`, { status }),
};

export const geocodingApi = {
  search: (query: string, limit = 5) =>
    api.get<GeocodingResult[]>('/geocoding/search', { query, limit }),

  reverse: (latitude: number, longitude: number) =>
    api.get<{ address: string | null }>('/geocoding/reverse', { latitude, longitude }),
};

export const fuelApi = {
  current: () => api.get<ResolvedFuelPrice[]>('/fuel/prices/current'),

  history: (fuelType?: FuelType) =>
    api.get<FuelPrice[]>('/fuel/prices', fuelType ? { fuelType } : {}),

  create: (payload: {
    fuelType: FuelType;
    pricePerLiter: number;
    currency?: string;
    effectiveDate: string;
    expirationDate?: string | null;
    source?: string | null;
  }) => api.post<FuelPrice>('/fuel/prices', payload),

  expire: (id: string) => api.patch<FuelPrice>(`/fuel/prices/${id}/expire`),
};

export const tollsApi = {
  stations: (includeInactive = false) =>
    api.get<TollStationAdmin[]>('/tolls/admin/stations', { includeInactive }),

  createStation: (payload: {
    name: string;
    latitude: number;
    longitude: number;
    highwayName: string;
    operator?: string | null;
  }) => api.post<TollStationAdmin>('/tolls/admin/stations', payload),

  updateStation: (id: string, payload: { isActive?: boolean; operator?: string | null }) =>
    api.patch<TollStationAdmin>(`/tolls/admin/stations/${id}`, payload),

  createRate: (
    stationId: string,
    payload: {
      vehicleCategory: TollCategory;
      rateAmount: number;
      currency?: string;
      effectiveDate: string;
      expirationDate?: string | null;
    },
  ) => api.post<TollRate>(`/tolls/admin/stations/${stationId}/rates`, payload),

  updateRate: (rateId: string, payload: { rateAmount?: number; expirationDate?: string | null }) =>
    api.patch<TollRate>(`/tolls/admin/rates/${rateId}`, payload),
};

export const analyticsApi = {
  summary: (days = 30) => api.get<AnalyticsSummary>('/analytics/summary', { days }),

  overTime: (days = 30) => api.get<RoutesOverTime[]>('/analytics/over-time', { days }),

  byRoadType: (days = 30) => api.get<CostByRoadType[]>('/analytics/by-road-type', { days }),
};
