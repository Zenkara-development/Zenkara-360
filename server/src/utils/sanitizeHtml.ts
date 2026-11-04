/**
 * Server-side HTML sanitisation for user-authored rich content (comments,
 * ticket bodies, KB articles). The client's DOMPurify pass is a courtesy;
 * THIS is the security boundary — API callers (integrations, curl, a
 * compromised client) bypass the browser entirely.
 *
 * Plain text and markdown pass through untouched: sanitize-html only strips
 * tags, and text without tags has none to strip — so legacy rows and
 * AI-generated markdown are unaffected.
 */
import sanitize from 'sanitize-html';

const OPTIONS: sanitize.IOptions = {
  allowedTags: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre', 'blockquote',
    'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'a', 'img', 'hr',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div', 'mark',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title'],
    '*': ['class'],
  },
  // http(s)/mailto links, plus base64 data URIs for the editor's inline
  // images. javascript:, vbscript:, file: etc. are all rejected.
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  allowProtocolRelative: false,
  // A single pasted phone photo is ~100-300KB as a data URL; 2MB of markup
  // per field is generous without letting one row balloon the table.
  textFilter: undefined,
};

const MAX_LENGTH = 2 * 1024 * 1024;

export function sanitizeRichText<T extends string | null | undefined>(html: T): T {
  if (html === null || html === undefined || html === '') return html;
  const bounded = String(html).slice(0, MAX_LENGTH);
  return sanitize(bounded, OPTIONS) as T;
}
