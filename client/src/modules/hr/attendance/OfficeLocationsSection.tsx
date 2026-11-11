import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MapContainer, TileLayer, Polygon, Circle, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Building2, Plus, Pencil, Trash2, MapPin, Wifi, ScanLine, Users, ChevronDown, ChevronRight,
} from 'lucide-react';
import { api } from '../../../api/client';
import {
  Card, CardHeader, Button, Badge, RowActions, Field, Input, Alert, EmptyState, SkeletonTable, Modal, InlineSpinner,
} from '../../../shared/components';
import { useFormat } from '../../../hooks/useFormat';
import { polygonCentroid, formatArea } from '../../../shared/geo';
import { PolygonGeofenceEditor, polygonToPoints, type EditorPolygon } from './PolygonGeofenceEditor';

/**
 * Office locations — the admin's view of the geofences that decide who may
 * check in.
 *
 * An office is either a CIRCLE (the original centre + radius) or a POLYGON
 * (a boundary drawn on the map). The two are interchangeable: switching
 * between them keeps the office, and switching back to a circle clears the
 * boundary that was drawn.
 *
 * The map preview, the boundary editor and the entry/exit history all live
 * here, so the whole life-cycle of an office — draw it, see who is inside
 * it, see when people arrived — is in one place.
 */

interface OfficeLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  allowedIps: string | null;
  isActive: boolean;
  geofenceType: string;
  polygon: EditorPolygon | null;
  areaSquareMeters: number | null;
  locationId: string | null;
}

interface GeofenceEvent {
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

interface Presence {
  generatedAt: string;
  offices: { id: string; name: string; geofenceType: string; inside: number }[];
  people: { user: { id: string; name: string }; insideOffice: string | null; distanceMeters: number | null; stale: boolean; seenAt: string | null }[];
  insideCount: number;
  outsideCount: number;
  staleCount: number;
}

const emptyOffice = {
  name: '', latitude: '', longitude: '', radiusMeters: '150', allowedIps: '',
  geofenceType: 'CIRCLE' as 'CIRCLE' | 'POLYGON', polygon: null as EditorPolygon | null,
  areaSquareMeters: null as number | null,
};

/** Fits the preview map to whatever boundary the office has. */
function FitToBoundary({ office, points }: { office: OfficeLocation; points: { lat: number; lng: number }[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length >= 3) {
      map.fitBounds(points.map(p => [p.lat, p.lng] as [number, number]), { padding: [12, 12], maxZoom: 17 });
      return;
    }
    if (office.radiusMeters > 0) {
      // Show the whole circle, not just its centre.
      const dLat = (office.radiusMeters / 111_320);
      const dLng = dLat / Math.max(0.2, Math.cos((office.latitude * Math.PI) / 180));
      map.fitBounds(
        [
          [office.latitude - dLat, office.longitude - dLng],
          [office.latitude + dLat, office.longitude + dLng],
        ],
        { padding: [12, 12] },
      );
      return;
    }
    map.setView([office.latitude, office.longitude], 16);
  }, [office.id, office.latitude, office.longitude, office.radiusMeters, points]);
  return null;
}

/** A small, static map of one office's boundary. */
function OfficeBoundaryPreview({ office }: { office: OfficeLocation }) {
  const points = polygonToPoints(office.polygon);
  const center = points.length >= 3
    ? polygonCentroid(points)
    : { lat: office.latitude, lng: office.longitude };
  return (
    <div className="h-24 w-full rounded-card overflow-hidden border border-line-subtle">
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={16}
        scrollWheelZoom={false}
        zoomControl={false}
        attributionControl={false}
        dragging={false}
        doubleClickZoom={false}
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitToBoundary office={office} points={points} />
        {points.length >= 3 ? (
          <Polygon
            positions={points.map(p => [p.lat, p.lng] as [number, number])}
            pathOptions={{ color: '#4f46e5', fillColor: '#4f46e5', fillOpacity: 0.18, weight: 2 }}
          />
        ) : (
          <Circle
            center={[office.latitude, office.longitude]}
            radius={office.radiusMeters}
            pathOptions={{ color: '#4f46e5', fillColor: '#4f46e5', fillOpacity: 0.12, weight: 1.5 }}
          />
        )}
      </MapContainer>
    </div>
  );
}

/** The entry/exit history for one office. */
function OfficeEvents({ officeId }: { officeId: string }) {
  const { dateTime } = useFormat();
  const { data, isLoading } = useQuery<{ events: GeofenceEvent[] }>({
    queryKey: ['office-geofence-events', officeId],
    queryFn: () => api.get(`/hr/attendance/office-locations/${officeId}/events`, { params: { limit: 25 } }).then(r => r.data),
  });
  if (isLoading) return <p className="text-[12px] text-fg-subtle flex items-center gap-2"><InlineSpinner /> Loading entry/exit history…</p>;
  const events = data?.events ?? [];
  if (!events.length) {
    return <p className="text-[12px] text-fg-subtle">No entry or exit has been recorded for this office yet.</p>;
  }
  return (
    <ul className="space-y-1.5" data-testid="office-events">
      {events.map(e => (
        <li key={e.id} className="flex items-center gap-2 text-[12px]">
          <Badge variant={e.eventType === 'ENTER' ? 'green' : 'orange'}>{e.eventType === 'ENTER' ? 'Entered' : 'Left'}</Badge>
          <span className="text-fg truncate">{e.user.name}</span>
          <span className="text-fg-subtle tabular-nums ml-auto">{dateTime(e.at)}</span>
        </li>
      ))}
    </ul>
  );
}

export function OfficeLocationsSection() {
  const qc = useQueryClient();
  const { dateTime } = useFormat();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<OfficeLocation | null>(null);
  const [form, setForm] = useState(emptyOffice);
  const [error, setError] = useState('');
  const [locating, setLocating] = useState(false);
  const [detectingIp, setDetectingIp] = useState(false);
  const [detectingHost, setDetectingHost] = useState(false);
  const [checkingHosts, setCheckingHosts] = useState(false);
  const [hostNote, setHostNote] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading } = useQuery<OfficeLocation[]>({
    queryKey: ['office-locations'],
    queryFn: () => api.get('/hr/attendance/office-locations').then(r => r.data),
  });

  // Live presence is only available when the org has turned location
  // sharing on; the endpoint refuses otherwise, and that is fine — the
  // section simply doesn't show the counts.
  const { data: presence } = useQuery<Presence>({
    queryKey: ['office-presence'],
    queryFn: () => api.get('/hr/attendance/office-locations/presence').then(r => r.data),
    retry: false,
  });

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        name: form.name,
        allowedIps: form.allowedIps.trim() || null,
        geofenceType: form.geofenceType,
      };
      if (form.geofenceType === 'POLYGON') {
        payload.polygon = form.polygon;
      } else {
        payload.latitude = Number(form.latitude);
        payload.longitude = Number(form.longitude);
        payload.radiusMeters = Number(form.radiusMeters);
      }
      return editing
        ? api.patch(`/hr/attendance/office-locations/${editing.id}`, payload)
        : api.post('/hr/attendance/office-locations', payload);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['office-locations'] }); closeModal(); },
    onError: (err: any) => setError(err?.response?.data?.error || 'Could not save office location.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/hr/attendance/office-locations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['office-locations'] }),
  });

  const toggleActive = useMutation({
    mutationFn: (loc: OfficeLocation) => api.patch(`/hr/attendance/office-locations/${loc.id}`, { isActive: !loc.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['office-locations'] }),
  });

  function openCreate() {
    setEditing(null); setForm(emptyOffice); setError(''); setHostNote(null); setModalOpen(true);
  }

  function openEdit(loc: OfficeLocation) {
    setEditing(loc);
    setForm({
      name: loc.name,
      latitude: String(loc.latitude),
      longitude: String(loc.longitude),
      radiusMeters: String(loc.radiusMeters),
      allowedIps: loc.allowedIps || '',
      geofenceType: (loc.geofenceType || 'CIRCLE') as 'CIRCLE' | 'POLYGON',
      polygon: loc.polygon ?? null,
      areaSquareMeters: loc.areaSquareMeters ?? null,
    });
    setError(''); setHostNote(null); setModalOpen(true);
  }

  function closeModal() { setModalOpen(false); setEditing(null); }

  function useMyLocation() {
    if (!navigator.geolocation) { setError('Geolocation is not supported on this device/browser.'); return; }
    setLocating(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      pos => {
        setForm(f => ({ ...f, latitude: String(pos.coords.latitude), longitude: String(pos.coords.longitude) }));
        setLocating(false);
      },
      () => { setError('Could not get current location.'); setLocating(false); },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  /** Fetches the caller's public IP exactly as the server sees it, so this
   *  can never populate an IP that check-in would then fail to match. */
  async function useMyIp() {
    setDetectingIp(true);
    setError('');
    try {
      const { data } = await api.get('/hr/attendance/my-ip');
      const ip = data?.ip;
      if (!ip) { setError('Could not detect your public IP.'); return; }
      setForm(f => {
        const existing = f.allowedIps.split(',').map(s => s.trim()).filter(Boolean);
        if (existing.includes(ip)) return f;
        return { ...f, allowedIps: [...existing, ip].join(', ') };
      });
    } catch {
      setError('Could not detect your public IP.');
    } finally {
      setDetectingIp(false);
    }
  }

  /** Best-effort reverse-DNS of the current public IP. Only a name that
   *  forward-resolves back to this IP is offered. */
  async function useMyDnsName() {
    setDetectingHost(true);
    setError('');
    setHostNote(null);
    try {
      const { data } = await api.get('/hr/attendance/my-host');
      if (data?.host && data.verified) {
        const host = data.host as string;
        setForm(f => {
          const existing = f.allowedIps.split(',').map(s => s.trim()).filter(Boolean);
          if (existing.includes(host)) return f;
          return { ...f, allowedIps: [...existing, host].join(', ') };
        });
        setHostNote({ tone: 'success', text: `Added ${host} — it currently resolves back to your IP (${data.ip}).` });
      } else if (data?.host) {
        setHostNote({ tone: 'warning', text: 'Your IP\'s DNS name doesn\'t resolve back to it, so it can\'t be used for check-in. Set up a free dynamic-DNS hostname and enter that instead.' });
      } else {
        setHostNote({ tone: 'warning', text: 'Your current IP has no DNS name. Set up a free dynamic-DNS hostname (DuckDNS, No-IP, or your router\'s DDNS feature) and enter it here.' });
      }
    } catch {
      setError('Could not look up a DNS name for your IP.');
    } finally {
      setDetectingHost(false);
    }
  }

  async function verifyHostnames() {
    const hosts = form.allowedIps.split(',').map(h => h.trim()).filter(h => h && /[a-z]/i.test(h));
    if (!hosts.length) { setHostNote({ tone: 'warning', text: 'No hostnames in the list yet — add one first.' }); return; }
    setCheckingHosts(true);
    setHostNote(null);
    try {
      const results = await Promise.all(hosts.map(h =>
        api.get('/hr/attendance/check-host', { params: { host: h } }).then(r => r.data).catch(() => ({ host: h, resolvedIps: [], matchesIp: false }))
      ));
      const lines = results.map((r: any) =>
        r.resolvedIps.length === 0 ? `${r.host}: does not resolve`
          : r.matchesIp ? `${r.host}: OK — points at your current IP`
          : `${r.host}: resolves to ${r.resolvedIps.join(', ')} (not your current network)`
      );
      const allOk = results.every((r: any) => r.matchesIp);
      setHostNote({ tone: allOk ? 'success' : 'warning', text: lines.join(' · ') });
    } finally {
      setCheckingHosts(false);
    }
  }

  const polygonReady = form.geofenceType === 'CIRCLE' || !!form.polygon;

  return (
    <Card>
      <CardHeader
        title="Office Locations"
        icon={<Building2 size={14} />}
        className="mb-3"
        actions={<Button size="sm" icon={<Plus size={13} />} onClick={openCreate}>Add Location</Button>}
      />
      <p className="text-xs text-fg-subtle mb-4">
        Employees must be inside an active location — a circle or a drawn boundary — or on an allowed IP/network, to check in.
      </p>

      {presence && presence.offices.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4 text-[12px] text-fg-muted" data-testid="office-presence">
          <Users size={12} className="text-fg-subtle" />
          {presence.offices.map(o => (
            <Badge key={o.id} variant={o.inside > 0 ? 'green' : 'gray'}>
              {o.name}: {o.inside} inside
            </Badge>
          ))}
          <span className="text-fg-subtle">updated {dateTime(presence.generatedAt)}</span>
        </div>
      )}

      {isLoading ? <SkeletonTable rows={2} /> : (data || []).length === 0 ? (
        <EmptyState
          compact
          icon={<Building2 />}
          title="No office locations yet"
          description="Add your office's coordinates so employees can check in from on-site."
          action={{ label: 'Add location', onClick: openCreate }}
        />
      ) : (
        <div className="space-y-2">
          {(data || []).map(loc => {
            const isPolygon = (loc.geofenceType || 'CIRCLE') === 'POLYGON';
            const points = polygonToPoints(loc.polygon);
            return (
              <div key={loc.id} className="p-3 border border-line-subtle rounded-card">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-fg text-sm">{loc.name}</span>
                      <Badge variant={loc.isActive ? 'green' : 'gray'}>{loc.isActive ? 'Active' : 'Inactive'}</Badge>
                      <Badge variant={isPolygon ? 'purple' : 'blue'}>{isPolygon ? 'Polygon' : 'Circular'}</Badge>
                    </div>
                    <p className="text-xs text-fg-subtle mt-0.5 tabular-nums">
                      {isPolygon
                        ? `${points.length} points · ${formatArea(loc.areaSquareMeters ?? 0)}`
                        : `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)} · ${loc.radiusMeters}m radius`}
                      {loc.allowedIps && ` · IP allowlist: ${loc.allowedIps}`}
                    </p>
                  </div>
                  <RowActions items={[
                    { label: 'Edit', icon: <Pencil size={13} />, onClick: () => openEdit(loc) },
                    ...(isPolygon ? [{
                      label: 'Edit boundary', icon: <ScanLine size={13} />,
                      onClick: () => { openEdit(loc); setDrawing(true); },
                    }] : []),
                    { label: loc.isActive ? 'Deactivate' : 'Activate', icon: <MapPin size={13} />, onClick: () => toggleActive.mutate(loc) },
                    { label: 'Delete', icon: <Trash2 size={13} />, variant: 'danger' as const, onClick: () => { if (confirm(`Delete "${loc.name}"?`)) remove.mutate(loc.id); } },
                  ]} />
                </div>

                <div className="mt-3 grid grid-cols-1 sm:grid-cols-[180px_minmax(0,1fr)] gap-3 items-start">
                  <OfficeBoundaryPreview office={loc} />
                  <div>
                    <button
                      type="button"
                      onClick={() => setExpanded(expanded === loc.id ? null : loc.id)}
                      className="inline-flex items-center gap-1.5 text-[12px] text-fg-muted hover:text-fg"
                    >
                      {expanded === loc.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      Entry / exit events
                    </button>
                    {expanded === loc.id && (
                      <div className="mt-2">
                        <OfficeEvents officeId={loc.id} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={modalOpen} onClose={closeModal} title={editing ? 'Edit office location' : 'Add office location'} icon={<Building2 size={16} />}
        footer={<>
          <Button variant="secondary" onClick={closeModal}>Cancel</Button>
          <Button
            onClick={() => { setError(''); save.mutate(); }}
            loading={save.isPending}
            disabled={!form.name || !polygonReady || (form.geofenceType === 'CIRCLE' && (!form.latitude || !form.longitude))}
          >
            {editing ? 'Save Changes' : 'Add Location'}
          </Button>
        </>}>
        <div className="space-y-1">
          {error && <Alert tone="danger" className="mb-3">{error}</Alert>}
          <div className="form-section">
            <p className="form-section-title">Location</p>
            <div className="space-y-4">
              <Field label="Name">
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Main Office" />
              </Field>

              {/* Geofence type — the circle is unchanged, the polygon is new. */}
              <Field label="Geofence type" hint="A circle covers a radius around a point. A polygon covers an exact boundary you draw on the map — useful for a campus or an irregular building.">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, geofenceType: 'CIRCLE' }))}
                    className={`flex-1 px-3 py-2 rounded-btn border text-[12.5px] ${form.geofenceType === 'CIRCLE' ? 'border-accent bg-accent-soft text-accent-soft-fg font-semibold' : 'border-line text-fg-muted hover:bg-surface-hover'}`}
                    data-testid="geofence-circle"
                  >
                    Circular Geofence
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, geofenceType: 'POLYGON' }))}
                    className={`flex-1 px-3 py-2 rounded-btn border text-[12.5px] ${form.geofenceType === 'POLYGON' ? 'border-accent bg-accent-soft text-accent-soft-fg font-semibold' : 'border-line text-fg-muted hover:bg-surface-hover'}`}
                    data-testid="geofence-polygon"
                  >
                    Polygon Geofence
                  </button>
                </div>
              </Field>

              {form.geofenceType === 'CIRCLE' ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Latitude">
                      <Input value={form.latitude} onChange={e => setForm(f => ({ ...f, latitude: e.target.value }))} placeholder="12.9716" />
                    </Field>
                    <Field label="Longitude">
                      <Input value={form.longitude} onChange={e => setForm(f => ({ ...f, longitude: e.target.value }))} placeholder="77.5946" />
                    </Field>
                  </div>
                  <Button variant="ghost" size="xs" icon={<MapPin size={12} />} loading={locating} onClick={useMyLocation} disabled={locating}>
                    Use my current location
                  </Button>
                  <Field label="Radius (meters)">
                    <Input type="number" min={10} max={50000} value={form.radiusMeters} onChange={e => setForm(f => ({ ...f, radiusMeters: e.target.value }))} />
                  </Field>
                </>
              ) : (
                <div className="space-y-2">
                  <div className="rounded-card border border-line p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[12.5px] font-medium text-fg">
                        {form.polygon ? 'Boundary drawn' : 'No boundary yet'}
                      </p>
                      {form.polygon && (
                        <Badge variant="green">{formatArea(form.areaSquareMeters ?? 0)}</Badge>
                      )}
                    </div>
                    <p className="text-[11.5px] text-fg-subtle">
                      {form.polygon
                        ? 'Click "Edit boundary" to change the shape. The server checks the polygon again before saving it.'
                        : 'Draw the office boundary on the map — at least three points, in order around the edge.'}
                    </p>
                    <Button size="sm" variant="secondary" icon={<ScanLine size={13} />} onClick={() => setDrawing(true)}>
                      {form.polygon ? 'Edit boundary' : 'Draw boundary'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="form-section">
            <p className="form-section-title">Check-in rules</p>
            <div className="space-y-4">
              <Field
                label="Allowed IPs / CIDR / hostname (optional)"
                hint="Comma-separated. If set, check-in also verifies the employee's public IP matches the office network. Office on a dynamic IP? Enter a dynamic-DNS hostname (e.g. office.myco.ddns.net) instead of an IP — it's resolved to the office's current address at every check-in."
              >
                <Input value={form.allowedIps} onChange={e => setForm(f => ({ ...f, allowedIps: e.target.value }))} placeholder="203.0.113.4, 203.0.113.0/24, office.myco.ddns.net" />
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Button variant="ghost" size="xs" icon={<Wifi size={12} />} loading={detectingIp} onClick={useMyIp} disabled={detectingIp}>
                    Use my current IP
                  </Button>
                  <Button variant="ghost" size="xs" icon={<Wifi size={12} />} loading={detectingHost} onClick={useMyDnsName} disabled={detectingHost}>
                    Use my DNS name
                  </Button>
                  <Button variant="ghost" size="xs" loading={checkingHosts} onClick={verifyHostnames} disabled={checkingHosts}>
                    Verify hostnames
                  </Button>
                </div>
                {hostNote && (
                  <p className={`mt-1.5 text-xs ${hostNote.tone === 'success' ? 'text-success' : 'text-warning-fg'}`}>
                    {hostNote.text}
                  </p>
                )}
              </Field>
            </div>
          </div>
        </div>
      </Modal>

      {drawing && (
        <PolygonGeofenceEditor
          open
          onClose={() => setDrawing(false)}
          initialPolygon={form.polygon}
          initialCenter={form.latitude && form.longitude ? { lat: Number(form.latitude), lng: Number(form.longitude) } : null}
          officeName={form.name}
          onApply={result => {
            setForm(f => ({
              ...f,
              geofenceType: 'POLYGON',
              polygon: result.polygon,
              areaSquareMeters: result.areaSquareMeters,
              latitude: String(result.center.lat),
              longitude: String(result.center.lng),
            }));
            setDrawing(false);
          }}
        />
      )}
    </Card>
  );
}
