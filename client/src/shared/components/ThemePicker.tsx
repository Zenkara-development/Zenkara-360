import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPopover, popoverStyle } from './useAnchoredPopover';
import { Palette, Check, Type, X, Moon, Sun } from 'lucide-react';
import {
  useTheme, THEME_LABELS, FONT_LABELS, THEME_ACCENTS,
  type ThemeStyle, type ThemeFont,
} from '../../contexts/ThemeContext';

/* Swatch previews. These deliberately mirror the real per-theme values from
   index.css — an earlier version kept its own hand-copied map that had drifted
   (it showed Classic as grey at 3px when Classic is corporate blue, and Modern
   as indigo at 6px when Modern is violet), so the picker advertised a look you
   did not actually get. Accents come from THEME_ACCENTS so there is one source
   of truth; only the geometry is repeated here, and it is deliberately
   approximate because these are 28px-tall doodles. */
const PREVIEW_GEOMETRY: Record<ThemeStyle, { radius: string; shadow: string; bar: string }> = {
  sky:      { radius: '16px', shadow: '0 8px 20px rgba(37,99,235,0.16)', bar: 'linear-gradient(90deg,#4c9bff,#2578eb)' },
  minimal:  { radius: '10px', shadow: '0 4px 12px rgba(15,23,42,0.10)', bar: 'transparent' },
  modern:   { radius: '6px',  shadow: '0 8px 20px rgba(9,9,30,0.20)',   bar: 'linear-gradient(90deg,#6d28d9,#8b5cf6)' },
  classic:  { radius: '2px',  shadow: '0 2px 6px rgba(17,24,39,0.14)',  bar: 'transparent' },
  friendly: { radius: '14px', shadow: '0 6px 18px rgba(120,72,32,0.14)', bar: 'linear-gradient(90deg,#ea580c,#fbbf24)' },
};

const FONT_SAMPLES: Record<ThemeFont, string> = {
  inter:   'Inter',
  jakarta: 'Plus Jakarta Sans',
  dm:      'DM Sans',
  nunito:  'Nunito Sans',
};

export function ThemePicker() {
  const { style, font, dark, setStyle, setFont, toggleDark } = useTheme();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  /* Measured on a 390px viewport, this 288px panel opened at x=196 and ran to
     484 — 94px off the right edge — then got clipped by the shell's
     `overflow-hidden`. It lives at the bottom of the sidebar, so it also needs
     to open upward. Portaling with viewport clamping fixes both. */
  const { triggerRef, panelRef: floatRef, position } = useAnchoredPopover<HTMLButtonElement>(open, {
    width: 288, align: 'left', placement: 'top', estimatedHeight: 520,
  });

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (floatRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) {
      document.addEventListener('mousedown', onClick);
      document.addEventListener('keydown', onKey);
    }
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={panelRef}>
      <button
        ref={triggerRef}
        onClick={() => setOpen(v => !v)}
        title="Appearance"
        aria-label="Appearance settings"
        aria-expanded={open}
        className="w-8 h-8 flex items-center justify-center rounded-md text-sidebar-muted hover:text-sidebar-fg hover:bg-sidebar-hover transition-all"
      >
        <Palette size={16} />
      </button>

      {open && position && createPortal(
        <div
          ref={floatRef}
          style={popoverStyle(position)}
          className="z-[400] animate-slide-down ui-popover"
        >
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-line-subtle">
            <div className="flex items-center gap-2">
              <Palette size={14} className="text-accent" />
              <span className="text-[13px] font-semibold text-fg">Appearance</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="w-6 h-6 flex items-center justify-center rounded-btn text-fg-subtle hover:text-fg hover:bg-surface-hover transition-all"
            >
              <X size={13} />
            </button>
          </div>

          <div className="p-4 space-y-5">
            {/* ── Visual style ── */}
            <div>
              <p className="text-[11px] font-semibold text-fg-subtle uppercase tracking-widest mb-3">
                Visual style
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(THEME_LABELS) as ThemeStyle[]).map(s => {
                  const geo = PREVIEW_GEOMETRY[s];
                  const accent = THEME_ACCENTS[s];
                  const active = style === s;
                  return (
                    <button
                      key={s}
                      onClick={() => setStyle(s)}
                      aria-pressed={active}
                      className={`theme-swatch relative text-left p-3 border rounded-card transition-all ${
                        active
                          ? 'border-accent bg-accent-soft'
                          : 'border-line-subtle bg-surface-sunken hover:border-line-strong'
                      }`}
                    >
                      <div className="mb-2.5 space-y-1.5" aria-hidden="true">
                        <div
                          className="w-full h-7 bg-white border border-slate-200 overflow-hidden"
                          style={{ borderRadius: geo.radius, boxShadow: geo.shadow }}
                        >
                          <div className="h-1.5 w-full" style={{ background: geo.bar }} />
                          <div className="px-2 pt-1 flex items-center justify-between">
                            <div className="h-1.5 w-10 bg-slate-200 rounded-full" />
                            <div
                              className="h-1.5 w-4"
                              style={{ background: accent, borderRadius: geo.radius, opacity: 0.9 }}
                            />
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <div className="h-2 flex-1" style={{ background: accent, borderRadius: geo.radius, opacity: 0.85 }} />
                          <div className="h-2 flex-1 bg-slate-200" style={{ borderRadius: geo.radius }} />
                        </div>
                      </div>

                      <p className="text-[11.5px] font-semibold text-fg leading-none">
                        {THEME_LABELS[s].name}
                      </p>
                      <p className="text-[10.5px] text-fg-muted mt-1 leading-snug">
                        {THEME_LABELS[s].desc}
                      </p>

                      {active && (
                        <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-accent flex items-center justify-center">
                          <Check size={9} strokeWidth={3} className="text-accent-fg" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Colour mode ── */}
            <div>
              <p className="text-[11px] font-semibold text-fg-subtle uppercase tracking-widest mb-3">
                Colour mode
              </p>
              <button
                onClick={toggleDark}
                role="switch"
                aria-checked={dark}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-btn border border-line-subtle bg-surface-sunken hover:border-line-strong transition-all"
              >
                <span className="flex items-center gap-2 text-[13px] font-medium text-fg">
                  {dark ? <Moon size={14} className="text-accent" /> : <Sun size={14} className="text-amber-500" />}
                  {dark ? 'Dark' : 'Light'}
                </span>
                <span className={`relative w-9 h-5 rounded-full transition-colors ${dark ? 'bg-accent' : 'bg-line-strong'}`}>
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      dark ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </span>
              </button>
            </div>

            {/* ── Font ── */}
            <div>
              <p className="text-[11px] font-semibold text-fg-subtle uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <Type size={10} /> Font
              </p>
              <div className="space-y-1">
                {(Object.keys(FONT_LABELS) as ThemeFont[]).map(f => {
                  const active = font === f;
                  return (
                    <button
                      key={f}
                      onClick={() => setFont(f)}
                      aria-pressed={active}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-btn text-left border transition-all ${
                        active
                          ? 'bg-accent-soft border-accent/30'
                          : 'border-transparent hover:bg-surface-hover'
                      }`}
                    >
                      <span
                        className="text-[13px] font-medium text-fg"
                        style={{ fontFamily: FONT_LABELS[f].family }}
                      >
                        {FONT_SAMPLES[f]}
                      </span>
                      {active
                        ? <Check size={12} className="text-accent" />
                        : <span className="text-[11px] text-fg-subtle italic opacity-60">Aa</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
