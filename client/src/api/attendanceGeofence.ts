import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

/**
 * Geofence status for the employee, and the office boundaries an admin
 * manages.
 *
 * The polygon is stored and exchanged as a GeoJSON Polygon (RFC 7946) —
 * longitude first, ring closed. See server/src/utils/geoPolygon.ts for the
 * authoritative format and the validation rules.
 */

export type GeofenceType = 'CIRCLE' | 'POLYGON';

export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface OfficeLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  allowedIps: string | null;
  isActive: boolean;
  geofenceType: GeofenceType | string;
  polygon: GeoJsonPolygon | null;
  areaSquareMeters: number | null;
  locationId: string | null;
}

export interface MyLocation {
  inside: boolean | null;
  office: string | null;
  distanceMeters: number | null;
  lat: number | null;
  lng: number | null;
  accuracy?: number | null;
  seenAt: string | null;
  /** True when the last fix is old enough that it is history, not "now". */
  stale: boolean;
  /** False when the GPS fix was too vague to decide anything. */
  usable?: boolean;
  assignedOffice: { id: string; name: string } | null;
  lastEvent: { type: 'ENTER' | 'EXIT'; at: string } | null;
  officeCount: number;
  message?: string | null;
}

export interface GeofenceEvent {
  id: string;
  userId: string;
  eventType: 'ENTER' | 'EXIT';
  at: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  source: string;
  user: { id: string; name: string; avatarUrl: string | null; department: string | null };
}

export interface GeocodeResult {
  name: string;
  displayName: string;
  lat: number;
  lng: number;
  bounds: { south: number; north: number; west: number; east: number } | null;
}

// ─── Employee ────────────────────────────────────────────────────────────────

/** The last position the server has for the caller — no GPS prompt. */
export const useMyLocation = (enabled = true) =>
  useQuery<MyLocation>({
    queryKey: ['my-location'],
    queryFn: () => api.get('/hr/attendance/my-location').then(r => r.data),
    enabled,
    staleTime: 60_000,
  });

/** Sends a fresh GPS fix for the server to evaluate. */
export const useReportMyLocation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { lat: number; lng: number; accuracy?: number }) =>
      api.post('/hr/attendance/my-location', body).then(r => r.data as MyLocation),
    onSuccess: (data) => {
      qc.setQueryData(['my-location'], data);
      qc.invalidateQueries({ queryKey: ['attendance-me'] });
    },
  });
};

// ─── Admin ───────────────────────────────────────────────────────────────────

export const useOfficeLocations = () =>
  useQuery<OfficeLocation[]>({
    queryKey: ['office-locations'],
    queryFn: () => api.get('/hr/attendance/office-locations').then(r => r.data),
  });

export const useOfficeEvents = (officeId: string | null) =>
  useQuery<{ office: { id: string; name: string }; events: GeofenceEvent[] }>({
    queryKey: ['office-geofence-events', officeId],
    queryFn: () => api.get(`/hr/attendance/office-locations/${officeId}/events`, { params: { limit: 25 } }).then(r => r.data),
    enabled: !!officeId,
  });

export interface Presence {
  generatedAt: string;
  offices: { id: string; name: string; geofenceType: string; inside: number }[];
  people: {
    user: { id: string; name: string };
    insideOffice: string | null;
    distanceMeters: number | null;
    stale: boolean;
    seenAt: string | null;
  }[];
  insideCount: number;
  outsideCount: number;
  staleCount: number;
}

export const useOfficePresence = (enabled = true) =>
  useQuery<Presence>({
    queryKey: ['office-presence'],
    queryFn: () => api.get('/hr/attendance/office-locations/presence').then(r => r.data),
    enabled,
    retry: false,
  });

export const useGeocode = () =>
  useQuery<{ query: string; results: GeocodeResult[] }>({
    queryKey: ['geocode'],
    queryFn: () => api.get('/hr/attendance/geocode').then(r => r.data),
    enabled: false,
  });
