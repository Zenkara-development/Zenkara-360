import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Polygon, Polyline, CircleMarker, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Search, LocateFixed, Undo2, Eraser, Check, Plus, Minus, AlertTriangle } from 'lucide-react';
import { Modal, Button, Alert, Input, Badge, InlineSpinner } from '../../../shared/components';
import { api } from '../../../api/client';
import { polygonAreaSquareMeters, polygonCentroid, polygonPerimeterMeters, polygonProblem, formatArea, formatDistance, type LatLng } from '../../../shared/geo';

/**
 * The interactive polygon editor.
 *
 * The admin draws the office boundary by clicking points on the map, then
 * hands the finished shape to the office form. Nothing here is trusted: the
 * server validates the polygon again before it stores it, so a mistake made
 * in the browser is caught either way — this one is just caught sooner.
 *
 * Leaflet is the map library the product already uses (see LiveMap.tsx), so
 * this is the same map, the same tiles and the same look as the rest of the
 * attendance screens.
 */

export interface EditorPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** The boundary being edited, if any — GeoJSON, longitude first. */
  initialPolygon?: EditorPolygon | null;
  /** Where to open the map when there's no boundary to fit to. */
  initialCenter?: LatLng | null;
  officeName?: string;
  /** Called with the finished boundary. The caller stores it on the form. */
  onApply: (result: {
    polygon: EditorPolygon;
    points: LatLng[];
    areaSquareMeters: number;
    center: LatLng;
  }) => void;
}

interface SearchResult {
  name: string;
  displayName: string;
  lat: number;
  lng: number;
  bounds: { south: number; north: number; west: number; east: number } | null;
}

/** Reads a stored GeoJSON polygon back into the editor's point list. */
export function polygonToPoints(polygon: EditorPolygon | null | undefined): LatLng[] {
  if (!polygon?.coordinates?.length) return [];
  const ring = polygon.coordinates[0];
  if (!Array.isArray(ring) || ring.length < 3) return [];
  const points = ring
    .filter(p => Array.isArray(p) && p.length >= 2)
    .map(p => ({ lng: Number(p[0]), lat: Number(p[1]) }));
  // Drop the closing point GeoJSON repeats — the editor re-closes it.
  if (points.length > 1) {
    const first = points[0];
    const last = points[points.length - 1];
    if (first.lat === last.lat && first.lng === last.lng) points.pop();
  }
  return points;
}

/** Captures map clicks — the way the admin adds boundary points. */
function ClickCapture({ onPick }: { onPick: (p: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

/** Fits the map to the points being drawn, and provides the zoom buttons. */
function MapControls({ points, focus }: { points: LatLng[]; focus: { lat: number; lng: number; zoom?: number } | null }) {
  const map = useMap();
  const lastFit = useRef<string>('');

  useEffect(() => {
    if (focus) {
      map.setView([focus.lat, focus.lng], focus.zoom ?? 16);
      return;
    }
    if (!points.length) return;
    const key = points.map(p => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join('|');
    if (key === lastFit.current) return;
    lastFit.current = key;
    if (points.length === 1) { map.setView([points[0].lat, points[0].lng], 16); return; }
    map.fitBounds(points.map(p => [p.lat, p.lng] as [number, number]), { padding: [30, 30], maxZoom: 17 });
  }, [points, focus, map]);

  return (
    <div className="absolute right-2 top-2 z-[400] flex flex-col gap-1">
      <button
        type="button"
        onClick={() => map.zoomIn()}
        aria-label="Zoom in"
        className="w-8 h-8 flex items-center justify-center rounded-btn bg-surface border border-line shadow-ui-sm text-fg hover:bg-surface-hover"
      >
        <Plus size={15} />
      </button>
      <button
        type="button"
        onClick={() => map.zoomOut()}
        aria-label="Zoom out"
        className="w-8 h-8 flex items-center justify-center rounded-btn bg-surface border border-line shadow-ui-sm text-fg hover:bg-surface-hover"
      >
        <Minus size={15} />
      </button>
    </div>
  );
}

/** The blue dot for "this is where you are right now". */
function HereMarker({ position }: { position: LatLng | null }) {
  if (!position) return null;
  return (
    <Marker position={[position.lat, position.lng]} icon={L.divIcon({
      className: '',
      html: '<div style="width:14px;height:14px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 2px rgba(37,99,235,.35)"></div>',
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    })} />
  );
}

export function PolygonGeofenceEditor({ open, onClose, initialPolygon, initialCenter, officeName, onApply }: Props) {
  const [points, setPoints] = useState<LatLng[]>([]);
  const [focus, setFocus] = useState<{ lat: number; lng: number; zoom?: number } | null>(null);
  const [here, setHere] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchError, setSearchError] = useState('');
  const [finished, setFinished] = useState(false);

  // Start from whatever is being edited.
  useEffect(() => {
    if (!open) return;
    const existing = polygonToPoints(initialPolygon);
    setPoints(existing);
    setFinished(existing.length >= 3);
    setHere(null);
    setResults([]);
    setSearchError('');
    setQuery('');
    setFocus(initialCenter ? { lat: initialCenter.lat, lng: initialCenter.lng, zoom: 16 } : null);
  }, [open, initialPolygon, initialCenter]);

  const problem = useMemo(() => polygonProblem(points), [points]);
  const area = useMemo(() => (points.length >= 3 ? polygonAreaSquareMeters(points) : 0), [points]);
  const perimeter = useMemo(() => (points.length >= 2 ? polygonPerimeterMeters(points) : 0), [points]);

  function addPoint(p: LatLng) {
    setFinished(false);
    setPoints(prev => [...prev, p]);
  }

  function undoLast() {
    setFinished(false);
    setPoints(prev => prev.slice(0, -1));
  }

  function clearShape() {
    setFinished(false);
    setPoints([]);
  }

  function useMyLocation() {
    if (!navigator.geolocation) { setLocationError('This device has no location service.'); return; }
    setLocating(true);
    setLocationError('');
    navigator.geolocation.getCurrentPosition(
      pos => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setHere(p);
        setFocus({ ...p, zoom: 17 });
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        if (err?.code === err.PERMISSION_DENIED) {
          setLocationError('Location permission was denied. You can still draw the boundary by clicking points on the map.');
        } else if (err?.code === err.POSITION_UNAVAILABLE) {
          setLocationError('No location fix is available right now. Draw the boundary by clicking points on the map.');
        } else {
          setLocationError('Could not get your location. Draw the boundary by clicking points on the map.');
        }
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  async function search(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 3) { setSearchError('Type at least three characters.'); return; }
    setSearching(true);
    setSearchError('');
    try {
      const { data } = await api.get('/hr/attendance/geocode', { params: { q } });
      setResults(data?.results ?? []);
      if (!(data?.results ?? []).length) setSearchError('No matches found — try a different spelling, or click the map directly.');
    } catch (err: any) {
      setSearchError(err?.response?.data?.error || 'Address search is unavailable right now. You can still click the map to draw the boundary.');
    } finally {
      setSearching(false);
    }
  }

  function apply() {
    if (!points.length) return;
    const ring = points.map(p => [p.lng, p.lat]);
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
    onApply({
      polygon: { type: 'Polygon', coordinates: [ring] },
      points,
      areaSquareMeters: Math.round(area),
      center: polygonCentroid(points),
    });
  }

  const center: [number, number] = focus
    ? [focus.lat, focus.lng]
    : points.length
      ? [points[0].lat, points[0].lng]
      : initialCenter
        ? [initialCenter.lat, initialCenter.lng]
        : [12.9716, 77.5946];

  const canApply = points.length >= 3 && !problem;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={officeName ? `Draw boundary — ${officeName}` : 'Draw office boundary'}
      subtitle="Click the map to add the corners of the office boundary. Add at least three points; click them in order around the edge."
      icon={<AlertTriangle size={16} />}
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button icon={<Check size={14} />} disabled={!canApply} onClick={apply}>
            Use this boundary
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {problem && (
          <Alert tone={points.length < 3 ? 'info' : 'danger'}>{problem}</Alert>
        )}
        {locationError && <Alert tone="warning">{locationError}</Alert>}
        {searchError && <Alert tone="warning">{searchError}</Alert>}

        {/* Search + locate */}
        <div className="flex flex-wrap items-end gap-2">
          <form onSubmit={search} className="flex-1 min-w-[220px] flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-[11px] uppercase tracking-wide text-fg-subtle mb-1">Search for a place</label>
              <Input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="e.g. Outer Ring Road, Bengaluru"
                aria-label="Search for an address"
              />
            </div>
            <Button type="submit" size="md" variant="secondary" icon={<Search size={14} />} loading={searching}>Search</Button>
          </form>
          <Button variant="secondary" icon={<LocateFixed size={14} />} loading={locating} onClick={useMyLocation}>
            Use my location
          </Button>
        </div>

        {results.length > 0 && (
          <div className="rounded-card border border-line divide-y divide-line-subtle max-h-40 overflow-y-auto">
            {results.map((r, i) => (
              <button
                key={i}
                type="button"
                className="w-full text-left px-3 py-2 text-[12.5px] hover:bg-surface-hover"
                onClick={() => {
                  setFocus({ lat: r.lat, lng: r.lng, zoom: r.bounds ? 15 : 16 });
                  setResults([]);
                }}
              >
                <span className="font-medium text-fg">{r.name}</span>
                <span className="block text-[11.5px] text-fg-subtle truncate">{r.displayName}</span>
              </button>
            ))}
          </div>
        )}

        {/* The map */}
        <div className="relative rounded-card overflow-hidden border border-line" style={{ height: 380 }}>
          <MapContainer center={center} zoom={16} scrollWheelZoom zoomControl={false} className="h-full w-full">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <ClickCapture onPick={addPoint} />
            <MapControls points={points} focus={focus} />
            <HereMarker position={here} />
            {points.length === 1 && (
              <CircleMarker center={[points[0].lat, points[0].lng]} radius={6} pathOptions={{ color: '#4f46e5', fillOpacity: 1, weight: 2 }} />
            )}
            {points.length >= 2 && (
              <Polyline
                positions={points.map(p => [p.lat, p.lng] as [number, number])}
                pathOptions={{ color: '#4f46e5', weight: 2, dashArray: '5 5' }}
              />
            )}
            {points.length >= 3 && (
              <Polygon
                positions={points.map(p => [p.lat, p.lng] as [number, number])}
                pathOptions={{ color: '#4f46e5', fillColor: '#4f46e5', fillOpacity: finished ? 0.18 : 0.08, weight: 2 }}
              />
            )}
            {points.map((p, i) => (
              <CircleMarker
                key={i}
                center={[p.lat, p.lng]}
                radius={5}
                pathOptions={{ color: '#ffffff', fillColor: '#4f46e5', fillOpacity: 1, weight: 2 }}
              />
            ))}
          </MapContainer>

          {/* Toolbar */}
          <div className="absolute left-2 top-2 z-[400] flex flex-wrap gap-1.5">
            <Button
              size="xs"
              variant="secondary"
              icon={<Undo2 size={12} />}
              disabled={!points.length}
              onClick={undoLast}
            >
              Undo last point
            </Button>
            <Button
              size="xs"
              variant="secondary"
              icon={<Eraser size={12} />}
              disabled={!points.length}
              onClick={clearShape}
            >
              Clear shape
            </Button>
            <Button
              size="xs"
              variant={finished ? 'subtle' : 'secondary'}
              icon={<Check size={12} />}
              disabled={points.length < 3}
              onClick={() => setFinished(true)}
            >
              {finished ? 'Boundary finished' : 'Finish polygon'}
            </Button>
          </div>

          {searching && (
            <div className="absolute inset-0 z-[401] flex items-center justify-center bg-surface/70 text-[12.5px] text-fg-muted gap-2">
              <InlineSpinner /> Searching…
            </div>
          )}
        </div>

        {/* What has been drawn so far */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-card border border-line-subtle p-2.5">
            <p className="text-[10.5px] uppercase tracking-wide text-fg-subtle">Points</p>
            <p className="text-[13px] font-medium text-fg mt-0.5">{points.length}</p>
          </div>
          <div className="rounded-card border border-line-subtle p-2.5">
            <p className="text-[10.5px] uppercase tracking-wide text-fg-subtle">Covered area</p>
            <p className="text-[13px] font-medium text-fg mt-0.5" data-testid="polygon-area">{formatArea(area)}</p>
          </div>
          <div className="rounded-card border border-line-subtle p-2.5">
            <p className="text-[10.5px] uppercase tracking-wide text-fg-subtle">Perimeter</p>
            <p className="text-[13px] font-medium text-fg mt-0.5">{formatDistance(perimeter)}</p>
          </div>
        </div>

        {points.length > 0 && (
          <details className="rounded-card border border-line-subtle">
            <summary className="px-3 py-2 text-[12.5px] text-fg-muted cursor-pointer select-none">
              Boundary coordinates ({points.length})
            </summary>
            <ol className="px-3 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11.5px] text-fg-subtle tabular-nums">
              {points.map((p, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span>Point {i + 1}</span>
                  <span>{p.lat.toFixed(6)}, {p.lng.toFixed(6)}</span>
                </li>
              ))}
            </ol>
          </details>
        )}

        {finished && (
          <Alert tone="success" title="Boundary finished">
            {points.length} points, covering {formatArea(area)}. Save the office location to store it — the server
            checks the shape once more before it is written.
          </Alert>
        )}

        <p className="text-[11.5px] text-fg-subtle">
          Coordinates are stored as GeoJSON (longitude first, ring closed) — the same format the attendance check-in
          uses to decide whether somebody is inside the office.
        </p>
        <div className="flex items-center gap-2">
          <Badge variant={points.length >= 3 ? 'green' : 'gray'}>
            {points.length >= 3 ? 'Boundary ready' : 'Not enough points'}
          </Badge>
        </div>
      </div>
    </Modal>
  );
}
