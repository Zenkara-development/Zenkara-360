import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { MapContainer, TileLayer, Circle, CircleMarker, Polyline, Popup, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Crosshair, RefreshCw, MapPin, Clock, Route } from 'lucide-react';
import { api } from '../../api/client';
import { Card, CardHeader, Button, Badge, Avatar, Alert, EmptyState, SkeletonCard, Input } from '../../shared/components';
import { useFormat } from '../../hooks/useFormat';

interface Office { id: string; name: string; latitude: number; longitude: number; radiusMeters: number }
interface Person {
  user: { id: string; name: string; role: string; avatarUrl?: string | null; department?: string | null };
  recordId: string;
  checkInAt: string;
  lat: number | null; lng: number | null;
  seenAt: string | null;
  stale: boolean;
  inside: boolean | null;
  nearestOffice: { name: string; distanceMeters: number } | null;
  outsideSince: string | null;
}
interface Live { generatedAt: string; offices: Office[]; people: Person[] }
interface Trail { user: { id: string; name: string }; date: string; pings: { at: string; lat: number; lng: number; accuracy: number | null; inside: boolean | null }[]; sessions: { id: string; checkInAt: string | null; checkOutAt: string | null; checkInLat: number | null; checkInLng: number | null; checkOutLat: number | null; checkOutLng: number | null }[] }

const colour = (p: Person) => (p.stale ? '#9ca3af' : p.inside ? '#16a34a' : '#d97706');
const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`;
};
const today = () => new Date().toISOString().slice(0, 10);

/** Fits the map to whatever is on it whenever the set of points changes. */
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  const key = points.map(p => p.join(',')).join('|');
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) { map.setView(points[0], 15); return; }
    map.fitBounds(points, { padding: [40, 40], maxZoom: 16 });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function LiveMap() {
  const { time } = useFormat();
  const [selected, setSelected] = useState<string | null>(null);
  const [date, setDate] = useState(today());
  const { data, isLoading, error, refetch, isFetching } = useQuery<Live>({
    queryKey: ['attendance-live'],
    queryFn: () => api.get('/hr/attendance/live').then(r => r.data),
    refetchInterval: 30_000,
    retry: false,
  });
  const { data: trail, isFetching: trailLoading } = useQuery<Trail>({
    queryKey: ['attendance-trail', selected, date],
    queryFn: () => api.get(`/hr/attendance/trail/${selected}`, { params: { date } }).then(r => r.data),
    enabled: !!selected,
    refetchInterval: date === today() ? 60_000 : false,
  });
  const locate = useMutation({ mutationFn: (userId: string) => api.post(`/hr/attendance/locate/${userId}`) });

  const people = data?.people ?? [];
  const offices = data?.offices ?? [];
  const points = useMemo<[number, number][]>(() => {
    const pts: [number, number][] = offices.map(o => [o.latitude, o.longitude]);
    for (const p of people) if (p.lat != null && p.lng != null) pts.push([p.lat, p.lng]);
    return pts;
  }, [offices, people]);
  const trailPts = useMemo<[number, number][]>(() => (trail?.pings ?? []).map(p => [p.lat, p.lng]), [trail]);
  const selectedPerson = people.find(p => p.user.id === selected) ?? null;

  if (isLoading) return <SkeletonCard lines={8} />;
  if (error) {
    const msg = (error as any)?.response?.data?.error || 'Could not load live locations.';
    return <Alert tone="warning" title="Live location is not available">{msg}</Alert>;
  }

  const inside = people.filter(p => p.inside && !p.stale).length;
  const outside = people.filter(p => p.inside === false && !p.stale).length;
  const stale = people.filter(p => p.stale).length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] gap-4">
      <Card padding="none" className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-line-subtle flex-wrap gap-2">
          <div className="flex items-center gap-3 text-[12px]">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#16a34a]" /> {inside} at office</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#d97706]" /> {outside} away</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#9ca3af]" /> {stale} no recent fix</span>
          </div>
          <div className="flex items-center gap-2 text-[11.5px] text-fg-subtle">
            {data && <>updated {ago(data.generatedAt)}</>}
            <Button size="xs" variant="ghost" icon={<RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />} onClick={() => refetch()}>Refresh</Button>
          </div>
        </div>
        <div className="h-[480px]" data-testid="live-map">
          {points.length === 0 ? (
            <EmptyState icon={<MapPin />} title="Nothing to show yet" description="Positions appear here while employees are checked in with the app open. Add an office location in HR Settings to see the geofence." />
          ) : (
            <MapContainer center={points[0]} zoom={14} scrollWheelZoom className="h-full w-full">
              <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <FitBounds points={selected && trailPts.length ? trailPts : points} />
              {offices.map(o => (
                <Circle key={o.id} center={[o.latitude, o.longitude]} radius={o.radiusMeters} pathOptions={{ color: '#4f46e5', fillColor: '#4f46e5', fillOpacity: 0.08, weight: 1.5 }}>
                  <Tooltip direction="top" permanent={false}>{o.name} · {o.radiusMeters} m</Tooltip>
                </Circle>
              ))}
              {selected && trailPts.length > 1 && (
                <Polyline positions={trailPts} pathOptions={{ color: '#4f46e5', weight: 3, opacity: 0.7, dashArray: '6 6' }} />
              )}
              {selected && trail?.pings.map((p, i) => (
                <CircleMarker key={i} center={[p.lat, p.lng]} radius={3} pathOptions={{ color: p.inside ? '#16a34a' : '#d97706', fillOpacity: 0.9, weight: 0 }}>
                  <Tooltip>{time(p.at)}{p.accuracy != null ? ` · ±${Math.round(p.accuracy)} m` : ''}</Tooltip>
                </CircleMarker>
              ))}
              {people.filter(p => p.lat != null && p.lng != null).map(p => (
                <CircleMarker
                  key={p.user.id}
                  center={[p.lat!, p.lng!]}
                  radius={selected === p.user.id ? 11 : 8}
                  pathOptions={{ color: '#ffffff', weight: 2, fillColor: colour(p), fillOpacity: 1 }}
                  eventHandlers={{ click: () => setSelected(p.user.id) }}
                >
                  <Popup>
                    <div className="text-[12.5px]">
                      <p className="font-semibold">{p.user.name}</p>
                      <p>{p.stale ? 'No recent fix' : p.inside ? 'At the office' : 'Away from office'}{p.nearestOffice ? ` · ${p.nearestOffice.distanceMeters} m from ${p.nearestOffice.name}` : ''}</p>
                      <p className="text-gray-500">Seen {ago(p.seenAt)} · checked in {time(p.checkInAt)}</p>
                    </div>
                  </Popup>
                </CircleMarker>
              ))}
            </MapContainer>
          )}
        </div>
      </Card>

      <div className="space-y-4">
        <Card padding="none">
          <div className="px-4 pt-4"><CardHeader title="Checked in now" subtitle={`${people.length} ${people.length === 1 ? 'person' : 'people'}`} /></div>
          {people.length === 0 ? (
            <p className="px-4 pb-4 text-[12.5px] text-fg-subtle">Nobody is checked in right now.</p>
          ) : (
            <ul className="divide-y divide-line-subtle max-h-[420px] overflow-y-auto" data-testid="live-people">
              {people.map(p => (
                <li key={p.user.id}>
                  <button type="button" onClick={() => setSelected(p.user.id === selected ? null : p.user.id)}
                    className={`w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-surface-sunken ${selected === p.user.id ? 'bg-accent-soft' : ''}`}>
                    <span className="relative">
                      <Avatar name={p.user.name} src={p.user.avatarUrl ?? undefined} size="sm" />
                      <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-surface" style={{ background: colour(p) }} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] font-medium text-fg truncate">{p.user.name}</span>
                      <span className="block text-[11.5px] text-fg-subtle truncate">
                        {p.stale ? `no fix · last seen ${ago(p.seenAt)}` : p.inside ? `at ${p.nearestOffice?.name ?? 'office'}` : `${p.nearestOffice?.distanceMeters ?? '?'} m from ${p.nearestOffice?.name ?? 'office'}`}
                        {' · '}in since {time(p.checkInAt)}
                      </span>
                    </span>
                    <Button size="xs" variant="ghost" icon={<Crosshair size={12} />} title="Ask their app for a fresh position"
                      loading={locate.isPending && locate.variables === p.user.id}
                      onClick={e => { e.stopPropagation(); locate.mutate(p.user.id); }}>Locate</Button>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {selected && (
          <Card>
            <CardHeader title={`Trail — ${selectedPerson?.user.name ?? trail?.user.name ?? ''}`} subtitle="Location pings while checked in" />
            <div className="flex items-center gap-2 mt-3">
              <Input type="date" value={date} max={today()} onChange={e => setDate(e.target.value)} />
              <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Close</Button>
            </div>
            <div className="mt-3 text-[12.5px] text-fg-muted space-y-1">
              {trailLoading && !trail ? <p>Loading…</p> : !trail ? null : (
                <>
                  <p className="flex items-center gap-1.5"><Route size={12} /> {trail.pings.length} pings · {trail.pings.filter(p => p.inside).length} inside · {trail.pings.filter(p => p.inside === false).length} outside</p>
                  {trail.sessions.map(s => (
                    <p key={s.id} className="flex items-center gap-1.5"><Clock size={12} /> {s.checkInAt ? time(s.checkInAt) : '—'} → {s.checkOutAt ? time(s.checkOutAt) : 'open'}</p>
                  ))}
                  {trail.pings.length === 0 && <p className="text-fg-subtle">No pings on this day.</p>}
                </>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {selectedPerson?.outsideSince && <Badge variant="yellow">outside since {time(selectedPerson.outsideSince)}</Badge>}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
