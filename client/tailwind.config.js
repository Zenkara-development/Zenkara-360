/** @type {import('tailwindcss').Config} */

/* Colour tokens live in src/index.css as bare "R G B" triples so that
   Tailwind's `<alpha-value>` placeholder works here. That is what keeps
   `bg-surface/60`, `border-line/40` and `dark:bg-brand-500/10` valid —
   a #hex in the CSS var would break every one of those.

   `token()` wraps that boilerplate. `ramp()` builds a full 50→950 scale
   from the per-theme accent ramp. */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const ramp = (name) =>
  Object.fromEntries(
    [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((step) => [
      step,
      token(`${name}-${step}`),
    ]),
  );

export default {
  // 'media' would mean every `dark:` class in the app only ever reacted
  // to the OS setting and the in-app toggle did nothing. 'class' lets
  // ThemeContext drive it by putting `dark` on <html>.
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // var(--font-sans), not a literal 'Inter' — otherwise the
        // `font-sans` utility hardcodes Inter and defeats the font picker.
        sans: ['var(--font-sans)', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        // The accent ramp. Every pre-existing `bg-brand-600` in the app
        // now follows the active theme and colour mode for free.
        brand: ramp('ui-accent'),
        accent: {
          DEFAULT: token('ui-accent'),
          hover: token('ui-accent-hover'),
          active: token('ui-accent-active'),
          fg: token('ui-accent-fg'),
          soft: token('ui-accent-soft'),
          'soft-fg': token('ui-accent-soft-fg'),
          ring: token('ui-accent-ring'),
        },

        // Semantic surfaces — replace `bg-white dark:bg-gray-900`
        canvas: token('ui-canvas'),
        surface: {
          DEFAULT: token('ui-surface'),
          raised: token('ui-surface-raised'),
          sunken: token('ui-surface-sunken'),
          hover: token('ui-surface-hover'),
        },

        // Borders — replace `border-gray-200 dark:border-gray-700`
        line: {
          DEFAULT: token('ui-line'),
          strong: token('ui-line-strong'),
          subtle: token('ui-line-subtle'),
        },

        // Text — replace `text-gray-900 dark:text-white`
        fg: {
          DEFAULT: token('ui-fg'),
          muted: token('ui-fg-muted'),
          subtle: token('ui-fg-subtle'),
        },

        // Status, so success/warning/danger stop being 40 hand-picked greens
        success: {
          DEFAULT: token('ui-success'),
          soft: token('ui-success-soft'),
          fg: token('ui-success-fg'),
        },
        warning: {
          DEFAULT: token('ui-warning'),
          soft: token('ui-warning-soft'),
          fg: token('ui-warning-fg'),
        },
        danger: {
          DEFAULT: token('ui-danger'),
          soft: token('ui-danger-soft'),
          fg: token('ui-danger-fg'),
        },
        info: {
          DEFAULT: token('ui-info'),
          soft: token('ui-info-soft'),
          fg: token('ui-info-fg'),
        },

        // Sidebar keeps its own scale: it is deliberately dark even in
        // light mode, so it cannot share the surface tokens.
        sidebar: {
          DEFAULT: token('ui-sidebar-bg'),
          fg: token('ui-sidebar-fg'),
          muted: token('ui-sidebar-muted'),
          heading: token('ui-sidebar-heading'),
          line: token('ui-sidebar-line'),
          hover: token('ui-sidebar-hover'),
          active: token('ui-sidebar-active-bg'),
          'active-fg': token('ui-sidebar-active-fg'),
        },
      },

      // Per-element radii, so `rounded-card` tracks the theme while the
      // literal `rounded-xl` (658 uses) keeps its old fixed value.
      borderRadius: {
        btn: 'var(--ui-btn-radius)',
        card: 'var(--ui-card-radius)',
        input: 'var(--ui-input-radius)',
        badge: 'var(--ui-badge-radius)',
        modal: 'var(--ui-modal-radius)',
        xl: '12px',
        '2xl': '16px',
      },

      boxShadow: {
        'ui-sm': 'var(--ui-shadow-sm)',
        'ui-md': 'var(--ui-shadow-md)',
        'ui-lg': 'var(--ui-shadow-lg)',
        'ui-modal': 'var(--ui-shadow-modal)',
        card: 'var(--ui-shadow-sm)',
        'card-hover': 'var(--ui-shadow-md)',
        topbar: '0 1px 0 0 rgb(0 0 0 / 0.06)',
        soft: 'var(--ui-shadow-md)',
        glow: '0 0 20px rgb(var(--ui-accent) / 0.35)',
        'inner-sm': 'inset 0 1px 3px 0 rgba(0,0,0,0.06)',
      },

      // Control heights and shell dimensions, so "Classic = dense" and
      // "Friendly = airy" are real rather than just a radius change.
      height: {
        ctl: 'var(--ui-ctl-h-md)',
        'ctl-xs': 'var(--ui-ctl-h-xs)',
        'ctl-sm': 'var(--ui-ctl-h-sm)',
        'ctl-md': 'var(--ui-ctl-h-md)',
        'ctl-lg': 'var(--ui-ctl-h-lg)',
        topbar: 'var(--ui-topbar-h)',
      },
      width: {
        sidebar: 'var(--ui-sidebar-w)',
      },
      spacing: {
        card: 'var(--ui-card-pad)',
        section: 'var(--ui-section-gap)',
      },

      // Keyframes are defined once, in index.css. Declaring them here as
      // well produced two `animate-scale-in` definitions with different
      // timings, and which one won depended on layer order.
      animation: {
        'pulse-fast': 'pulse 0.8s cubic-bezier(0.4,0,0.6,1) infinite',
        'bounce-sm': 'bounce 0.8s infinite',
      },
    },
  },
  plugins: [],
};
