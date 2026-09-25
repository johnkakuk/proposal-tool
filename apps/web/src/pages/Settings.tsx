import { NotificationPrefsSchema, defaultNotificationPrefs, type NotificationPrefs, type OwnerNotificationType } from "@bridger/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorNote, Spinner } from "../components/ui";
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
    </>
  );
}
