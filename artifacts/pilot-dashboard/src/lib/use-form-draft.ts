// Generic form-draft hook. Persists the live form state to
// localStorage on every change (debounced) so a LAN drop, page reload
// or accidental browser close never costs the operator a half-typed
// sortie / pilot record / NOTAM. Mounted forms call `discardDraft()`
// after a successful save so the next session starts clean.
//
// Design notes
// ────────────
//   • The hook never auto-restores. It only reports `hasDraft` and
//     hands two callbacks (`restoreDraft`, `discardDraft`) back to the
//     caller. The caller renders <FormDraftBanner/> which gives the
//     operator a deliberate Restore / Discard choice  silently
//     replacing the form would be a worse UX (mid-edit rows would
//     get clobbered).
//   • The "is this draft different from the empty initial state?"
//     comparison uses JSON.stringify against a snapshot of `current`
//     captured on first render. That snapshot is treated as the
//     "empty" baseline; if the persisted blob deep-equals it, we
//     hide the banner. This lets every form pass its own `blankForm()`
//     output without needing a separate `initial` prop.
//   • Persistence is debounced at 500ms. Operators type fast; without
//     debounce we'd hammer localStorage on every keystroke.
//   • SSR-safe: the hook checks for `window` before touching
//     localStorage, so server-rendered tests don't blow up.
//
// Task T-D / #371.

import { useEffect, useMemo, useRef, useState, useCallback } from "react";

const DEBOUNCE_MS = 500;

interface UseFormDraftResult {
  /** True if a non-empty saved draft exists for this key. */
  hasDraft: boolean;
  /** Apply the saved draft to the form (calls setCurrent). */
  restoreDraft: () => void;
  /** Wipe the saved draft from localStorage and hide the banner. */
  discardDraft: () => void;
}

function safeRead(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage may be full or blocked  silently drop */
  }
}

function safeRemove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function useFormDraft<T>(
  formKey: string,
  current: T,
  setCurrent: (next: T) => void,
): UseFormDraftResult {
  // Snapshot the initial "empty" state on first render. We compare
  // persisted drafts against this baseline so the banner only fires
  // when there's actual user-entered content, not just the default
  // shape. The ref is intentionally NOT included as a dependency
  // anywhere  it must stay stable across re-renders.
  const emptyBaselineRef = useRef<string>("");
  const initialisedRef = useRef(false);
  if (!initialisedRef.current) {
    try {
      emptyBaselineRef.current = JSON.stringify(current);
    } catch {
      emptyBaselineRef.current = "";
    }
    initialisedRef.current = true;
  }

  // Read the persisted draft once on mount.
  const initialPersisted = useMemo(() => safeRead(formKey), [formKey]);
  const [storedDraft, setStoredDraft] = useState<string | null>(initialPersisted);

  // hasDraft is true iff a persisted blob exists AND differs from
  // the empty baseline. We keep this as derived state so the banner
  // hides as soon as discardDraft() runs.
  const hasDraft = useMemo(() => {
    if (!storedDraft) return false;
    if (storedDraft === emptyBaselineRef.current) return false;
    return storedDraft.length > 0;
  }, [storedDraft]);

  // Debounced write: every change to `current` schedules a save 500ms
  // later. Subsequent changes within that window cancel the prior
  // timer so we end up with a single write per quiet period.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handle = window.setTimeout(() => {
      try {
        const blob = JSON.stringify(current);
        // Don't bother persisting the empty baseline  it's just
        // noise and would make hasDraft trip on every fresh visit.
        if (blob === emptyBaselineRef.current) {
          safeRemove(formKey);
        } else {
          safeWrite(formKey, blob);
        }
      } catch {
        /* unserialisable input  skip */
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [formKey, current]);

  const restoreDraft = useCallback(() => {
    const blob = safeRead(formKey);
    if (!blob) {
      setStoredDraft(null);
      return;
    }
    try {
      const parsed = JSON.parse(blob) as T;
      setCurrent(parsed);
    } catch {
      /* corrupt blob  drop it so we don't keep prompting */
      safeRemove(formKey);
    }
    setStoredDraft(null);
  }, [formKey, setCurrent]);

  const discardDraft = useCallback(() => {
    safeRemove(formKey);
    setStoredDraft(null);
  }, [formKey]);

  return { hasDraft, restoreDraft, discardDraft };
}
