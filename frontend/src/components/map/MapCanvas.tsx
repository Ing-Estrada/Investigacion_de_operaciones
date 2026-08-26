'use client';

import L from 'leaflet';
import { useEffect, useMemo } from 'react';
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';

import type { RouteResult } from '@/lib/types/api.types';
import {
  formatCurrency,
  formatDistance,
  formatDuration,
  INCIDENT_TYPE_LABELS,
  SEVERITY_LABELS,
} from '@/lib/utils/format';
import { selectActiveRoute, useRouteStore } from '@/store/useRouteStore';

import 'leaflet/dist/leaflet.css';

/** Centro por defecto: corredor Pitalito - Neiva (Huila, Colombia). */
const DEFAULT_CENTER: [number, number] = [2.4, -75.7];
const DEFAULT_ZOOM = 8;

/**
 * Marcadores con `divIcon` en lugar de los PNG por defecto de Leaflet.
 *
 * Los iconos por defecto se referencian por URL relativa al CSS y se rompen con el
 * hashing de assets de los bundlers — es el clásico marcador invisible. Un divIcon con
 * SVG en línea no depende de ningún archivo, escala sin pixelarse y hereda el color.
 */
function pinIcon(color: string, label: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `
      <div style="position:relative;width:26px;height:34px" role="img" aria-label="${label}">
        <svg viewBox="0 0 26 34" width="26" height="34">
          <path d="M13 0C5.8 0 0 5.8 0 13c0 9.7 13 21 13 21s13-11.3 13-21C26 5.8 20.2 0 13 0z"
                fill="${color}" stroke="rgba(0,0,0,.25)" stroke-width="1"/>
          <circle cx="13" cy="13" r="5" fill="#fff"/>
        </svg>
      </div>`,
    iconSize: [26, 34],
    iconAnchor: [13, 34],
    popupAnchor: [0, -30],
  });
}

const ORIGIN_ICON = pinIcon('#16a34a', 'Origen');
const DESTINATION_ICON = pinIcon('#dc2626', 'Destino');
const TOLL_ICON = pinIcon('#7c3aed', 'Peaje');

const SEVERITY_COLORS: Record<string, string> = {
  low: '#facc15',
  medium: '#fb923c',
  high: '#ef4444',
  critical: '#991b1b',
};

/** Traduce los clics del mapa a origen o destino según el modo activo. */
function ClickHandler() {
  const pickingMode = useRouteStore((state) => state.pickingMode);
  const setOrigin = useRouteStore((state) => state.setOrigin);
  const setDestination = useRouteStore((state) => state.setDestination);

  useMapEvents({
    click(event) {
      if (!pickingMode) return;

      const point = { latitude: event.latlng.lat, longitude: event.latlng.lng };
      if (pickingMode === 'origin') setOrigin(point);
      else setDestination(point);
    },
  });

  return null;
}

/**
 * Encuadra el mapa sobre la ruta calculada.
 *
 * Depende del identificador de la ruta y no del array de coordenadas: React crea un
 * array nuevo en cada render y el efecto se dispararía continuamente, reencuadrando el
 * mapa mientras el usuario intenta moverlo.
 */
function FitBounds({ route }: { route: RouteResult | null }) {
  const map = useMap();

  useEffect(() => {
    if (!route || route.geometry.length < 2) return;

    const bounds = L.latLngBounds(route.geometry.map(([lat, lon]) => L.latLng(lat, lon)));
    map.fitBounds(bounds, { padding: [48, 48] });
  }, [route?.id, map]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

export default function MapCanvas() {
  const origin = useRouteStore((state) => state.origin);
  const destination = useRouteStore((state) => state.destination);
  const result = useRouteStore((state) => state.result);
  const selectedRouteId = useRouteStore((state) => state.selectedRouteId);
  const selectRoute = useRouteStore((state) => state.selectRoute);
  const showIncidents = useRouteStore((state) => state.showIncidents);
  const showTolls = useRouteStore((state) => state.showTolls);
  const activeRoute = useRouteStore(selectActiveRoute);

  const allRoutes = useMemo(
    () => (result ? [result.route, ...result.alternatives] : []),
    [result],
  );

  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={DEFAULT_ZOOM}
      scrollWheelZoom
      className="h-full w-full"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />

      <ClickHandler />
      <FitBounds route={activeRoute} />

      {/*
        Las alternativas se pintan primero y la activa después: en Leaflet gana la última
        capa dibujada, así que la ruta seleccionada queda por encima y es clicable.
      */}
      {allRoutes
        .filter((route) => route.id !== selectedRouteId)
        .map((route) => (
          <Polyline
            key={route.id}
            positions={route.geometry}
            pathOptions={{ color: '#94a3b8', weight: 4, opacity: 0.65, dashArray: '6 8' }}
            eventHandlers={{ click: () => selectRoute(route.id) }}
          />
        ))}

      {activeRoute && (
        <Polyline
          key={activeRoute.id}
          positions={activeRoute.geometry}
          pathOptions={{ color: '#2563eb', weight: 6, opacity: 0.95 }}
        />
      )}

      {origin && (
        <Marker position={[origin.latitude, origin.longitude]} icon={ORIGIN_ICON}>
          <Popup>
            <strong>Origen</strong>
            <br />
            {origin.address ?? `${origin.latitude.toFixed(4)}, ${origin.longitude.toFixed(4)}`}
          </Popup>
        </Marker>
      )}

      {destination && (
        <Marker position={[destination.latitude, destination.longitude]} icon={DESTINATION_ICON}>
          <Popup>
            <strong>Destino</strong>
            <br />
            {destination.address ??
              `${destination.latitude.toFixed(4)}, ${destination.longitude.toFixed(4)}`}
          </Popup>
        </Marker>
      )}

      {showTolls &&
        activeRoute?.tollBreakdown.map((toll) => (
          <Marker key={toll.stationId} position={[toll.latitude, toll.longitude]} icon={TOLL_ICON}>
            <Popup>
              <strong>{toll.name}</strong>
              <br />
              {toll.highwayName}
              <br />
              {toll.amount === null ? (
                <em>Sin tarifa registrada</em>
              ) : (
                formatCurrency(toll.amount, activeRoute.cost.currency)
              )}
            </Popup>
          </Marker>
        ))}

      {showIncidents &&
        activeRoute?.incidents.map((incident) => (
          <CircleMarker
            key={incident.id}
            center={[incident.latitude, incident.longitude]}
            radius={9}
            pathOptions={{
              color: SEVERITY_COLORS[incident.severity] ?? '#f97316',
              fillColor: SEVERITY_COLORS[incident.severity] ?? '#f97316',
              fillOpacity: 0.65,
              weight: 2,
            }}
          >
            <Popup>
              <strong>{INCIDENT_TYPE_LABELS[incident.incidentType] ?? incident.incidentType}</strong>
              <br />
              Severidad: {SEVERITY_LABELS[incident.severity] ?? incident.severity}
              <br />
              {incident.description}
            </Popup>
          </CircleMarker>
        ))}

      {activeRoute && (
        <div className="leaflet-bottom leaflet-left" style={{ pointerEvents: 'none' }}>
          <div className="leaflet-control m-3 rounded-lg border border-border bg-surface-raised/95 px-3 py-2 text-xs shadow">
            <p className="font-medium text-content">
              {formatDistance(activeRoute.distanceKm)} · {formatDuration(activeRoute.durationMinutes)}
            </p>
            <p className="text-content-muted">
              {formatCurrency(activeRoute.cost.totalCost, activeRoute.cost.currency)}
            </p>
          </div>
        </div>
      )}
    </MapContainer>
  );
}
