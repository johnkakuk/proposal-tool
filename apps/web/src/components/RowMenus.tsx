import type { ClientRow, ProposalSummary, TemplateSummary } from "@bridger/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { api, downloadFromApi } from "../lib/api";
import { ConfirmDialog, RenameDialog } from "./dialogs";
import { KebabMenu, type MenuAction } from "./KebabMenu";
import { useToast } from "./Toaster";

type Dialog = "rename" | "delete" | "purge" | null;

/** ⋮ menu for a proposal: Edit, Rename, Duplicate, Copy link, Download PDF, Delete/Restore. */
export function ProposalMenu({ proposal: p }: { proposal: ProposalSummary }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["proposals"] });
    void qc.invalidateQueries({ queryKey: ["client"] });
    void qc.invalidateQueries({ queryKey: ["proposal", p.id] });
  };
  const archived = p.status === "archived";
  const locked = Boolean(p.signed_at);
  const live = p.current_version > 0 && !archived;
  const run = (fn: () => Promise<unknown>) => () => void fn().catch((e: unknown) => toast(e instanceof Error ? e.message : "Something went wrong"));

  const actions: MenuAction[] = [
    { label: "Edit", onSelect: () => navigate(`/app/proposals/${p.id}`) },
    { label: "Rename", onSelect: () => setDialog("rename"), disabled: locked || archived, hint: locked ? "Signed proposals can't be renamed" : "Restore it first" },
    {
      label: "Duplicate",
      onSelect: run(async () => {
        await api(`/proposals/${p.id}/duplicate`, { method: "POST", json: {} });
        refresh();
        toast(`Duplicated “${p.title}”`);
      }),
    },
    {
      label: "Copy link",
      disabled: !live,
      hint: archived ? "Archived proposals have no public link" : "Publish it first",
      onSelect: run(async () => {
        await navigator.clipboard.writeText(`${window.location.origin}/p/${p.slug}`);
        toast("Link copied");
        await api(`/proposals/${p.id}/events`, { method: "POST", json: { type: "link_copied" } });
      }),
    },
    {
      label: locked ? "Download signed PDF" : "Download PDF",
      disabled: p.current_version === 0,
      hint: "Publish it first",
      onSelect: run(async () => {
        if (locked) {
          const sig = await api<{ pdfUrl: string | null }>(`/proposals/${p.id}/signature`);
          if (!sig.pdfUrl) return toast("The signed PDF is still being prepared");
          window.open(sig.pdfUrl, "_blank", "noopener");
          return;
        }
        toast("Preparing PDF…");
        await downloadFromApi(`/proposals/${p.id}/pdf`, `${p.title}.pdf`);
      }),
    },
    ...(archived
      ? [
          {
            label: "Restore",
            onSelect: run(async () => {
              await api(`/proposals/${p.id}/restore`, { method: "POST" });
              refresh();
              toast(`Restored “${p.title}”`);
            }),
          },
          {
            label: "Delete permanently",
            danger: true,
            disabled: locked,
            hint: "Signed proposals are legal records and can't be permanently deleted",
            onSelect: () => setDialog("purge"),
          },
        ]
      : [{ label: "Delete", danger: true, onSelect: () => setDialog("delete") }]),
  ];

  return (
    <>
      <KebabMenu label={`Actions for ${p.title}`} actions={actions} />
      <RenameDialog
        open={dialog === "rename"}
        onClose={() => setDialog(null)}
        title="Rename proposal"
        label="Title"
        initial={p.title}
        onSave={async (title) => {
          await api(`/proposals/${p.id}`, { method: "PATCH", json: { title } });
          refresh();
        }}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        danger
        title={`Delete “${p.title}”?`}
        body={
          <>
            <p>It's removed from your proposals{p.current_version > 0 ? " and its client link stops working" : ""}.</p>
            <p className="mt-2 text-slate-500">Because every proposal keeps a permanent audit trail, deleted proposals are archived rather than erased. You can restore it from the Archived filter.</p>
          </>
        }
        confirmLabel="Delete"
        onConfirm={async () => {
          await api(`/proposals/${p.id}/archive`, { method: "POST" });
          refresh();
          toast(`Deleted “${p.title}”`);
        }}
      />
      <ConfirmDialog
        open={dialog === "purge"}
        onClose={() => setDialog(null)}
        danger
        title={`Permanently delete “${p.title}”?`}
        body={
          <>
            <p>This erases the proposal, all its published versions, and its activity history. It can't be undone.</p>
            <p className="mt-2 text-slate-500">Analytics for this proposal are deleted too.</p>
          </>
        }
        confirmLabel="Delete permanently"
        onConfirm={async () => {
          await api(`/proposals/${p.id}`, { method: "DELETE" });
          refresh();
          toast(`Permanently deleted “${p.title}”`);
        }}
      />
    </>
  );
}

/** ⋮ menu for a template: Edit, Rename, Duplicate, Delete. */
export function TemplateMenu({ template: t }: { template: TemplateSummary }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["templates"] });
  return (
    <>
      <KebabMenu
        label={`Actions for ${t.name}`}
        actions={[
          { label: "Edit", onSelect: () => navigate(`/app/templates/${t.id}`) },
          { label: "Rename", onSelect: () => setDialog("rename") },
          {
            label: "Duplicate",
            onSelect: () =>
              void api(`/templates/${t.id}/duplicate`, { method: "POST" })
                .then(() => (refresh(), toast(`Duplicated “${t.name}”`)))
                .catch((e: Error) => toast(e.message)),
          },
          { label: "Delete", danger: true, onSelect: () => setDialog("delete") },
        ]}
      />
      <RenameDialog
        open={dialog === "rename"}
        onClose={() => setDialog(null)}
        title="Rename template"
        label="Name"
        initial={t.name}
        onSave={async (name) => {
          await api(`/templates/${t.id}`, { method: "PATCH", json: { name } });
          refresh();
          void qc.invalidateQueries({ queryKey: ["template", t.id] });
        }}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        danger
        title={`Delete “${t.name}”?`}
        body="This permanently deletes the template. Proposals already made from it aren't affected."
        confirmLabel="Delete template"
        onConfirm={async () => {
          await api(`/templates/${t.id}`, { method: "DELETE" });
          refresh();
          toast(`Deleted “${t.name}”`);
        }}
      />
    </>
  );
}

/** ⋮ menu for a client: Edit, Rename, Delete (blocked while they have proposals). */
export function ClientMenu({ client: c, onDeleted }: { client: ClientRow; onDeleted?: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const label = c.company ? `${c.name}, ${c.company}` : c.name;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["clients"] });
    void qc.invalidateQueries({ queryKey: ["client", c.id] });
  };
  return (
    <>
      <KebabMenu
        label={`Actions for ${label}`}
        actions={[
          { label: "Edit", onSelect: () => navigate(`/app/clients/${c.id}`) },
          { label: "Rename", onSelect: () => setDialog("rename") },
          { label: "Delete", danger: true, onSelect: () => setDialog("delete") },
        ]}
      />
      <RenameDialog
        open={dialog === "rename"}
        onClose={() => setDialog(null)}
        title="Rename client"
        label="Contact name"
        initial={c.name}
        onSave={async (name) => {
          await api(`/clients/${c.id}`, { method: "PATCH", json: { name } });
          refresh();
        }}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        danger
        title={`Delete ${c.name}?`}
        body="This permanently deletes the client. Clients with proposals can't be deleted; reassign or delete those proposals first."
        confirmLabel="Delete client"
        onConfirm={async () => {
          await api(`/clients/${c.id}`, { method: "DELETE" });
          refresh();
          toast(`Deleted ${c.name}`);
          onDeleted?.();
        }}
      />
    </>
  );
}
