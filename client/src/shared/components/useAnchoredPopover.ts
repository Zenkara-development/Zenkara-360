import { useState, useLayoutEffect, useEffect, useRef, type RefObject } from 'react';

/**
 * Positions a floating panel against a trigger, in viewport coordinates.
 *
 * An absolutely-positioned panel is laid out relative to its nearest
 * positioned ancestor, which means it is at the mercy of that subtree: an
 * ancestor with `overflow: hidden` clips it, and an ancestor with a z-index
 * traps it beneath anything painted higher. The app shell has both — the
 * root is `overflow-hidden`, the top bar is `z-30`, and `PageHeader` is a
 * sticky `z-20` stacking context — so a panel opened from inside a page could
 * be cut off or painted underneath the chrome.
 *
 * On a phone the clipping is what users actually notice: a 288px panel opened
 * from a trigger 196px along a 390px-wide screen runs ~94px past the right
 * edge and is simply gone. That was measurable on the Appearance panel.
 *
 * `RowActions` already solved this with a portal plus fixed coordinates; this
 * hook is that approach extracted so every popover can share it.
 *
 * Returns coordinates to spend on a `position: fixed` element rendered through
 * `createPortal(…, document.body)`. Panels are clamped horizontally to stay on
 * screen, flipped above the trigger when there is no room below, and closed on
 * scroll or resize rather than tracked live — the same trade-off RowActions
 * makes, and it keeps the panel from drifting away from its anchor.
 */

export interface AnchoredPopoverOptions {
  /** Panel width in px. Clamped down on screens narrower than this + margins. */
  width: number;
  /** Which trigger edge the panel lines up with when there is room. */
  align?: 'left' | 'right';
  /** Preferred side. Flips automatically when it does not fit. */
  placement?: 'bottom' | 'top';
  /** Space between trigger and panel. */
  gap?: number;
  /** Estimated panel height, used only to decide whether to flip. */
  estimatedHeight?: number;
}

export interface AnchoredPosition {
  /** Set when the panel hangs below the trigger. */
  top?: number;
  /** Set when the panel opens upward — measured from the viewport bottom.
      Anchoring the panel's BOTTOM edge is what makes an upward flip correct:
      positioning by `top` requires knowing the panel's height in advance, and
      when the real content is taller than the estimate the panel grows past
      the trigger and off the bottom of the screen. */
  bottom?: number;
  left: number;
  width: number;
  /** Cap so a tall panel scrolls instead of running off-screen. */
  maxHeight: number;
}

const EDGE = 8;

/** Decide which side to open on, and return a top- or bottom-anchored offset. */
function place(
  r: DOMRect, vh: number, gap: number,
  placement: 'bottom' | 'top', estimatedHeight: number,
): { top?: number; bottom?: number; maxHeight: number } {
  const below = vh - r.bottom - gap - EDGE;
  const above = r.top - gap - EDGE;
  const wantAbove = placement === 'top' ? above > 160 : below < Math.min(estimatedHeight, 200) && above > below;

  return wantAbove
    // Anchored to the viewport bottom so the panel grows upward from the
    // trigger regardless of how tall its content turns out to be.
    ? { bottom: Math.max(EDGE, vh - r.top + gap), maxHeight: Math.max(140, above) }
    : { top: r.bottom + gap, maxHeight: Math.max(140, below) };
}

export function useAnchoredPopover<T extends HTMLElement = HTMLElement>(
  open: boolean,
  {
    width,
    align = 'left',
    placement = 'bottom',
    gap = 6,
    estimatedHeight = 320,
  }: AnchoredPopoverOptions,
): {
  triggerRef: RefObject<T>;
  panelRef: RefObject<HTMLDivElement>;
  position: AnchoredPosition | null;
} {
  const triggerRef = useRef<T>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<AnchoredPosition | null>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setPosition(null);
      return;
    }
    const r = triggerRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Never wider than the screen allows. This is what stops a 300px panel
    // from disappearing off a 390px phone.
    const w = Math.min(width, vw - EDGE * 2);

    // Line up with the requested edge, then pull back inside the viewport.
    const preferred = align === 'right' ? r.right - w : r.left;
    const left = Math.max(EDGE, Math.min(preferred, vw - w - EDGE));

    setPosition({ ...place(r, vh, gap, placement, estimatedHeight), left, width: w });
  }, [open, width, align, placement, gap, estimatedHeight]);

  // Close-on-outside-click and Escape are left to the caller, which already
  // owns its `open` state; this hook only positions. But scroll and resize
  // invalidate the anchor, so recompute on those.
  useEffect(() => {
    if (!open) return;
    const recompute = () => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = Math.min(width, vw - EDGE * 2);
      const preferred = align === 'right' ? r.right - w : r.left;
      const left = Math.max(EDGE, Math.min(preferred, vw - w - EDGE));
      setPosition({ ...place(r, vh, gap, placement, estimatedHeight), left, width: w });
    };
    window.addEventListener('resize', recompute);
    window.addEventListener('scroll', recompute, true);
    return () => {
      window.removeEventListener('resize', recompute);
      window.removeEventListener('scroll', recompute, true);
    };
  }, [open, width, align, placement, gap, estimatedHeight]);

  return { triggerRef, panelRef, position };
}

/** Style object for the portaled panel. */
export function popoverStyle(p: AnchoredPosition): React.CSSProperties {
  return {
    position: 'fixed',
    ...(p.top !== undefined ? { top: p.top } : { bottom: p.bottom }),
    left: p.left,
    width: p.width,
    maxHeight: p.maxHeight,
    overflowY: 'auto',
  };
}
