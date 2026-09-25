import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { Button, ErrorNote, Modal, inputClass } from "./ui";

export function RenameDialog({ open, onClose, title, label, initial, onSave }: { open: boolean; onClose: () => void; title: string; label: string; initial: string; onSave: (value: string) => Promise<unknown> }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setValue(initial);
      setError(null);
    }
  }, [open, initial]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave(value.trim());
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm font-medium">
          {label}
          <input autoFocus required className={`mt-1 ${inputClass}`} value={value} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.target.select()} />
        </label>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy || !value.trim() || value.trim() === initial}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  title,
  body,
  confirmLabel,
  onConfirm,
  danger,
  confirmText,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<unknown>;
  danger?: boolean;
  /** For irreversible actions: the confirm button stays disabled until this exact word is typed. */
  confirmText?: string;
}) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");
  const typedId = useId();
  useEffect(() => {
    if (open) {
      setError(null);
      setTyped("");
    }
  }, [open]);
  const confirmed = !confirmText || typed.trim() === confirmText;
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <div className="text-sm text-slate-600">{body}</div>
        {confirmText && (
          <div>
            <label htmlFor={typedId} className="block text-sm font-medium">
              Type <span className="rounded bg-slate-100 px-1 font-mono">{confirmText}</span> to confirm
            </label>
            <input id={typedId} autoFocus autoComplete="off" spellCheck={false} className={`mt-1 ${inputClass} font-mono`} value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>
        )}
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={danger ? "danger" : "primary"}
            className={danger ? "!bg-red-600 !text-white !ring-red-600 hover:!bg-red-700" : ""}
            disabled={busy || !confirmed}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onClose();
              } catch (err) {
                setError(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
