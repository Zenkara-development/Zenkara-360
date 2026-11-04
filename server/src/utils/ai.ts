import OpenAI from 'openai';
import crypto from 'crypto';
import { getAiContext } from './aiContext';
import { complete } from './aiGateway';

// ─── Client Factory ───────────────────────────────────────────────────────────

/* The SDK defaults to a 10-minute timeout and 2 internal retries. chat() adds
   its own 3-attempt loop on top, so a wedged provider could hold an Express
   handler for up to ~90 minutes across 9 HTTP attempts — long enough to
   exhaust the connection pool while the user stares at a spinner. These calls
   are interactive; 30s is already generous, and maxRetries:0 leaves retry
   policy to chat(), which is the only place that should own it. */
const AI_REQUEST_TIMEOUT_MS = Number(process.env.AI_REQUEST_TIMEOUT_MS ?? 30_000);

function getClient(): OpenAI | null {
  const opts = { timeout: AI_REQUEST_TIMEOUT_MS, maxRetries: 0 };
  if (process.env.GROQ_API_KEY) {
    return new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
      ...opts,
    });
  }
  if (process.env.OPENAI_API_KEY) {
    /* OPENAI_BASE_URL (optional) points this at an OpenAI-compatible
       endpoint — an org proxy, LiteLLM, Ollama, vLLM — without code changes.
       Left unset, the SDK talks to api.openai.com as before. */
    return new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
      ...opts,
    });
  }
  return null;
}

/** Whether an AI provider is configured at all — used by search.controller.ts to honestly report "AI search" vs. a plain substring fallback, rather than always labeling it AI-powered regardless of whether a call was actually made. */
export function isAiConfigured(): boolean {
  return !!getClient();
}

// ─── Model Routing ────────────────────────────────────────────────────────────

/* Groq retires models on a schedule — llama-3.1-8b-instant and
   llama-3.3-70b-versatile were both decommissioned on 2026-08-16, which
   silently broke every AI feature for Groq-keyed deployments until these
   defaults were updated. Two defenses now:
   1. Defaults track Groq's own recommended replacements (openai/gpt-oss-20b
      for the fast tier, openai/gpt-oss-120b for the smart tier).
   2. Both names are env-overridable (AI_MODEL_FAST / AI_MODEL_SMART), so the
      NEXT deprecation is fixed by changing an environment variable in the
      hosting dashboard — no code change, no redeploy of a new build. */
const AI_MODEL_FAST =
  process.env.AI_MODEL_FAST || (process.env.GROQ_API_KEY ? 'openai/gpt-oss-20b' : 'gpt-4o-mini');
const AI_MODEL_SMART =
  process.env.AI_MODEL_SMART || (process.env.GROQ_API_KEY ? 'openai/gpt-oss-120b' : 'gpt-4o');
const AI_MODEL = AI_MODEL_FAST;

// ─── Per-feature tier routing ─────────────────────────────────────────────────
//
// The hybrid-hosting knob: which features deserve the SMART (large/paid) model
// and which run fine on FAST (small/cheap — possibly a self-hosted Ollama/vLLM
// endpoint via OPENAI_BASE_URL). Long-form writing features default to SMART
// because users read their prose; classification-style features default to
// FAST because their output is a score or a label nobody can tell apart.
//
// Override without a deploy: AI_SMART_FEATURES="ticket.kbArticle,ticket.summary"
// replaces the default list entirely (set it to "" to force everything FAST).
const DEFAULT_SMART_FEATURES = new Set([
  'ticket.kbArticle', 'ticket.summary', 'ticket.reply',
  'invoice.reminder',
  'lead.followUp', 'deal.followUp', 'account.nurture',
  'meeting.notes', 'pipeline.health',
  // Generates a whole workspace (modules, stages, relations, skin) from one
  // business description — the highest-stakes structured output in the
  // product, so it always deserves the large model.
  'solution.builder',
]);
function smartFeatures(): Set<string> {
  const env = process.env.AI_SMART_FEATURES;
  if (env === undefined) return DEFAULT_SMART_FEATURES;
  return new Set(env.split(',').map(s => s.trim()).filter(Boolean));
}
/** SMART/FAST tier for a call: the feature's routing wins; an unlabelled call
    falls back to whatever model the call site asked for. */
function tierFor(feature: string | undefined, requestedModel: string): 'SMART' | 'FAST' {
  if (feature) return smartFeatures().has(feature) ? 'SMART' : 'FAST';
  return requestedModel === AI_MODEL_SMART ? 'SMART' : 'FAST';
}

// ─── In-Memory Response Cache ─────────────────────────────────────────────────
//
// Deterministic features (a score, a label, a risk band for the same input)
// cache for 30 minutes — re-opening the same lead or re-checking the same
// title should not re-bill. Generative features keep the short 5-minute TTL:
// long enough to absorb a double-click, short enough that "Regenerate"
// actually regenerates.
const DETERMINISTIC_FEATURES = new Set([
  'ticket.duplicate', 'ticket.sentiment', 'ticket.slaRisk', 'ticket.estimate',
  'ticket.autoRoute', 'lead.score', 'deal.winProbability', 'account.churn',
]);
const DETERMINISTIC_TTL_MS = 30 * 60 * 1000;

const cache = new Map<string, { value: string; expires: number }>();

function getCached(key: string): string | null {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expires) { cache.delete(key); return null; }
  return entry.value;
}

function setCached(key: string, value: string, ttlMs = 5 * 60 * 1000) {
  cache.set(key, { value, expires: Date.now() + ttlMs });
  // Prune if cache grows large
  if (cache.size > 500) {
    const now = Date.now();
    for (const [k, v] of cache) { if (now > v.expires) cache.delete(k); }
  }
}

function cacheKey(...parts: any[]): string {
  /* Hash, don't truncate. The old `.slice(0, 500)` meant any feature whose
     system prompt alone exceeded ~500 chars (the action planner, the chat
     router) produced ONE key for every call — so for five minutes, every
     user got the first user's cached answer. A digest keys on the full
     content, whatever its length. */
  const raw = parts.map(p => (typeof p === 'object' ? JSON.stringify(p) : String(p))).join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// ─── Chat with Retry + Caching ────────────────────────────────────────────────

/* Every AI call in this file now goes through the gateway when a request
   context is available, which is what puts the ~26 features here under the
   same budget, interaction log and cost accounting that RAG already had.
   Before this, roughly 90% of the product's AI traffic was invisible to the
   AI Governance page and could not be budget-capped.

   `feature` is the one thing the gateway needs that cannot be inferred — it
   is the label the governance dashboard groups by. Keep the values in step
   with the ids in client/src/shared/ai/aiFeatures.ts so the two agree. */
async function chat(
  client: OpenAI,
  system: string,
  user: string,
  opts: {
    maxTokens?: number;
    temperature?: number;
    model?: string;
    json?: boolean;
    /** Governance label, e.g. "lead.score". Defaults to an explicit unknown
        so an unlabelled call is visible in the log rather than silent. */
    feature?: string;
  } = {}
): Promise<string> {
  const model = opts.model ?? AI_MODEL;
  const maxTokens = opts.maxTokens ?? 800;
  const temperature = opts.temperature ?? 0.3;

  const key = cacheKey(model, system, user, opts.json ? 'json' : '');
  const cached = getCached(key);
  if (cached) return cached;

  const ctx = getAiContext();
  if (ctx) {
    const res = await complete({
      orgId: ctx.orgId,
      userId: ctx.userId,
      feature: opts.feature ?? 'legacy.unlabelled',
      // Tier comes from the feature's routing (see tierFor above) so ops can
      // move features between the cheap and premium model without touching
      // call sites — the gateway then maps the tier to the org's providers.
      task: tierFor(opts.feature, model),
      system,
      user,
      maxTokens,
      temperature,
      json: opts.json,
    });

    if (res.blocked) {
      // Surfaced as 402 by handleAIError, so the user is told the budget was
      // reached instead of receiving a confidently empty answer.
      const err: any = new Error('Monthly AI budget reached. Raise the limit in AI Governance, or wait for the next billing period.');
      err.status = 402;
      throw err;
    }

    setCached(key, res.text, opts.feature && DETERMINISTIC_FEATURES.has(opts.feature) ? DETERMINISTIC_TTL_MS : undefined);
    return res.text;
  }

  /* No request context — a cron job, a queue worker, or anything that escaped
     the async chain. Fall back to calling the provider directly so background
     work keeps running; it is simply not logged or budgeted. See
     utils/aiContext.ts for how to attach a context to such callers. */
  let lastErr: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
    try {
      const res = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature,
        max_tokens: maxTokens,
        // Groq/OpenAI JSON mode — forces a syntactically valid JSON object
        // back instead of relying purely on a "respond only with JSON"
        // instruction the model can (and, on the fast/small models, does)
        // ignore by wrapping the reply in prose or markdown fences.
        ...(opts.json ? { response_format: { type: 'json_object' as const } } : {}),
      });
      const text = res.choices[0]?.message?.content?.trim() || '';
      setCached(key, text, opts.feature && DETERMINISTIC_FEATURES.has(opts.feature) ? DETERMINISTIC_TTL_MS : undefined);
      return text;
    } catch (err: any) {
      lastErr = err;
      if (err?.status === 401 || err?.status === 402) throw err; // don't retry auth errors
      if (err?.status !== 429 && err?.status !== 503) throw err; // only retry rate limits
    }
  }
  throw lastErr;
}

// ─── Lead Scoring ──────────────────────────────────────────────────────────────

/* ── Response validation ──────────────────────────────────────────────
   Several handlers used to `return JSON.parse(reply)` straight to the client.
   A model is free to return a string where a number was asked for, omit a key,
   or wrap an array in an object — and that shape then reached React (or, for
   bulk scoring, Prisma) unchecked. These coerce and clamp instead. */

/** Parse without throwing. Returns null on malformed JSON. */
function safeJson(reply: string): any {
  try { return JSON.parse(reply); } catch { return null; }
}

/** Finite number clamped to [min,max]; null if the value is not numeric.
    `Number(undefined)` is NaN and NaN survives Math.min/Math.max, which is how
    a NaN probability used to reach the client. */
function num(v: unknown, min: number, max: number): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

/** Trimmed non-empty string, capped. null if absent or blank. */
function str(v: unknown, cap: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, cap) : null;
}

/** Array of trimmed strings, capped in both length and element size. */
function strArray(v: unknown, cap: number, elemCap = 300): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(x => str(x, elemCap)).filter((x): x is string => !!x).slice(0, cap);
}

export async function scoreLead(lead: {
  status: string;
  source?: string | null;
  notes?: string | null;
  contact?: { name: string; email?: string | null; jobTitle?: string | null } | null;
  createdAt: Date;
  /* `scored` tells the caller whether this is a real assessment. Without it,
     the "AI not configured" and "could not parse" paths both returned 50 and
     the controller wrote that 50 to Lead.aiScore, indistinguishable from a
     genuine mid-range score. */
}): Promise<{ score: number; reason: string; scored: boolean }> {
  const client = getClient();
  if (!client) return { score: 50, scored: false, reason: 'AI not configured — add GROQ_API_KEY to .env (free at console.groq.com)' };

  const payload = {
    status: lead.status,
    source: lead.source,
    notes: lead.notes,
    contact: lead.contact,
    daysSinceCreated: Math.floor((Date.now() - new Date(lead.createdAt).getTime()) / 86400000),
  };

  const reply = await chat(
    client,
    'You are a CRM lead scoring AI. Score leads from 0–100. Higher = more likely to convert. Respond ONLY with valid JSON: {"score": number, "reason": "1 sentence max 120 chars"}',
    `Score this lead: ${JSON.stringify(payload)}`,
    { feature: 'lead.score', maxTokens: 300 }
  );

  const parsed = safeJson(reply);
  const score = parsed ? num(parsed.score, 0, 100) : null;
  if (score === null) return { score: 50, scored: false, reason: 'Could not parse AI response' };
  return {
    score: Math.round(score),
    reason: str(parsed.reason, 150) ?? 'No reason given',
    scored: true,
  };
}

// ─── Follow-up Email Generator ────────────────────────────────────────────────

export async function generateFollowUp(context: {
  type: 'lead' | 'deal';
  title: string;
  stage?: string;
  contactName?: string;
  contactEmail?: string;
  notes?: string;
  value?: number;
}): Promise<{ subject: string; body: string }> {
  const client = getClient();
  if (!client) {
    return {
      subject: `Follow-up: ${context.title}`,
      body: 'AI follow-up generation not configured — add OPENAI_API_KEY to .env',
    };
  }

  const reply = await chat(
    client,
    'You are a professional sales email writer. Write concise, warm, personalized follow-up emails (3–5 short paragraphs). Respond ONLY with valid JSON: {"subject": "...", "body": "..."}',
    `Write a follow-up email for this ${context.type}: ${JSON.stringify(context)}`,
    // Shared by leads and deals, so the governance label follows the caller —
    // otherwise both would collapse into one row on the cost-by-feature chart.
    { feature: `${context.type}.followUp`, maxTokens: 1000 }
  );

  const parsed = safeJson(reply);
  return {
    subject: str(parsed?.subject, 200) ?? `Follow-up: ${context.title}`,
    // Falling back to the raw reply is deliberate — a model that ignored the
    // JSON instruction usually still wrote a usable email. But it goes through
    // str() so a non-string can never reach the client as an email body.
    body: str(parsed?.body, 8000) ?? str(reply, 8000) ?? '',
  };
}

// ─── Ticket Sentiment Analysis ────────────────────────────────────────────────

export type Sentiment = 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'FRUSTRATED';
const VALID_SENTIMENTS: Sentiment[] = ['POSITIVE', 'NEUTRAL', 'NEGATIVE', 'FRUSTRATED'];

export async function analyzeTicketSentiment(ticket: {
  title: string;
  body: string;
  priority: string;
}): Promise<Sentiment> {
  const client = getClient();
  if (!client) return 'NEUTRAL';

  const reply = await chat(
    client,
    'You are a customer support AI. Classify the sentiment of this support ticket. Respond ONLY with one word: POSITIVE, NEUTRAL, NEGATIVE, or FRUSTRATED.',
    `Ticket: "${ticket.title}"\n\n${ticket.body}`,
    { feature: 'ticket.sentiment', maxTokens: 300 }
  );

  const sentiment = reply.toUpperCase().trim() as Sentiment;
  return VALID_SENTIMENTS.includes(sentiment) ? sentiment : 'NEUTRAL';
}

// ─── AI Reply Suggestion ──────────────────────────────────────────────────────

export async function suggestTicketReply(
  ticket: { title: string; body: string; priority: string; category?: string | null },
  articles: Array<{ title: string; body: string }>
): Promise<string> {
  const client = getClient();
  if (!client) return 'AI reply suggestions not configured — add OPENAI_API_KEY to .env';

  const kb = articles.length > 0
    ? `\n\nRelevant knowledge base articles:\n${articles.map(a => `**${a.title}**: ${a.body.slice(0, 300)}`).join('\n---\n')}`
    : '';

  return chat(
    client,
    'You are a helpful, professional IT support agent. Write a clear, empathetic, solution-focused reply to the support ticket below. Keep it concise (3–5 sentences). Do not include subject lines or greetings like "Dear" — just the body.',
    `Ticket title: "${ticket.title}"\nPriority: ${ticket.priority}\nCategory: ${ticket.category || 'General'}\n\n${ticket.body}${kb}\n\nWrite a reply:`,
    { feature: 'ticket.reply', maxTokens: 800 }
  );
}

// ─── AI Auto-Routing ──────────────────────────────────────────────────────────

export async function autoRouteTicket(ticket: {
  title: string;
  body: string;
  priority: string;
}, categories: Array<{ id: string; name: string }>, agents: Array<{ id: string; name: string; role: string }>): Promise<{
  categoryId: string | null;
  categoryName: string | null;
  agentId: string | null;
  agentName: string | null;
  reason: string;
}> {
  const client = getClient();
  if (!client) return { categoryId: null, categoryName: null, agentId: null, agentName: null, reason: 'AI not configured' };

  const reply = await chat(
    client,
    `You are an IT help desk triage AI. Given a support ticket, pick the most appropriate category and agent.
Respond ONLY with valid JSON: {"categoryId": "...", "agentId": "...", "reason": "1 sentence"}
Use null if no clear match. Pick from the provided lists only.`,
    `Ticket: "${ticket.title}"\nPriority: ${ticket.priority}\n\n${ticket.body}\n\nCategories: ${JSON.stringify(categories)}\n\nAgents: ${JSON.stringify(agents)}`,
    { feature: 'ticket.autoRoute', maxTokens: 300 }
  );

  try {
    const parsed = JSON.parse(reply);
    const cat = categories.find(c => c.id === parsed.categoryId) ?? null;
    const agent = agents.find(a => a.id === parsed.agentId) ?? null;
    return {
      categoryId: cat?.id ?? null,
      categoryName: cat?.name ?? null,
      agentId: agent?.id ?? null,
      agentName: agent?.name ?? null,
      reason: String(parsed.reason || '').slice(0, 200),
    };
  } catch {
    return { categoryId: null, categoryName: null, agentId: null, agentName: null, reason: 'Could not parse AI response' };
  }
}

// ─── Natural Language Dashboard Query ────────────────────────────────────────

export async function naturalLanguageQuery(
  question: string,
  context: {
    totalDeals: number;
    openDeals: number;
    wonDeals: number;
    lostDeals: number;
    totalContacts: number;
    totalTickets: number;
    openTickets: number;
    resolvedTickets: number;
    totalLeads: number;
    activeLeads: number;
    forecastRevenue: number;
  }
): Promise<string> {
  const client = getClient();
  if (!client) return 'AI queries not configured — add OPENAI_API_KEY to .env';

  return chat(
    client,
    'You are a CRM analytics assistant. Answer questions about the user\'s business data concisely (2–3 sentences max). Be specific and actionable. If the data doesn\'t support the question, say so briefly.',
    `CRM snapshot: ${JSON.stringify(context)}\n\nUser question: ${question}`,
    { feature: 'dashboard.query', maxTokens: 300 }
  );
}

// ─── KB Article Generator ─────────────────────────────────────────────────────

export async function generateKbArticle(ticket: {
  title: string; body: string; priority: string; category?: string | null;
}, comments: Array<{ body: string; author?: string }>): Promise<{ title: string; body: string }> {
  const client = getClient();
  if (!client) return { title: ticket.title, body: 'AI not configured.' };
  const thread = comments.map(c => `- ${c.author ?? 'Agent'}: ${c.body}`).join('\n');
  const reply = await chat(client,
    'You are a technical writer. Given a resolved support ticket and its resolution thread, write a clear knowledge base article. Respond ONLY with valid JSON: {"title": "...", "body": "markdown content"}',
    `Ticket: "${ticket.title}"\nCategory: ${ticket.category ?? 'General'}\n\nDescription:\n${ticket.body}\n\nResolution thread:\n${thread}`,
    { feature: 'ticket.kbArticle', model: AI_MODEL_SMART, maxTokens: 1500 }
  );
  const parsed = safeJson(reply);
  return {
    title: str(parsed?.title, 200) ?? ticket.title,
    body: str(parsed?.body, 20000) ?? str(reply, 20000) ?? '',
  };
}

// ─── Chat Copilot Router ──────────────────────────────────────────────────────

/**
 * The cheap first hop of the chat copilot: reads the running conversation and
 * classifies the latest user turn. Returns:
 *   mode 'action' — the user wants something DONE; `command` is the request
 *                   rewritten as one standalone imperative sentence (the plan
 *                   endpoint needs no chat history).
 *   mode 'query'  — a question about org data; `command` is the standalone question.
 *   mode 'reply'  — smalltalk/clarification; `reply` is the assistant's answer.
 * Deliberately FAST-tier: it's a three-way classifier plus a sentence rewrite,
 * called on every chat turn — exactly the traffic to keep off the big model.
 */
export async function routeChatTurn(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  contextNote?: string,
): Promise<{ mode: 'action' | 'query' | 'reply'; command?: string; reply?: string }> {
  const client = getClient();
  if (!client) return { mode: 'reply', reply: 'AI not configured.' };
  const thread = messages.slice(-12).map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
  const raw = await chat(client,
    'You route messages in a CRM/helpdesk chat assistant. Classify the LATEST user message given the conversation. ' +
    'Respond ONLY with valid JSON: {"mode": "action"|"query"|"reply", "command": "...", "reply": "..."}. ' +
    'Use "action" when the user wants something created or changed (ticket, lead, note, assignment, status, leave request or approval, reminder…) — set "command" to ONE standalone imperative sentence carrying every detail from the conversation (names, priorities, dates). ' +
    'Use "query" for questions about their business data (counts, forecasts, workloads) — set "command" to the standalone question. ' +
    'Use "reply" for greetings, thanks, or when you must ask a clarifying question — set "reply" to a short helpful answer.',
    `${contextNote ? `Context: the user has ${contextNote} open.\n` : ''}Conversation:\n${thread}`,
    { feature: 'chat.copilot', maxTokens: 300, json: true }
  );
  const parsed = safeJson(raw);
  const mode = parsed?.mode === 'action' || parsed?.mode === 'query' ? parsed.mode : 'reply';
  return {
    mode,
    command: str(parsed?.command, 1000) ?? undefined,
    reply: str(parsed?.reply, 1500) ?? undefined,
  };
}

// ─── AI Solution Builder (platform Phase 3) ──────────────────────────────────

/**
 * One business description in → a complete workspace blueprint out: the
 * product's name/skin (Phase 1 config), custom modules with fields, pipeline
 * stages, and cross-module relations (Phase 2), core-entity relabels, and
 * simple declarative automations. The blueprint is DATA, not actions — the
 * apply endpoint (solutionBuilder.controller.ts) re-validates every part
 * against the same zod schemas the manual builders use, so nothing the model
 * emits can reach the database in a shape a human couldn't have clicked
 * together by hand.
 */
export async function generateSolutionBlueprint(description: string): Promise<any> {
  const client = getClient();
  if (!client) return null;
  const raw = await chat(client,
    'You are a solution architect for a CRM + helpdesk + HR platform. Given a business description, design their whole workspace. ' +
    'Respond ONLY with valid JSON, no prose, in exactly this shape:\n' +
    '{"workspace":{"appName":str<=40,"sectionRenames":{section:label},"navRenames":{route:label},"hiddenSections":[section]},' +
    '"labels":{"ticket"|"deal"|"lead"|"contact":{"singular":str,"plural":str}},' +
    '"modules":[{"name":str,"icon":str,"description":str,"navSection":"CRM"|"IT_DESK"|"HR"|"ADMIN","fields":[{"label":str,"fieldType":str,"options":[str],"required":bool,"isPrimary":bool,"relationTo":str}],"stages":[{"key":str,"label":str,"color":str}],"listColumns":[fieldLabelsInOrder]}],' +
    '"automations":[{"name":str,"module":str,"event":"created"|"stage_reached","stage":stageKey,"notifyTitle":str,"notifyBody":str}]}\n' +
    'Rules: sections are exactly "CRM","HR","IT Desk","Admin","Integrations". Rename sections/entities into the business\'s own vocabulary; hide sections they clearly don\'t need (never hide "Admin"). ' +
    'navRenames keys are routes: /itdesk/tickets /crm/deals /crm/leads /crm/contacts /itdesk/assets /itdesk/articles. ' +
    'labels relabel the four core entities (singular AND plural). ' +
    'Create 2-4 custom modules that capture what the business tracks that a generic CRM does not. fieldType one of TEXT,TEXTAREA,NUMBER,CURRENCY,DATE,BOOLEAN,DROPDOWN,EMAIL,PHONE,URL,RELATION. ' +
    'A RELATION field sets "relationTo" to another module\'s exact "name" from THIS blueprint. Exactly one field per module has isPrimary:true (its display title, TEXT, required). ' +
    'Give 3-6 stages to modules that flow through a lifecycle; stage keys are lowercase-kebab; color one of slate,blue,cyan,teal,emerald,amber,orange,rose,violet,indigo. ' +
    'icon one of Layers,Package,Boxes,Wrench,Tag,Briefcase,ClipboardList,FileText,Building2,Monitor. ' +
    '1-3 automations: notify the team when a record is created or reaches a stage; {{field_key}} placeholders in notifyBody interpolate record fields.',
    `Business description:\n${description}`,
    { feature: 'solution.builder', maxTokens: 3000, temperature: 0.4, json: true }
  );
  return safeJson(raw);
}

// ─── AI dispatcher — pick department + owner for a new ticket/lead ───────────

/**
 * The brain behind the AI_AUTO_ASSIGN workflow action: given a fresh ticket
 * or lead, the org's departments, and the eligible people (with their
 * department and current open workload), pick which department the record
 * belongs to and who should own it. Balances topical fit against workload —
 * the prompt tells it to prefer the least-loaded qualified person. Returns
 * NAMES (validated/resolved to ids by the caller); null when unsure, so the
 * action can leave a field untouched instead of guessing.
 */
export async function pickAssignment(
  kind: 'TICKET' | 'LEAD',
  record: { title: string; body?: string },
  departments: Array<{ name: string }>,
  candidates: Array<{ name: string; department?: string | null; openCount: number }>,
): Promise<{ departmentName: string | null; assigneeName: string | null; reason: string }> {
  const client = getClient();
  if (!client) return { departmentName: null, assigneeName: null, reason: 'AI not configured' };
  const raw = await chat(client,
    'You are a work dispatcher for a service desk and CRM. Given a new ' +
    (kind === 'TICKET' ? 'support ticket' : 'sales lead') +
    ', pick which department it belongs to and the best person to own it. ' +
    'Respond ONLY with valid JSON: {"departmentName": string|null, "assigneeName": string|null, "reason": "1 short sentence"}. ' +
    'departmentName must be EXACTLY one of the listed department names (or null if none fits). ' +
    'assigneeName must be EXACTLY one of the listed candidate names (or null if none fits). ' +
    'Prefer a candidate whose department matches the chosen department; among equally suitable people pick the LOWEST openCount (their current workload). Never invent names.',
    `${kind === 'TICKET' ? 'Ticket' : 'Lead'}: ${record.title}\n${record.body ? `Details: ${record.body.slice(0, 800)}\n` : ''}` +
    `Departments: ${JSON.stringify(departments)}\n` +
    `Candidates: ${JSON.stringify(candidates)}`,
    { feature: 'routing.assign', maxTokens: 200, json: true }
  );
  const parsed = safeJson(raw);
  return {
    departmentName: str(parsed?.departmentName, 60) ?? null,
    assigneeName: str(parsed?.assigneeName, 120) ?? null,
    reason: str(parsed?.reason, 300) ?? '',
  };
}

// ─── Invoice Payment Reminder ─────────────────────────────────────────────────

/**
 * Drafts a payment-reminder email for an unpaid/overdue invoice. Tone scales
 * with lateness: friendly nudge before the due date, firmer past it, and a
 * final-notice register beyond 30 days late — that judgment is the reason
 * this is an AI feature rather than a mail-merge template.
 */
export async function generateInvoiceReminder(invoice: {
  invoiceNumber: string; title: string; total: number; currency?: string;
  dueDate?: Date | null; status: string; contactName?: string | null; orgName?: string | null;
}): Promise<{ subject: string; body: string }> {
  const client = getClient();
  if (!client) return { subject: `Payment reminder — ${invoice.invoiceNumber}`, body: 'AI not configured.' };
  const daysLate = invoice.dueDate ? Math.floor((Date.now() - invoice.dueDate.getTime()) / 86400000) : 0;
  const reply = await chat(client,
    'You draft professional accounts-receivable emails. Given an invoice, write a payment reminder whose firmness matches how overdue it is: not yet due = friendly heads-up; up to 30 days late = polite but direct; more than 30 days = firm final notice mentioning next steps. Keep it under 150 words, no legal threats. Respond ONLY with valid JSON: {"subject": "...", "body": "..."}',
    `Invoice ${invoice.invoiceNumber}: "${invoice.title}"\nAmount: ${invoice.currency ?? 'USD'} ${invoice.total}\nStatus: ${invoice.status}\nDays past due: ${daysLate}\nCustomer: ${invoice.contactName ?? 'the customer'}\nFrom: ${invoice.orgName ?? 'our company'}`,
    { feature: 'invoice.reminder', model: AI_MODEL_SMART, maxTokens: 400, json: true }
  );
  const parsed = safeJson(reply);
  return {
    subject: str(parsed?.subject, 200) ?? `Payment reminder — ${invoice.invoiceNumber}`,
    body: str(parsed?.body, 4000) ?? str(reply, 4000) ?? '',
  };
}

// ─── Duplicate Ticket Detector ────────────────────────────────────────────────

export async function detectDuplicates(newTicket: {
  title: string; body: string;
}, existing: Array<{ id: string; title: string; body: string; status: string }>): Promise<{
  duplicates: Array<{ id: string; title: string; confidence: number; reason: string }>;
}> {
  const client = getClient();
  if (!client || existing.length === 0) return { duplicates: [] };
  const sample = existing.slice(0, 20); // limit context
  const reply = await chat(client,
    'You are a duplicate detection AI. Given a new support ticket, identify semantically similar existing tickets. Respond ONLY with valid JSON: {"duplicates": [{"id": "...", "confidence": 0-100, "reason": "1 sentence"}]}. Only include tickets with confidence > 60.',
    `New ticket: "${newTicket.title}"\n${newTicket.body}\n\nExisting tickets:\n${JSON.stringify(sample.map(t => ({ id: t.id, title: t.title, status: t.status })))}`,
    { feature: 'ticket.duplicate', maxTokens: 300 }
  );
  try {
    const parsed = JSON.parse(reply);
    return {
      duplicates: (parsed.duplicates ?? []).map((d: any) => ({
        ...d,
        title: existing.find(e => e.id === d.id)?.title ?? d.id,
      })),
    };
  } catch { return { duplicates: [] }; }
}

// ─── Ticket Thread Summarizer ─────────────────────────────────────────────────

export async function summarizeThread(ticket: {
  title: string; body: string;
}, comments: Array<{ body: string; author?: string; createdAt?: Date }>): Promise<string> {
  const client = getClient();
  if (!client) return 'AI not configured.';
  if (comments.length < 3) return 'Not enough comments to summarize.';
  const thread = comments.map(c => `${c.author ?? 'User'}: ${c.body}`).join('\n---\n');
  return chat(client,
    'You are a support ticket summarizer. Summarize the thread in 3–4 sentences covering: the issue, what was tried, current status, and next steps.',
    `Ticket: "${ticket.title}"\n\n${ticket.body}\n\nThread:\n${thread}`,
    { feature: 'ticket.summarize', maxTokens: 600 }
  );
}

// ─── Resolution Time Estimator ────────────────────────────────────────────────

export async function estimateResolutionTime(ticket: {
  title: string; body: string; priority: string; category?: string | null;
}): Promise<{ hours: number; label: string; reason: string }> {
  const client = getClient();
  if (!client) return { hours: 24, label: '~1 day', reason: 'AI not configured' };
  const reply = await chat(client,
    'You are an IT helpdesk AI. Estimate resolution time for this ticket. Respond ONLY with valid JSON: {"hours": number, "label": "e.g. 2–4 hours", "reason": "1 sentence"}',
    `Title: "${ticket.title}"\nPriority: ${ticket.priority}\nCategory: ${ticket.category ?? 'General'}\n\n${ticket.body}`,
    { feature: 'ticket.estimate', maxTokens: 300 }
  );
  const parsed = safeJson(reply);
  const hours = parsed ? num(parsed.hours, 0.25, 2000) : null;
  if (hours === null) return { hours: 24, label: '~1 day', reason: 'Could not estimate' };
  return {
    hours,
    label: str(parsed.label, 40) ?? `~${Math.round(hours)}h`,
    reason: str(parsed.reason, 200) ?? '',
  };
}

// ─── SLA Breach Predictor ─────────────────────────────────────────────────────

export async function predictSlaBreach(ticket: {
  title: string; body: string; priority: string; createdAt: Date; slaDeadline?: Date | null;
  responseCount: number;
}): Promise<{ risk: 'LOW' | 'MEDIUM' | 'HIGH'; score: number; reason: string }> {
  const client = getClient();
  if (!client) return { risk: 'LOW', score: 20, reason: 'AI not configured' };
  const ageHours = (Date.now() - new Date(ticket.createdAt).getTime()) / 3600000;
  const hoursLeft = ticket.slaDeadline
    ? (new Date(ticket.slaDeadline).getTime() - Date.now()) / 3600000
    : null;
  const reply = await chat(client,
    'You are an SLA risk assessment AI. Predict breach risk. Respond ONLY with valid JSON: {"risk": "LOW"|"MEDIUM"|"HIGH", "score": 0-100, "reason": "1 sentence"}',
    `Priority: ${ticket.priority}\nAge: ${ageHours.toFixed(1)}h\nHours until SLA: ${hoursLeft?.toFixed(1) ?? 'unknown'}\nResponses: ${ticket.responseCount}\nTitle: "${ticket.title}"`,
    { feature: 'ticket.slaRisk', maxTokens: 300 }
  );
  try {
    const p = JSON.parse(reply);
    return { risk: ['LOW','MEDIUM','HIGH'].includes(p.risk) ? p.risk : 'MEDIUM', score: Number(p.score) || 50, reason: String(p.reason || '') };
  } catch { return { risk: 'MEDIUM', score: 50, reason: 'Could not assess' }; }
}

// ─── Deal Win Probability ─────────────────────────────────────────────────────

export async function calculateWinProbability(deal: {
  title: string; value: number; stage: string; probability: number;
  daysOpen: number; contactName?: string; notes?: string | null;
}, orgWinRate: number): Promise<{ probability: number; factors: string[]; recommendation: string }> {
  const client = getClient();
  if (!client) return { probability: deal.probability, factors: [], recommendation: 'AI not configured' };
  const reply = await chat(client,
    'You are a sales AI. Predict deal win probability. Respond ONLY with valid JSON: {"probability": 0-100, "factors": ["up to 3 key factors"], "recommendation": "1 actionable sentence"}',
    `Deal: "${deal.title}"\nValue: $${deal.value}\nStage: ${deal.stage}\nManual prob: ${deal.probability}%\nDays open: ${deal.daysOpen}\nOrg win rate: ${orgWinRate}%\nContact: ${deal.contactName ?? 'unknown'}\nNotes: ${deal.notes ?? 'none'}`,
    { feature: 'deal.winProbability', maxTokens: 300 }
  );
  try {
    const p = JSON.parse(reply);
    return {
      probability: num(p.probability, 0, 100) ?? deal.probability,
      factors: Array.isArray(p.factors) ? p.factors.slice(0, 3) : [],
      recommendation: String(p.recommendation || ''),
    };
  } catch { return { probability: deal.probability, factors: [], recommendation: 'Could not assess' }; }
}

// ─── Pipeline Health Report ───────────────────────────────────────────────────

export async function generatePipelineHealth(data: {
  totalDeals: number; openDeals: number; wonDeals: number; lostDeals: number;
  totalValue: number; avgDaysOpen: number; staleDealCount: number;
  stageBreakdown: Array<{ stage: string; count: number; value: number }>;
}): Promise<{ summary: string; risks: string[]; opportunities: string[] }> {
  const client = getClient();
  if (!client) return { summary: 'AI not configured.', risks: [], opportunities: [] };
  const reply = await chat(client,
    'You are a sales analytics AI. Analyze the pipeline and respond ONLY with valid JSON: {"summary": "2-3 sentence overview", "risks": ["up to 3 risks"], "opportunities": ["up to 3 opportunities"]}',
    `Pipeline snapshot: ${JSON.stringify(data)}`,
    { feature: 'deal.pipelineHealth', model: AI_MODEL_SMART, maxTokens: 800 }
  );
  const parsed = safeJson(reply);
  return {
    summary: str(parsed?.summary, 2000) ?? str(reply, 2000) ?? '',
    risks: strArray(parsed?.risks, 3),
    opportunities: strArray(parsed?.opportunities, 3),
  };
}

// ─── Churn Risk Detector ──────────────────────────────────────────────────────

export async function detectChurnRisk(contact: {
  name: string; createdAt: Date; lastActivityAt?: Date | null;
}, recentTickets: Array<{ sentiment?: string | null; status: string; createdAt: Date }>): Promise<{
  risk: 'LOW' | 'MEDIUM' | 'HIGH'; score: number; reason: string;
}> {
  const client = getClient();
  if (!client) return { risk: 'LOW', score: 20, reason: 'AI not configured' };
  const daysSinceActivity = contact.lastActivityAt
    ? (Date.now() - new Date(contact.lastActivityAt).getTime()) / 86400000
    : (Date.now() - new Date(contact.createdAt).getTime()) / 86400000;
  const negativeCount = recentTickets.filter(t => ['NEGATIVE','FRUSTRATED'].includes(t.sentiment ?? '')).length;
  const reply = await chat(client,
    'You are a churn risk AI. Respond ONLY with valid JSON: {"risk": "LOW"|"MEDIUM"|"HIGH", "score": 0-100, "reason": "1 sentence"}',
    `Contact: ${contact.name}\nDays since last activity: ${daysSinceActivity.toFixed(0)}\nRecent tickets: ${recentTickets.length}\nNegative/frustrated tickets: ${negativeCount}\nTicket details: ${JSON.stringify(recentTickets.slice(0,5).map(t => ({ sentiment: t.sentiment, status: t.status })))}`,
    { feature: 'contact.churnRisk', maxTokens: 300 }
  );
  try {
    const p = JSON.parse(reply);
    return { risk: ['LOW','MEDIUM','HIGH'].includes(p.risk) ? p.risk : 'LOW', score: Number(p.score)||20, reason: String(p.reason||'') };
  } catch { return { risk: 'LOW', score: 20, reason: 'Could not assess' }; }
}

// ─── Lead Nurture Sequence ────────────────────────────────────────────────────

export async function generateNurtureSequence(lead: {
  status: string; source?: string | null; notes?: string | null;
  contactName?: string; contactEmail?: string;
}): Promise<Array<{ day: number; subject: string; body: string }>> {
  const client = getClient();
  if (!client) return [];
  const reply = await chat(client,
    'You are a sales email strategist. Generate a 3-step lead nurture email sequence. Respond ONLY with valid JSON array: [{"day": number, "subject": "...", "body": "3-4 sentence email body"}]. Days should be 1, 4, and 10.',
    `Lead info: contact=${lead.contactName ?? 'Unknown'}, source=${lead.source ?? 'unknown'}, status=${lead.status}, notes=${lead.notes ?? 'none'}`,
    { feature: 'lead.nurture', model: AI_MODEL_SMART, maxTokens: 1200 }
  );
  try {
    const arr = JSON.parse(reply);
    return Array.isArray(arr) ? arr.slice(0, 3) : [];
  } catch { return []; }
}

// ─── Meeting Notes Parser ─────────────────────────────────────────────────────

export async function parseMeetingNotes(notes: string): Promise<{
  contacts: Array<{ name: string; email?: string; company?: string; jobTitle?: string }>;
  leads: Array<{ name: string; notes: string; source: string }>;
  deals: Array<{ title: string; value?: number; stage?: string; notes: string }>;
  nextSteps: string[];
  summary: string;
}> {
  const client = getClient();
  if (!client) return { contacts: [], leads: [], deals: [], nextSteps: [], summary: 'AI not configured.' };
  const reply = await chat(client,
    'You are a CRM data extraction AI. Extract structured CRM data from meeting notes. Respond ONLY with valid JSON: {"contacts": [...], "leads": [...], "deals": [...], "nextSteps": ["..."], "summary": "2-sentence overview"}',
    `Meeting notes:\n${notes}`,
    { feature: 'meeting.notes', model: AI_MODEL_SMART, maxTokens: 1500 }
  );
  /* This result populates create-forms in the client, so every field is
     coerced. Previously the raw parse was returned and a malformed `contacts`
     (a string, say) reached React and broke the render. */
  const parsed = safeJson(reply);
  if (!parsed || typeof parsed !== 'object') {
    return { contacts: [], leads: [], deals: [], nextSteps: [], summary: notes.slice(0, 200) };
  }
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    contacts: arr(parsed.contacts).slice(0, 25).map((c: any) => ({
      name: str(c?.name, 120) ?? '',
      email: str(c?.email, 200) ?? undefined,
      company: str(c?.company, 160) ?? undefined,
      jobTitle: str(c?.jobTitle, 120) ?? undefined,
    })).filter(c => c.name),
    leads: arr(parsed.leads).slice(0, 25).map((l: any) => ({
      name: str(l?.name, 120) ?? '',
      notes: str(l?.notes, 2000) ?? '',
      source: str(l?.source, 60) ?? 'MEETING',
    })).filter(l => l.name),
    deals: arr(parsed.deals).slice(0, 25).map((d: any) => ({
      title: str(d?.title, 200) ?? '',
      value: num(d?.value, 0, 1e12) ?? undefined,
      stage: str(d?.stage, 60) ?? undefined,
      notes: str(d?.notes, 2000) ?? '',
    })).filter(d => d.title),
    nextSteps: strArray(parsed.nextSteps, 20, 500),
    summary: str(parsed.summary, 1000) ?? notes.slice(0, 200),
  };
}

// ─── Proactive AI Insights ────────────────────────────────────────────────────

export async function generateInsights(data: {
  staleDealCount: number; staleDealValue: number;
  openTickets: number; avgTicketAgeHours: number;
  slaBreachedCount: number; weeklyTicketGrowth: number;
  weeklyLeadsGrowth: number; unfollowedLeads: number;
  topNegativeTickets: number;
}): Promise<Array<{ type: 'warning' | 'info' | 'success'; title: string; description: string; action?: string }>> {
  const client = getClient();
  if (!client) return [];
  const reply = await chat(client,
    'You are a proactive business insights AI. Generate 3-5 actionable observations from the data. Respond ONLY with valid JSON array: [{"type": "warning"|"info"|"success", "title": "short title", "description": "1-2 sentences", "action": "optional CTA text"}]',
    `Business snapshot: ${JSON.stringify(data)}`,
    { feature: 'dashboard.insights', maxTokens: 600 }
  );
  try {
    const arr = JSON.parse(reply);
    return Array.isArray(arr) ? arr.slice(0, 5) : [];
  } catch { return []; }
}

// ─── Email Tone Checker ───────────────────────────────────────────────────────

export async function checkEmailTone(email: {
  subject: string; body: string; context?: string;
}): Promise<{ tone: string; score: number; issues: string[]; suggestions: string[]; approved: boolean; checked: boolean }> {
  const client = getClient();
  /* Fails CLOSED. This used to return approved:true whenever AI was
     unavailable or the reply was malformed, so an unchecked email looked
     identical to one that passed review. `checked` lets the UI say which. */
  if (!client) return { tone: 'unknown', score: 0, issues: [], suggestions: [], approved: false, checked: false };
  const reply = await chat(client,
    'You are a professional communication coach. Analyze this business email tone. Respond ONLY with valid JSON: {"tone": "professional|friendly|aggressive|passive-aggressive|too-casual|empathetic", "score": 0-100, "issues": ["up to 3 issues"], "suggestions": ["up to 3 improvements"], "approved": boolean}',
    `Subject: ${email.subject}\nContext: ${email.context ?? 'customer support reply'}\n\nBody:\n${email.body}`,
    { feature: 'deal.toneCheck', maxTokens: 300 }
  );
  const parsed = safeJson(reply);
  const score = parsed ? num(parsed.score, 0, 100) : null;
  if (score === null) return { tone: 'unknown', score: 0, issues: [], suggestions: [], approved: false, checked: false };
  return {
    tone: str(parsed.tone, 40) ?? 'unknown',
    score: Math.round(score),
    issues: strArray(parsed.issues, 3),
    suggestions: strArray(parsed.suggestions, 3),
    approved: parsed.approved === true,
    checked: true,
  };
}

// ─── Natural Language Command Parser (AI CRUD) ────────────────────────────────

export type NlCommandEntity = 'ticket' | 'contact' | 'lead' | 'deal' | 'article' | 'unknown';

export interface NlCommandResult {
  intent: 'create' | 'update' | 'unknown';
  entity: NlCommandEntity;
  fields: Record<string, any>;
  confidence: number;
  explanation: string;
}

// Which fields are legitimate for each entity — anything else the model
// returns (e.g. a stray `company`/`email` on a `ticket`, leaked in from the
// Contacts context) gets silently dropped rather than forwarded into the
// create form.
const NL_COMMAND_ALLOWED_FIELDS: Record<Exclude<NlCommandEntity, 'unknown'>, string[]> = {
  ticket:  ['title', 'body', 'priority', 'categoryId', 'assignedTo'],
  contact: ['name', 'email', 'phone', 'jobTitle', 'company'],
  lead:    ['name', 'email', 'source', 'status', 'notes'],
  deal:    ['title', 'value', 'stage', 'probability', 'contactId', 'notes'],
  article: ['title', 'body', 'status'],
};

// Keyword signals for each entity, used only as a deterministic sanity check
// on top of the model's own classification — never as the primary classifier.
// This exists specifically to catch the failure mode where a small/fast model,
// given an unrelated list of existing Contacts as "the only concrete named
// data in context", defaults to entity: "contact" for a command that's
// actually describing a support issue (or any other entity) with zero
// contact-shaped wording anywhere in it.
const NL_ENTITY_KEYWORDS: Record<Exclude<NlCommandEntity, 'unknown'>, RegExp> = {
  ticket:  /\b(ticket|issue|bug|broken|not working|malfunction|outage|crash(ed|ing)?|error|troubleshoot|support (request|issue)|password reset|vpn|printer|laptop|wifi|network (down|issue)|server down|can'?t (log ?in|connect|access))\b/i,
  contact: /\b(contact|save (his|her|their) (number|email|info)|phone number|add (a )?contact|new contact|save (a )?contact)\b/i,
  lead:    /\b(lead|prospect|inquiry|inbound|potential customer|interested in (our|the))\b/i,
  deal:    /\b(deal|opportunity|pipeline|proposal|worth \$?\d|close (the|this) deal|\bstage\b)\b/i,
  article: /\b(article|knowledge ?base|\bkb\b|how-?to guide|documentation|help ?doc)\b/i,
};

export function sanitizeNlCommandFields(entity: NlCommandEntity, fields: Record<string, any>): Record<string, any> {
  if (entity === 'unknown' || !fields || typeof fields !== 'object') return {};
  const allowed = NL_COMMAND_ALLOWED_FIELDS[entity];
  const out: Record<string, any> = {};
  for (const key of Object.keys(fields)) {
    // Drop null/undefined outright rather than passing them through — the
    // model sometimes emits e.g. "contactId": null for a field it has no
    // data for, instead of omitting the key entirely. That null then flows
    // straight into the create form's prefill (useAiPrefill) and on to the
    // server's Zod schema, which for optional relation fields like
    // deal.contactId only ever accepts a string or "" — never null — so it
    // 400s ("Expected string, received null") the instant the form
    // auto-submits with an AI-suggested value. Treating null the same as
    // "field omitted" here matches what the model actually means by it.
    if (allowed.includes(key) && fields[key] !== null && fields[key] !== undefined) out[key] = fields[key];
  }
  return out;
}

// Deterministic guardrail applied after the LLM call. If the model picked an
// entity that has zero keyword support in the command text, but exactly one
// *other* entity does, trust the command's own wording over the model's
// guess, downgrade confidence to reflect the correction, and note it in the
// explanation for transparency. Ambiguous cases (0 or 2+ entities matched)
// are left exactly as the model returned them — this only intervenes when
// there's an unambiguous, provable mismatch.
export function guardEntityClassification(command: string, parsed: NlCommandResult): NlCommandResult {
  if (parsed.entity === 'unknown') return parsed;
  const matched = (Object.keys(NL_ENTITY_KEYWORDS) as Array<Exclude<NlCommandEntity, 'unknown'>>)
    .filter(entity => NL_ENTITY_KEYWORDS[entity].test(command));

  if (matched.includes(parsed.entity as any) || matched.length !== 1) {
    return parsed; // model's pick is supported, or the command is genuinely ambiguous
  }

  const corrected = matched[0];
  return {
    ...parsed,
    entity: corrected,
    fields: sanitizeNlCommandFields(corrected, parsed.fields),
    confidence: Math.min(parsed.confidence, 55),
    explanation: `${parsed.explanation} (entity corrected to "${corrected}" — the command's wording didn't support "${parsed.entity}")`,
  };
}

// The exact (command -> fields) pairs shown as JSON-shape samples in the
// system prompt above. A correctly-working model only ever produces these
// values when the real command actually contains that same information —
// but small/fast models are prone to pattern-echo: copying a nearby
// example's answer instead of extracting from the real input, especially
// once the prompt got busier with disambiguation rules. This is what
// "creating tickets/contacts always named after the same sample values, no
// matter what I actually typed" looks like from the outside. Since no prompt
// wording can 100% guarantee a model won't do this, this is a deterministic
// backstop: if the returned fields exactly match one of these samples but
// the real command shares none of that sample's distinctive words, the
// result is rejected outright rather than silently creating the wrong record.
const NL_COMMAND_SAMPLES: Array<{ entity: NlCommandEntity; fields: Record<string, any>; distinctiveWords: string[] }> = [
  { entity: 'ticket',  fields: { title: 'VPN issues', body: 'The user is reporting an issue with VPN connectivity.' }, distinctiveWords: ['vpn'] },
  { entity: 'contact', fields: { name: 'Jane Smith', company: 'Acme Corp' },       distinctiveWords: ['jane', 'smith'] },
  { entity: 'lead',    fields: { name: 'John Doe', source: 'LinkedIn' },           distinctiveWords: ['john', 'doe', 'linkedin'] },
  { entity: 'deal',    fields: { title: 'Acme Corp deal', value: 50000 },          distinctiveWords: ['acme', '50,000', '50000', '$50'] },
  { entity: 'ticket',  fields: { title: 'Production database down', body: 'The user is reporting the production database is completely down and affecting everyone.', priority: 'CRITICAL' }, distinctiveWords: ['production', 'database'] },
];

function fieldsExactlyMatch(a: Record<string, any>, b: Record<string, any>): boolean {
  const bKeys = Object.keys(b);
  return bKeys.length > 0 && bKeys.every(k => String(a?.[k] ?? '').toLowerCase() === String(b[k]).toLowerCase());
}

export function guardAgainstEchoedSample(command: string, parsed: NlCommandResult): NlCommandResult {
  const lowerCommand = command.toLowerCase();
  const sample = NL_COMMAND_SAMPLES.find(s => s.entity === parsed.entity && fieldsExactlyMatch(parsed.fields, s.fields));
  if (!sample) return parsed;
  const commandActuallyMentionsIt = sample.distinctiveWords.some(w => lowerCommand.includes(w));
  if (commandActuallyMentionsIt) return parsed; // legitimate — the user really did type this
  return {
    intent: parsed.intent,
    entity: parsed.entity,
    fields: {},
    confidence: 0,
    explanation: "The AI returned placeholder sample values instead of reading your command — please try rephrasing with more specific details.",
  };
}

// Custom modules (a whole separate CRUD surface — CREATE_CUSTOM_MODULE /
// ADD_CUSTOM_MODULE_FIELD / CREATE_CUSTOM_MODULE_RECORD, all in
// ai-actions.ts) are only ever handled by the whitelisted action registry
// below, never by this 5-entity flow — there's no "module" entity here for
// the model to pick. On a command like "create a custom module for Vendor
// Contracts" the model still has to answer with one of ticket/contact/lead/
// deal/article, and reliably guessed "article": building a new object/schema
// vaguely resembles "creating a new piece of content" to a model with no
// better option. AiCommandBar.tsx only ever tries the action-registry
// planner when this legacy call returns entity "unknown" (see its
// "never overridden" comment), so a wrong-but-confident "article" guess here
// permanently shadowed the correct CREATE_CUSTOM_MODULE match — that's the
// "create custom module command is going to KB" bug. This is a hard
// override, not a confidence-based correction like the guards above: any
// module-flavored wording forces this flow to step aside entirely and let
// the action planner take it.
const MODULE_COMMAND_RE = /\b(custom\s+)?modules?\b/i;

export function guardAgainstModuleCommand(command: string, parsed: NlCommandResult): NlCommandResult {
  if (!MODULE_COMMAND_RE.test(command)) return parsed;
  return {
    intent: parsed.intent,
    entity: 'unknown',
    fields: {},
    confidence: 0,
    explanation: 'Custom module requests are handled by the AI action planner, not the create/update form flow.',
  };
}

export async function parseNaturalLanguageCommand(
  command: string,
  context: {
    users?: Array<{ id: string; name: string }>;
    categories?: Array<{ id: string; name: string }>;
    contacts?: Array<{ id: string; name: string }>;
  }
): Promise<NlCommandResult> {
  const client = getClient();
  if (!client) return { intent: 'unknown', entity: 'unknown', fields: {}, confidence: 0, explanation: 'AI not configured' };
  const reply = await chat(client,
    `You are a CRM/IT-Desk command parser. Read the user's command and decide exactly ONE target entity to create or update: "ticket", "contact", "lead", "deal", or "article".

Decide the entity from the command's OWN wording — not from anything in the context block below:
- ticket: reporting a problem/bug/outage or asking for IT/support help ("ticket", "issue", "broken", "not working", "error", "VPN", "printer", "password reset", "can't log in"...).
- contact: saving a person's info as a CRM contact ("add a contact", "save contact", "new contact").
- lead: logging a new sales prospect/inquiry ("lead", "prospect", "inquiry", a source like LinkedIn/website/referral).
- deal: creating/sizing a sales opportunity ("deal", "opportunity", a dollar amount, "pipeline", "stage", "close").
- article: writing/publishing a knowledge-base/help article ("article", "KB", "how-to", "documentation").

The Users/Categories/Contacts lists in the context block exist ONLY to resolve a name mentioned in the command to its id (e.g. matching "assign it to Priya" to a user id, or "deal with Jane Smith" to a contact id for a deal's contactId field). They are never a signal for which entity to create — do not default to "contact" just because contacts happen to exist in the org.

Fields allowed per entity:
- ticket: title, body, priority (LOW/MEDIUM/HIGH/CRITICAL), categoryId, assignedTo (user id)
- contact: name, email, phone, jobTitle, company
- lead: name, email, source, status, notes
- deal: title, value (number), stage, probability (0-100), contactId, notes
- article: title, body, status (DRAFT/PUBLISHED)

SMART INFERENCE — applies only to ticket priority, ticket categoryId, and ticket body, and only in the specific ways below. Everywhere else, the strict rule still applies: if a detail isn't in the command, omit that field rather than inventing or borrowing one.
- priority: only set this if the command's own wording actually conveys urgency or severity — words/phrases like "urgent", "asap", "critical", "down", "outage", "everyone is affected", "can't work", "production". Map that to LOW/MEDIUM/HIGH/CRITICAL. If the command conveys no urgency either way, leave priority out entirely — do NOT default it to MEDIUM yourself, the app's own form already does that.
- categoryId: only set this if the command's topic clearly and confidently matches the NAME of one of the categories listed in the context block below (e.g. a command about a VPN matches a category literally named "Network" or "VPN Access"). If nothing in the Categories list is a good topical match, leave categoryId out — never guess or pick the closest-sounding one.
- body: if the command gives no separate description beyond the subject itself, you may write ONE short sentence that rephrases the subject into fuller prose (e.g. subject "VPN issues" -> body "The user is reporting an issue with VPN connectivity."). This must be a rephrasing only — it must not invent specific facts, causes, steps, names, dates, or numbers that the command didn't state. If you can't rephrase without adding invented specifics, leave body out.

The block below shows the RESPONSE SHAPE ONLY, for four unrelated made-up sample commands. They are NOT the command you're being asked about, and their field values (VPN, Jane Smith, Acme Corp, John Doe, LinkedIn, $50,000, ...) must NEVER appear in your actual answer unless the real command at the bottom of this prompt happens to contain that exact same information itself. Copying any of these sample values into your answer when the real command doesn't contain them is a critical error.

Sample shape (ignore the content, copy only the JSON structure):
"Create a new ticket about VPN issues" -> {"intent":"create","entity":"ticket","fields":{"title":"VPN issues","body":"The user is reporting an issue with VPN connectivity."},"confidence":90,"explanation":"Reports a VPN problem — a support ticket. No urgency stated, so priority was left out; no matching category was in context."}
"Add a contact named Jane Smith from Acme Corp" -> {"intent":"create","entity":"contact","fields":{"name":"Jane Smith","company":"Acme Corp"},"confidence":92,"explanation":"Explicitly asks to add a contact."}
"New lead from LinkedIn named John Doe" -> {"intent":"create","entity":"lead","fields":{"name":"John Doe","source":"LinkedIn"},"confidence":90,"explanation":"A new lead from a named source."}
"Create a deal with Acme Corp worth $50,000" -> {"intent":"create","entity":"deal","fields":{"title":"Acme Corp deal","value":50000},"confidence":88,"explanation":"Sales opportunity with a dollar value."}
"URGENT - create a ticket, production database is completely down for everyone" -> {"intent":"create","entity":"ticket","fields":{"title":"Production database down","body":"The user is reporting the production database is completely down and affecting everyone.","priority":"CRITICAL"},"confidence":93,"explanation":"Explicit urgency and total outage wording maps to CRITICAL priority."}

Now read the ACTUAL command given below (in the user message, not this list) and extract fields from its own words, applying SMART INFERENCE only where this prompt explicitly allows it above.

Respond with a single JSON object only: {"intent": "create"|"update", "entity": "ticket"|"contact"|"lead"|"deal"|"article", "fields": {...}, "confidence": 0-100, "explanation": "1 sentence"}`,
    `Command: "${command}"\n\nContext (for resolving names to IDs only — NOT for choosing the entity):\nUsers: ${JSON.stringify(context.users ?? [])}\nCategories: ${JSON.stringify(context.categories ?? [])}\nContacts (only relevant for a deal's contactId): ${JSON.stringify(context.contacts ?? [])}`,
    // The command-parsing path mutates real records off a single inference,
    // so it's worth trading the fast/small model's latency for the smart
    // model's much better instruction-following — plus JSON mode so the
    // "respond with JSON only" instruction is enforced by the API, not just
    // requested.
    { feature: 'command.bar', maxTokens: 300, model: AI_MODEL_SMART, json: true }
  );
  let parsed: NlCommandResult;
  try {
    parsed = JSON.parse(reply);
  } catch {
    return { intent: 'unknown', entity: 'unknown', fields: {}, confidence: 0, explanation: 'Could not parse command' };
  }
  parsed.fields = sanitizeNlCommandFields(parsed.entity, parsed.fields);
  parsed = guardEntityClassification(command, parsed);
  parsed = guardAgainstEchoedSample(command, parsed);
  parsed = guardAgainstModuleCommand(command, parsed);
  return parsed;
}

// ─── AI Action Planner (whitelisted action execution) ─────────────────────────
// Distinct from parseNaturalLanguageCommand above: that one only ever proposes
// a create/update of one of 5 entity types, which the UI then hands off to the
// existing form. This one picks from an arbitrary caller-supplied menu of
// registered actions (server/src/utils/ai-actions.ts) — state changes,
// reminders, notes, scoring, toggles — anything with no dedicated "create"
// form. The model can only ever name an action from the menu it's given; it
// never invents one, and every id it returns still gets re-validated against
// the org by the action's own handler before anything runs.

export async function planAiAction(
  command: string,
  context: {
    actions: Array<{ name: string; description: string; params: string }>;
    deals?: Array<{ id: string; title: string; stage: string }>;
    tickets?: Array<{ id: string; title: string; status: string }>;
    leads?: Array<{ id: string; name: string }>;
    rules?: Array<{ id: string; name: string; isActive: boolean }>;
    contacts?: Array<{ id: string; name: string }>;
    modules?: Array<{
      id: string; name: string;
      fields: Array<{ fieldKey: string; label: string; fieldType: string }>;
      /** Pipeline stage keys+labels, when the module has a board (Phase 5). */
      stages?: Array<{ key: string; label: string }>;
      /** Recent records (id/title/stage) so stage-moves can resolve a title to an id. */
      records?: Array<{ id: string; title: string; stage: string | null }>;
    }>;
    assignableUsers?: Array<{ id: string; name: string }>;
    quotes?: Array<{ id: string; title: string; status: string }>;
    invoices?: Array<{ id: string; invoiceNumber: string; title: string; status: string }>;
    campaigns?: Array<{ id: string; name: string; status: string }>;
    assets?: Array<{ id: string; name: string; type: string }>;
    leaveTypes?: Array<{ id: string; name: string }>;
    pendingLeaveRequests?: Array<{ id: string; userName: string; leaveTypeName: string; startDate: string; endDate: string }>;
    orgUsers?: Array<{ id: string; name: string }>;
  }
): Promise<{
  action: string | null;
  params: Record<string, any>;
  confidence: number;
  explanation: string;
}> {
  const client = getClient();
  if (!client) return { action: null, params: {}, confidence: 0, explanation: 'AI not configured' };

  const menu = context.actions
    .map(a => `- ${a.name}: ${a.description}\n  params: ${a.params}`)
    .join('\n');

  // The API call itself (not just a malformed reply) can fail — a request
  // that's grown past the model's limits, a transient Groq/OpenAI error not
  // in chat()'s narrow retry list, etc. This endpoint is advisory only (it
  // never mutates anything — see the function comment above), so a failure
  // here should degrade to "couldn't plan that" the same way a bad JSON
  // reply already does below, rather than surfacing as a hard 500 that
  // makes the whole command bar show a generic error.
  let reply: string;
  try {
    reply = await chat(client,
      `You are a CRM automation planner. Given a natural language request, pick the SINGLE best-matching action from this whitelist, or return null if nothing matches well enough:\n${menu}\n\nMatch any deal/ticket/lead/rule/contact/custom-module/quote/invoice/campaign/asset/leave-type/leave-request/user mentioned by name (or invoice number) to its id using the context lists provided — never invent an id that isn't in the context. For custom module records/fields, only ever use a fieldKey that's actually listed under that module's "fields" in the context — never invent one, even if the wording suggests an obvious key. A module's "stages" list holds its valid stage keys: any stage param must be one of those keys, and a record named by the user should be matched to an id in that module's "records" list when it appears there. Pending leave requests are matched by the requester's name, not the manager's. If you can't find a confident id/fieldKey match for something the action requires, lower the confidence instead of guessing.\nRespond ONLY with valid JSON: {"action": "<one of the names above>"|null, "params": {...matching that action's params shape}, "confidence": 0-100, "explanation": "1 short sentence describing what will happen, for the user to confirm"}`,
      `Command: "${command}"\n\nContext:\nDeals: ${JSON.stringify(context.deals ?? [])}\nTickets: ${JSON.stringify(context.tickets ?? [])}\nLeads: ${JSON.stringify(context.leads ?? [])}\nWorkflow rules: ${JSON.stringify(context.rules ?? [])}\nContacts: ${JSON.stringify(context.contacts ?? [])}\nCustom modules: ${JSON.stringify(context.modules ?? [])}\nAssignable users (for ASSIGN_TICKET): ${JSON.stringify(context.assignableUsers ?? [])}\nQuotes: ${JSON.stringify(context.quotes ?? [])}\nInvoices: ${JSON.stringify(context.invoices ?? [])}\nCampaigns: ${JSON.stringify(context.campaigns ?? [])}\nAssets: ${JSON.stringify(context.assets ?? [])}\nLeave types: ${JSON.stringify(context.leaveTypes ?? [])}\nPending leave requests: ${JSON.stringify(context.pendingLeaveRequests ?? [])}\nOrg users (for MANUAL_ATTENDANCE_ENTRY): ${JSON.stringify(context.orgUsers ?? [])}`,
      { feature: 'command.plan', maxTokens: 500, model: AI_MODEL_SMART }
    );
  } catch (err: any) {
    console.error('[planAiAction] chat call failed:', err?.status, err?.message || err);
    return { action: null, params: {}, confidence: 0, explanation: 'AI request failed — try again in a moment' };
  }
  try {
    const parsed = JSON.parse(reply);
    return {
      action: parsed.action ?? null,
      params: parsed.params ?? {},
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      explanation: parsed.explanation ?? '',
    };
  } catch {
    console.error('[planAiAction] non-JSON reply:', reply.slice(0, 300));
    return { action: null, params: {}, confidence: 0, explanation: 'Could not parse command' };
  }
}

// ─── Auto-Tag Ticket ──────────────────────────────────────────────────────────

export async function autoTagTicket(ticket: {
  title: string; body: string; category?: string | null;
}): Promise<string[]> {
  const client = getClient();
  if (!client) return [];
  /* A cache read used to sit here, JSON.parse-ing outside any try/catch. It
     was dead code — chat() caches under its own key and nothing ever wrote
     this one — but it would have thrown on the first hit. chat() already
     caches this call, so nothing is lost by removing it. */
  const reply = await chat(client,
    'You are an IT help desk AI. Extract 3-6 short, lowercase keyword tags from this support ticket that would help categorize and find it later. Respond ONLY with a valid JSON array of strings: ["tag1", "tag2", ...]',
    `Title: "${ticket.title}"\nCategory: ${ticket.category ?? 'General'}\n\n${ticket.body.slice(0, 600)}`,
    { feature: 'ticket.autoTag', maxTokens: 150 }
  );
  try {
    const tags = JSON.parse(reply);
    return Array.isArray(tags) ? tags.slice(0, 6).map((t: any) => String(t).toLowerCase().trim()) : [];
  } catch { return []; }
}

// ─── Score Contact Health ─────────────────────────────────────────────────────

export async function scoreContactHealth(contact: {
  name: string; createdAt: Date; lastActivityAt?: Date | null;
  dealCount: number; openDealValue: number;
  ticketCount: number; negativeTickets: number;
  responseRate?: number;
}): Promise<{ score: number; grade: 'A' | 'B' | 'C' | 'D' | 'F'; summary: string; recommendations: string[] }> {
  const client = getClient();
  if (!client) return { score: 70, grade: 'B', summary: 'AI not configured', recommendations: [] };

  const daysSinceActivity = contact.lastActivityAt
    ? Math.floor((Date.now() - new Date(contact.lastActivityAt).getTime()) / 86400000)
    : Math.floor((Date.now() - new Date(contact.createdAt).getTime()) / 86400000);

  const reply = await chat(client,
    'You are a customer health scoring AI. Rate the overall health of a customer relationship. Respond ONLY with valid JSON: {"score": 0-100, "grade": "A"|"B"|"C"|"D"|"F", "summary": "2-sentence assessment", "recommendations": ["up to 3 actionable recommendations"]}',
    `Contact: ${contact.name}\nDays since last activity: ${daysSinceActivity}\nOpen deals: ${contact.dealCount} (value: $${contact.openDealValue})\nTotal tickets: ${contact.ticketCount}\nNegative/frustrated tickets: ${contact.negativeTickets}`,
    { feature: 'contact.health', maxTokens: 300 }
  );
  try {
    const p = JSON.parse(reply);
    const grades = ['A','B','C','D','F'];
    return {
      score: Math.min(100, Math.max(0, Number(p.score))),
      grade: grades.includes(p.grade) ? p.grade : 'C',
      summary: String(p.summary || ''),
      recommendations: Array.isArray(p.recommendations) ? p.recommendations.slice(0, 3) : [],
    };
  } catch { return { score: 70, grade: 'B', summary: 'Could not assess', recommendations: [] }; }
}

// ─── Predict Deal Close Date ──────────────────────────────────────────────────

export async function predictDealCloseDate(deal: {
  title: string; stage: string; value: number; probability: number;
  daysOpen: number; expectedCloseDate?: Date | null; notes?: string | null;
}, historicalAvgDays: number): Promise<{
  predictedDays: number; predictedDate: string; confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  reasoning: string;
}> {
  const client = getClient();
  if (!client) return { predictedDays: historicalAvgDays, predictedDate: '', confidence: 'LOW', reasoning: 'AI not configured' };

  const reply = await chat(client,
    'You are a sales forecasting AI. Predict when this deal will close. Respond ONLY with valid JSON: {"predictedDays": number (days from today), "confidence": "LOW"|"MEDIUM"|"HIGH", "reasoning": "1-2 sentences"}',
    `Deal: "${deal.title}"\nStage: ${deal.stage}\nValue: $${deal.value}\nProbability: ${deal.probability}%\nDays already open: ${deal.daysOpen}\nHistorical avg close: ${historicalAvgDays} days\nExpected close: ${deal.expectedCloseDate ?? 'not set'}\nNotes: ${deal.notes ?? 'none'}`,
    { feature: 'deal.closeDate', maxTokens: 200 }
  );
  try {
    const p = JSON.parse(reply);
    const days = Math.max(1, Number(p.predictedDays) || historicalAvgDays);
    const date = new Date();
    date.setDate(date.getDate() + days);
    return {
      predictedDays: days,
      predictedDate: date.toISOString().split('T')[0],
      confidence: ['LOW','MEDIUM','HIGH'].includes(p.confidence) ? p.confidence : 'MEDIUM',
      reasoning: String(p.reasoning || ''),
    };
  } catch { return { predictedDays: historicalAvgDays, predictedDate: '', confidence: 'LOW', reasoning: 'Could not predict' }; }
}

// ─── Detect Competitor Mentions ───────────────────────────────────────────────

export async function detectCompetitorMentions(text: string, knownCompetitors?: string[]): Promise<{
  mentions: Array<{ competitor: string; context: string; sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' }>;
  hasCompetitorActivity: boolean;
}> {
  const client = getClient();
  if (!client) return { mentions: [], hasCompetitorActivity: false };

  const competitorHint = knownCompetitors?.length
    ? `Known competitors to watch for: ${knownCompetitors.join(', ')}\n`
    : '';

  const reply = await chat(client,
    `You are a competitive intelligence AI. Detect competitor mentions in business text. ${competitorHint}Respond ONLY with valid JSON: {"mentions": [{"competitor": "name", "context": "brief quote or context", "sentiment": "POSITIVE"|"NEGATIVE"|"NEUTRAL"}], "hasCompetitorActivity": boolean}`,
    `Text to analyze:\n${text.slice(0, 1000)}`,
    { feature: 'competitors.detect', maxTokens: 400 }
  );
  try {
    const p = JSON.parse(reply);
    return {
      mentions: Array.isArray(p.mentions) ? p.mentions.slice(0, 5) : [],
      hasCompetitorActivity: Boolean(p.hasCompetitorActivity),
    };
  } catch { return { mentions: [], hasCompetitorActivity: false }; }
}

// ─── Bulk Score Leads ─────────────────────────────────────────────────────────

export async function bulkScoreLeads(leads: Array<{
  id: string; status: string; source?: string | null; notes?: string | null;
  contactName?: string; daysOld: number;
}>): Promise<Array<{ id: string; score: number; reason: string }>> {
  const client = getClient();
  // Same reasoning as scoreLead: return nothing rather than 50s the caller
  // would write across every lead in the org.
  if (!client) return [];

  const BATCH = 10;
  const results: Array<{ id: string; score: number; reason: string }> = [];

  for (let i = 0; i < leads.length; i += BATCH) {
    const batch = leads.slice(i, i + BATCH);
    const reply = await chat(client,
      'You are a CRM lead scoring AI. Score each lead 0-100. Respond ONLY with a valid JSON array: [{"id": "...", "score": number, "reason": "max 80 chars"}]',
      `Score these leads:\n${JSON.stringify(batch)}`,
      { feature: 'lead.bulkScore', maxTokens: 600 }
    );
    /* Validate before these reach prisma.lead.updateMany. Ids are checked
       against the batch we actually sent, so a hallucinated id cannot become a
       stray write, and a non-numeric score cannot reach the database. */
    const parsed = safeJson(reply);
    const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.leads) ? parsed.leads : [];
    const sent = new Set(batch.map(l => l.id));
    for (const row of arr) {
      const id = str(row?.id, 60);
      const score = num(row?.score, 0, 100);
      if (!id || !sent.has(id) || score === null) continue;
      results.push({ id, score: Math.round(score), reason: str(row?.reason, 120) ?? '' });
    }
    if (i + BATCH < leads.length) await new Promise(r => setTimeout(r, 500)); // rate limit spacing
  }
  return results;
}

// ─── Search Query Interpreter ─────────────────────────────────────────────────
// Backs the global search bar (AISmartSearch.tsx / search.controller.ts).
// Turns free text like "open critical tickets about vpn" into keywords to
// substring-match plus a narrowed set of record types and a status/priority
// hint, instead of running every query as a blind `contains` scan across
// every entity. Falls back to treating the whole query as keywords across
// all types when AI isn't configured or the response doesn't parse — same
// behavior the search always had, so there's no regression, just an upgrade
// when a key is present.

export interface SearchInterpretation {
  keywords: string;
  entityTypes: string[]; // subset of contact|deal|ticket|lead|article|asset|invoice, [] = all
  status: string | null;
  priority: string | null;
}

const SEARCH_ENTITY_TYPES = ['contact', 'deal', 'ticket', 'lead', 'article', 'asset', 'invoice'];

export async function interpretSearchQuery(query: string): Promise<SearchInterpretation> {
  const client = getClient();
  if (!client) return { keywords: query, entityTypes: [], status: null, priority: null };

  try {
    const reply = await chat(
      client,
      `You are a search query interpreter for a CRM + helpdesk app. Given a user's free-text search, extract:
1. keywords: the core search term(s) to match against names/titles/bodies — strip filler words like "find", "show me", "open" (unless "open" is itself a status), articles, etc. If nothing meaningful is left, repeat the original query.
2. entityTypes: which record types are relevant, chosen from exactly: ${SEARCH_ENTITY_TYPES.join(', ')}. Empty array if the query doesn't hint at a specific type (search everything).
3. status: a status hint if mentioned (e.g. "open", "resolved", "won", "lost", "paid", "overdue"), else null.
4. priority: a priority hint if mentioned (e.g. "critical", "high"), else null.
Respond ONLY with valid JSON: {"keywords": "...", "entityTypes": [...], "status": "..."|null, "priority": "..."|null}`,
      `Search query: "${query}"`,
      { feature: 'search.interpret', maxTokens: 150, model: AI_MODEL_FAST },
    );
    const parsed = JSON.parse(reply);
    const entityTypes = Array.isArray(parsed.entityTypes)
      ? parsed.entityTypes.filter((t: any) => typeof t === 'string' && SEARCH_ENTITY_TYPES.includes(t))
      : [];
    return {
      keywords: (typeof parsed.keywords === 'string' && parsed.keywords.trim()) || query,
      entityTypes,
      status: typeof parsed.status === 'string' ? parsed.status : null,
      priority: typeof parsed.priority === 'string' ? parsed.priority : null,
    };
  } catch {
    // AI unreachable, rate-limited, or returned unparseable JSON — fall back
    // to exactly the old behavior rather than surfacing an error to the
    // search bar over what's meant to be a low-stakes, best-effort upgrade.
    return { keywords: query, entityTypes: [], status: null, priority: null };
  }
}
