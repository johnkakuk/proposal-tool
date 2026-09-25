import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

/** Small transient confirmations ("Link copied"). Announced to screen readers. */
const ToastContext = createContext<(message: string) => void>(() => {});

export function Toaster({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);
  const toast = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2500);
  }, []);
  return (
    <ToastContext value={toast}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="rounded-lg bg-ink px-4 py-2 text-sm text-white shadow-lg">
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext>
  );
}

export const useToast = () => useContext(ToastContext);
