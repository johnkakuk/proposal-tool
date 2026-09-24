import { useCallback, useEffect, useRef, useState } from "react";

export type SaveState = { kind: "saved" } | { kind: "pending" } | { kind: "saving" } | { kind: "error"; error: unknown };

/**
 * Debounced autosave (SPEC §7.2: 1.5 s). The first value is treated as already saved,
 * so opening a document doesn't write it back. Saves never overlap: a change during a
 * save is written right after it finishes. Unsaved changes warn before leaving the page.
 */
export function useAutosave<T>(value: T | null, save: (v: T) => Promise<void>, delay = 1500) {
  const [state, setState] = useState<SaveState>({ kind: "saved" });
  const saved = useRef<string | null>(null);
  const latest = useRef<T | null>(value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inFlight = useRef<Promise<void> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  latest.current = value;

  const flush = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current);
    if (inFlight.current) {
      await inFlight.current;
    }
    const v = latest.current;
    if (v === null) return;
    const json = JSON.stringify(v);
    if (json === saved.current) return setState({ kind: "saved" });
    setState({ kind: "saving" });
    const run = saveRef
      .current(v)
      .then(() => {
        saved.current = json;
        setState(JSON.stringify(latest.current) === json ? { kind: "saved" } : { kind: "pending" });
        if (JSON.stringify(latest.current) !== json) timer.current = setTimeout(() => void flush(), delay);
      })
      .catch((error: unknown) => setState({ kind: "error", error }))
      .finally(() => {
        inFlight.current = null;
      });
    inFlight.current = run;
    return run;
  }, [delay]);

  useEffect(() => {
    if (value === null) return;
    const json = JSON.stringify(value);
    if (saved.current === null) {
      saved.current = json; // baseline: what was loaded
      return;
    }
    if (json === saved.current) return;
    setState((s) => (s.kind === "error" || s.kind === "pending" ? s : { kind: "pending" }));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), delay);
  }, [value, delay, flush]);

  // Warn before closing the tab with unsaved changes; save when leaving the page in-app.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (latest.current !== null && JSON.stringify(latest.current) !== saved.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      void flush();
    };
  }, [flush]);

  return { state, flush };
}
