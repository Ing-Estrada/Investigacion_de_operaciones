/** Roles del sistema (RF-017). El orden no implica jerarquía: los permisos son explícitos. */
export enum Role {
  Admin = 'admin',
  Dispatcher = 'dispatcher',
  Driver = 'driver',
  Customer = 'customer',
}

export enum RouteStatus {
  Pending = 'pending',
  Calculated = 'calculated',
  InProgress = 'in_progress',
  Completed = 'completed',
  Cancelled = 'cancelled',
}

/** Clasificación de vías (RF-010). */
export enum RoadType {
  Highway = 'highway',
  Principal = 'principal',
  Secondary = 'secondary',
  Tertiary = 'tertiary',
}

export enum IncidentType {
  Accident = 'accident',
  Construction = 'construction',
  Weather = 'weather',
  Restriction = 'restriction',
  TrafficJam = 'traffic_jam',
}

export enum IncidentSeverity {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
  Critical = 'critical',
}

/** Categoría de peaje: determina qué tarifa aplica a cada vehículo (RF-015). */
export enum TollCategory {
  CategoryI = 'I',
  CategoryII = 'II',
  CategoryIII = 'III',
  CategoryIV = 'IV',
  CategoryV = 'V',
}

export enum WeightCategory {
  Light = 'light',
  Medium = 'medium',
  Heavy = 'heavy',
  ExtraHeavy = 'extra_heavy',
}

export enum AuditAction {
  Login = 'login',
  LoginFailed = 'login_failed',
  Logout = 'logout',
  Register = 'register',
  TokenRefresh = 'token_refresh',
  PasswordChange = 'password_change',
  RoleChange = 'role_change',
  Create = 'create',
  Update = 'update',
  Delete = 'delete',
  Read = 'read',
  AccessDenied = 'access_denied',
}

/**
 * Multiplicadores de riesgo por severidad de incidente. Alimentan el 10% de "riesgo"
 * del peso multicriterio y penalizan el tiempo estimado del tramo afectado.
 */
export const INCIDENT_SEVERITY_PENALTY: Record<IncidentSeverity, number> = {
  [IncidentSeverity.Low]: 0.1,
  [IncidentSeverity.Medium]: 0.3,
  [IncidentSeverity.High]: 0.6,
  [IncidentSeverity.Critical]: 1.0,
};
