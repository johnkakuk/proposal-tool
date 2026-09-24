import {
  BrandSchema,
  OwnerSignatureSchema,
  type ClientDetail,
  type ClientInput,
  type ClientRow,
  type CreateProposalInput,
  type ProposalDetail,
  type ProposalStatus,
  type ProposalSummary,
  type TemplateDetail,
  type TemplateInput,
  type TemplateSummary,
} from "@bridger/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { supabase } from "./supabase";

const qs = (params: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  return s ? `?${s}` : "";
};

// Proposals
export const useProposals = (f: { status?: ProposalStatus; clientId?: string; q?: string }) =>
  useQuery({ queryKey: ["proposals", f], queryFn: () => api<ProposalSummary[]>(`/proposals${qs(f)}`) });

export const useProposal = (id: string) => useQuery({ queryKey: ["proposal", id], queryFn: () => api<ProposalDetail>(`/proposals/${id}`), staleTime: Infinity });

export function useCreateProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProposalInput) => api<ProposalDetail>("/proposals", { method: "POST", json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["proposals"] }),
  });
}

export function useProposalAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, json }: { id: string; action: "duplicate" | "archive" | "save-as-template"; json?: unknown }) =>
      api<ProposalDetail | TemplateDetail>(`/proposals/${id}/${action}`, { method: "POST", json: json ?? {} }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["proposals"] });
      void qc.invalidateQueries({ queryKey: ["templates"] });
    },
  });
}

// Templates
export const useTemplates = () => useQuery({ queryKey: ["templates"], queryFn: () => api<TemplateSummary[]>("/templates") });
export const useTemplate = (id: string) => useQuery({ queryKey: ["template", id], queryFn: () => api<TemplateDetail>(`/templates/${id}`), staleTime: Infinity });

export function useTemplateMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ["templates"] });
  return {
    create: useMutation({ mutationFn: (input: TemplateInput) => api<TemplateDetail>("/templates", { method: "POST", json: input }), onSuccess: done }),
    duplicate: useMutation({ mutationFn: (id: string) => api<TemplateDetail>(`/templates/${id}/duplicate`, { method: "POST" }), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => api<void>(`/templates/${id}`, { method: "DELETE" }), onSuccess: done }),
  };
}

// Clients
export const useClients = (q?: string) => useQuery({ queryKey: ["clients", q ?? ""], queryFn: () => api<ClientRow[]>(`/clients${qs({ q })}`) });
export const useClient = (id: string) => useQuery({ queryKey: ["client", id], queryFn: () => api<ClientDetail>(`/clients/${id}`) });

export function useClientMutations() {
  const qc = useQueryClient();
  const done = (c?: ClientRow | void) => {
    void qc.invalidateQueries({ queryKey: ["clients"] });
    if (c) void qc.invalidateQueries({ queryKey: ["client", c.id] });
  };
  return {
    create: useMutation({ mutationFn: (input: ClientInput) => api<ClientRow>("/clients", { method: "POST", json: input }), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, input }: { id: string; input: Partial<ClientInput> }) => api<ClientRow>(`/clients/${id}`, { method: "PATCH", json: input }), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => api<void>(`/clients/${id}`, { method: "DELETE" }), onSuccess: () => done() }),
  };
}

// Settings (read directly through RLS)
export function useWorkspaceSettings() {
  return useQuery({
    queryKey: ["settings"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("settings").select("brand, owner_signature, default_terms_markdown").maybeSingle();
      if (error) throw error;
      const brand = BrandSchema.safeParse(data?.brand);
      const sig = OwnerSignatureSchema.safeParse(data?.owner_signature);
      return { brand: brand.success ? brand.data : null, ownerSignatureName: sig.success ? sig.data.name : undefined };
    },
  });
}
