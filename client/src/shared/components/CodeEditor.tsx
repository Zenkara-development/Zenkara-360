import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from 'react';

/**
 * A small code editor with line numbers and syntax highlighting.
 *
 * The product has no editor dependency (no CodeMirror, no Monaco), and
 * pulling one in for two text fields would be a heavy addition, so this is
 * the classic technique: a transparent <textarea> sitting exactly on top of
 * a highlighted <pre>. The caret, selection and keyboard handling are the
 * browser's own; the colours are ours.
 *
 * Both layers must agree exactly on font metrics, padding and line-height,
 * or the caret drifts away from the text it is supposed to sit in.
 */

export type CodeLanguage = 'html' | 'css';

export interface CodeEditorHandle {
  /** Inserts text where the caret is. */
  insert: (snippet: string) => void;
  focus: () => void;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  language: CodeLanguage;
  placeholder?: string;
  height?: number;
  readOnly?: boolean;
  ariaLabel?: string;
  id?: string;
}

const MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Wraps the interesting parts of HTML in spans. */
function highlightHtml(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i);
      const stop = end === -1 ? src.length : end + 3;
      out += `<span class="tk-comment">${escHtml(src.slice(i, stop))}</span>`;
      i = stop;
      continue;
    }
    if (src[i] === '<') {
      const end = src.indexOf('>', i);
      if (end === -1) { out += escHtml(src.slice(i)); break; }
      // The angle brackets have to be escaped before the tokens are marked
      // up, or the browser reads the markup as elements and the editor
      // shows a tag with its name missing.
      const tag = src.slice(i, end + 1).replace(/</g, '&lt;').replace(/>/g, '&gt;');
      // The attributes are marked up FIRST: the tag-name rule below would
      // otherwise match the class="tk-tag" of the span it had just inserted.
      out += tag
        .replace(/([a-zA-Z-:]+)(=)("([^"]*)"|'([^']*)')/g, (_m, name, eq, dq, sq) => {
          const value = dq !== undefined ? `"${dq}"` : `'${sq}'`;
          return `<span class="tk-attr">${name}</span>${eq}<span class="tk-string">${value}</span>`;
        })
        .replace(/^&lt;\/?([a-zA-Z0-9-]+)/, (_m, name) => `&lt;<span class="tk-tag">${name}</span>`);
      i = end + 1;
      continue;
    }
    const next = src.indexOf('<', i);
    const stop = next === -1 ? src.length : next;
    out += `<span class="tk-text">${escHtml(src.slice(i, stop))}</span>`;
    i = stop;
  }
  return out;
}

/** Wraps the interesting parts of CSS in spans. */
function highlightCss(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => `<span class="tk-comment">${escHtml(m)}</span>`)
    .replace(/([a-zA-Z-]+)(\s*:\s*)([^;{}\n]*)/g, (_m, prop, sep, value) =>
      `<span class="tk-attr">${escHtml(prop)}</span><span class="tk-punct">${escHtml(sep)}</span><span class="tk-string">${escHtml(value)}</span>`)
    .replace(/([.#][a-zA-Z0-9_-]+)/g, '<span class="tk-tag">$1</span>');
}

export const CodeEditor = forwardRef<CodeEditorHandle, Props>(function CodeEditor(
  { value, onChange, language, placeholder, height = 320, readOnly, ariaLabel, id }, ref,
) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const html = useMemo(() => (language === 'html' ? highlightHtml(value) : highlightCss(value)), [value, language]);
  const lines = useMemo(() => Math.max(1, value.split('\n').length), [value]);

  const sync = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    if (layerRef.current) layerRef.current.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
    if (gutterRef.current) gutterRef.current.style.transform = `translateY(${-ta.scrollTop}px)`;
  }, []);

  const insert = useCallback((snippet: string) => {
    const ta = taRef.current;
    if (!ta) { onChange(value + snippet); return; }
    const start = ta.selectionStart ?? value.length;
    const end = ta.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + snippet + value.slice(end));
    requestAnimationFrame(() => {
      ta.focus();
      const caret = start + snippet.length;
      ta.setSelectionRange(caret, caret);
    });
  }, [value, onChange]);

  useImperativeHandle(ref, () => ({
    insert,
    focus: () => taRef.current?.focus(),
  }), [insert]);

  return (
    <div className="relative overflow-hidden rounded-lg border border-line bg-surface" style={{ height }}>
      {/* line numbers */}
      <div className="absolute left-0 top-0 bottom-0 w-10 overflow-hidden bg-surface-sunken border-r border-line-subtle select-none pointer-events-none">
        <div ref={gutterRef} className="py-2.5 text-right pr-2 font-mono text-[11.5px] leading-[1.6] text-fg-subtle tabular-nums">
          {Array.from({ length: lines }, (_, i) => <div key={i}>{i + 1}</div>)}
        </div>
      </div>

      {/* highlighted text */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div ref={layerRef} className="pl-12 py-2.5 pr-3 will-change-transform">
          <pre className="font-mono text-[12px] leading-[1.6] whitespace-pre-wrap break-words m-0"><code dangerouslySetInnerHTML={{ __html: html || '&nbsp;' }} /></pre>
        </div>
      </div>

      {/* the editor itself */}
      <textarea
        id={id}
        ref={taRef}
        value={value}
        readOnly={readOnly}
        aria-label={ariaLabel}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        onChange={e => onChange(e.target.value)}
        onScroll={sync}
        placeholder={placeholder}
        className="absolute inset-0 pl-12 py-2.5 pr-3 bg-transparent text-transparent caret-[var(--ui-fg,#111827)] resize-none outline-none font-mono text-[12px] leading-[1.6] whitespace-pre-wrap break-words overflow-auto"
        style={{ fontFamily: MONO }}
      />
    </div>
  );
});
