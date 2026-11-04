import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, ArrowRight, Loader2, ChevronRight, CheckCircle2, ShieldAlert, Zap, Info } from "lucide-react";
import { useNlCommand, usePlanAiAction, useExecuteAiAction, useAiActionsMenu } from "../../api/ai";
import { useAuth } from "../../contexts/AuthContext";
import { can } from "../permissions";
import { AiNote } from "./AiInfo";
import { Alert } from "./Alert";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { Input } from "./Field";
import { Modal } from "./Modal";

// Route mapping
const ENTITY_ROUTES: Record<string, string> = {
  ticket:  "/itdesk/tickets",
  contact: "/crm/contacts",
  lead:    "/crm/leads",
  deal:    "/crm/deals",
  article: "/itdesk/articles",
};

const ENTITY_LABELS: Record<string, string> = {
  ticket:  "Ticket",
  contact: "Contact",
  lead:    "Lead",
  deal:    "Deal",
  article: "Article",
};

const SUGGESTIONS = [
  "Create a new ticket about VPN issues",
  "Add a contact named Jane Smith from Acme Corp",
  "Create a deal with Acme Corp worth $50,000",
  "New lead from LinkedIn named John Doe",
];

/* Confidence is a judgement about quality, so it stays on the reserved status
   hues rather than the accent — "80% confident" should read the same shade of
   good in every theme. */
function confidenceVariant(score: number) {
  if (score >= 80) return "green" as const;
  if (score >= 50) return "yellow" as const;
  return "red" as const;
}

interface AiCommandBarProps {
  open: boolean;
  onClose: () => void;
}

// Two things can come back from a submitted command:
//  - "legacy": the existing create/update-an-entity flow (ticket/contact/lead/
//    deal/article) — unchanged, still just prefills a form and redirects.
//  - "action": a whitelisted registry action (move a deal's stage, schedule a
//    reminder, add a note, toggle a rule, etc.) with no dedicated create form
//    — this is the new propose -> confirm -> execute flow.
type ResultMode = "legacy" | "action" | "none";

/** A clickable example command. Was five copies of the same hover-tinted row. */
function ExampleRow({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-start gap-2 px-3 py-1.5 rounded-btn text-sm text-fg-muted hover:bg-accent-soft hover:text-accent-soft-fg transition-colors text-left group w-full"
    >
      <ChevronRight size={13} className="mt-0.5 text-fg-subtle group-hover:text-accent flex-shrink-0" />
      <span className="min-w-0">{children}</span>
    </button>
  );
}

/** A parsed key/value chip. */
function ParamChip({ name, value }: { name: string; value: unknown }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-btn bg-surface-sunken text-xs text-fg">
      <span className="font-semibold text-fg-muted">{name}:</span>
      <span>{String(value)}</span>
    </span>
  );
}

export function AiCommandBar({ open, onClose }: AiCommandBarProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<ResultMode>("none");
  const [searching, setSearching] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const nlCommand = useNlCommand();
  const planAction = usePlanAiAction();
  const execAction = useExecuteAiAction();
  // Only fetched once help is actually opened — it's role-filtered server
  // data (not static), so there's no point loading it on every command-bar
  // open when most uses never touch the help panel. GET /ai/actions is also
  // ALL_STAFF-only, so for an EMPLOYEE the help toggle is not offered at all
  // rather than opening a panel whose contents are a refusal.
  const { user } = useAuth();
  const canReadActions = can.readStaffRecords(user?.role);
  const actionsMenu = useAiActionsMenu(showHelp && canReadActions);

  const result = nlCommand.data;
  const plan = planAction.data;
  const isLoading = searching || nlCommand.isPending || planAction.isPending;
  const isError = mode === "none" && (nlCommand.isError || planAction.isError);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
      setMode("none");
      setSearching(false);
      setShowHelp(false);
      nlCommand.reset();
      planAction.reset();
      execAction.reset();
    }
  }, [open]);

  // Escape-to-close and body scroll locking now come from Modal, which is the
  // whole point of routing through it — this was the app's most prominent
  // dialog and the only one that reimplemented both.

  if (!open) return null;

  async function runCommand(text: string) {
    setMode("none");
    execAction.reset();
    setSearching(true);
    try {
      const legacy = await nlCommand.mutateAsync(text).catch(() => null);
      // A confident, recognized create/update intent keeps today's behavior
      // exactly as-is — never overridden by the new action flow.
      if (legacy && legacy.entity !== "unknown" && legacy.confidence >= 30) {
        setMode("legacy");
        return;
      }
      // Otherwise, see if this matches something in the whitelisted action
      // registry instead — covers requests with no dedicated create form
      // (move a stage, schedule a reminder, add a note, toggle a rule...).
      const proposed = await planAction.mutateAsync(text).catch(() => null);
      if (proposed && proposed.action && proposed.confidence >= 40) {
        setMode("action");
        return;
      }
      // Fall back to the existing "couldn't understand" branch only if we
      // actually have a (low-confidence) legacy result to show — otherwise
      // leave mode as "none" so the generic network-error banner renders
      // instead of a blank panel.
      if (legacy) setMode("legacy");
    } finally {
      setSearching(false);
    }
  }

  function handleSubmit() {
    const trimmed = query.trim();
    if (trimmed.length < 3) return;
    runCommand(trimmed);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleSubmit();
  }

  function handleSuggestion(text: string) {
    setShowHelp(false);
    setQuery(text);
    runCommand(text);
  }

  function navigateToEntity(showCreateModal: boolean) {
    if (!result) return;
    const route = ENTITY_ROUTES[result.entity] ?? "/dashboard";
    onClose();
    navigate(route, {
      state: {
        aiPrefill: result.fields,
        ...(showCreateModal ? { openCreate: true } : {}),
      },
    });
  }

  function handleConfirmAction() {
    if (!plan?.action) return;
    execAction.mutate({ action: plan.action, params: plan.params, command: query.trim() });
  }

  function handleCancelAction() {
    setMode("none");
    execAction.reset();
  }

  const confidencePct = result ? Math.round(result.confidence * 100) : 0;
  const lowConfidence = result && confidencePct < 30;
  const planConfidencePct = plan ? Math.round(plan.confidence) : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="AI Command"
      subtitle="Type a natural language command"
      icon={<Sparkles size={16} />}
    >
      <div className="-mx-6 -my-5">
        {/* What this does and what workspace data it sends. The "What can I
            say?" panel below is good, but it is hidden behind a toggle and
            says nothing about what leaves the server. */}
        <div className="px-6 pt-4">
          <AiNote id="command.bar" />
        </div>

        {/* Help panel: every supported command syntax, straight from the
            server's action registry (ai-actions.ts) plus the fixed 5-entity
            create/update list — so this can never list something that isn't
            actually wired up. Click any example to run it immediately. */}
        {showHelp && canReadActions && (
          <div className="px-6 py-4 border-b border-line-subtle max-h-80 overflow-y-auto">
            {actionsMenu.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-fg-muted">
                <Loader2 size={14} className="animate-spin" /> Loading supported commands...
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-[11px] font-semibold text-fg-subtle uppercase tracking-wider mb-2">Create or update a record</p>
                  <div className="flex flex-col gap-1">
                    {(actionsMenu.data?.legacy ?? []).map(l => (
                      <ExampleRow key={l.entity} onClick={() => handleSuggestion(l.example)}>
                        "{l.example}"
                      </ExampleRow>
                    ))}
                  </div>
                </div>
                {(actionsMenu.data?.actions?.length ?? 0) > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold text-fg-subtle uppercase tracking-wider mb-2">Actions</p>
                    <div className="flex flex-col gap-1">
                      {(actionsMenu.data?.actions ?? []).map(a => (
                        <ExampleRow key={a.name} onClick={() => handleSuggestion(a.example)}>
                          <span className="block">"{a.example}"</span>
                          <span className="block text-[11px] text-fg-subtle">{a.label}</span>
                        </ExampleRow>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-[11px] text-fg-subtle leading-relaxed">
                  Actions beyond the four free ones (lead scoring, ticket sentiment, auto-routing, auto-tagging) need a Pro or Enterprise plan.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Input area */}
        <div className="px-6 pt-4 pb-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-xs font-medium text-fg-muted">What would you like to do?</p>
            {canReadActions && (
              <IconButton
                label="What can I say?"
                icon={<Info size={16} />}
                tone="accent"
                onClick={() => setShowHelp(s => !s)}
                aria-pressed={showHelp}
                className={showHelp ? "text-accent bg-accent-soft" : ""}
              />
            )}
          </div>
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search or ask AI — what would you like to do? e.g. Move the Acme deal to Proposal..."
              aria-label="What would you like to do?"
              className="flex-1"
              disabled={isLoading}
            />
            <Button
              onClick={handleSubmit}
              disabled={query.trim().length < 3}
              loading={isLoading}
              icon={<Sparkles size={15} />}
            >
              Ask AI
            </Button>
          </div>
        </div>

        {/* Suggestions */}
        {mode === "none" && !isLoading && !isError && (
          <div className="px-6 pb-4">
            <p className="text-[11px] font-semibold text-fg-subtle uppercase tracking-wider mb-2">Try asking</p>
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <ExampleRow key={s} onClick={() => handleSuggestion(s)}>{s}</ExampleRow>
              ))}
            </div>
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="px-6 pb-6 flex items-center gap-3 text-sm text-fg-muted">
            <Loader2 size={16} className="animate-spin text-accent" />
            Parsing your command with AI...
          </div>
        )}

        {/* Error state */}
        {isError && (
          <div className="mx-6 mb-5">
            <Alert tone="danger">Something went wrong. Please try again.</Alert>
          </div>
        )}

        {/* Legacy result: create/update one of the 5 entity types */}
        {mode === "legacy" && result && (
          <div className="px-6 pb-5 space-y-4 border-t border-line-subtle pt-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="accent">{result.intent}</Badge>
              <Badge variant="blue">{ENTITY_LABELS[result.entity] ?? result.entity}</Badge>
              <Badge variant={confidenceVariant(confidencePct)}>{confidencePct}% confidence</Badge>
            </div>

            {lowConfidence ? (
              <Alert tone="danger">I couldn&apos;t understand that command. Try rephrasing.</Alert>
            ) : (
              <>
                {result.explanation && (
                  <p className="text-sm text-fg-muted leading-relaxed">{result.explanation}</p>
                )}

                {Object.keys(result.fields).length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold text-fg-subtle uppercase tracking-wider mb-2">Parsed fields</p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(result.fields).map(([k, v]) => (
                        <ParamChip key={k} name={k} value={v} />
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <Button onClick={() => navigateToEntity(false)} iconRight={<ArrowRight size={14} />}>
                    Go Create {ENTITY_LABELS[result.entity] ?? result.entity}
                  </Button>
                  <Button variant="secondary" onClick={() => navigateToEntity(true)}>
                    Edit before creating
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Registry action: propose -> confirm -> execute */}
        {mode === "action" && plan && (
          <div className="px-6 pb-5 space-y-4 border-t border-line-subtle pt-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="indigo"><Zap size={11} /> {plan.label ?? plan.action}</Badge>
              <Badge variant={confidenceVariant(planConfidencePct)}>{planConfidencePct}% confidence</Badge>
            </div>

            <p className="text-sm text-fg-muted leading-relaxed">{plan.explanation}</p>

            {Object.keys(plan.params).length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-fg-subtle uppercase tracking-wider mb-2">This will run with</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(plan.params).map(([k, v]) => (
                    <ParamChip key={k} name={k} value={v} />
                  ))}
                </div>
              </div>
            )}

            {!plan.allowed ? (
              <Alert tone="warning" icon={<ShieldAlert size={15} />}>
                Your role isn&apos;t permitted to run this action.
              </Alert>
            ) : execAction.isSuccess ? (
              <Alert tone="success">
                {execAction.data?.summary || "Done."}
              </Alert>
            ) : (
              <>
                {execAction.isError && (
                  <Alert tone="danger">
                    {(execAction.error as any)?.response?.data?.error || "Couldn't run that action."}
                  </Alert>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    onClick={handleConfirmAction}
                    loading={execAction.isPending}
                    icon={<CheckCircle2 size={14} />}
                  >
                    Confirm &amp; Run
                  </Button>
                  <Button variant="secondary" onClick={handleCancelAction} disabled={execAction.isPending}>
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
