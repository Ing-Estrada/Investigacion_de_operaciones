import { api } from './client';
import type {
  AnalyticsSummary,
  AuthResponse,
  CostByRoadType,
  GeocodingResult,
  OptimizeRouteRequest,
  OptimizedRouteResponse,
  Paginated,
  RouteResult,
  RouteStatus,
  RoutesOverTime,
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

export const analyticsApi = {
  summary: (days = 30) => api.get<AnalyticsSummary>('/analytics/summary', { days }),

  overTime: (days = 30) => api.get<RoutesOverTime[]>('/analytics/over-time', { days }),

  byRoadType: (days = 30) => api.get<CostByRoadType[]>('/analytics/by-road-type', { days }),
};
