import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Button, EmptyState, ErrorNote, Modal, Spinner, inputClass, relativeTime } from "../components/ui";
import { TemplateMenu } from "../components/RowMenus";
import { useTemplateMutations, useTemplates } from "../lib/queries";

export function Templates() {
  const { data, error, isLoading } = useTemplates();
  const { create } = useTemplateMutations();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const navigate = useNavigate();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ name }, { onSuccess: (t) => navigate(`/app/templates/${t.id}`) });
  };

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Templates</h1>
        <Button variant="primary" onClick={() => setCreating(true)}>
          + New template
        </Button>
      </div>
      <ErrorNote error={error} />
      {isLoading ? (
        <Spinner />
      ) : !data?.length ? (
        <EmptyState title="No templates yet" body="Create one here, or save any proposal as a template." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((t) => (
            <li key={t.id} className="flex flex-col rounded-xl bg-white p-5 shadow-xs ring-1 ring-slate-200">
              <div className="mb-3 flex aspect-[16/7] items-center justify-center rounded-lg bg-gradient-to-br from-brand to-brand/70 px-4 text-center font-semibold text-white">
                {t.name}
              </div>
              {t.category && <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{t.category}</span>}
              <Link to={`/app/templates/${t.id}`} className="font-medium hover:text-brand hover:underline">
                {t.name}
              </Link>
              {t.description && <p className="mt-1 line-clamp-2 text-sm text-slate-500">{t.description}</p>}
              <div className="mt-auto flex items-center justify-between pt-4 text-xs text-slate-500">
                <span>Updated {relativeTime(t.updated_at)}</span>
                <TemplateMenu template={t} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="New template">
        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm font-medium">
            Name
            <input required autoFocus className={`mt-1 ${inputClass}`} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <ErrorNote error={create.error} />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={create.isPending || !name.trim()}>
              Create and edit
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
