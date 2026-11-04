/**
 * Chart theme — the bridge between the design tokens and Recharts.
 *
 * Recharts writes real SVG `fill` / `stroke` attributes and cannot take a CSS
 * custom property reliably, so a chart cannot simply say `stroke="var(--ui-line)"`.
 * Before this file that meant every chart hardcoded hex tuned for a white page:
 * `stroke="#f0f0f0"` grids (invisible on dark), `fill="#ede9fe"` area tints,
 * `#2563eb` strokes that ignored the active theme, and two different local
 * `COLORS` arrays in AnalyticsPage and ReportsPage.
 *
 * The fix is to read the tokens off `<html>` at runtime and hand Recharts the
 * concrete `rgb(r, g, b)` strings it wants. Tokens are stored as bare "R G B"
 * triples (see index.css), so they need wrapping before use.
 *
 * ── Two different colour jobs, two different rules ──────────────────────────
 *
 * CHROME (grid, axis ticks, tooltip surface, cursors) FOLLOWS THE THEME. It is
 * part of the page, and must recede against whatever background is behind it.
 *
 * SERIES COLOUR DOES NOT. A six-series chart needs six mutually distinguishable
 * hues; deriving them from the accent would collapse them into one ramp, and
 * re-deriving them per theme would repaint the same entity differently on every
 * theme switch. So the categorical palette is fixed and shared by every chart in
 * the app — only its light/dark *steps* change, chosen for each surface rather
 * than flipped automatically.
 *
 * The palette is colour-blind-safe by measurement, not by taste: worst adjacent
 * CVD ΔE 9.1 light / 8.4 dark (OKLab ×100, ≥8 target), worst adjacent
 * normal-vision ΔE 19.6 light / 19.3 dark (≥15 floor), all six ≥3:1 on the dark
 * surface. Three light steps sit under 3:1 on white, which is why the pies that
 * use them keep their direct labels.
 *
 * STATUS colour is reserved and never borrows a series slot: "resolved" is
 * green because it is good, not because it is the third thing in the list.
 * Those come from the `success`/`warning`/`danger`/`info` tokens, which already
 * have dark-mode values.
 */

import { useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';

/* ── Categorical palette ───────────────────────────────────────────────── */

/** blue, orange, aqua, yellow, magenta, green — in this order, never cycled. */
const SERIES_LIGHT = [
  '#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300',
] as const;

/** The same six hues re-stepped for a dark surface, not an automatic flip. */
const SERIES_DARK = [
  '#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300',
] as const;

export function chartSeries(dark: boolean): readonly string[] {
  return dark ? SERIES_DARK : SERIES_LIGHT;
}

/* ── Token reading ─────────────────────────────────────────────────────── */

/**
 * Reads one token and returns a concrete colour string.
 *
 * Tokens are `R G B` triples so Tailwind's `/opacity` modifiers keep working;
 * SVG needs them wrapped. A theme that has not been applied yet (SSR, or a
 * token that was renamed) falls back rather than emitting `fill=""`.
 */
function readToken(cs: CSSStyleDeclaration, name: string, fallback: string): string {
  const raw = cs.getPropertyValue(name).trim();
  if (!raw) return fallback;
  const triple = raw.match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/);
  if (triple) return `rgb(${triple[1]}, ${triple[2]}, ${triple[3]})`;
  // Already a usable colour (a theme could legitimately define one that way).
  return raw;
}

/** Translucent version of any palette colour — for area fills under a line. */
export function fade(color: string, alpha: number): string {
  const rgb = color.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  if (rgb) return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`;

  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, c => c + c) : hex[1];
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  return color;
}

/* ── Shape ─────────────────────────────────────────────────────────────── */

export interface ChartTheme {
  /** Fixed categorical hues. Assign in order by entity — never by rank. */
  series: readonly string[];
  /** CartesianGrid stroke. */
  grid: string;
  /** Axis lines and tick marks. */
  axis: string;
  text: string;
  muted: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  neutral: string;
  /** `tick` prop for an axis: keeps the caller's font size, themes the fill. */
  tick: (fontSize: number) => { fontSize: number; fill: string };
  /** Spread onto `<Tooltip>` — themed surface, border and text. */
  tooltip: {
    contentStyle: React.CSSProperties;
    labelStyle: React.CSSProperties;
    itemStyle: React.CSSProperties;
  };
  /** `cursor` for a bar chart's tooltip (a filled band). */
  barCursor: { fill: string };
  /** `cursor` for a line/area chart's tooltip (a vertical rule). */
  lineCursor: { stroke: string; strokeWidth: number };
  /** Spread onto `<Legend>`. */
  legend: { wrapperStyle: React.CSSProperties };
  fade: (color: string, alpha: number) => string;
  /** Ticket/lead status → a reserved status colour. Never a series slot. */
  statusColor: (status: string) => string;
  /** Priority → a reserved status colour. */
  priorityColor: (priority: string) => string;
  /** CSAT star rating → good / middling / bad. */
  ratingColor: (rating: number) => string;
}

function build(dark: boolean): ChartTheme {
  // `document` is always present in this app (Vite SPA), but a defensive read
  // keeps the module importable from a test renderer with no DOM.
  const cs = typeof document !== 'undefined'
    ? getComputedStyle(document.documentElement)
    : ({ getPropertyValue: () => '' } as unknown as CSSStyleDeclaration);

  const grid    = readToken(cs, '--ui-line',           dark ? 'rgb(51, 65, 85)'    : 'rgb(226, 232, 240)');
  const axis    = readToken(cs, '--ui-line-strong',    dark ? 'rgb(71, 85, 105)'   : 'rgb(203, 213, 225)');
  const text    = readToken(cs, '--ui-fg',             dark ? 'rgb(241, 245, 249)' : 'rgb(15, 23, 42)');
  const muted   = readToken(cs, '--ui-fg-muted',       dark ? 'rgb(148, 163, 184)' : 'rgb(100, 116, 139)');
  const accent  = readToken(cs, '--ui-accent-500',     dark ? 'rgb(99, 102, 241)'  : 'rgb(79, 70, 229)');
  const success = readToken(cs, '--ui-success',        dark ? 'rgb(52, 211, 153)'  : 'rgb(5, 150, 105)');
  const warning = readToken(cs, '--ui-warning',        dark ? 'rgb(251, 191, 36)'  : 'rgb(217, 119, 6)');
  const danger  = readToken(cs, '--ui-danger',         dark ? 'rgb(248, 113, 113)' : 'rgb(220, 38, 38)');
  const info    = readToken(cs, '--ui-info',           dark ? 'rgb(96, 165, 250)'  : 'rgb(37, 99, 235)');
  const neutral = readToken(cs, '--ui-fg-subtle',      dark ? 'rgb(100, 116, 139)' : 'rgb(148, 163, 184)');
  const surface = readToken(cs, '--ui-surface-raised', dark ? 'rgb(30, 41, 59)'    : 'rgb(255, 255, 255)');

  const statusMap: Record<string, string> = {
    OPEN: info,
    NEW: info,
    IN_PROGRESS: warning,
    CONTACTED: warning,
    PENDING: warning,
    QUALIFIED: accent,
    RESOLVED: success,
    CONVERTED: success,
    CLOSED: neutral,
    UNQUALIFIED: neutral,
  };

  const priorityMap: Record<string, string> = {
    LOW: neutral,
    MEDIUM: info,
    HIGH: warning,
    CRITICAL: danger,
  };

  const series = chartSeries(dark);

  return {
    series,
    grid,
    axis,
    text,
    muted,
    accent,
    success,
    warning,
    danger,
    info,
    neutral,

    tick: (fontSize: number) => ({ fontSize, fill: muted }),

    tooltip: {
      contentStyle: {
        background: surface,
        border: `1px solid ${grid}`,
        borderRadius: 'var(--ui-card-radius, 12px)',
        boxShadow: 'var(--ui-shadow-md)',
        fontSize: 12,
        color: text,
      },
      labelStyle: { color: text, fontWeight: 600, marginBottom: 2 },
      itemStyle: { color: muted },
    },

    barCursor: { fill: fade(muted, 0.12) },
    lineCursor: { stroke: axis, strokeWidth: 1 },
    legend: { wrapperStyle: { fontSize: 11, color: muted } },

    fade,

    // A status the map doesn't know about still needs *a* colour; neutral is
    // the honest answer — better than silently reusing a series hue and
    // implying a relationship that isn't there.
    statusColor: (status: string) => statusMap[String(status).toUpperCase().replace(/[\s-]+/g, '_')] ?? neutral,
    priorityColor: (priority: string) => priorityMap[String(priority).toUpperCase()] ?? neutral,
    ratingColor: (rating: number) => (rating >= 4 ? success : rating === 3 ? warning : danger),
  };
}

/**
 * The chart palette for the theme that is currently applied.
 *
 * `ThemeContext` writes `data-theme` / `.dark` onto `<html>` synchronously
 * inside its setters, before the re-render those setters trigger — so by the
 * time this memo re-runs, `getComputedStyle` already reports the new values.
 * Recomputing on `{ style, dark }` is therefore enough to keep every chart in
 * step with a theme switch or a dark-mode toggle.
 */
export function useChartTheme(): ChartTheme {
  const { style, dark } = useTheme();
  return useMemo(() => build(dark), [style, dark]);
}
