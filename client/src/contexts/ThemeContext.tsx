import { createContext, useContext, useEffect, useState } from 'react';

export type ThemeStyle = 'sky' | 'minimal' | 'modern' | 'classic' | 'friendly';
export type ThemeFont  = 'inter' | 'jakarta' | 'dm' | 'nunito';

export const THEME_STYLES: ThemeStyle[] = ['sky', 'minimal', 'modern', 'classic', 'friendly'];
export const THEME_FONTS:  ThemeFont[]  = ['inter', 'jakarta', 'dm', 'nunito'];

export const THEME_LABELS: Record<ThemeStyle, { name: string; desc: string }> = {
  sky:      { name: 'Sky',      desc: 'Light blue & pastel — white cards, blue pill nav' },
  minimal:  { name: 'Minimal',  desc: 'Clean & airy — light rail, soft indigo' },
  modern:   { name: 'Modern',   desc: 'Bold & sharp — deep violet, vivid depth' },
  classic:  { name: 'Classic',  desc: 'Enterprise grade — corporate blue, dense' },
  friendly: { name: 'Friendly', desc: 'Warm & rounded — amber, approachable' },
};

export const FONT_LABELS: Record<ThemeFont, { name: string; family: string }> = {
  inter:   { name: 'Inter',             family: "'Inter', system-ui, sans-serif" },
  jakarta: { name: 'Plus Jakarta Sans', family: "'Plus Jakarta Sans', system-ui, sans-serif" },
  dm:      { name: 'DM Sans',           family: "'DM Sans', system-ui, sans-serif" },
  nunito:  { name: 'Nunito Sans',       family: "'Nunito Sans', system-ui, sans-serif" },
};

/* Each theme's signature accent, for swatches in the picker. These are the
   `--ui-accent-600` values from index.css; keep them in step if a theme's
   accent changes. Read at render time rather than hardcoded elsewhere so the
   picker cannot drift from what the theme actually applies. */
export const THEME_ACCENTS: Record<ThemeStyle, string> = {
  sky:      '#2578eb',
  minimal:  '#4f46e5',
  modern:   '#7c3aed',
  classic:  '#2563eb',
  friendly: '#ea580c',
};

interface ThemeContextValue {
  style: ThemeStyle;
  font:  ThemeFont;
  dark:  boolean;
  setStyle: (s: ThemeStyle) => void;
  setFont:  (f: ThemeFont)  => void;
  setDark:  (d: boolean)    => void;
  toggleDark: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  style: 'sky', font: 'jakarta', dark: false,
  setStyle: () => {}, setFont: () => {}, setDark: () => {}, toggleDark: () => {},
});

/* localStorage is user-writable and survives deploys, so a stale or hand-edited
   value must not reach the DOM. Previously these were cast straight through
   (`as ThemeStyle`), which let `data-theme="garbage"` silently fall back to the
   :root defaults with no indication anything was wrong. */
function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return allowed.includes(raw as T) ? (raw as T) : fallback;
  } catch {
    return fallback;
  }
}

function safeWrite(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Private browsing or a full quota — the theme still applies for this
       session, it just won't be remembered. Not worth surfacing to the user. */
  }
}

/* The [data-font] rules in index.css are the single mechanism for font family.
   An earlier version ALSO set --font-sans inline on <html>, which always won,
   leaving those CSS rules as dead code and two sources of truth for one value. */
/* Storage keys carry a version so a redesign can change the default once:
   anyone who had picked a theme under the old keys starts on the new Sky
   default, and can still switch back from the theme picker. Kept in sync
   with the bootstrap script in index.html. */
const THEME_KEY = 'ui-theme-v2';
const FONT_KEY  = 'ui-font-v2';

function applyTheme(style: ThemeStyle, font: ThemeFont) {
  const html = document.documentElement;
  html.setAttribute('data-theme', style);
  html.setAttribute('data-font', font);
}

function applyDark(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark);
}

function initialDark(): boolean {
  try {
    const stored = localStorage.getItem('ui-dark');
    if (stored !== null) return stored === 'true';
  } catch { /* fall through to the OS preference */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [style, setStyleState] = useState<ThemeStyle>(
    () => readStored(THEME_KEY, THEME_STYLES, 'sky'),
  );
  const [font, setFontState] = useState<ThemeFont>(
    () => readStored(FONT_KEY, THEME_FONTS, 'jakarta'),
  );
  const [dark, setDarkState] = useState<boolean>(initialDark);

  // The inline bootstrap in index.html has normally already done this before
  // first paint; re-applying keeps React state and the DOM in agreement when
  // storage was unreadable there.
  useEffect(() => { applyTheme(style, font); applyDark(dark); }, []);

  // Follow the OS only while the user has expressed no preference of their own.
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => {
      let hasPreference = false;
      try { hasPreference = localStorage.getItem('ui-dark') !== null; } catch { /* treat as none */ }
      if (hasPreference) return;
      setDarkState(e.matches);
      applyDark(e.matches);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  function setStyle(s: ThemeStyle) {
    setStyleState(s);
    safeWrite(THEME_KEY, s);
    applyTheme(s, font);
  }

  function setFont(f: ThemeFont) {
    setFontState(f);
    safeWrite(FONT_KEY, f);
    applyTheme(style, f);
  }

  function setDark(d: boolean) {
    setDarkState(d);
    safeWrite('ui-dark', String(d));
    applyDark(d);
  }

  function toggleDark() {
    setDark(!dark);
  }

  return (
    <ThemeContext.Provider value={{ style, font, dark, setStyle, setFont, setDark, toggleDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
