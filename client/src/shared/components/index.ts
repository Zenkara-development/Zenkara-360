/**
 * Shared component barrel.
 *
 * Import from here (`import { Button, Card } from '../shared/components'`)
 * rather than reaching into individual files — two pages previously imported
 * via deep paths and so never saw the barrel's other exports.
 */

// ── Layout & page chrome ──────────────────────────────────────────────
export * from './PageHeader';       // PageHeader, PageBody, Toolbar, SectionHeader
export * from './Card';             // Card, CardHeader, CardSection, StatTile
export * from './PastelStat';       // PastelStatCard — pastel KPI tile
export * from './Modal';
export * from './Tabs';

// ── Controls ──────────────────────────────────────────────────────────
export * from './Button';
export * from './IconButton';
export * from './Field';            // Field, Label, Input, Textarea, Select, Checkbox, Toggle, FormGrid, FormActions
export * from './SearchInput';
export * from './SearchableSelect';
export * from './RowActions';

// ── Data display ──────────────────────────────────────────────────────
export * from './DataTable';        // DataTable, Table, Th, Td, Column
export * from './Badge';            // Badge, StatusBadge, humanise, *Variant maps
export * from './Avatar';
export * from './EmptyState';
export * from './Alert';            // Alert, FormError

// ── Feedback ──────────────────────────────────────────────────────────
export * from './Spinner';          // Spinner, InlineSpinner
export * from './SkeletonCard';     // SkeletonCard, SkeletonTable, SkeletonStats
export * from './ToastContainer';
export * from './toastStore';

// ── Domain widgets ────────────────────────────────────────────────────
export * from './ThemePicker';
export * from './useAnchoredPopover';  // portal positioning for popovers
export * from './AiInfo';         // AiInfo, AiNote, AiGeneratedTag
export * from './AITypewriter';
export * from './AIConfidenceBadge';
export * from './AISuggestionPill';
export * from './AISmartSearch';
export * from './CustomFieldsFormFields';
export * from './CustomFieldsDisplay';
export * from './RecordTemplatePicker';
export * from './ScheduleReminderPanel';
export * from './RecordTasks';   // tasks attached to any record
export * from './RecordTags';    // tags attached to any record
export * from './AccessDenied';
export * from './ErrorBoundary';
export * from './RelatedRecords';  // universal "everything under this record" panel
export * from './RichText';        // safe renderer for HTML/markdown content
export * from './RichTextEditor';  // TipTap editor producing sanitised HTML
