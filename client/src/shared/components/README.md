# UI system

Everything visual comes from two places: **design tokens** in `src/index.css`
and the **shared components** in this folder. If you are writing a Tailwind
colour or a border radius by hand in a page, it is almost certainly a mistake.

## Why

Before this system the app contained ~200 hand-rolled `<button>` elements in
six real variants, five parallel input systems, five table-header styles, five
tab styles, and 14 hand-rolled modal overlays despite `Modal` existing. Four
themes were selectable but only restyled modals, because the app used 658
hardcoded `rounded-*` classes against 21 uses of the theme variables.

## Tokens

Colour tokens are stored as bare `R G B` triples so Tailwind's opacity
modifiers keep working (`bg-surface/60`, `border-line/40`).

| Use | Class | Replaces |
| --- | --- | --- |
| Page background | `bg-canvas` | `bg-slate-50 dark:bg-slate-900` |
| Card / panel | `bg-surface` | `bg-white dark:bg-gray-900` |
| Popover / modal | `bg-surface-raised` | `bg-white dark:bg-gray-900` |
| Wells, table headers, tiles | `bg-surface-sunken` | `bg-gray-50 dark:bg-gray-800` |
| Row hover | `hover:bg-surface-hover` | `hover:bg-gray-50 dark:hover:bg-gray-800` |
| Default border | `border-line` | `border-gray-200 dark:border-gray-700` |
| Divider | `border-line-subtle` | `border-gray-100 dark:border-gray-800` |
| Emphasised border | `border-line-strong` | `border-gray-300 dark:border-gray-600` |
| Primary text | `text-fg` | `text-gray-900 dark:text-white` |
| Secondary text | `text-fg-muted` | `text-gray-500 dark:text-gray-400` |
| Tertiary text | `text-fg-subtle` | `text-gray-400 dark:text-gray-500` |
| Brand fill | `bg-accent text-accent-fg` | `bg-brand-600 text-white` |
| Brand tint | `bg-accent-soft text-accent-soft-fg` | `bg-brand-50 text-brand-700` |

Status tokens: `success` / `warning` / `danger` / `info`, each with `-soft`
(tinted background) and `-fg` (readable text on that tint).

**These tokens already flip for dark mode.** Once a colour is a token, you do
not add a `dark:` variant — adding one usually reintroduces the bug you just
fixed.

The `brand-50…950` scale is bound to the active theme's accent ramp, so
existing `bg-brand-600` works and is theme-aware. Prefer `bg-accent` in new code.

Radius and shadow: `rounded-btn`, `rounded-card`, `rounded-input`,
`rounded-badge`, `rounded-modal`, and `shadow-ui-sm|md|lg`. Avoid literal
`rounded-xl` — it is fixed at 12px and will not follow the theme.

Density: `h-ctl-xs|sm|md|lg` for controls, `p-card` for card padding,
`space-y-section` for page rhythm. These vary per theme, which is what makes
Classic genuinely dense and Friendly genuinely airy.

## Components

```tsx
import { Button, Card, Field, Input, DataTable } from '../shared/components';
```

| Need | Use | Not |
| --- | --- | --- |
| Any button | `<Button variant size icon loading>` | a raw `<button>` with Tailwind |
| Icon-only button | `<IconButton label icon tone>` | `<button className="p-1.5 …">` |
| Panel | `<Card padding tone>` | `bg-white rounded-xl border …` |
| Metric | `<StatTile label value icon>` | a bespoke stat div |
| Labelled input | `<Field label error><Input/></Field>` | `<label className="form-label">` + `<input>` |
| Text / number entry | `<Input>` | `<input className="ui-input">` |
| Dropdown | `<Select options>` | `<select className="ui-input">` |
| Searchable dropdown | `<SearchableSelect>` | a custom combobox |
| Table | `<DataTable columns rows>` or `<Table><Th/><Td/>` | a raw `<table>` |
| Tabs | `<Tabs variant="underline\|segmented\|pill">` | a hand-rolled tab strip |
| Status pill | `<Badge variant>` / `<StatusBadge value map>` | a local colour map |
| Tinted message | `<Alert tone title>` | `bg-amber-50 border border-amber-100 …` |
| Field error | `<FormError>` | `text-[12.5px] text-red-600 …` |
| Person | `<Avatar name size>` | an initials div |
| Dialog | `<Modal open onClose title footer>` | `fixed inset-0 bg-black/50 …` |
| Empty list | `<EmptyState icon title description action>` | `py-16 text-center text-gray-400` |
| Loading | `<Spinner>` / `<SkeletonTable>` | a bare `animate-spin` |
| Page shell | `<PageHeader>` + `<PageBody>` | per-page `p-6` guesses |
| Filter bar | `<Toolbar>` | `flex items-center gap-2 flex-wrap` |
| Toast | `addToast({ type, message })` | inline banners |

Floating surfaces (dropdowns, menus, popovers) use the `.ui-popover` class so
they share one elevation and border treatment.

## Adding a theme

Copy an entire `[data-theme="…"]` block in `index.css` — every theme must
define every token, there is no inheritance between them. Add the name to
`THEME_STYLES`, `THEME_LABELS` and `THEME_ACCENTS` in `contexts/ThemeContext.tsx`,
and to the allow-list in the bootstrap script in `index.html`. Dark overrides
live under `html.dark`, whose specificity beats any `[data-theme]` block, so a
new theme cannot silently lose dark mode.
