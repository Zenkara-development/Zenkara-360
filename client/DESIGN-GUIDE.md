# CRMITdesk Evolved — UI Design Guide

One design language for the whole product. Every screen in CRM, IT Desk, HR,
Admin and Portal follows these rules. If a page deviates, fix the page, not
the rule.

## Tokens, never raw palette classes

All color comes from semantic tokens (see `src/index.css` + `tailwind.config.js`):

- Surfaces: `bg-canvas`, `bg-surface`, `bg-surface-raised`, `bg-surface-sunken`, `bg-surface-hover`
- Borders: `border-line`, `border-line-strong`, `border-line-subtle`
- Text: `text-fg`, `text-fg-muted`, `text-fg-subtle`
- Accent (means "this is us / selected / primary"): `bg-accent`, `text-accent`, `bg-accent-soft`, `text-accent-soft-fg`, `hover:bg-accent-hover`
- Status: `success` / `warning` / `danger` / `info`, each with `-soft` and `-fg` (e.g. `bg-danger-soft text-danger-fg`)

Never write `bg-white`, `dark:bg-gray-900`, `text-gray-500`, `bg-indigo-600`,
`text-violet-500`, `focus:ring-brand-500`, etc. in pages. The only sanctioned
fixed hues are inside `Badge` (status pills keep universal meaning across
themes) and chart series colors from `shared/chartTheme.ts`.

## Components, never hand-rolled markup

- Page scaffold: `PageHeader` (title, subtitle, actions, `below` for tabs/filters) + `PageBody` (`narrow` for settings/forms, `wide` default). Never invent page padding.
- Panels: `Card` / `CardHeader` / `CardSection` / `StatTile`. Not every group needs a border — prefer whitespace over nested boxes.
- Tables: `DataTable` or `Table`/`Th`/`Td` (`.ui-table`). Loading = built-in skeleton, empty = `EmptyState` (explain + CTA, e.g. "No leads yet. Add your first lead or import contacts." with buttons). Secondary row actions go in `RowActions` overflow menu, not a row of icon buttons.
- Forms: `Field`-family inputs or `.ui-input`; labels via `.form-label`; group long forms with `.form-section` + `.form-section-title`; hints/errors via `.form-hint`. One primary button per form, right-aligned in the footer.
- Buttons: `Button` variants — `primary` (one per context), `secondary`, `ghost`, `outline`, `subtle`, `danger`. Never a raw `<button>` with visual classes for a normal action; `IconButton` for icon-only.
- Status: `Badge` / `StatusBadge` with the exported semantic maps (`ticketStatusVariant`, `priorityVariant`, …). No local color maps.
- Overlays: `Modal` (focused actions, `sm`/`md` sizes preferred) with footer actions; popovers use `.ui-popover` + `useAnchoredPopover`.
- States: `Spinner` only for inline waits; page/table waits use `.skeleton` blocks shaped like the content (no full-screen spinners, no layout jumps). Errors use `Alert` with a retry where possible.
- Keyboard hints: `.ui-kbd`.

## Type & spacing rhythm

- Page title 18px/semibold (PageHeader owns it). Section titles ~14px semibold or the 11px uppercase `SectionTitle` pattern. Body 13–13.5px. Metadata 11–12px `text-fg-muted`/`subtle`.
- Don't bold everything; hierarchy comes from size + color, not weight alone.
- Radii/heights come from theme vars: `rounded-btn|card|input|badge|modal`, `h-ctl*`. Avoid literal `rounded-xl`/`rounded-2xl` in new code.
- Numbers in tables/KPIs: `tabular-nums`.

## AI design language

AI features share one identity: `Sparkles` icon + accent color, `AiInfo`
explainer, `AiGeneratedTag` on generated output, `AIConfidenceBadge` where
confidence exists. AI actions appear contextually (in the record they act on),
not as decorative "AI" labels.

## Interaction

- Transitions 100–200ms; `animate-fade-in`/`scale-in`/`slide-up` where they aid comprehension. Nothing flashy.
- Every interactive element: visible hover + `focus-visible` state, cursor-pointer, ≥32px touch target.
- Truncate long user content (`truncate` / `line-clamp-*`) — never let it break layout; keep the full value in `title=`.

## Responsive

- Tables: hide secondary columns with `hideBelow`, never the actions column.
- Toolbars/filters wrap (`flex-wrap`); grids collapse `lg:grid-cols-N → sm:2 → 1`.
- Modals become bottom sheets on mobile (built into `Modal`).
