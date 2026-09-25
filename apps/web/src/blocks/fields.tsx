import { centsToInput, parseDollarsToCents } from "@bridger/shared";
import { useEffect, useId, useState, type ReactNode } from "react";

/**
 * Form kit for block Editors. Keeps every object's editor short and consistent.
 * Inputs here are controlled and report changes on every keystroke; undo/redo
 * groups them via the editor's history.
 */

const inputClass =
  "block w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-ink shadow-xs placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-xs font-medium text-slate-600">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function TextInput(p: { label: string; value: string | undefined; onChange: (v: string) => void; placeholder?: string; hint?: string; type?: string }) {
  const id = useId();
  return (
    <Field label={p.label} hint={p.hint} htmlFor={id}>
      <input id={id} type={p.type ?? "text"} className={inputClass} value={p.value ?? ""} placeholder={p.placeholder} onChange={(e) => p.onChange(e.target.value)} />
    </Field>
  );
}

/** Optional string props: empty input → undefined, so optional URLs don't store "". */
export function OptionalTextInput(p: { label: string; value: string | undefined; onChange: (v: string | undefined) => void; placeholder?: string; hint?: string }) {
  return <TextInput {...p} onChange={(v) => p.onChange(v === "" ? undefined : v)} />;
}

export function TextArea(p: { label: string; value: string | undefined; onChange: (v: string) => void; rows?: number; placeholder?: string; hint?: string }) {
  const id = useId();
  return (
    <Field label={p.label} hint={p.hint} htmlFor={id}>
      <textarea id={id} rows={p.rows ?? 3} className={inputClass} value={p.value ?? ""} placeholder={p.placeholder} onChange={(e) => p.onChange(e.target.value)} />
    </Field>
  );
}

export function MarkdownInput(p: { label: string; value: string | undefined; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  return <TextArea {...p} rows={p.rows ?? 5} hint="Markdown: **bold**, *italic*, [link](https://…), - lists, > quotes" />;
}

export function SelectInput<V extends string | number>(p: { label: string; value: V; options: { value: V; label: string }[]; onChange: (v: V) => void }) {
  const id = useId();
  return (
    <Field label={p.label} htmlFor={id}>
      <select
        id={id}
        className={inputClass}
        value={String(p.value)}
        onChange={(e) => p.onChange(p.options.find((o) => String(o.value) === e.target.value)!.value)}
      >
        {p.options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Toggle(p: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input type="checkbox" className="size-4 rounded border-slate-300 accent-brand" checked={p.checked} onChange={(e) => p.onChange(e.target.checked)} />
      {p.label}
    </label>
  );
}

/** A number field that tolerates partial input ("1.", "") while typing. */
export function NumberInput(p: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string; compact?: boolean }) {
  const id = useId();
  const [text, setText] = useState(String(p.value));
  useEffect(() => {
    if (Number(text) !== p.value) setText(String(p.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only resync when the value changes from outside
  }, [p.value]);
  const input = (
    <div className="relative">
      <input
        id={id}
        inputMode="decimal"
        className={inputClass}
        value={text}
        aria-label={p.compact ? p.label : undefined}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(n) && n >= (p.min ?? 0) && (p.max === undefined || n <= p.max)) p.onChange(Math.round(n * 100) / 100);
        }}
      />
      {p.suffix && <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-slate-500">{p.suffix}</span>}
    </div>
  );
  return p.compact ? input : <Field label={p.label} htmlFor={id}>{input}</Field>;
}

/** Dollar input backed by integer cents. Invalid text is kept visible but not reported. */
export function MoneyInput(p: { label: string; cents: number; onChange: (cents: number) => void; compact?: boolean }) {
  const id = useId();
  const [text, setText] = useState(centsToInput(p.cents));
  const parsed = parseDollarsToCents(text);
  useEffect(() => {
    if (parseDollarsToCents(text) !== p.cents) setText(centsToInput(p.cents));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only resync when the value changes from outside
  }, [p.cents]);
  const input = (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-slate-500">$</span>
      <input
        id={id}
        inputMode="decimal"
        aria-label={p.compact ? p.label : undefined}
        aria-invalid={parsed === null}
        className={`${inputClass} pl-6 text-right tabular-nums ${parsed === null ? "border-red-400" : ""}`}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const c = parseDollarsToCents(e.target.value);
          if (c !== null) p.onChange(c);
        }}
        onBlur={() => parsed !== null && setText(centsToInput(parsed))}
      />
    </div>
  );
  return p.compact ? input : <Field label={p.label} htmlFor={id}>{input}</Field>;
}

export function IconButton(p: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean; tone?: "default" | "danger" }) {
  return (
    <button
      type="button"
      title={p.label}
      aria-label={p.label}
      disabled={p.disabled}
      onClick={p.onClick}
      className={`inline-flex size-7 items-center justify-center rounded text-sm disabled:opacity-30 ${
        p.tone === "danger" ? "text-slate-500 hover:bg-red-50 hover:text-red-600" : "text-slate-500 hover:bg-slate-100 hover:text-ink"
      }`}
    >
      {p.children}
    </button>
  );
}

export function AddButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="rounded-md px-2 py-1 text-sm font-medium text-brand hover:bg-brand/5">
      + {children}
    </button>
  );
}

/** Editable list with add / reorder / remove, used by deliverables, timeline, FAQ, team… */
export function ListEditor<T>(p: {
  items: T[];
  onChange: (items: T[]) => void;
  newItem: () => T;
  itemLabel: string;
  renderItem: (item: T, update: (next: T) => void, index: number) => ReactNode;
  min?: number;
  max?: number;
}) {
  const move = (i: number, d: number) => {
    const next = [...p.items];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    p.onChange(next);
  };
  return (
    <div className="space-y-3">
      {p.items.map((item, i) => (
        <div key={i} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {p.itemLabel} {i + 1}
            </span>
            <div className="flex">
              <IconButton label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </IconButton>
              <IconButton label="Move down" disabled={i === p.items.length - 1} onClick={() => move(i, 1)}>
                ↓
              </IconButton>
              <IconButton label={`Remove ${p.itemLabel.toLowerCase()}`} tone="danger" disabled={p.items.length <= (p.min ?? 0)} onClick={() => p.onChange(p.items.filter((_, j) => j !== i))}>
                ✕
              </IconButton>
            </div>
          </div>
          <div className="space-y-2">{p.renderItem(item, (next) => p.onChange(p.items.map((x, j) => (j === i ? next : x))), i)}</div>
        </div>
      ))}
      {(p.max === undefined || p.items.length < p.max) && <AddButton onClick={() => p.onChange([...p.items, p.newItem()])}>Add {p.itemLabel.toLowerCase()}</AddButton>}
    </div>
  );
}

export function EditorGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 @lg:grid-cols-2">{children}</div>;
}
