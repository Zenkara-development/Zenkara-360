import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Reads the `aiPrefill` field payload the AI Command Bar attaches to its
 * navigation (see shared/components/AiCommandBar.tsx navigateToEntity) and
 * hands it to the caller once, then scrubs it from router state so a later
 * refresh/back-navigation to the same URL doesn't re-open the create modal.
 *
 * This used to be the missing link in the "create a ticket/contact/lead/
 * deal/article via AI command" flow: the command bar always navigated here
 * with the parsed fields in `location.state`, but nothing on any of these
 * pages ever read it back out, so the AI's "Go Create X" button just landed
 * on the plain list page and did nothing.
 *
 * The effect depends on `location.key` rather than `[]`. `location.key` is a
 * fresh, unique value on EVERY navigation — including one that lands back on
 * a pathname you're already viewing. An empty dependency array only ever
 * fires once, on this component's first mount, so if the AI Command Bar was
 * used while already sitting on the target list page (the most common case —
 * e.g. asking it to "create a ticket" while already viewing Tickets), the
 * page never remounts, this effect never re-runs, and the freshly-navigated
 * `aiPrefill` in `location.state` is silently missed: no modal opens, no
 * fields populate, and any *other* modal that happened to be open already
 * (e.g. an existing record's edit view) is left exactly as it was —
 * which is what made it look like "Go Create" was opening an edit screen.
 */
export function useAiPrefill<T = Record<string, any>>(): T | null {
  const location = useLocation();
  const navigate = useNavigate();
  const [prefill, setPrefill] = useState<T | null>(null);

  useEffect(() => {
    const state = location.state as { aiPrefill?: T } | null;
    if (state?.aiPrefill) {
      setPrefill(state.aiPrefill);
      navigate(location.pathname, { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  return prefill;
}
