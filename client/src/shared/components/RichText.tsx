/**
 * RichText — the one safe way to display formatted content anywhere in the app.
 *
 * Content arrives in three shapes and this component normalises all of them:
 *   • HTML from the RichTextEditor (starts with a tag) — sanitised and shown.
 *   • Markdown (KB articles written before the editor existed, and everything
 *     the AI generates) — converted with `marked`, then sanitised.
 *   • Plain text — preserved with line breaks.
 *
 * DOMPurify runs on EVERY path even though the server also sanitises on
 * write: defence in depth, because this component is also fed AI output and
 * legacy rows the server never re-scrubbed.
 */
import { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.setOptions({ breaks: true, gfm: true });

const looksLikeHtml = (s: string) => /^\s*</.test(s) && /<\/?[a-z][\s\S]*>/i.test(s);
const looksLikeMarkdown = (s: string) =>
  /(^|\n)#{1,6}\s|\*\*[^*]+\*\*|(^|\n)\s*[-*+]\s|\[[^\]]+\]\([^)]+\)|`[^`]+`/.test(s);

const PURIFY_OPTS = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre', 'blockquote',
    'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'a', 'img', 'hr',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div', 'mark',
  ],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'target', 'rel', 'class'],
  // data: URIs power inline images (see RichTextEditor's upload path);
  // everything else is restricted to http(s)/mailto.
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|data:image\/(?:png|jpe?g|gif|webp);base64,)/i,
};

export function toSafeHtml(raw: string | null | undefined): string {
  if (!raw) return '';
  const html = looksLikeHtml(raw)
    ? raw
    : looksLikeMarkdown(raw)
      ? (marked.parse(raw) as string)
      : raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>');
  const clean = DOMPurify.sanitize(html, PURIFY_OPTS);
  // External links open safely in a new tab.
  return clean.replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ');
}

export function RichText({ content, className = '' }: { content: string | null | undefined; className?: string }) {
  const html = useMemo(() => toSafeHtml(content), [content]);
  if (!html) return null;
  return (
    <div
      className={`rich-text ${className}`}
      // Safe: everything above passed through DOMPurify with a strict allowlist.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
