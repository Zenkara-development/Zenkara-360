/**
 * The server-side PDF renderer for custom HTML payslip templates.
 *
 * PDFKit has no HTML engine in this build (no `htmlparser2` dependency, and
 * `doc.html()` is not available), and installing a headless browser on the
 * API box is not an option. So the template is laid out here, with the same
 * markup and the same CSS the browser preview uses.
 *
 * What it supports is deliberately the shape of a payslip:
 *
 *   • block flow — div, p, section, headings, lists, horizontal rules
 *   • inline runs — span, strong/b, em/i, u, s, code, with per-run styling
 *   • tables — thead/tbody/tr/td/th, colspan, alignment, borders, shading
 *   • images — data: URIs and remote http(s) URLs (guarded against
 *     internal addresses), sized from their width/height attributes
 *
 * CSS is resolved by `inlineCss()`: the author's stylesheet is applied to
 * every element it matches, and the element's own `style` attribute wins.
 * Only the properties the engine understands are honoured; the rest are
 * ignored here and still work in the browser preview — which is why the
 * designer is told, at save time, that flexbox and friends will not make it
 * into the PDF.
 */

import PDFDocument from 'pdfkit';
import type { PayslipDoc } from './payslipRender';
import {
  parseHtml, sanitizeCustomCss, substitute, type HtmlNode,
} from './payslipCustomRender';

// ─── Styles ──────────────────────────────────────────────────────────────────

interface Box { width: number; color: string; style: string }

interface Style {
  display: string;
  fontSize: number;
  bold: boolean; italic: boolean; underline: boolean; strike: boolean;
  color: string; background: string;
  align: 'left' | 'center' | 'right' | 'justify';
  valign: 'top' | 'middle' | 'bottom';
  fontFamily: string;
  letterSpacing: number;
  lineHeight: number;
  textTransform: string;
  padding: { t: number; r: number; b: number; l: number };
  margin: { t: number; r: number; b: number; l: number };
  border: { t: Box; r: Box; b: Box; l: Box };
  widthPx: number | null;
  heightPx: number | null;
  whiteSpace: string;
}

const DEFAULT_FONT = 'Helvetica';

function baseStyle(): Style {
  return {
    display: 'block', fontSize: 10, bold: false, italic: false, underline: false, strike: false,
    color: '#111827', background: 'transparent', align: 'left', valign: 'top',
    fontFamily: DEFAULT_FONT, letterSpacing: 0, lineHeight: 1.35, textTransform: 'none',
    padding: { t: 0, r: 0, b: 0, l: 0 }, margin: { t: 0, r: 0, b: 0, l: 0 },
    border: {
      t: { width: 0, color: '#d1d5db', style: 'solid' },
      r: { width: 0, color: '#d1d5db', style: 'solid' },
      b: { width: 0, color: '#d1d5db', style: 'solid' },
      l: { width: 0, color: '#d1d5db', style: 'solid' },
    },
    widthPx: null, heightPx: null, whiteSpace: 'normal',
  };
}

const NUM = /^-?[\d.]+(px|pt|em|rem|%)?$/;

function toPx(v: string, fontSize: number): number | null {
  const s = String(v).trim();
  if (!NUM.test(s)) return null;
  const n = parseFloat(s);
  const unit = s.match(/(px|pt|em|rem|%)$/)?.[1] || 'px';
  switch (unit) {
    case 'pt': return n * (96 / 72);
    case 'em': case 'rem': return n * fontSize;
    case '%': return null;               // percentages need a container — handled by the caller
    default: return n;
  }
}

function parseBox(v: string): { width: number; color: string; style: string } {
  const parts = String(v).trim().split(/\s+/);
  const out = { width: 0, color: '#d1d5db', style: 'solid' };
  for (const p of parts) {
    const n = parseFloat(p);
    if (!Number.isNaN(n) && /px|pt|em|rem/.test(p)) { out.width = toPx(p, 10) ?? 0; continue; }
    if (/^(solid|dashed|dotted|double|none)$/.test(p)) { out.style = p; continue; }
    if (/^#/.test(p) || /^(rgb|hsl)/.test(p)) { out.color = p; continue; }
  }
  if (out.style === 'none') out.width = 0;
  return out;
}

function applyDecl(style: Style, decls: Record<string, string>, parentFontSize: number): Style {
  const s: Style = { ...style, padding: { ...style.padding }, margin: { ...style.margin }, border: { ...style.border } };
  for (const [rawKey, rawVal] of Object.entries(decls)) {
    const key = rawKey.toLowerCase();
    const val = String(rawVal).trim();
    switch (key) {
      case 'display': s.display = val.toLowerCase(); break;
      case 'font-size': { const n = toPx(val, parentFontSize); if (n) s.fontSize = n; break; }
      case 'font-weight': s.bold = val === 'bold' || Number(val) >= 600; break;
      case 'font-style': s.italic = val === 'italic' || val === 'oblique'; break;
      case 'text-decoration': s.underline = /underline/.test(val); s.strike = /line-through/.test(val); break;
      case 'color': s.color = val; break;
      case 'background-color': s.background = val; break;
      case 'text-align': if (['left', 'center', 'right', 'justify'].includes(val)) s.align = val as Style['align']; break;
      case 'vertical-align': if (['top', 'middle', 'bottom'].includes(val)) s.valign = val as Style['valign']; break;
      case 'font-family': s.fontFamily = val.split(',')[0].replace(/["']/g, '').trim(); break;
      case 'letter-spacing': { const n = parseFloat(val); if (!Number.isNaN(n)) s.letterSpacing = n; break; }
      case 'line-height': { const n = parseFloat(val); if (!Number.isNaN(n)) s.lineHeight = n > 3 ? n : n * 1.2; break; }
      case 'text-transform': s.textTransform = val.toLowerCase(); break;
      case 'white-space': s.whiteSpace = val.toLowerCase(); break;
      case 'width': { const n = toPx(val, parentFontSize); if (n) s.widthPx = n; break; }
      case 'height': { const n = toPx(val, parentFontSize); if (n) s.heightPx = n; break; }
      case 'padding': case 'margin': {
        const parts = val.split(/\s+/).map(p => toPx(p, parentFontSize) ?? 0);
        const [t, r = t, b = t, l = r] = parts;
        const box = { t, r, b, l };
        if (key === 'padding') s.padding = box; else s.margin = box;
        break;
      }
      case 'padding-top': s.padding.t = toPx(val, parentFontSize) ?? 0; break;
      case 'padding-right': s.padding.r = toPx(val, parentFontSize) ?? 0; break;
      case 'padding-bottom': s.padding.b = toPx(val, parentFontSize) ?? 0; break;
      case 'padding-left': s.padding.l = toPx(val, parentFontSize) ?? 0; break;
      case 'margin-top': s.margin.t = toPx(val, parentFontSize) ?? 0; break;
      case 'margin-right': s.margin.r = toPx(val, parentFontSize) ?? 0; break;
      case 'margin-bottom': s.margin.b = toPx(val, parentFontSize) ?? 0; break;
      case 'margin-left': s.margin.l = toPx(val, parentFontSize) ?? 0; break;
      case 'border': { const b = parseBox(val); s.border = { t: b, r: b, b: b, l: b }; break; }
      case 'border-top': case 'border-right': case 'border-bottom': case 'border-left': {
        const b = parseBox(val);
        s.border[key.replace('border-', '') as 't' | 'r' | 'b' | 'l'] = b;
        break;
      }
      case 'border-color': { const c = val.split(/\s+/)[0]; s.border = { t: { ...s.border.t, color: c }, r: { ...s.border.r, color: c }, b: { ...s.border.b, color: c }, l: { ...s.border.l, color: c } }; break; }
      case 'border-width': { const w = toPx(val, parentFontSize) ?? 0; s.border = { t: { ...s.border.t, width: w }, r: { ...s.border.r, width: w }, b: { ...s.border.b, width: w }, l: { ...s.border.l, width: w } }; break; }
      case 'border-style': { const st = val.split(/\s+/)[0]; s.border = { t: { ...s.border.t, style: st }, r: { ...s.border.r, style: st }, b: { ...s.border.b, style: st }, l: { ...s.border.l, style: st } }; break; }
      case 'border-collapse': break;
      default: break;                    // unknown property: ignored by the PDF engine
    }
  }
  return s;
}

// ─── CSS matching ────────────────────────────────────────────────────────────

interface Rule { selectors: string[]; decls: Record<string, string>; specificity: number }

function parseCss(css: string): Rule[] {
  const rules: Rule[] = [];
  const clean = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    const decls: Record<string, string> = {};
    for (const decl of m[2].split(';')) {
      const i = decl.indexOf(':');
      if (i === -1) continue;
      const k = decl.slice(0, i).trim().toLowerCase();
      const v = decl.slice(i + 1).trim();
      if (k) decls[k] = v;
    }
    if (!Object.keys(decls).length) continue;
    const selectors = m[1].split(',').map(s => s.trim()).filter(Boolean);
    for (const sel of selectors) {
      const specificity = (sel.match(/\./g)?.length ?? 0) * 10 + (sel.match(/#/g)?.length ?? 0) * 100 + (sel.match(/^[a-z]/i) ? 1 : 0);
      rules.push({ selectors: [sel], decls, specificity });
    }
  }
  return rules.sort((a, b) => a.specificity - b.specificity);
}

function matches(sel: string, node: HtmlNode): boolean {
  const s = sel.trim();
  if (!s) return false;
  if (s === '*') return true;
  // Only simple selectors are honoured: tag, .class, #id (and "tag.class").
  const parts = s.match(/^([a-zA-Z][a-zA-Z0-9]*)?((?:[.#][a-zA-Z0-9_-]+)*)$/);
  if (!parts) return false;
  const [, tag, rest] = parts;
  if (tag && node.tag !== tag.toLowerCase()) return false;
  for (const token of (rest || '').match(/[.#][a-zA-Z0-9_-]+/g) || []) {
    if (token[0] === '.') {
      const cls = (node.attrs.class || '').split(/\s+/);
      if (!cls.includes(token.slice(1))) return false;
    } else {
      if (node.attrs.id !== token.slice(1)) return false;
    }
  }
  return true;
}

function inlineCss(node: HtmlNode, rules: Rule[], parent: Style): Style {
  let style: Style = { ...parent, padding: { ...parent.padding }, margin: { ...parent.margin }, border: { ...parent.border } };
  if (node.tag !== '#text') {
    for (const rule of rules) {
      if (rule.selectors.some(sel => matches(sel, node))) style = applyDecl(style, rule.decls, parent.fontSize);
    }
    const inline: Record<string, string> = {};
    for (const decl of (node.attrs.style || '').split(';')) {
      const i = decl.indexOf(':');
      if (i === -1) continue;
      inline[decl.slice(0, i).trim().toLowerCase()] = decl.slice(i + 1).trim();
    }
    if (Object.keys(inline).length) style = applyDecl(style, inline, parent.fontSize);
  }
  return style;
}

// ─── Fonts ───────────────────────────────────────────────────────────────────

/** Maps a CSS font-family onto one of PDFKit's standard fonts. */
function pdfFont(style: Style): { name: string; bold: boolean; italic: boolean } {
  const f = (style.fontFamily || '').toLowerCase();
  const serif = /times|georgia|garamond|serif|book/.test(f);
  const mono = /courier|mono|consolas/.test(f);
  const name = mono ? 'Courier' : serif ? 'Times' : 'Helvetica';
  return { name, bold: style.bold, italic: style.italic };
}

// ─── Images ──────────────────────────────────────────────────────────────────

const INTERNAL_HOST = /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|0x)/i;

function isSafeRemoteUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (INTERNAL_HOST.test(u.hostname)) return false;
    return true;
  } catch { return false; }
}

async function fetchImage(src: string): Promise<Buffer | null> {
  try {
    if (src.startsWith('data:image/')) {
      const m = src.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
      if (!m) return null;
      return Buffer.from(m[2], 'base64');
    }
    if (!isSafeRemoteUrl(src)) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(src, { signal: controller.signal, headers: { 'User-Agent': 'Zenkara360/1.0 (payslip renderer)' } });
      if (!res.ok) return null;
      const type = res.headers.get('content-type') || '';
      if (!/image\/(png|jpeg|jpg)/i.test(type)) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length > 5_000_000 ? null : buf;
    } finally { clearTimeout(timer); }
  } catch { return null; }
}

// ─── Layout ──────────────────────────────────────────────────────────────────

interface Run { text: string; style: Style }

interface Ctx {
  doc: PDFKit.PDFDocument;
  rules: Rule[];
  images: Map<string, Buffer | null>;
  pageLeft: number;
  pageRight: number;
  pageBottom: number;
  y: number;
  fontFamily: string;
}

const BLOCK_TAGS = new Set(['div', 'p', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'figure', 'figcaption', 'blockquote', 'pre', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'table', 'tr', 'td', 'th', 'caption', 'thead', 'tbody', 'tfoot']);
const HEADING_SIZE: Record<string, number> = { h1: 20, h2: 16, h3: 13, h4: 11.5, h5: 10.5, h6: 10 };

function setFont(ctx: Ctx, style: Style) {
  const f = pdfFont(style);
  ctx.doc.font(f.name);
  if (f.bold && f.italic) ctx.doc.font(`${f.name}-BoldOblique`);
  else if (f.bold) ctx.doc.font(`${f.name}-Bold`);
  else if (f.italic) ctx.doc.font(`${f.name}-Oblique`);
  else ctx.doc.font(f.name);
  ctx.doc.fontSize(style.fontSize);
}

/** Flattens a subtree into styled text runs. */
function collectRuns(node: HtmlNode, style: Style, ctx: Ctx, out: Run[]): void {
  if (node.tag === '#text') {
    let text = node.text ?? '';
    if (!text) return;
    if (style.textTransform === 'uppercase') text = text.toUpperCase();
    else if (style.textTransform === 'lowercase') text = text.toLowerCase();
    else if (style.textTransform === 'capitalize') text = text.replace(/\b\w/g, c => c.toUpperCase());
    if (style.whiteSpace === 'pre') text = text.replace(/\n/g, ' ');
    out.push({ text, style });
    return;
  }
  if (node.tag === 'br') { out.push({ text: '\n', style }); return; }
  if (node.tag === 'img') return;                 // handled by the block walker
  const child = inlineCss(node, ctx.rules, style);
  for (const c of node.children || []) collectRuns(c, child, ctx, out);
}

/** Wraps and draws a run of text; returns the y after the last line. */
function drawRuns(ctx: Ctx, runs: Run[], x: number, width: number, style: Style, y: number): number {
  const lineHeight = style.fontSize * style.lineHeight;
  let cursorX = x;
  let cursorY = y;
  let lineHasContent = false;

  const newLine = () => {
    if (lineHasContent) cursorY += lineHeight;
    lineHasContent = false;
    cursorX = x;
  };

  for (const run of runs) {
    const s = run.style;
    setFont(ctx, s);
    const words = run.text.split(/(\s+)/).filter(w => w !== '');
    for (const word of words) {
      if (word === '\n') { newLine(); continue; }
      const isSpace = /^\s+$/.test(word);
      let w = ctx.doc.widthOfString(word) + s.letterSpacing * word.length;
      if (!isSpace && cursorX + w > x + width && (cursorX > x || lineHasContent)) {
        newLine();
        w = ctx.doc.widthOfString(word) + s.letterSpacing * word.length;
      }
      if (cursorY + lineHeight > ctx.pageBottom) {
        ctx.doc.addPage();
        cursorY = ctx.pageBottom - lineHeight;
        cursorX = x;
      }
      if (isSpace) { cursorX += w; continue; }

      // Background behind the word (a highlight).
      if (s.background && s.background !== 'transparent') {
        ctx.doc.save().fillColor(s.background).rect(cursorX - 1, cursorY - 2, w + 2, lineHeight).fill().restore();
      }
      ctx.doc.save();
      ctx.doc.fillColor(s.color);
      const text = s.textTransform === 'uppercase' ? word.toUpperCase()
        : s.textTransform === 'lowercase' ? word.toLowerCase()
        : s.textTransform === 'capitalize' ? word.replace(/\b\w/g, c => c.toUpperCase())
        : word;
      ctx.doc.text(text, cursorX, cursorY, { lineBreak: false, characterSpacing: s.letterSpacing });
      ctx.doc.restore();
      if (s.underline) {
        ctx.doc.save().lineWidth(Math.max(0.5, s.fontSize / 16)).strokeColor(s.color)
          .moveTo(cursorX, cursorY + s.fontSize * 0.12).lineTo(cursorX + w, cursorY + s.fontSize * 0.12).stroke().restore();
      }
      if (s.strike) {
        ctx.doc.save().lineWidth(Math.max(0.5, s.fontSize / 16)).strokeColor(s.color)
          .moveTo(cursorX, cursorY + s.fontSize * 0.45).lineTo(cursorX + w, cursorY + s.fontSize * 0.45).stroke().restore();
      }
      cursorX += w;
      lineHasContent = true;
    }
  }
  if (lineHasContent) cursorY += lineHeight;
  return cursorY;
}

function drawBox(ctx: Ctx, style: Style, x: number, y: number, width: number, height: number) {
  if (style.background && style.background !== 'transparent') {
    ctx.doc.save().fillColor(style.background).rect(x, y, width, height).fill().restore();
  }
  const sides: Array<['t' | 'r' | 'b' | 'l', number, number, number, number]> = [
    ['t', x, y, width, 0], ['b', x, y + height, width, 0], ['l', x, y, 0, height], ['r', x + width, y, 0, height],
  ];
  for (const [side, sx, sy, sw, sh] of sides) {
    const b = style.border[side];
    if (!b.width) continue;
    ctx.doc.save().lineWidth(b.width).strokeColor(b.color).moveTo(sx, sy).lineTo(sx + sw, sy + sh).stroke().restore();
  }
}

/** Lays out one block-level element and returns the y below it. */
function layoutBlock(ctx: Ctx, node: HtmlNode, parentStyle: Style, x: number, width: number): number {
  const style = inlineCss(node, ctx.rules, parentStyle);
  if (style.display === 'none') return ctx.y;

  if (node.tag === 'hr') {
    const y = ctx.y + style.margin.t + style.margin.b;
    ctx.doc.save().lineWidth(0.8).strokeColor(style.border.t.color).moveTo(x, y).lineTo(x + width, y).stroke().restore();
    ctx.y = y + style.border.t.width + style.margin.b;
    return ctx.y;
  }

  if (node.tag === 'img') {
    const src = node.attrs.src || '';
    const buf = ctx.images.get(src) ?? null;
    const w = Math.min(width, style.widthPx ?? width);
    let h = style.heightPx ?? w * 0.5;
    if (buf) {
      try {
        // The intrinsic size decides the aspect ratio; PDFKit's image() does
        // not report it back.
        const intrinsic = (ctx.doc as any).openImage?.(buf);
        if (intrinsic?.width && intrinsic?.height) h = style.heightPx ?? w * (intrinsic.height / intrinsic.width);
        ctx.doc.image(buf, x + style.margin.l, ctx.y + style.margin.t, { width: w, height: h });
      } catch { /* an unreadable image is skipped, not fatal */ }
    }
    const y = ctx.y + style.margin.t;
    ctx.y = y + h + style.margin.b;
    return ctx.y;
  }

  if (node.tag === 'table') return layoutTable(ctx, node, style, x, width);

  if (node.tag === 'ul' || node.tag === 'ol') {
    let y = ctx.y + style.margin.t;
    let index = 1;
    for (const li of node.children.filter(c => c.tag === 'li')) {
      const liStyle = inlineCss(li, ctx.rules, style);
      const marker = node.tag === 'ol' ? `${index++}. ` : '• ';
      const runs: Run[] = [{ text: marker, style: liStyle }];
      collectRuns({ tag: '#text', attrs: {}, children: li.children, text: undefined }, liStyle, ctx, runs);
      const lineHeight = liStyle.fontSize * liStyle.lineHeight;
      const textWidth = width - liStyle.padding.l - 18;
      const endY = drawRuns(ctx, runs, x + liStyle.padding.l + 18, textWidth, liStyle, y);
      y = endY + liStyle.margin.b;
      ctx.y = y;
    }
    ctx.y = y + style.margin.b;
    return ctx.y;
  }

  // A normal block: padding, background, border, then the children.
  const contentX = x + style.padding.l + style.margin.l;
  const contentWidth = Math.max(20, width - style.padding.l - style.padding.r - style.margin.l - style.margin.r);
  let y = ctx.y + style.margin.t;
  const startY = y;

  const isHeading = /^h[1-6]$/.test(node.tag);
  const headingStyle: Style = isHeading
    ? { ...style, fontSize: style.fontSize || HEADING_SIZE[node.tag], bold: true }
    : style;

  const runs: Run[] = [];
  collectRuns(node, headingStyle, ctx, runs);
  const hasBlockChildren = (node.children || []).some(c => BLOCK_TAGS.has(c.tag) && c.tag !== 'br');

  if (hasBlockChildren) {
    // Mixed content: draw the inline runs first, then the block children.
    const inlineOnly: Run[] = [];
    const blockKids: HtmlNode[] = [];
    for (const child of node.children || []) {
      if (child.tag === '#text' || (!BLOCK_TAGS.has(child.tag) && child.tag !== 'br')) collectRuns(child, headingStyle, ctx, inlineOnly);
      else blockKids.push(child);
    }
    if (inlineOnly.length) {
      const endY = drawRuns(ctx, inlineOnly, contentX, contentWidth, headingStyle, y + style.padding.t);
      y = endY;
      ctx.y = y;
    }
    for (const kid of blockKids) {
      y = layoutBlock(ctx, kid, headingStyle, contentX, contentWidth);
    }
  } else {
    y = drawRuns(ctx, runs, contentX, contentWidth, headingStyle, y + style.padding.t);
    ctx.y = y;
  }

  const height = Math.max(y - startY, style.heightPx ?? 0);
  drawBox(ctx, style, x + style.margin.l, startY, width - style.margin.l - style.margin.r, height + style.padding.b);
  ctx.y = y + style.padding.b + style.margin.b;
  return ctx.y;
}

function layoutTable(ctx: Ctx, node: HtmlNode, style: Style, x: number, width: number): number {
  const rows: HtmlNode[] = [];
  const walk = (n: HtmlNode) => {
    for (const c of n.children || []) {
      if (c.tag === 'tr') rows.push(c);
      else if (c.tag === 'thead' || c.tag === 'tbody' || c.tag === 'tfoot') walk(c);
    }
  };
  walk(node);

  let y = ctx.y + style.margin.t;
  const tableWidth = width - style.margin.l - style.margin.r;
  const left = x + style.margin.l;

  for (const tr of rows) {
    const cells = tr.children.filter(c => c.tag === 'td' || c.tag === 'th');
    if (!cells.length) continue;

    const cellStyles = cells.map(c => inlineCss(c, ctx.rules, style));
    const weights = cellStyles.map((s, i) => {
      const colspan = Math.max(1, parseInt(cells[i].attrs.colspan || '1', 10) || 1);
      const declared = s.widthPx;
      return declared && declared > 0 ? declared : 100 / cells.length / colspan;
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
    const widths = weights.map(w => (w / totalWeight) * tableWidth);

    // Measure the row: lay each cell out into a scratch run to find its height.
    const heights: number[] = [];
    for (let i = 0; i < cells.length; i++) {
      const s = cellStyles[i];
      const inner = Math.max(10, widths[i] - s.padding.l - s.padding.r);
      const runs: Run[] = [];
      collectRuns(cells[i], s, ctx, runs);
      const lineHeight = s.fontSize * s.lineHeight;
      const textW = runs.reduce((acc, r) => acc + ctx.doc.widthOfString(r.text.replace(/\n/g, ' ')), 0);
      const lines = Math.max(1, Math.ceil(textW / inner) || 1);
      heights.push(lines * lineHeight + s.padding.t + s.padding.b);
    }
    const rowHeight = Math.max(...heights, 8);

    if (y + rowHeight > ctx.pageBottom) { ctx.doc.addPage(); y = ctx.pageBottom - rowHeight; }

    let cx = left;
    for (let i = 0; i < cells.length; i++) {
      const s = cellStyles[i];
      const colspan = Math.max(1, parseInt(cells[i].attrs.colspan || '1', 10) || 1);
      const cellWidth = widths.slice(i, i + colspan).reduce((a, b) => a + b, 0);
      drawBox(ctx, s, cx, y, cellWidth, rowHeight);

      const runs: Run[] = [];
      collectRuns(cells[i], s, ctx, runs);
      const inner = Math.max(10, cellWidth - s.padding.l - s.padding.r);
      const align = s.align;
      const totalText = runs.reduce((acc, r) => acc + ctx.doc.widthOfString(r.text.replace(/\n/g, ' ')), 0);
      let tx = cx + s.padding.l;
      if (align === 'center') tx = cx + s.padding.l + Math.max(0, (inner - totalText) / 2);
      else if (align === 'right') tx = cx + s.padding.l + Math.max(0, inner - totalText);
      const lineHeight = s.fontSize * s.lineHeight;
      drawRuns(ctx, runs, tx, inner, s, y + s.padding.t);

      cx += cellWidth;
    }
    y += rowHeight;
  }
  ctx.y = y + style.margin.b;
  return ctx.y;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export interface CustomPdfOptions {
  orientation?: string;
  fontFamily?: string;
}

/**
 * Renders a custom template to a PDF.
 *
 * The markup has already been through the sanitiser and the placeholder
 * substitution; this lays it out with PDFKit.
 */
export async function renderCustomPayslipPdf(
  doc: PayslipDoc,
  payload: { html: string; css: string },
  opts: CustomPdfOptions = {},
  into?: PDFKit.PDFDocument,
): Promise<Buffer> {
  const orientation = opts.orientation === 'landscape' ? 'landscape' : 'portrait';
  const css = sanitizeCustomCss(payload.css || '');
  const body = substitute(payload.html || '', doc);
  const tree = parseHtml(body);

  // Images are fetched up front so the layout pass stays synchronous.
  const images = new Map<string, Buffer | null>();
  const collect = (n: HtmlNode) => {
    if (n.tag === 'img') {
      const src = n.attrs.src || '';
      if (src && !images.has(src)) images.set(src, null);
    }
    for (const c of n.children || []) collect(c);
  };
  collect(tree);
  await Promise.all([...images.keys()].map(async src => { images.set(src, await fetchImage(src)); }));

  const own = !into;
  const pdf = into ?? new PDFDocument({
    size: 'A4',
    layout: orientation,
    margin: orientation === 'landscape' ? 34 : 40,
    info: { Title: doc.payslip.number, Author: doc.company.name },
    autoFirstPage: true,
  });
  const chunks: Buffer[] = [];
  if (own) pdf.on('data', c => chunks.push(c));

  const margin = pdf.page.margins.left;
  const ctx: Ctx = {
    doc: pdf,
    rules: parseCss(css),
    images,
    pageLeft: margin,
    pageRight: pdf.page.width - pdf.page.margins.right,
    pageBottom: pdf.page.height - pdf.page.margins.bottom,
    y: pdf.page.margins.top,
    fontFamily: opts.fontFamily || 'Helvetica',
  };

  const rootStyle = baseStyle();
  rootStyle.fontFamily = opts.fontFamily || 'Helvetica';
  const contentWidth = ctx.pageRight - ctx.pageLeft;

  // The body's children are laid out; html/body/head are structural.
  const bodyNode = findBody(tree) ?? tree;
  const blocks = (bodyNode.children || []).filter(c => c.tag !== '#text' && c.tag !== 'style' && c.tag !== 'head');
  if (!blocks.length) {
    const runs: Run[] = [];
    collectRuns(bodyNode, rootStyle, ctx, runs);
    drawRuns(ctx, runs, ctx.pageLeft, contentWidth, rootStyle, ctx.y);
  } else {
    for (const block of blocks) {
      layoutBlock(ctx, block, rootStyle, ctx.pageLeft, contentWidth);
    }
  }

  if (!own) return Buffer.alloc(0);
  return new Promise(resolve => { pdf.on('end', () => resolve(Buffer.concat(chunks))); pdf.end(); });
}

function findBody(node: HtmlNode): HtmlNode | null {
  if (node.tag === 'body') return node;
  for (const c of node.children || []) {
    const found = findBody(c);
    if (found) return found;
  }
  return null;
}
