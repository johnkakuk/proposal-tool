import type { ProposalStatus } from "@bridger/shared";
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand/90 shadow-xs",
  secondary: "bg-white text-ink ring-1 ring-slate-300 hover:bg-slate-50 shadow-xs",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-ink",
  danger: "bg-white text-red-700 ring-1 ring-red-200 hover:bg-red-50",
};

export function Button({ variant = "secondary", className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className ?? ""}`}
    />
  );
}

const STATUS_STYLE: Record<ProposalStatus, string> = {
  draft: "bg-slate-100 text-slate-700",
  sent: "bg-sky-100 text-sky-800",
  viewed: "bg-violet-100 text-violet-800",
  signed: "bg-emerald-100 text-emerald-800",
  declined: "bg-red-100 text-red-800",
  expired: "bg-amber-100 text-amber-800",
  archived: "bg-slate-100 text-slate-500",
};

export function StatusChip({ status }: { status: ProposalStatus }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[status]}`}>{status}</span>;
}

/**
 * Accessible modal built on <dialog> (focus trap, Esc to close). Rendered in a portal so
 * a modal opened from inside a form never nests forms in the DOM, and it stops submit/close
 * events at its boundary because React bubbles them through portals to parent components.
 */
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
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
      // React propagates a nested dialog's close event to its parents; only react to our own.
      onClose={(e) => {
        e.stopPropagation();
        if (e.target === ref.current) onClose();
      }}
      onSubmit={(e) => e.stopPropagation()}
      onClick={(e) => e.target === ref.current && onClose()}
      className={`m-auto w-[calc(100%-2rem)] rounded-xl p-0 shadow-xl backdrop:bg-slate-900/40 ${wide ? "max-w-3xl" : "max-w-lg"}`}
    >
      {open && (
        <div className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-ink">
              ✕
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>,
    document.body,
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {body && <p className="mt-1 text-sm text-slate-500">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
      {error instanceof Error ? error.message : "Something went wrong"}
    </p>
  );
}

export const Spinner = () => <div className="p-8 text-sm text-slate-500">Loading…</div>;

export const inputClass =
  "block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-xs placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

export function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 30 * 86_400) return `${Math.floor(s / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium" });
}

export const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium" }) : "—");
