import type { Pricing, ProposalContent, TemplateDetail, Theme } from "@bridger/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { ErrorNote, Spinner, inputClass } from "../components/ui";
import { api } from "../lib/api";
import { useTemplate, useWorkspaceSettings } from "../lib/queries";
import { DocumentWorkspace, SidebarCard } from "../workspace/DocumentWorkspace";
import { useAutosave } from "../workspace/useAutosave";

export function TemplateEditorPage() {
  const { id = "" } = useParams();
  const { data: template, error, isLoading } = useTemplate(id);
  const settings = useWorkspaceSettings();
  if (isLoading || settings.isLoading) return <Spinner />;
  if (error || !template) return <div className="p-8"><ErrorNote error={error ?? new Error("Template not found")} /></div>;
  return <TemplateEditorLoaded key={template.id} template={template} brand={settings.data?.brand?.theme ?? null} ownerSignatureName={settings.data?.ownerSignatureName} />;
}

interface Draft {
  name: string;
  category: string | null;
  description: string | null;
  content: ProposalContent;
  pricing: Pricing;
}

/** Same editor as proposals, without client, expiry, or status (SPEC §7.4). */
function TemplateEditorLoaded({ template, brand, ownerSignatureName }: { template: TemplateDetail; brand: Theme | null; ownerSignatureName?: string }) {
  const [name, setName] = useState(template.name);
  const [category, setCategory] = useState(template.category ?? "");
  const [description, setDescription] = useState(template.description ?? "");
  const [doc, setDoc] = useState<{ content: ProposalContent; pricing: Pricing } | null>(null);
  const base = useRef(template.updated_at);
  const qc = useQueryClient();

  const draft: Draft | null = doc ? { name: name.trim() || template.name, category: category || null, description: description || null, ...doc } : null;
  const save = useCallback(
    async (d: Draft) => {
      const updated = await api<TemplateDetail>(`/templates/${template.id}`, { method: "PATCH", json: { ...d, baseUpdatedAt: base.current } });
      base.current = updated.updated_at;
      void qc.invalidateQueries({ queryKey: ["templates"] });
    },
    [template.id, qc],
  );
  const { state, flush } = useAutosave(draft, save);
  const onDocumentChange = useCallback((d: { content: ProposalContent; pricing: Pricing }) => setDoc(d), []);

  return (
    <DocumentWorkspace
      initialContent={template.content}
      initialPricing={template.pricing}
      onDocumentChange={onDocumentChange}
      saveState={state}
      onRetrySave={() => void flush()}
      brand={brand}
      ownerSignatureName={ownerSignatureName}
      heading={
        <>
          <Link to="/app/templates" className="shrink-0 rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-ink" aria-label="Back to templates">
            ←
          </Link>
          <span className="shrink-0 rounded bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800">Template</span>
          <input
            aria-label="Template name"
            className="min-w-0 flex-1 rounded-md border border-transparent px-2 py-1 text-lg font-semibold hover:border-slate-200 focus:border-brand focus:outline-none"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </>
      }
      sidebar={
        <SidebarCard title="Template details">
          <div className="space-y-3">
            <label className="block text-xs font-medium text-slate-600">
              Category
              <input className={`mt-1 ${inputClass}`} value={category} onChange={(e) => setCategory(e.target.value)} />
            </label>
            <label className="block text-xs font-medium text-slate-600">
              Description
              <textarea rows={3} className={`mt-1 ${inputClass}`} value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <p className="text-xs text-slate-400">
              Use <code>{"{{client_name}}"}</code> and <code>{"{{default_terms}}"}</code> anywhere; they're filled in when a proposal is created from this template.
            </p>
          </div>
        </SidebarCard>
      }
    />
  );
}
