import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Users, Target, TrendingUp, CheckSquare, ArrowRight } from 'lucide-react';
import { useMeetingNotes } from '../../api/ai';
import { Modal, Button, Field, Textarea, Alert, AiNote, AiGeneratedTag } from './index';
import { useFormat } from '../../hooks/useFormat';

interface MeetingNotesModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * One parsed-record group. Four near-identical blocks previously spelled the
 * same panel four times in four literal hues (violet / indigo / green / amber),
 * two of which were a second accent competing with the brand scale. The tint is
 * now a token, so it follows the theme and has a dark mode for free.
 */
const GROUP_TONES = {
  accent:  { head: 'bg-accent-soft text-accent-soft-fg',   icon: 'text-accent'  },
  info:    { head: 'bg-info-soft text-info-fg',            icon: 'text-info'    },
  success: { head: 'bg-success-soft text-success-fg',      icon: 'text-success' },
  warning: { head: 'bg-warning-soft text-warning-fg',      icon: 'text-warning' },
} as const;

function ParsedGroup({ tone, icon, title, count, children }: {
  tone: keyof typeof GROUP_TONES;
  icon: React.ReactNode;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  const t = GROUP_TONES[tone];
  return (
    <div className="border border-line rounded-card overflow-hidden">
      <div className={`${t.head} px-4 py-2 flex items-center gap-2`}>
        <span className={t.icon}>{icon}</span>
        <span className="text-xs font-semibold uppercase tracking-wider">{title}</span>
        <span className="ml-auto text-xs px-2 py-0.5 rounded-badge bg-surface/60">{count}</span>
      </div>
      <div className="divide-y divide-line-subtle">{children}</div>
    </div>
  );
}

export function MeetingNotesModal({ open, onClose }: MeetingNotesModalProps) {
  const navigate = useNavigate();
  const { money } = useFormat();
  const [notes, setNotes] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const [error, setError] = useState('');
  const parseMutation = useMeetingNotes();

  function showToast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3500);
  }

  async function handleParse() {
    if (notes.trim().length < 10) return;
    setError('');
    try {
      await parseMutation.mutateAsync(notes);
    } catch (e: any) {
      // Previously uncaught: a failed parse became an unhandled rejection and
      // the modal just sat there, looking like nothing had happened.
      setError(e?.response?.data?.error || 'Could not parse those notes. Please try again.');
    }
  }

  function handleDone() {
    if (!parseMutation.data) return;
    const d = parseMutation.data;
    const contactCount = d.contacts?.length ?? 0;
    const leadCount = d.leads?.length ?? 0;
    const dealCount = d.deals?.length ?? 0;
    const stepCount = d.nextSteps?.length ?? 0;
    const total = contactCount + leadCount + dealCount + stepCount;
    showToast(`Parsed ${total} records — go to the relevant pages to review`);
  }

  const data = parseMutation.data;

  return (
    <Modal open={open} onClose={() => { onClose(); parseMutation.reset(); setNotes(''); setError(''); }} title="Parse Meeting Notes" size="lg">
      <div className="space-y-4">
        <AiNote id="meeting.notes" />

        {/* Notes textarea */}
        <Field
          label="Paste your meeting notes"
          hint={`${notes.length} characters${notes.length < 10 ? ' (minimum 10)' : ''}`}
        >
          <Textarea
            rows={6}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Paste raw meeting notes here... Include names, companies, action items, deals discussed, etc."
            className="resize-none"
          />
        </Field>

        <div className="flex justify-center">
          <Button
            icon={<Sparkles size={15} />}
            onClick={handleParse}
            loading={parseMutation.isPending}
            disabled={notes.trim().length < 10}
          >
            Parse with AI
          </Button>
        </div>

        {error && <Alert tone="danger">{error}</Alert>}

        {/* Results */}
        {data && (
          <div className="space-y-3 border-t border-line-subtle pt-4">
            <div>
              <AiGeneratedTag />
              <p className="text-sm font-semibold text-fg mt-1.5">Parsed Results</p>
            </div>

            {data.contacts?.length > 0 && (
              <ParsedGroup tone="accent" icon={<Users size={14} />} title="Contacts" count={data.contacts.length}>
                {data.contacts.map((c: any, i: number) => (
                  <div key={i} className="px-4 py-2 text-sm">
                    <span className="font-medium text-fg">{c.name || c}</span>
                    {c.email && <span className="text-fg-subtle ml-2 text-xs">{c.email}</span>}
                  </div>
                ))}
              </ParsedGroup>
            )}

            {data.leads?.length > 0 && (
              <ParsedGroup tone="info" icon={<Target size={14} />} title="Leads" count={data.leads.length}>
                {data.leads.map((l: any, i: number) => (
                  <div key={i} className="px-4 py-2 text-sm">
                    <span className="font-medium text-fg">{l.name || l}</span>
                    {l.source && <span className="text-fg-subtle ml-2 text-xs">via {l.source}</span>}
                  </div>
                ))}
              </ParsedGroup>
            )}

            {data.deals?.length > 0 && (
              <ParsedGroup tone="success" icon={<TrendingUp size={14} />} title="Deals" count={data.deals.length}>
                {data.deals.map((d: any, i: number) => (
                  <div key={i} className="px-4 py-2 text-sm">
                    <span className="font-medium text-fg">{d.title || d}</span>
                    {d.value && <span className="text-success ml-2 text-xs font-semibold">{money(Number(d.value))}</span>}
                  </div>
                ))}
              </ParsedGroup>
            )}

            {data.nextSteps?.length > 0 && (
              <ParsedGroup tone="warning" icon={<CheckSquare size={14} />} title="Next Steps" count={data.nextSteps.length}>
                {data.nextSteps.map((s: any, i: number) => (
                  <div key={i} className="px-4 py-2 text-sm text-fg">{typeof s === 'string' ? s : s.text || JSON.stringify(s)}</div>
                ))}
              </ParsedGroup>
            )}

            <div className="flex items-center justify-between pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/crm/contacts')}
                iconRight={<ArrowRight size={12} />}
                className="!text-accent"
              >
                Go to Contacts
              </Button>
              {/* This never created anything — it only summarises what was
                  parsed — so it no longer promises that it does. */}
              <Button icon={<CheckSquare size={14} />} onClick={handleDone}>
                Done
              </Button>
            </div>
          </div>
        )}

        {/* Toast */}
        {toastMsg && (
          <div className="fixed bottom-6 right-6 bg-surface-raised border border-line text-fg text-sm px-4 py-3 rounded-card shadow-ui-lg z-50 animate-fade-in">
            {toastMsg}
          </div>
        )}
      </div>
    </Modal>
  );
}
