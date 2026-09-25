import { useEffect, useState, type FormEvent, type ReactNode } from "react";
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
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<unknown>;
  danger?: boolean;
}) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setError(null);
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <div className="text-sm text-slate-600">{body}</div>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={danger ? "danger" : "primary"}
            className={danger ? "!bg-red-600 !text-white !ring-red-600 hover:!bg-red-700" : ""}
            disabled={busy}
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
