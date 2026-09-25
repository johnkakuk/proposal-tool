import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { Theme } from "@bridger/shared";
import { api } from "../lib/api";
import { ProposalBlocks, RenderProvider, useRenderContextValue } from "../render/ProposalRenderer";
import type { Device, HeatmapCells, VersionDetail } from "./types";

const WIDTH: Record<Device, string> = { mobile: "max-w-[390px] px-5 py-8", tablet: "max-w-[768px] px-8 py-10", desktop: "max-w-4xl px-8 py-12 sm:px-14" };

/** One warm hue whose intensity follows density (a sequential ramp, not a rainbow). */
const HEAT_RGB = "220, 60, 30";

/**
 * Renders a published version read-only and, if `heat` is given, overlays a heatmap
 * (SPEC §11.3): each block's 50×50 grid drawn as radial gradients, normalized per block,
 * positioned by the block's own box, so it stays accurate at any width.
 */
export function VersionCanvas({
  proposalId,
  version,
  device,
  brand,
  heat,
}: {
  proposalId: string;
  version: number;
  device: Device;
  brand: Theme | null;
  heat?: { kind: "clicks" | "moves"; sessionId?: string; opacity: number };
}) {
  const v = useQuery({ queryKey: ["version", proposalId, version], queryFn: () => api<VersionDetail>(`/proposals/${proposalId}/versions/${version}`), staleTime: Infinity });
  const cells = useQuery({
    queryKey: ["heatmap", proposalId, version, device, heat?.kind, heat?.sessionId],
    queryFn: () => api<HeatmapCells>(`/proposals/${proposalId}/analytics/heatmap?version=${version}&device=${device}&kind=${heat!.kind}${heat!.sessionId ? `&sessionId=${heat!.sessionId}` : ""}`),
    enabled: Boolean(heat),
  });
  const value = useRenderContextValue(v.data?.pricing ?? { currency: "USD", sections: [], discounts: [] }, "preview", { ownerSignatureName: v.data?.owner_signature?.name });
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = container.current;
    const c = canvas.current;
    if (!root || !c || !heat) return;
    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      c.width = root.offsetWidth * ratio;
      c.height = root.offsetHeight * ratio;
      c.style.width = `${root.offsetWidth}px`;
      c.style.height = `${root.offsetHeight}px`;
      const ctx = c.getContext("2d")!;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, root.offsetWidth, root.offsetHeight);
      const base = root.getBoundingClientRect();
      const byBlock = new Map<string, HeatmapCells["cells"]>();
      for (const cell of cells.data?.cells ?? []) byBlock.set(cell.blockId, [...(byBlock.get(cell.blockId) ?? []), cell]);
      for (const [blockId, list] of byBlock) {
        const el = root.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const max = Math.max(...list.map((l) => l.count));
        const radius = Math.max(14, Math.min(r.width, r.height) / 12);
        for (const cell of list) {
          const x = r.left - base.left + ((cell.x + 0.5) / 50) * r.width;
          const y = r.top - base.top + ((cell.y + 0.5) / 50) * r.height;
          const a = 0.25 + 0.6 * (cell.count / max);
          const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
          g.addColorStop(0, `rgba(${HEAT_RGB}, ${a})`);
          g.addColorStop(1, `rgba(${HEAT_RGB}, 0)`);
          ctx.fillStyle = g;
          ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        }
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(root);
    const t = setTimeout(draw, 500); // after fonts/images settle
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, [cells.data, heat, v.data]);

  if (v.isLoading) return <div className="p-8 text-sm text-slate-500">Loading version {version}…</div>;
  if (!v.data) return <div className="p-8 text-sm text-red-700">Couldn't load version {version}.</div>;
  return (
    <RenderProvider value={value} theme={brand} overrides={v.data.content.theme}>
      <div className={`@container relative mx-auto rounded-xl bg-(--color-background) shadow-sm ring-1 ring-slate-200 ${WIDTH[device]}`} data-testid="version-canvas">
        <div ref={container} className="relative">
          <ProposalBlocks content={v.data.content} />
          {heat && <canvas ref={canvas} aria-hidden className="pointer-events-none absolute inset-0" style={{ opacity: heat.opacity }} data-testid="heatmap-canvas" data-cells={cells.data?.cells.length ?? 0} />}
        </div>
      </div>
    </RenderProvider>
  );
}
