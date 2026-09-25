import { NotificationPrefsSchema, defaultNotificationPrefs, type NotificationPrefs, type OwnerNotificationType } from "@bridger/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, ErrorNote, Spinner, inputClass } from "../components/ui";
import { api } from "../lib/api";
import { AiSettings } from "./AiSettings";
import { supabase } from "../lib/supabase";

/**
 * Settings (SPEC §7.6). Phase 5 ships Notifications; brand, signature, signing, tracking,
 * and AI settings join here in later phases. Settings are plain CRUD, written directly
 * through RLS.
 */

const NOTIFICATIONS: { key: OwnerNotificationType; label: string; hint: string }[] = [
  { key: "first_view", label: "First view", hint: "When a client first spends 5+ seconds on a proposal" },
  { key: "return_visit", label: "Return visits", hint: "When they come back after 12+ hours (max one per 12 h)" },
  { key: "signed", label: "Signed", hint: "Includes the QuickBooks invoice checklist" },
  { key: "declined", label: "Declined", hint: "Includes their reason, if given" },
  { key: "expiring_soon", label: "Expiring soon", hint: "3 days before an unsigned proposal expires" },
  { key: "expired", label: "Expired", hint: "When a proposal passes its expiry date" },
  { key: "extension_requested", label: "Extension requested", hint: "From the expired proposal page" },
  { key: "ai_draft_created", label: "AI drafted a proposal", hint: "When Claude or ChatGPT creates a draft" },
  { key: "ai_published", label: "AI published a proposal", hint: "When Claude or ChatGPT publishes" },
  { key: "daily_digest", label: "Daily digest", hint: "07:00 your time: views, signings, and expiring proposals" },
];

export function Settings() {
  const qc = useQueryClient();
  const prefs = useQuery({
    queryKey: ["notification-prefs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("settings").select("id, notification_prefs").single();
      if (error) throw error;
      const parsed = NotificationPrefsSchema.safeParse({ ...defaultNotificationPrefs(), ...(data.notification_prefs ?? {}) });
      return { id: data.id as string, prefs: parsed.success ? parsed.data : defaultNotificationPrefs() };
    },
  });
  const save = useMutation({
    mutationFn: async (next: NotificationPrefs) => {
      const { error } = await supabase.from("settings").update({ notification_prefs: next }).eq("id", prefs.data!.id);
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => qc.setQueryData(["notification-prefs"], { id: prefs.data!.id, prefs: next }),
  });

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Settings</h1>
      <section className="max-w-2xl rounded-xl bg-white p-6 shadow-xs ring-1 ring-slate-200">
        <h2 className="font-semibold">Email notifications</h2>
        <p className="mt-1 text-sm text-slate-500">Emails you get about your proposals. Emails to clients (sent proposals, signing codes, signed copies) always go out.</p>
        <ErrorNote error={prefs.error ?? save.error} />
        {prefs.isLoading ? (
          <Spinner />
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {NOTIFICATIONS.map((n) => {
              const on = prefs.data?.prefs[n.key] ?? false;
              return (
                <li key={n.key} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <div className="text-sm font-medium">{n.label}</div>
                    <div className="text-xs text-slate-500">{n.hint}</div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={n.label}
                    disabled={save.isPending}
                    onClick={() => save.mutate({ ...prefs.data!.prefs, [n.key]: !on })}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-brand" : "bg-slate-300"}`}
                  >
                    <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${on ? "left-5.5" : "left-0.5"}`} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <AiSettings />
      <TrackingSettings />
    </>
  );
}

/** Tracking (SPEC §7.6): excluded IPs and the "this browser is me" cookie. */
function TrackingSettings() {
  const qc = useQueryClient();
  const who = useQuery({ queryKey: ["tracking-whoami"], queryFn: () => api<{ ip: string; ownerCookie: boolean }>("/tracking/whoami") });
  const ips = useQuery({
    queryKey: ["excluded-ips"],
    queryFn: async () => {
      const { data, error } = await supabase.from("settings").select("id, excluded_ips").single();
      if (error) throw error;
      return { id: data.id as string, ips: (data.excluded_ips as string[]) ?? [] };
    },
  });
  const [draft, setDraft] = useState("");
  const saveIps = useMutation({
    mutationFn: async (next: string[]) => {
      const { error } = await supabase.from("settings").update({ excluded_ips: next }).eq("id", ips.data!.id);
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => qc.setQueryData(["excluded-ips"], { id: ips.data!.id, ips: next }),
  });
  const cookie = useMutation({
    mutationFn: (on: boolean) => api<{ ownerCookie: boolean }>("/tracking/owner-cookie", { method: on ? "POST" : "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tracking-whoami"] }),
  });
  const add = (ip: string) => {
    const v = ip.trim();
    if (!v || ips.data?.ips.includes(v)) return;
    saveIps.mutate([...(ips.data?.ips ?? []), v]);
    setDraft("");
  };
  return (
    <section className="mt-6 max-w-2xl rounded-xl bg-white p-6 shadow-xs ring-1 ring-slate-200">
      <h2 className="font-semibold">Tracking</h2>
      <p className="mt-1 text-sm text-slate-500">Your own visits never count toward views, analytics, or notifications. You're recognized when you're signed in here, and also by these settings.</p>
      <ErrorNote error={who.error ?? ips.error ?? saveIps.error ?? cookie.error} />
      <div className="mt-4 flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <div className="text-sm font-medium">This browser is me</div>
          <div className="text-xs text-slate-500">Ignore visits from this browser even when you're signed out (e.g. checking a link as a client would).</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={who.data?.ownerCookie ?? false}
          aria-label="This browser is me"
          disabled={!who.data || cookie.isPending}
          onClick={() => cookie.mutate(!who.data!.ownerCookie)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${who.data?.ownerCookie ? "bg-brand" : "bg-slate-300"}`}
        >
          <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${who.data?.ownerCookie ? "left-5.5" : "left-0.5"}`} />
        </button>
      </div>
      <div className="mt-4">
        <div className="text-sm font-medium">Excluded IP addresses</div>
        <div className="text-xs text-slate-500">Visits from these addresses (your office, your home) never count.</div>
        {ips.isLoading ? (
          <Spinner />
        ) : (
          <>
            <ul className="mt-2 space-y-1" aria-label="Excluded IP addresses">
              {ips.data?.ips.map((ip) => (
                <li key={ip} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-1.5 font-mono text-sm">
                  {ip}
                  <button type="button" aria-label={`Remove ${ip}`} onClick={() => saveIps.mutate(ips.data!.ips.filter((x) => x !== ip))} className="text-slate-400 hover:text-red-600">
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                add(draft);
              }}
            >
              <input aria-label="IP address to exclude" placeholder="203.0.113.10" className={`${inputClass} font-mono`} value={draft} onChange={(e) => setDraft(e.target.value)} />
              <Button type="submit" disabled={!draft.trim()}>
                Add
              </Button>
            </form>
            {who.data && !ips.data?.ips.includes(who.data.ip) && (
              <button type="button" onClick={() => add(who.data!.ip)} className="mt-2 text-sm font-medium text-brand hover:underline">
                + Add my current IP ({who.data.ip})
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
