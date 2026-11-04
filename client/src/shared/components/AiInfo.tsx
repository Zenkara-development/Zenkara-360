import { useState, useRef, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPopover, popoverStyle } from './useAnchoredPopover';
import { Info, X, Sparkles, PenLine, Eye, AlertTriangle, Lock } from 'lucide-react';
import { AI_FEATURE, EFFECT_LABEL, type AiFeature } from '../ai/aiFeatures';

/**
 * The explanation that sits beside an AI control.
 *
 * Two shapes, both reading from the same catalogue in `shared/ai/aiFeatures.ts`:
 *
 *   <AiInfo id="lead.score" />        — a small ⓘ button next to a control.
 *   <AiNote id="lead.score" />        — a persistent sentence inside a panel.
 *
 * The popover always answers the three questions the audit found unanswered
 * anywhere in the UI: what it does, what data leaves your server, and whether
 * it will change a record without asking.
 */

function EffectRow({ feature }: { feature: AiFeature }) {
  const writes = feature.effect === 'writes';
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-badge text-[11px] font-medium ring-1 ring-inset ${
        writes
          ? 'bg-warning-soft text-warning-fg ring-warning/30'
          : 'bg-surface-sunken text-fg-muted ring-line'
      }`}
    >
      {writes ? <PenLine size={11} /> : <Eye size={11} />}
      {EFFECT_LABEL[feature.effect]}
    </span>
  );
}

function TierRow({ feature }: { feature: AiFeature }) {
  if (feature.tier === 'free') return null;
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-badge text-[11px] font-medium bg-accent-soft text-accent-soft-fg ring-1 ring-inset ring-accent/25">
      <Lock size={10} />
      Pro plan
    </span>
  );
}

function Body({ feature }: { feature: AiFeature }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 flex-wrap">
        <EffectRow feature={feature} />
        <TierRow feature={feature} />
      </div>

      <p className="text-[12.5px] text-fg leading-relaxed">{feature.does}</p>

      <div>
        <p className="text-[10.5px] font-semibold uppercase tracking-wider text-fg-subtle mb-1">
          What is sent to the AI
        </p>
        <p className="text-[12px] text-fg-muted leading-relaxed">{feature.sends}</p>
      </div>

      {feature.fallback && (
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-fg-subtle mb-1">
            If AI is unavailable
          </p>
          <p className="text-[12px] text-fg-muted leading-relaxed">{feature.fallback}</p>
        </div>
      )}

      {feature.caveat && (
        <p className="flex items-start gap-1.5 text-[12px] text-warning-fg bg-warning-soft border border-warning/25 rounded-card px-2.5 py-2 leading-relaxed">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span>{feature.caveat}</span>
        </p>
      )}
    </div>
  );
}

export interface AiInfoProps {
  /** Key from AI_FEATURES. An unknown id renders nothing rather than crashing. */
  id: string;
  className?: string;
  /** Which side to open towards, when the control sits at a screen edge. */
  align?: 'left' | 'right';
}

export function AiInfo({ id, className = '', align = 'right' }: AiInfoProps) {
  const feature = AI_FEATURE[id];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const panelId = useId();
  /* Portaled and viewport-clamped. As a plain absolute panel this was 300px
     wide anchored to its trigger, so on a phone an ⓘ past the halfway point
     pushed it off the right edge — and 45 of the pages it sits on wrap content
     in an `overflow-hidden` card that would clip it regardless. */
  const { triggerRef, panelRef, position } = useAnchoredPopover<HTMLButtonElement>(open, {
    width: 300, align, estimatedHeight: 340,
  });

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // A missing catalogue entry is a documentation gap, not a crash. Render
  // nothing so a typo'd id degrades quietly in production.
  if (!feature) return null;

  return (
    <span ref={ref} className={`relative inline-flex ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`About ${feature.name}`}
        title={`About ${feature.name}`}
        className="inline-flex items-center justify-center w-5 h-5 rounded-full text-fg-subtle hover:text-accent hover:bg-accent-soft transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
      >
        <Info size={13} />
      </button>

      {open && position && createPortal(
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={feature.name}
          style={popoverStyle(position)}
          className="z-[400] ui-popover p-3.5 animate-slide-down"
        >
          <div className="flex items-start justify-between gap-2 mb-2.5">
            <p className="text-[13px] font-semibold text-fg flex items-center gap-1.5">
              <Sparkles size={13} className="text-accent shrink-0" />
              {feature.name}
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="shrink-0 -mr-1 -mt-0.5 p-1 rounded-btn text-fg-subtle hover:text-fg hover:bg-surface-hover transition-colors"
            >
              <X size={12} />
            </button>
          </div>
          <Body feature={feature} />
        </div>,
        document.body,
      )}
    </span>
  );
}

/**
 * Always-visible one-liner for the top of an AI panel, where a click-to-open
 * popover would be too easy to miss. Shows the summary and the effect badge;
 * the ⓘ button beside it opens the full detail.
 */
export function AiNote({ id, className = '' }: { id: string; className?: string }) {
  const feature = AI_FEATURE[id];
  if (!feature) return null;

  return (
    <p className={`flex items-start gap-1.5 text-[12px] text-fg-muted leading-relaxed ${className}`}>
      <Sparkles size={12} className="shrink-0 mt-0.5 text-accent" />
      <span>
        {feature.does}{' '}
        {feature.caveat && <span className="text-warning-fg">{feature.caveat}</span>}
        <AiInfo id={id} className="ml-1 align-text-bottom" />
      </span>
    </p>
  );
}

/**
 * Inline label for content a model produced, so AI output is never mistaken
 * for something a colleague wrote or for saved data.
 */
export function AiGeneratedTag({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-badge text-[10px] font-medium bg-accent-soft text-accent-soft-fg ${className}`}
    >
      <Sparkles size={9} />
      AI generated — review before use
    </span>
  );
}
