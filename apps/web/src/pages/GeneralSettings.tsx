import { BrandSchema, OwnerSignatureSchema, textOn, zodIssues, type Brand, type OwnerSignature } from "@bridger/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { SIGNATURE_FONT } from "../blocks/signature";
import { useToast } from "../components/Toaster";
import { Button, ErrorNote, Spinner, inputClass } from "../components/ui";
import { supabase } from "../lib/supabase";
import { BrandLogo } from "../render/BrandLogo";
import { FALLBACK_THEME, ThemeScope, useGoogleFonts } from "../render/ThemeScope";

/**
 * Settings (SPEC §7.6): brand & theme (live preview), company, proposal defaults,
 * the owner's signature, and signing options. Written directly through RLS.
 */

interface SettingsRow {
  id: string;
  owner_id: string;
  brand: unknown;
  default_terms_markdown: string;
  default_expiry_days: number;
  timezone: string;
  owner_signature: unknown;
  require_signer_email_otp: boolean;
}

const HEADING_FONTS = ["Playfair Display", "DM Serif Display", "Merriweather", "Lora", "Fraunces", "Montserrat", "Poppins", "Raleway", "Oswald", "Kanit", "Titillium Web", "Inter"];
const BODY_FONTS = ["Inter", "Source Sans 3", "Lato", "Open Sans", "Roboto", "Nunito Sans", "Work Sans", "IBM Plex Sans", "Kanit", "Titillium Web", "Merriweather", "Lora"];
const TIMEZONES = ["America/Los_Angeles", "America/Denver", "America/Phoenix", "America/Chicago", "America/New_York", "America/Anchorage", "Pacific/Honolulu", "UTC"];

export function useSettingsRow() {
  return useQuery({
    queryKey: ["settings-row"],
    queryFn: async () => {
      const { data, error } = await supabase.from("settings").select("id, owner_id, brand, default_terms_markdown, default_expiry_days, timezone, owner_signature, require_signer_email_otp").single();
      if (error) throw error;
      return data as SettingsRow;
    },
  });
}

export function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="mt-6 max-w-2xl scroll-mt-6 rounded-xl bg-white p-6 shadow-xs ring-1 ring-slate-200 first:mt-0">
      <h2 id={`${id}-h`} className="font-semibold">
        {title}
      </h2>
      {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function useSaveSettings(id: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Omit<SettingsRow, "id" | "owner_id">>) => {
      const { error } = await supabase.from("settings").update(patch).eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["settings-row"] });
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

const label = "block text-sm font-medium";

type LogoKey = "logoUrl" | "logoOnDarkUrl";

function LogoField({ title, hint, url, dark, uploading, onUpload, onRemove }: { title: string; hint: string; url?: string; dark: boolean; uploading: boolean; onUpload: (f: File) => void; onRemove: () => void }) {
  return (
    <div>
      <span className={label}>{title}</span>
      <span className="block text-xs text-slate-500">{hint}</span>
      <div className="mt-1 flex items-center gap-3">
        {url ? <img src={url} alt={`Current ${title.toLowerCase()}`} className={`h-10 max-w-40 rounded object-contain p-1 ${dark ? "bg-slate-800" : "bg-slate-100"}`} /> : <span className="text-sm text-slate-500">None yet</span>}
        <label className="cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium text-brand ring-1 ring-slate-300 focus-within:ring-2 focus-within:ring-brand hover:bg-slate-50">
          {uploading ? "Uploading…" : "Upload"}
          <input type="file" aria-label={`Upload ${title.toLowerCase()}`} accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
        </label>
        {url && (
          <button type="button" className="text-sm text-slate-500 hover:text-red-700" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

export function BrandSettings() {
  const row = useSettingsRow();
  const save = useSaveSettings(row.data?.id);
  const toast = useToast();
  const [brand, setBrand] = useState<Brand | null>(null);
  const [uploading, setUploading] = useState<LogoKey | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (row.data && !brand) {
      const parsed = BrandSchema.safeParse(row.data.brand);
      setBrand(parsed.success ? parsed.data : { theme: FALLBACK_THEME, company: { name: "Bridger Digital" } });
    }
  }, [row.data, brand]);
  useGoogleFonts([...new Set([...HEADING_FONTS, ...BODY_FONTS])].slice(0, 20));
  if (!brand || !row.data) return <Spinner />;

  const setColor = (k: keyof Brand["theme"]["colors"]) => (v: string) => setBrand({ ...brand, theme: { ...brand.theme, colors: { ...brand.theme.colors, [k]: v.toUpperCase() } } });
  const setCompany = (k: keyof Brand["company"]) => (v: string) => setBrand({ ...brand, company: { ...brand.company, [k]: v || undefined, ...(k === "name" ? { name: v } : {}) } });

  const upload = async (file: File, key: LogoKey) => {
    setError(null);
    if (file.size > 2 * 1024 * 1024) return setError(new Error("Logos must be under 2 MB."));
    setUploading(key);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
      const path = `${row.data!.owner_id}/${key === "logoOnDarkUrl" ? "logo-light" : "logo"}-${Date.now()}.${ext}`;
      const { error: e } = await supabase.storage.from("assets").upload(path, file, { contentType: file.type, upsert: false });
      if (e) throw e;
      const url = supabase.storage.from("assets").getPublicUrl(path).data.publicUrl;
      setBrand({ ...brand, theme: { ...brand.theme, [key]: url } });
    } catch (e) {
      setError(e);
    } finally {
      setUploading(null);
    }
  };

  const submit = () => {
    const parsed = BrandSchema.safeParse(brand);
    if (!parsed.success) return setError(new Error(zodIssues(parsed.error).map((i) => i.message).join("; ")));
    save.mutate({ brand: parsed.data }, { onSuccess: () => toast("Brand saved") });
  };

  return (
    <Section id="brand" title="Brand & company" description="How your proposals and emails look. Changes apply everywhere right away, including proposals you've already sent.">
      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <div className="space-y-4">
          <LogoField
            title="Logo"
            hint="The main version, for light backgrounds."
            url={brand.theme.logoUrl}
            dark={false}
            uploading={uploading === "logoUrl"}
            onUpload={(f) => void upload(f, "logoUrl")}
            onRemove={() => setBrand({ ...brand, theme: { ...brand.theme, logoUrl: undefined } })}
          />
          <LogoField
            title="Light logo (optional)"
            hint="A white or light version for dark backgrounds, like the email header. Without one, the main logo sits on a small white plate there."
            url={brand.theme.logoOnDarkUrl}
            dark
            uploading={uploading === "logoOnDarkUrl"}
            onUpload={(f) => void upload(f, "logoOnDarkUrl")}
            onRemove={() => setBrand({ ...brand, theme: { ...brand.theme, logoOnDarkUrl: undefined } })}
          />
          <fieldset>
            <legend className={label}>Colors</legend>
            <div className="mt-1 grid grid-cols-2 gap-3">
              {(["primary", "accent", "background", "text"] as const).map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm capitalize">
                  <input type="color" aria-label={`${k} color`} value={brand.theme.colors[k]} onChange={(e) => setColor(k)(e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-slate-300" />
                  <span>
                    {k}
                    <span className="block font-mono text-xs text-slate-500">{brand.theme.colors[k]}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>
              Heading font
              <select className={`mt-1 ${inputClass}`} value={brand.theme.headingFont} onChange={(e) => setBrand({ ...brand, theme: { ...brand.theme, headingFont: e.target.value } })}>
                {[...new Set([brand.theme.headingFont, ...HEADING_FONTS])].map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            <label className={label}>
              Body font
              <select className={`mt-1 ${inputClass}`} value={brand.theme.bodyFont} onChange={(e) => setBrand({ ...brand, theme: { ...brand.theme, bodyFont: e.target.value } })}>
                {[...new Set([brand.theme.bodyFont, ...BODY_FONTS])].map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>
              Company name
              <input className={`mt-1 ${inputClass}`} value={brand.company.name} onChange={(e) => setCompany("name")(e.target.value)} />
            </label>
            <label className={label}>
              Website
              <input className={`mt-1 ${inputClass}`} value={brand.company.website ?? ""} placeholder="https://" onChange={(e) => setCompany("website")(e.target.value)} />
            </label>
            <label className={label}>
              Phone
              <input className={`mt-1 ${inputClass}`} value={brand.company.phone ?? ""} onChange={(e) => setCompany("phone")(e.target.value)} />
            </label>
            <label className={label}>
              Address
              <input className={`mt-1 ${inputClass}`} value={brand.company.address ?? ""} onChange={(e) => setCompany("address")(e.target.value)} />
            </label>
          </div>
        </div>
        <div aria-label="Brand preview">
          <div className="mb-1 text-xs font-medium text-slate-500">Preview</div>
          <ThemeScope theme={brand.theme}>
            <div className="overflow-hidden rounded-lg ring-1 ring-slate-200" style={{ background: "var(--color-background)" }}>
              <div className="flex items-center justify-between border-b border-black/10 px-3 py-2">
                <BrandLogo theme={brand.theme} surface={brand.theme.colors.background} alt="" className="h-5 w-auto" fallback={<span className="font-(family-name:--font-heading) text-sm font-bold text-(--color-primary-text)">{brand.company.name}</span>} />
                <span className="rounded bg-(--color-accent) px-2 py-0.5 text-[10px] font-semibold text-(--color-on-accent)">Accept</span>
              </div>
              <div className="bg-(--color-primary) px-3 py-5 text-(--color-on-primary)">
                <div className="text-[9px] font-semibold uppercase tracking-widest text-(--color-accent-on-primary)">Proposal for Acme</div>
                <div className="font-(family-name:--font-heading) text-lg font-bold leading-tight">Content War Chest</div>
              </div>
              <div className="space-y-1 px-3 py-3 text-xs text-(--color-text)">
                <div className="font-(family-name:--font-heading) text-sm font-bold text-(--color-primary-text)">Our approach</div>
                <p>We film for two days and turn it into a year of content.</p>
              </div>
            </div>
          </ThemeScope>
          <div className="mb-1 mt-4 text-xs font-medium text-slate-500">Email header</div>
          <div className="rounded-lg px-4 py-3" style={{ background: brand.theme.colors.primary }}>
            <BrandLogo theme={brand.theme} surface={brand.theme.colors.primary} alt="" className="h-6 w-auto" fallback={<span className="text-sm font-bold" style={{ color: textOn(brand.theme.colors.primary), fontFamily: "Georgia, serif" }}>{brand.company.name}</span>} />
          </div>
        </div>
      </div>
      <ErrorNote error={error ?? save.error} />
      <div className="mt-4 flex justify-end">
        <Button variant="primary" onClick={submit} disabled={save.isPending || uploading !== null}>
          Save brand
        </Button>
      </div>
    </Section>
  );
}

export function DefaultsSettings() {
  const row = useSettingsRow();
  const save = useSaveSettings(row.data?.id);
  const toast = useToast();
  const [draft, setDraft] = useState<{ terms: string; expiry: number; timezone: string } | null>(null);
  useEffect(() => {
    if (row.data && !draft) setDraft({ terms: row.data.default_terms_markdown, expiry: row.data.default_expiry_days, timezone: row.data.timezone });
  }, [row.data, draft]);
  if (!draft) return <Spinner />;
  return (
    <Section id="defaults" title="Proposal defaults" description="Used when you create or publish proposals.">
      <div className="space-y-4">
        <label className={label}>
          Default terms
          <span className="block text-xs font-normal text-slate-500">Markdown. Fills {"{{default_terms}}"} in templates.</span>
          <textarea rows={8} className={`mt-1 ${inputClass}`} value={draft.terms} onChange={(e) => setDraft({ ...draft, terms: e.target.value })} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>
            Proposals expire after (days)
            <input type="number" min={1} max={365} className={`mt-1 ${inputClass}`} value={draft.expiry} onChange={(e) => setDraft({ ...draft, expiry: Number(e.target.value) })} />
          </label>
          <label className={label}>
            Your timezone
            <select className={`mt-1 ${inputClass}`} value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}>
              {[...new Set([draft.timezone, ...TIMEZONES])].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <ErrorNote error={save.error} />
      <div className="mt-4 flex justify-end">
        <Button
          variant="primary"
          disabled={save.isPending || draft.expiry < 1 || draft.expiry > 365}
          onClick={() => save.mutate({ default_terms_markdown: draft.terms, default_expiry_days: draft.expiry, timezone: draft.timezone }, { onSuccess: () => toast("Defaults saved") })}
        >
          Save defaults
        </Button>
      </div>
    </Section>
  );
}

export function SignatureSettings() {
  const row = useSettingsRow();
  const save = useSaveSettings(row.data?.id);
  const toast = useToast();
  const [sig, setSig] = useState<OwnerSignature | null>(null);
  useGoogleFonts([SIGNATURE_FONT]);
  useEffect(() => {
    if (row.data && !sig) {
      const parsed = OwnerSignatureSchema.safeParse(row.data.owner_signature);
      setSig(parsed.success ? parsed.data : { name: "", title: "", type: "typed", text: "" });
    }
  }, [row.data, sig]);
  if (!sig || !row.data) return <Spinner />;
  return (
    <Section id="signature" title="Your signature" description="Shown next to the client's on proposals whose signature block includes yours. Frozen into each version when you publish.">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          Name
          <input className={`mt-1 ${inputClass}`} value={sig.name} onChange={(e) => setSig({ ...sig, name: e.target.value, text: e.target.value })} />
        </label>
        <label className={label}>
          Title
          <input className={`mt-1 ${inputClass}`} value={sig.title} placeholder="Founder" onChange={(e) => setSig({ ...sig, title: e.target.value })} />
        </label>
      </div>
      <div className="mt-4 flex h-16 items-end border-b border-slate-300 pb-1 text-4xl" style={{ fontFamily: `"${SIGNATURE_FONT}", cursive` }} role="img" aria-label="Signature preview">
        {sig.name}
      </div>
      <p className="mt-1 text-xs text-slate-500">{sig.title ? `${sig.name}, ${sig.title}` : sig.name}</p>
      <ErrorNote error={save.error} />
      <div className="mt-4 flex justify-end gap-2">
        {row.data.owner_signature !== null && (
          <Button variant="ghost" onClick={() => save.mutate({ owner_signature: null }, { onSuccess: () => (setSig({ name: "", title: "", type: "typed", text: "" }), toast("Signature removed")) })}>
            Remove
          </Button>
        )}
        <Button variant="primary" disabled={save.isPending || !sig.name.trim()} onClick={() => save.mutate({ owner_signature: { ...sig, type: "typed", text: sig.name } }, { onSuccess: () => toast("Signature saved") })}>
          Save signature
        </Button>
      </div>
    </Section>
  );
}

export function SigningSettings() {
  const row = useSettingsRow();
  const save = useSaveSettings(row.data?.id);
  if (!row.data) return <Spinner />;
  const on = row.data.require_signer_email_otp;
  return (
    <Section id="signing" title="Signing">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium">Verify the signer's email</div>
          <div className="text-xs text-slate-500">Clients enter a 6-digit code sent to their email before signing. Recommended: it strengthens the signature record.</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Verify the signer's email"
          disabled={save.isPending}
          onClick={() => save.mutate({ require_signer_email_otp: !on })}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-brand" : "bg-slate-300"}`}
        >
          <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${on ? "left-5.5" : "left-0.5"}`} />
        </button>
      </div>
      <ErrorNote error={save.error} />
    </Section>
  );
}
