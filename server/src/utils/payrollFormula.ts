// ─── Safe formula evaluator for salary components ────────────────────────────
//
// Grammar (no eval, no prototype access):
//   expr   := term (('+'|'-') term)*
//   term   := unary (('*'|'/'|'%') unary)*
//   unary  := '-' unary | primary
//   primary:= number | IDENT | IDENT '(' args ')' | '(' expr ')'
//   comparisons inside if(): expr (< <= > >= == !=) expr
// Functions: min, max, round, floor, ceil, abs, if(cond, a, b)
// Identifiers: component codes (BASIC, HRA …) and payroll variables
// (GROSS_EARNINGS, TOTAL_DEDUCTIONS, CTC, CTC_MONTHLY, PAID_DAYS, WORKING_DAYS,
// LOP_DAYS, PRESENT_DAYS, OVERTIME_HOURS, DAYS_IN_PERIOD, PERIOD_FRACTION).

export type Vars = Record<string, number>;

type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

const OPS = ['<=', '>=', '==', '!=', '&&', '||', '+', '-', '*', '/', '%', '(', ')', ',', '<', '>'];

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i; while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const n = Number(src.slice(i, j));
      if (!Number.isFinite(n)) throw new Error(`Bad number at ${i}`);
      out.push({ t: 'num', v: n }); i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i; while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      out.push({ t: 'id', v: src.slice(i, j) }); i = j; continue;
    }
    const op = OPS.find(o => src.startsWith(o, i));
    if (!op) throw new Error(`Unexpected character "${c}" at ${i}`);
    out.push({ t: 'op', v: op }); i += op.length;
  }
  return out;
}

/** Identifiers a formula references (for dependency ordering and validation). */
export function formulaRefs(src: string): string[] {
  const fns = new Set(['min', 'max', 'round', 'floor', 'ceil', 'abs', 'if']);
  return [...new Set(tokenize(src).filter(t => t.t === 'id' && !fns.has((t as any).v)).map(t => (t as any).v as string))];
}

export function evaluate(src: string, vars: Vars): number {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const eat = (v?: string) => {
    const t = toks[p++];
    if (!t) throw new Error('Unexpected end of formula');
    if (v !== undefined && !(t.t === 'op' && t.v === v)) throw new Error(`Expected "${v}"`);
    return t;
  };

  function orExpr(): number { let l = andExpr(); while (peek()?.t === 'op' && (peek() as any).v === '||') { p++; const r = andExpr(); l = (l || r) ? 1 : 0; } return l; }
  function andExpr(): number { let l = cmp(); while (peek()?.t === 'op' && (peek() as any).v === '&&') { p++; const r = cmp(); l = (l && r) ? 1 : 0; } return l; }
  function cmp(): number {
    let l = expr();
    const t = peek();
    if (t?.t === 'op' && ['<', '<=', '>', '>=', '==', '!='].includes(t.v)) {
      p++; const r = expr();
      switch (t.v) { case '<': return l < r ? 1 : 0; case '<=': return l <= r ? 1 : 0; case '>': return l > r ? 1 : 0; case '>=': return l >= r ? 1 : 0; case '==': return l === r ? 1 : 0; default: return l !== r ? 1 : 0; }
    }
    return l;
  }
  function expr(): number {
    let l = term();
    while (peek()?.t === 'op' && ['+', '-'].includes((peek() as any).v)) { const o = (eat() as any).v; const r = term(); l = o === '+' ? l + r : l - r; }
    return l;
  }
  function term(): number {
    let l = unary();
    while (peek()?.t === 'op' && ['*', '/', '%'].includes((peek() as any).v)) {
      const o = (eat() as any).v; const r = unary();
      if (o === '*') l = l * r; else if (o === '/') l = r === 0 ? 0 : l / r; else l = r === 0 ? 0 : l % r;
    }
    return l;
  }
  function unary(): number { if (peek()?.t === 'op' && (peek() as any).v === '-') { p++; return -unary(); } return primary(); }
  function primary(): number {
    const t = eat();
    if (t.t === 'num') return t.v;
    if (t.t === 'op' && t.v === '(') { const v = orExpr(); eat(')'); return v; }
    if (t.t === 'id') {
      if (peek()?.t === 'op' && (peek() as any).v === '(') {
        p++; const args: number[] = [];
        if (!(peek()?.t === 'op' && (peek() as any).v === ')')) { args.push(orExpr()); while (peek()?.t === 'op' && (peek() as any).v === ',') { p++; args.push(orExpr()); } }
        eat(')');
        switch (t.v) {
          case 'min': return Math.min(...args);
          case 'max': return Math.max(...args);
          case 'round': return args.length > 1 ? Math.round(args[0] * 10 ** args[1]) / 10 ** args[1] : Math.round(args[0]);
          case 'floor': return Math.floor(args[0]);
          case 'ceil': return Math.ceil(args[0]);
          case 'abs': return Math.abs(args[0]);
          case 'if': return args[0] ? args[1] : (args[2] ?? 0);
          default: throw new Error(`Unknown function ${t.v}`);
        }
      }
      if (!(t.v in vars)) throw new Error(`Unknown name ${t.v}`);
      return vars[t.v];
    }
    throw new Error('Unexpected token');
  }

  const v = orExpr();
  if (p !== toks.length) throw new Error('Unexpected trailing input');
  if (!Number.isFinite(v)) throw new Error('Formula did not produce a number');
  return v;
}

/** Throws with a readable message if the formula is malformed or references unknown names. */
export function validateFormula(src: string, knownNames: string[]): void {
  if (!src.trim()) throw new Error('Formula is empty');
  const refs = formulaRefs(src);
  const unknown = refs.filter(r => !knownNames.includes(r));
  if (unknown.length) throw new Error(`Unknown name(s): ${unknown.join(', ')}`);
  evaluate(src, Object.fromEntries(knownNames.map(n => [n, 1])));
}
