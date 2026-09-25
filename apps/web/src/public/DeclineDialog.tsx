import { useState } from "react";
import { declineProposal } from "./api";
import { PublicModal, publicInput } from "./PublicModal";

export function DeclineDialog({ slug, open, onClose, onDeclined }: { slug: string; open: boolean; onClose: () => void; onDeclined: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <PublicModal open={open} onClose={onClose} title="Decline this proposal?">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await declineProposal(slug, reason.trim());
            onDeclined();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Something went wrong.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="opacity-80">We'd appreciate knowing why, so we can do better. This is optional.</p>
        <label className="block text-sm font-medium">
          Reason (optional)
          <textarea rows={3} maxLength={2000} className={publicInput} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 rounded-md border border-black/20 px-4 py-2.5 font-medium">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="flex-1 rounded-md bg-gray-900 px-4 py-2.5 font-semibold text-white disabled:opacity-50">
            Decline proposal
          </button>
        </div>
      </form>
    </PublicModal>
  );
}
