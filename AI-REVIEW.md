# AI review — CRMITdesk Evolved

A full pass over every AI capability in the product: what each one does, what
was wrong, what was fixed, and what remains a decision rather than a bug.

**Scope:** 36 server-side AI capabilities, 32 client touchpoints.
**Status:** bugs listed in §2 are fixed. §3 items are documented, not changed.

---

## 1. What was added for users

Every AI feature is now described in one place — `client/src/shared/ai/aiFeatures.ts` —
and the UI reads from it rather than each button carrying (or omitting) its own
explanation. Before this, **20 of 32 AI touchpoints had no user-facing
explanation at all**, and only three places in the entire client told the user
what record data actually gets sent to the model.

Each catalogue entry answers four questions:

| Field | Why it exists |
| --- | --- |
| `does` | What the user gets, in plain language. |
| `sends` | What leaves your server and reaches the AI provider. This is the first question any customer's security reviewer asks, and it was previously unanswerable from the UI. |
| `effect` | `advisory` (you decide) or `writes` (the product changes a record). Four features write without asking. |
| `tier` | `free` or `paid`, so a Pro-only feature does not surprise a Free-plan user with a 402. |

Two components render it: `<AiInfo id="…" />` (an ⓘ button beside a control)
and `<AiNote id="…" />` (a persistent sentence at the top of a panel).
`<AiGeneratedTag />` marks model-written text so it is never mistaken for saved
data.

**The four features that change a record without confirmation** — now labelled
as such in the UI:

1. **Lead score** — writes `aiScore` onto the lead.
2. **Ticket sentiment** — writes `sentiment` onto the ticket.
3. **Ticket auto-routing** — reassigns category and agent immediately.
4. **Score all leads** — bulk-writes scores across up to 50 leads at once.

---

## 2. Fixed

### 2.1 Churn risk was computed from unrelated data
`ai.controller.ts` fetched *the ten most recent tickets in the whole
organisation*, not the contact's. Every contact was assessed against the same
unrelated ticket set, so the score said nothing about the customer it was
attached to. Now scoped with `contactId`.

### 2.2 Contact health was given metrics it did not have
The prompt asks for support-ticket counts. The handler passed the **activity**
count as `ticketCount` and hardcoded `negativeTickets: 0`. The model was
reasoning about a support history it was never shown. Both now come from a real
query against the contact's tickets.

### 2.3 Placeholder scores were written to the database as real ones
With no AI provider configured, `scoreLead` returned `{ score: 50 }` and the
controller persisted it. A lead that had never been assessed became
indistinguishable from one genuinely scored 50/100 — and because bulk scoring
selects `where: { aiScore: null }`, that lead was then **skipped forever**.
`bulkScoreLeads` did the same across 50 leads at once.

Both now return a `scored: false` flag and the controller writes nothing.

### 2.4 The tone checker failed open
Any failure — no API key, provider error, malformed reply — returned
`approved: true`. An email that was never checked looked exactly like one that
passed review. It now fails closed and returns `checked: false`, and the UI
shows "Tone not checked" rather than a pass.

### 2.5 Customer API keys were bypassed in favour of the platform's
`resolveModels` used `orderBy: [{ orgId: 'desc' }, …]` intending "a customer key
beats the platform key". In Postgres, `DESC` sorts **NULLS FIRST**, so
platform-owned providers (`orgId IS NULL`) were tried *first* — the exact
inverse. The platform was billed for tenant traffic and per-org rate limits went
unused. Ordering is now explicit in JS.

### 2.6 Model output reached the client and the database unchecked
Six handlers did `return JSON.parse(reply)` with no shape check, and
`bulkScoreLeads` pushed unvalidated scores straight into `prisma.lead.updateMany`.
A model is free to return a string where a number was asked for, omit a key, or
wrap an array in an object.

Added `safeJson` / `num` / `str` / `strArray` helpers and applied them to
`generateFollowUp`, `estimateResolutionTime`, `checkEmailTone`,
`parseMeetingNotes`, `generatePipelineHealth`, `generateKbArticle`,
`calculateWinProbability` and `bulkScoreLeads`. Bulk scoring now also checks each
returned id against the batch actually sent, so a hallucinated id cannot become
a stray write.

### 2.7 A failed re-index made a document permanently unsearchable
`indexDocument` wrote the new `contentHash`, then deleted and recreated chunks in
a bare loop. A crash partway through left a document whose hash matched its
content but whose chunks were missing. Because indexing short-circuits on a hash
match, **every future re-index skipped it** — silently, forever. Delete-and-insert
now runs in one transaction; the pgvector shadow column syncs afterwards, since
it is an optimisation rather than the source of truth.

### 2.8 A transient database blip permanently degraded search
`hasPgVector()` cached `false` on *any* error, including a connection blip during
boot, pinning that process to the slow in-Node path for its whole lifetime with
no way to recover short of a restart. Failures are no longer cached.

### 2.9 Fallback search returned a non-deterministic subset
The non-pgvector path did `take: 2000` with no `orderBy`, so Postgres returned an
arbitrary 2000 rows — a different subset run to run, silently losing recall on a
large tenant. Now ordered newest-first.

### 2.10 Requests had no timeout
No `timeout` or `maxRetries` was set on any OpenAI client. The SDK's 10-minute
default combined with `chat()`'s own 3-attempt loop meant a wedged provider could
hold an Express handler for roughly **90 minutes across 9 HTTP attempts** — long
enough to exhaust the connection pool. Now 30s with retry policy owned solely by
`chat()`. Override with `AI_REQUEST_TIMEOUT_MS`.

### 2.11 Dead code that would have thrown
`autoTagTicket` read a cache key nothing ever wrote and `JSON.parse`d it outside
any try/catch. Harmless only because it never hit. Removed.

### 2.12 Silent failures in the UI
Ticket auto-routing had a bare `catch { }` — a failed reassignment showed nothing
at all. Meeting-notes parsing had an uncaught `mutateAsync`, so a failure was an
unhandled rejection and the modal just sat there. Smart search swallowed errors
and showed an empty dropdown. All three now surface the error.

Two honesty fixes alongside them: the meeting-notes **"Create All"** button
created nothing — it only fired a toast — and is now labelled "Done"; and the
AI Insights widget sat in an indefinite skeleton because its mutation never
auto-runs, with nothing telling the user to press Refresh.

---

## 3. Not fixed — decisions, not bugs

### 3.1 Three separate AI stacks, one governance layer
There are three independent paths to a model:

| Stack | Used by | Logged | Budgeted | Cost tracked |
| --- | --- | --- | --- | --- |
| `utils/aiGateway.ts` | RAG only | yes | yes | yes |
| `utils/ai.ts` | all 26 CRM/IT-Desk features + search | no | no | no |
| Ad-hoc `new OpenAI()` | AI Studio, custom rules | no | no | no |

**Roughly 90% of AI calls are invisible to your cost dashboard and cannot be
budget-capped.** The AI Governance page reports on RAG traffic only — the number
shown is real, but it is not the whole bill.

`aiGateway.ts` already notes this as "a mechanical follow-up". It is the single
highest-value change remaining, and the one I did not make because it touches
every AI feature at once.

### 3.2 Budgets are advisory by default
`setBudget` defaults `hardStop: false`, which only raises an alert. A budget with
no row at all means unlimited. And `embed()` does not check the budget, so
knowledge indexing can spend freely — `IndexSchema.content` has **no maximum
length**, so a single request can embed an arbitrarily large document.

### 3.3 No AI-specific rate limiting
The only limits are the global `apiLimiter` (300 req/min per IP) and
`apiKeyLimiter` (120/min), both `skip: () => !isProd`. Nothing caps AI calls
specifically. `bulkScoreHandler` issues up to five sequential large-model calls
per request; `reindexKnowledgeArticles` runs synchronously over every published
article. `trackAiCall` records usage but enforces nothing — `usageTracking.ts`
says so outright: *"No billing decisions read from this yet."*

### 3.4 Prompt injection
User-controlled text is interpolated into prompts everywhere with no delimiting.
The mitigations that matter are already in place and are good: the action
registry allowlist, a server-side role re-check, Zod parsing of params, and
per-handler org scoping. The worst outcome from an injected action is *a
different registered action on a record in the same org, which the user must
still confirm*.

Two paths deserve a second look:

- **Auto-routing with `apply: true`** writes without confirmation. Ids are
  re-validated against your real lists, so the blast radius is misrouting within
  the org — but it is the only unconfirmed write driven by ticket text.
- **`CustomAIFunction.systemPrompt` and `AICustomRule.customPrompt`** are
  unbounded, org-authored system prompts (`z.string().min(1)`, no maximum) that
  any `ALL_STAFF` user can execute, though only managers can author them.

### 3.5 PII goes to the provider with no redaction
Contact names and emails, full ticket bodies, comment threads with author names,
pasted meeting notes, and — in the action planner's context — **employee names
and pending leave dates**. There is no DPA gate, no opt-out and no redaction.

The gateway was built for this: `prepareContext()` and the `redactedFields`
column exist, and a comment describes them as *"what stops 'the model summarised
an employee record and mentioned their salary'"*. **They are exported but never
called**, so `redactedFields` is always empty. Wiring that up is the natural
companion to §3.1.

### 3.6 Smaller items
- `markActionExecuted()` is never called, so `actionExecuted` / `actionName` /
  `approvedBy` are always empty in the interaction log — the governance page's
  "Actions executed" tile can only ever read zero.
- A hard-stop budget block returns an **empty answer with no explanation** rather
  than saying the budget was reached.
- `decryptSecretOrPlain` returns the ciphertext as the key when decryption fails
  (wrong `ENCRYPTION_KEY`), producing a confusing 401 instead of a clear error.
- `POST /api/knowledge/ai/providers` accepts an arbitrary `baseUrl` from any
  manager, so an org admin can route all gateway prompts to a third-party endpoint.
- `POST /api/knowledge/feedback/:id` has no permission check (org-scoped, so at
  most intra-org feedback spoofing).
- Ticket reply suggestions pull `take: 3` knowledge base articles **with no
  ordering and no relevance search** — the RAG index built for exactly this is
  not used. Routing that through `rag.search` would measurably improve replies.
- `indexDocument` only de-duplicates when `entityType` *and* `entityId` are set,
  so `POST /knowledge/documents` without an entity link creates a duplicate
  document and re-embeds on every call.
- Four client components are dead: `AIConfidenceBadge`, `AISuggestionPill`,
  `useKnowledgeSearch`, and `AITypewriter`'s "AI Generated" label (suppressed at
  its only call site).

---

## 4. Keeping this accurate

`client/src/shared/ai/aiFeatures.ts` is documentation that ships to users, so it
goes stale the same way comments do. When you change what a prompt receives,
update that entry's `sends`. When a feature starts writing to a record, change
its `effect` to `writes` — that string is what tells a user the product will act
without asking.
