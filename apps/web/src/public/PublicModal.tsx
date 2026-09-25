import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useThemeVars } from "../render/ThemeScope";

/** Branded modal for the public viewer (kept separate from the admin UI kit). */
export function PublicModal({ open, onClose, title, children, dismissable = true }: { open: boolean; onClose: () => void; title: string; children: ReactNode; dismissable?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const themeVars = useThemeVars();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      style={themeVars}
      onCancel={(e) => {
        if (!dismissable) e.preventDefault();
      }}
      onClose={(e) => {
        e.stopPropagation();
        if (e.target === ref.current) onClose();
      }}
      className="proposal-theme m-auto max-h-[92vh] w-[calc(100%-1.5rem)] max-w-xl overflow-y-auto rounded-2xl bg-(--color-background) p-0 text-(--color-text) shadow-2xl backdrop:bg-black/50"
    >
      {open && (
        <div className="p-6 sm:p-8">
          <div className="mb-5 flex items-start justify-between gap-4">
            <h2 id={titleId} className="font-(family-name:--font-heading) text-2xl font-bold text-(--color-primary-text)">
              {title}
            </h2>
            {dismissable && (
              <button type="button" onClick={onClose} aria-label="Close dialog" className="rounded p-1 text-(--color-muted) hover:text-(--color-text)">
                ✕
              </button>
            )}
          </div>
          {children}
        </div>
      )}
    </dialog>,
    document.body,
  );
}

export const publicInput = "mt-1 block w-full rounded-md border border-black/20 bg-white px-3 py-2 text-base text-gray-900 focus:border-(--color-accent) focus:outline-none focus:ring-2 focus:ring-(--color-accent)/25";
export const primaryButton = "w-full rounded-md bg-(--color-accent) px-4 py-3 font-semibold text-(--color-on-accent) shadow-sm hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";
