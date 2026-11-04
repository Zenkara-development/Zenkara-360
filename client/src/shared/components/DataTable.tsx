/**
 * DataTable — one table style for the whole product.
 *
 * The audit found five mutually incompatible table-header styles:
 *   • `text-left px-4 py-3 … tracking-wider` (21 uses, CRM/IT Desk)
 *   • `px-4 py-3 text-left … tracking-wide` (25 uses, top-level pages)
 *   • a light-only fork of that with no `dark:` at all (12 uses, TemplatesPage)
 *   • `pb-2 font-medium` on a bare `<tr>` (14 uses, HR + public docs)
 *   • styles hoisted onto `<thead>` (PlatformAdminPage)
 * They differed in letter-spacing, padding, which element carried the
 * background, and whether dark mode worked.
 *
 * The visual now lives in the `.ui-table` CSS class (index.css) so it is
 * theme-aware and row density follows --ui-row-py. This file provides both a
 * declarative API (`<DataTable columns rows>`) for straightforward lists and
 * composable parts (`<Table><Th/><Td/>`) for tables with complex cells.
 */

import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

/* ── Composable parts ──────────────────────────────────────────────── */

export function Table({
  children,
  minWidth,
  clickableRows = false,
  className = '',
}: {
  children: React.ReactNode;
  /** Below this the container scrolls horizontally instead of squashing cells. */
  minWidth?: number;
  clickableRows?: boolean;
  className?: string;
}) {
  return (
    <div className="table-container">
      <table
        className={`ui-table ${clickableRows ? 'ui-table--clickable' : ''} ${className}`}
        style={minWidth ? { minWidth } : undefined}
      >
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  align = 'left',
  hideBelow,
  sortable,
  sorted,
  onSort,
  className = '',
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & {
  align?: 'left' | 'right' | 'center';
  /** Hide this column under the given breakpoint. */
  hideBelow?: 'sm' | 'md' | 'lg';
  sortable?: boolean;
  sorted?: 'asc' | 'desc' | false;
  onSort?: () => void;
}) {
  const hide = hideBelow ? { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' }[hideBelow] : '';
  const alignCls = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : '';

  return (
    <th
      {...props}
      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
      className={`${hide} ${alignCls} ${className}`}
    >
      {sortable ? (
        <button
          type="button"
          onClick={onSort}
          className={`inline-flex items-center gap-1 hover:text-fg transition-colors ${
            align === 'right' ? 'flex-row-reverse' : ''
          }`}
        >
          {children}
          {sorted === 'asc' ? <ArrowUp size={11} />
            : sorted === 'desc' ? <ArrowDown size={11} />
            : <ArrowUpDown size={11} className="opacity-40" />}
        </button>
      ) : children}
    </th>
  );
}

export function Td({
  children,
  align = 'left',
  hideBelow,
  muted,
  className = '',
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & {
  align?: 'left' | 'right' | 'center';
  hideBelow?: 'sm' | 'md' | 'lg';
  /** Secondary cell — de-emphasised text. */
  muted?: boolean;
}) {
  const hide = hideBelow ? { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' }[hideBelow] : '';
  const alignCls = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : '';
  return (
    <td {...props} className={`${hide} ${alignCls} ${muted ? '!text-fg-muted' : ''} ${className}`}>
      {children}
    </td>
  );
}

/* ── Declarative API ───────────────────────────────────────────────── */

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  /** Cell renderer. Return any node; keep it cheap, it runs per row. */
  cell: (row: T, index: number) => React.ReactNode;
  align?: 'left' | 'right' | 'center';
  hideBelow?: 'sm' | 'md' | 'lg';
  muted?: boolean;
  width?: string | number;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  minWidth?: number;
  /** Shown in place of the body when `rows` is empty. */
  empty?: React.ReactNode;
  loading?: boolean;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  minWidth,
  empty,
  loading,
  className = '',
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div className="p-4 space-y-2">
        <div className="skeleton h-9 w-full" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton h-12 w-full" style={{ opacity: 1 - i * 0.15 }} />
        ))}
      </div>
    );
  }

  if (!rows.length && empty) return <>{empty}</>;

  return (
    <Table minWidth={minWidth} clickableRows={!!onRowClick} className={className}>
      <thead>
        <tr>
          {columns.map(c => (
            <Th
              key={c.key}
              align={c.align}
              hideBelow={c.hideBelow}
              style={c.width ? { width: c.width } : undefined}
            >
              {c.header}
            </Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr
            key={rowKey(row, i)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
          >
            {columns.map(c => (
              <Td key={c.key} align={c.align} hideBelow={c.hideBelow} muted={c.muted}>
                {c.cell(row, i)}
              </Td>
            ))}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
