import type { ClientInput, ClientRow } from "@bridger/shared";
import { useState, type FormEvent } from "react";
import { Button, ErrorNote, inputClass } from "./ui";

const FIELDS: { key: keyof ClientInput; label: string; type?: string; required?: boolean }[] = [
  { key: "name", label: "Contact name", required: true },
  { key: "company", label: "Company" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone", type: "tel" },
  { key: "website", label: "Website", type: "url" },
  { key: "logo_url", label: "Logo URL", type: "url" },
];

export function ClientForm({ initial, onSubmit, submitLabel, error, busy }: { initial?: Partial<ClientRow>; onSubmit: (v: ClientInput) => void; submitLabel: string; error?: unknown; busy?: boolean }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries([...FIELDS.map((f) => f.key), "notes"].map((k) => [k, (initial?.[k as keyof ClientRow] as string | null | undefined) ?? ""])),
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(values as unknown as ClientInput);
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="block text-sm font-medium">
            {f.label}
            {f.required && <span className="text-red-600"> *</span>}
            <input
              type={f.type ?? "text"}
              required={f.required}
              className={`mt-1 ${inputClass}`}
              value={values[f.key]}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              placeholder={f.type === "url" ? "https://" : undefined}
            />
          </label>
        ))}
      </div>
      <label className="block text-sm font-medium">
        Notes
        <textarea rows={3} className={`mt-1 ${inputClass}`} value={values.notes} onChange={(e) => setValues({ ...values, notes: e.target.value })} />
      </label>
      <ErrorNote error={error} />
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
