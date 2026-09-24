import type { ClientRow } from "@bridger/shared";
import { useState } from "react";
import { useClientMutations, useClients } from "../lib/queries";
import { ClientForm } from "./ClientForm";
import { Modal, inputClass } from "./ui";

const NEW = "__new__";

/** Client <select> with an inline "New client…" option. */
export function ClientPicker({ value, onChange, disabled, id }: { value: string | null; onChange: (client: ClientRow | null) => void; disabled?: boolean; id?: string }) {
  const { data: clients = [] } = useClients();
  const { create } = useClientMutations();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <select
        id={id}
        className={inputClass}
        disabled={disabled}
        value={value ?? ""}
        onChange={(e) => {
          if (e.target.value === NEW) return setCreating(true);
          onChange(clients.find((c) => c.id === e.target.value) ?? null);
        }}
      >
        <option value="">No client yet</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.company ? `${c.company} (${c.name})` : c.name}
          </option>
        ))}
        <option value={NEW}>+ New client…</option>
      </select>
      <Modal open={creating} onClose={() => setCreating(false)} title="New client">
        <ClientForm
          submitLabel="Create client"
          busy={create.isPending}
          error={create.error}
          onSubmit={(v) =>
            create.mutate(v, {
              onSuccess: (c) => {
                setCreating(false);
                onChange(c);
              },
            })
          }
        />
      </Modal>
    </>
  );
}
