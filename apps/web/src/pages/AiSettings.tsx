import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, ErrorNote, Spinner, inputClass, relativeTime } from "../components/ui";
import { useToast } from "../components/Toaster";
import { api } from "../lib/api";
import { supabase } from "../lib/supabase";

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  created_at: string;
}
interface Connection {
  grantId: string;
  clientName: string;
  createdAt: string;
}

function Switch({ label, hint, checked, onChange, disabled }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-slate-500">{hint}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? "bg-brand" : "bg-slate-300"}`}
      >
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${checked ? "left-5.5" : "left-0.5"}`} />
      </button>
    </div>
  );
}

/** Settings → AI & API (SPEC §7.6). */
export function AiSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const settings = useQuery({
    queryKey: ["ai-settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("settings").select("id, ai_can_publish, ai_can_email_client, guidelines_markdown").single();
      if (error) throw error;
      return data as { id: string; ai_can_publish: boolean; ai_can_email_client: boolean; guidelines_markdown: string };
    },
  });
  const save = useMutation({
    mutationFn: async (patch: Partial<{ ai_can_publish: boolean; ai_can_email_client: boolean; guidelines_markdown: string }>) => {
      const { error } = await supabase.from("settings").update(patch).eq("id", settings.data!.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-settings"] }),
  });
  const [guidelines, setGuidelines] = useState<string | null>(null);

  const keys = useQuery({ queryKey: ["api-keys"], queryFn: () => api<ApiKey[]>("/api-keys") });
  const connections = useQuery({ queryKey: ["connections"], queryFn: () => api<Connection[]>("/connections") });
  const [keyName, setKeyName] = useState("Claude Code");
  const [newKey, setNewKey] = useState<string | null>(null);
  const createKey = useMutation({
    mutationFn: () => api<ApiKey & { key: string }>("/api-keys", { method: "POST", json: { name: keyName } }),
    onSuccess: (k) => {
      setNewKey(k.key);
      void qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });
  const revokeKey = useMutation({ mutationFn: (id: string) => api(`/api-keys/${id}`, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }) });
  const disconnect = useMutation({ mutationFn: (id: string) => api(`/connections/${id}`, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["connections"] }) });

  return (
    <section className="mt-6 max-w-2xl rounded-xl bg-white p-6 shadow-xs ring-1 ring-slate-200" aria-labelledby="ai-settings">
      <h2 id="ai-settings" className="font-semibold">
        AI & API
      </h2>
      <p className="mt-1 text-sm text-slate-500">Claude and ChatGPT can draft proposals for you. They never delete anything and can't change signed proposals.</p>
      <ErrorNote error={settings.error ?? save.error ?? keys.error ?? connections.error ?? createKey.error} />
      {settings.data && (
        <div className="mt-2 divide-y divide-slate-100">
          <Switch
            label="Let AI publish proposals"
            hint="When off, AI can only create and edit drafts; you publish."
            checked={settings.data.ai_can_publish}
            disabled={save.isPending}
            onChange={(v) => save.mutate({ ai_can_publish: v })}
          />
          <Switch
            label="Let AI email clients"
            hint="When off, AI can't send the proposal link to a client."
            checked={settings.data.ai_can_email_client}
            disabled={save.isPending}
            onChange={(v) => save.mutate({ ai_can_email_client: v })}
          />
          <div className="py-3">
            <label className="block text-sm font-medium">
              Writing guidelines
              <span className="block text-xs font-normal text-slate-500">Shared with AI clients before they write. Markdown.</span>
              <textarea
                rows={5}
                className={`mt-2 ${inputClass}`}
                value={guidelines ?? settings.data.guidelines_markdown}
                onChange={(e) => setGuidelines(e.target.value)}
              />
            </label>
            {guidelines !== null && guidelines !== settings.data.guidelines_markdown && (
              <Button className="mt-2" variant="primary" onClick={() => save.mutate({ guidelines_markdown: guidelines }, { onSuccess: () => (setGuidelines(null), toast("Guidelines saved")) })}>
                Save guidelines
              </Button>
            )}
          </div>
        </div>
      )}

      <h3 className="mt-6 text-sm font-semibold">Connected apps</h3>
      <p className="text-xs text-slate-500">Claude.ai, ChatGPT, and other apps you've connected by signing in.</p>
      {connections.isLoading ? (
        <Spinner />
      ) : connections.data?.length ? (
        <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200" aria-label="Connected apps">
          {connections.data.map((c) => (
            <li key={c.grantId} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>
                <strong>{c.clientName}</strong> <span className="text-slate-500">· connected {relativeTime(c.createdAt)}</span>
              </span>
              <Button variant="ghost" className="text-red-700" onClick={() => window.confirm(`Disconnect ${c.clientName}?`) && disconnect.mutate(c.grantId)}>
                Disconnect
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-slate-500">No apps connected yet. See “Write with AI” to connect Claude or ChatGPT.</p>
      )}

      <h3 className="mt-6 text-sm font-semibold">API keys</h3>
      <p className="text-xs text-slate-500">For Claude Code, scripts, and Zapier. Keys are shown once; store them somewhere safe.</p>
      {newKey && (
        <div role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <p className="font-medium text-emerald-900">Copy your new key now. You won't see it again.</p>
          <div className="mt-2 flex gap-2">
            <input readOnly aria-label="New API key" className={`${inputClass} font-mono text-xs`} value={newKey} onFocus={(e) => e.target.select()} />
            <Button
              onClick={async () => {
                await navigator.clipboard.writeText(newKey);
                toast("Key copied");
              }}
            >
              Copy
            </Button>
            <Button variant="ghost" onClick={() => setNewKey(null)}>
              Done
            </Button>
          </div>
        </div>
      )}
      {keys.data && keys.data.length > 0 && (
        <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200" aria-label="API keys">
          {keys.data.map((k) => (
            <li key={k.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>
                <strong>{k.name}</strong> <span className="font-mono text-xs text-slate-500">{k.key_prefix}…</span>
                <span className="block text-xs text-slate-500">
                  Created {relativeTime(k.created_at)} · {k.last_used_at ? `last used ${relativeTime(k.last_used_at)}` : "never used"}
                </span>
              </span>
              <Button variant="ghost" className="text-red-700" onClick={() => window.confirm(`Revoke “${k.name}”? Anything using it stops working.`) && revokeKey.mutate(k.id)}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          createKey.mutate();
        }}
      >
        <input aria-label="API key name" className={inputClass} value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="Claude Code" />
        <Button type="submit" className="whitespace-nowrap" disabled={!keyName.trim() || createKey.isPending}>
          Create key
        </Button>
      </form>
    </section>
  );
}
