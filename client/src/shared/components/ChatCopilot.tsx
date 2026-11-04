/**
 * Chat Copilot — the floating chat that can DO things.
 *
 * A multi-turn conversation with a small routing model: questions get
 * answered from org data, imperatives come back as a whitelisted action plan
 * rendered as a confirm card (the server never executes anything without the
 * user pressing Run — see executeActionHandler's role re-checks). This is the
 * "manage the project from chat" surface: file tickets, add notes, assign
 * work, request or approve leave, create leads — all without leaving the
 * conversation.
 *
 * The assistant is fronted by an animated 3D robot (robot/Robot3D, lazy
 * loaded). Its mood follows the conversation: listening while you type,
 * thinking while a request is in flight, talking when a reply lands, happy
 * when an action runs, and a head-shake on errors.
 */
import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Send, Sparkles, X, Check, Loader2, Play } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useExecuteAiAction, type AiActionPlan } from '../../api/ai';
import { Button } from './Button';
import { RichText } from './RichText';
import { RobotFace, canUseWebGL } from './robot/RobotFace';
import type { RobotMood } from './robot/types';

const Robot3D = lazy(() => import('./robot/Robot3D'));

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  /** A proposed action awaiting confirm — rendered as a card under the text. */
  plan?: AiActionPlan;
  /** Set once the plan ran (or was dismissed) so the card locks. */
  planState?: 'done' | 'dismissed' | 'error';
  resultSummary?: string;
}

const SUGGESTIONS = [
  'Create a high priority ticket: boardroom projector flickering',
  'How many tickets are open right now?',
  'Add a lead for Maria Gomez from Initech — met at the expo',
  'Request 2 days of annual leave from next Monday',
];

const STATUS: Record<RobotMood, string> = {
  idle: 'Ready to help',
  listening: 'Listening…',
  thinking: 'Thinking…',
  talking: "Here's what I found",
  happy: 'All done!',
  error: "Hmm, that didn't work",
};

/* A lost WebGL context or a driver bug must not take the app down with it —
   ChatCopilot sits outside the page ErrorBoundary — so the 3D robot falls
   back to the CSS one on any render error. */
class RobotBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function RobotAvatar({ mood, interactive = false, onPoke, className = '' }: {
  mood: RobotMood; interactive?: boolean; onPoke?: () => void; className?: string;
}) {
  const [webgl] = useState(canUseWebGL);
  const fallback = <RobotFace mood={mood} className={className} />;
  if (!webgl) return fallback;
  return (
    <RobotBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <Robot3D mood={mood} interactive={interactive} onPoke={onPoke} className={className} />
      </Suspense>
    </RobotBoundary>
  );
}

export function ChatCopilot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [launcherHover, setLauncherHover] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const execute = useExecuteAiAction();

  const chat = useMutation({
    mutationFn: (msgs: Array<{ role: string; content: string }>) =>
      api.post('/ai/chat', { messages: msgs }).then(r => r.data as { type: 'plan' | 'reply'; text: string; plan?: AiActionPlan }),
  });

  /* Short-lived reactions (talking after a reply, happy after an action…)
     layered over the steady state derived below. */
  const [reaction, setReaction] = useState<RobotMood | null>(null);
  const reactionTimer = useRef<number>();
  function react(m: RobotMood, ms: number) {
    setReaction(m);
    window.clearTimeout(reactionTimer.current);
    reactionTimer.current = window.setTimeout(() => setReaction(null), ms);
  }
  useEffect(() => () => window.clearTimeout(reactionTimer.current), []);
  const mood: RobotMood = chat.isPending || execute.isPending
    ? 'thinking'
    : reaction ?? (input.trim() ? 'listening' : 'idle');

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, open]);

  function openChat() {
    setOpen(true);
    react('happy', 1600); // wave hello
  }

  /* People type their confirmations — "yes", "confirm", "go ahead" — at
     least as often as they click buttons. If the previous assistant message
     holds a pending plan, treat an affirmation as pressing "Run it" and a
     negation as "Dismiss", instead of routing the word through the model
     as a brand-new command (which used to re-plan "yes confirm" into
     nonsense). */
  const AFFIRM = /^(yes|yes[,!. ]*(please|confirm|do it)?|confirm|ok(ay)?|sure|go ahead|do it|run( it)?|proceed|please do)[.! ]*$/i;
  const NEGATE = /^(no|cancel|dismiss|stop|don'?t|nevermind|never mind)[.! ]*$/i;

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || chat.isPending) return;
    setInput('');

    const pendingIdx = messages.reduce((acc, m, i) => (m.plan && !m.planState ? i : acc), -1);
    if (pendingIdx >= 0 && AFFIRM.test(content)) {
      setMessages(m => [...m, { role: 'user', content }]);
      await runPlan(pendingIdx);
      return;
    }
    if (pendingIdx >= 0 && NEGATE.test(content)) {
      setMessages(m => [
        ...m.map((x, i) => (i === pendingIdx ? { ...x, planState: 'dismissed' as const } : x)),
        { role: 'user', content },
        { role: 'assistant', content: 'Okay, dismissed — nothing was run.' },
      ]);
      react('talking', 1200);
      return;
    }

    const next: ChatMsg[] = [...messages, { role: 'user', content }];
    setMessages(next);
    try {
      const res = await chat.mutateAsync(
        next.slice(-12).map(m => ({ role: m.role, content: m.content })),
      );
      setMessages(m => [...m, {
        role: 'assistant',
        content: res.text,
        plan: res.type === 'plan' && res.plan?.action ? res.plan : undefined,
      }]);
      react('talking', 2400);
    } catch (e: any) {
      setMessages(m => [...m, { role: 'assistant', content: e?.response?.data?.error || 'Something went wrong — try rephrasing.' }]);
      react('error', 1500);
    }
  }

  async function runPlan(idx: number) {
    const msg = messages[idx];
    if (!msg.plan?.action) return;
    try {
      const result = await execute.mutateAsync({ action: msg.plan.action, params: msg.plan.params });
      setMessages(m => m.map((x, i) => (i === idx ? { ...x, planState: 'done', resultSummary: result.summary } : x)));
      react('happy', 2200);
    } catch (e: any) {
      setMessages(m => m.map((x, i) => (i === idx ? { ...x, planState: 'error', resultSummary: e?.response?.data?.error || 'Action failed.' } : x)));
      react('error', 1500);
    }
  }

  return (
    <>
      {/* Launcher — the robot itself, with a soft glow and a hover greeting */}
      {!open && (
        <button
          type="button"
          aria-label="Open AI chat"
          onClick={openChat}
          onMouseEnter={() => setLauncherHover(true)}
          onMouseLeave={() => setLauncherHover(false)}
          onFocus={() => setLauncherHover(true)}
          onBlur={() => setLauncherHover(false)}
          className="robot-launcher fixed bottom-2 right-2 sm:bottom-3 sm:right-3 z-40 w-[84px] h-[96px] sm:w-[96px] sm:h-[110px]
                     rounded-[28px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
        >
          <span className="robot-halo" aria-hidden="true" />
          <RobotAvatar mood={launcherHover ? 'listening' : 'idle'} className="relative w-full h-full" />
          <span className="robot-bubble" aria-hidden="true">Hi! Need a hand?</span>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div
          role="dialog"
          aria-label="AI assistant"
          className="robot-panel fixed z-40 inset-x-2 bottom-2 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[400px]
                     h-[min(640px,calc(100dvh-1rem))] sm:h-[min(640px,calc(100dvh-2rem))]
                     flex flex-col rounded-modal border border-line bg-surface shadow-ui-modal overflow-hidden"
        >
          <div className="robot-panel__header relative shrink-0 flex items-center gap-2 pl-1 pr-10 pt-1">
            <RobotAvatar
              mood={mood}
              interactive
              onPoke={() => react('happy', 1800)}
              className="w-[108px] h-[120px] sm:w-[124px] sm:h-[136px] shrink-0"
            />
            <div className="min-w-0 flex-1 py-3">
              <p className="text-[17px] font-extrabold text-fg tracking-tight leading-tight">Assistant</p>
              <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-fg-muted mt-1" aria-live="polite">
                <span className={`robot-status-dot robot-status-dot--${mood}`} aria-hidden="true" />
                {STATUS[mood]}
              </p>
              <p className="text-[11.5px] text-fg-subtle mt-1.5 leading-snug">
                Chats, answers and takes action — tap me to say hi.
              </p>
            </div>
            <button
              type="button" aria-label="Close chat" onClick={() => setOpen(false)}
              className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full flex items-center justify-center
                         bg-surface/80 border border-line-subtle text-fg-muted hover:text-fg hover:bg-surface shadow-ui-sm transition-colors"
            >
              <X size={15} />
            </button>
          </div>

          <div ref={listRef} className="flex-1 overflow-y-auto px-3.5 py-3.5 space-y-3 bg-canvas/60">
            {messages.length === 0 && (
              <div className="robot-msg-in">
                <div className="rounded-2xl rounded-tl-md bg-surface border border-line-subtle shadow-ui-sm px-3.5 py-2.5 text-[12.5px] text-fg leading-relaxed">
                  Hi! Ask a question or tell me what to do — I can create tickets and leads, add notes,
                  assign work, file or approve leave, and answer questions about your data.
                </div>
                <div className="mt-3 space-y-2">
                  {SUGGESTIONS.map(s => (
                    <button
                      key={s} type="button" onClick={() => send(s)}
                      className="flex items-start gap-2 w-full text-left text-[12px] px-3 py-2 rounded-xl border border-line bg-surface
                                 text-fg-muted hover:text-accent hover:border-accent/40 hover:bg-accent-soft/40 shadow-ui-sm transition-colors"
                    >
                      <Sparkles size={13} className="text-accent shrink-0 mt-px" />
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`robot-msg-in ${m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}`}>
                <div className={`max-w-[85%] px-3.5 py-2.5 text-[12.5px] leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'robot-user-bubble rounded-2xl rounded-tr-md text-white'
                    : 'rounded-2xl rounded-tl-md bg-surface border border-line-subtle shadow-ui-sm text-fg'
                }`}>
                  {m.role === 'assistant' ? <RichText content={m.content} className="text-[12.5px]" /> : m.content}
                  {m.plan && (
                    <div className="mt-2 rounded-xl border border-accent/30 bg-surface overflow-hidden">
                      <div className="px-2.5 py-1.5 border-b border-line-subtle bg-accent-soft/50">
                        <p className="text-[12px] font-semibold text-accent-soft-fg">{m.plan.label || m.plan.action}</p>
                      </div>
                      <div className="px-2.5 py-1.5 space-y-0.5">
                        {Object.entries(m.plan.params).map(([k, v]) => (
                          <p key={k} className="text-[11.5px] text-fg-muted">
                            <span className="font-medium text-fg">{k}:</span> {(typeof v === 'object' ? JSON.stringify(v) : String(v)).slice(0, 180) + ((typeof v === 'object' ? JSON.stringify(v) : String(v)).length > 180 ? '…' : '')}
                          </p>
                        ))}
                        {m.plan.explanation && <p className="text-[11px] text-fg-subtle pt-0.5">{m.plan.explanation}</p>}
                      </div>
                      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-t border-line-subtle">
                        {m.planState === 'done' ? (
                          <p className="flex items-center gap-1 text-[11.5px] font-medium text-success"><Check size={12} /> {m.resultSummary}</p>
                        ) : m.planState === 'error' ? (
                          <p className="text-[11.5px] font-medium text-danger">{m.resultSummary}</p>
                        ) : m.planState === 'dismissed' ? (
                          <p className="text-[11.5px] text-fg-subtle">Dismissed.</p>
                        ) : !m.plan.allowed ? (
                          <p className="text-[11.5px] text-fg-subtle">Your role can't run this action.</p>
                        ) : (
                          <>
                            <Button size="xs" icon={execute.isPending ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                              disabled={execute.isPending} onClick={() => runPlan(i)}>
                              Run it
                            </Button>
                            <Button size="xs" variant="ghost"
                              onClick={() => setMessages(ms => ms.map((x, j) => (j === i ? { ...x, planState: 'dismissed' } : x)))}>
                              Dismiss
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {chat.isPending && (
              <div className="flex justify-start robot-msg-in">
                <div className="rounded-2xl rounded-tl-md px-3.5 py-3 bg-surface border border-line-subtle shadow-ui-sm" aria-label="Assistant is thinking">
                  <span className="robot-typing"><span /><span /><span /></span>
                </div>
              </div>
            )}
          </div>

          <form
            onSubmit={e => { e.preventDefault(); send(); }}
            className="shrink-0 px-3 py-3 border-t border-line-subtle bg-surface"
          >
            <div className="flex items-center gap-2 h-11 pl-4 pr-1.5 rounded-full border border-line bg-surface-sunken
                            focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent-ring/40 transition-shadow">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Ask or instruct…"
                aria-label="Chat message"
                className="flex-1 min-w-0 bg-transparent text-[13px] text-fg placeholder:text-fg-subtle focus:outline-none"
              />
              <button
                type="submit"
                aria-label="Send"
                disabled={!input.trim() || chat.isPending}
                className="w-8 h-8 rounded-full flex items-center justify-center bg-accent text-accent-fg shadow-ui-sm
                           hover:bg-accent-hover active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <Send size={14} />
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
