import type { Device, TrackEvents } from "@bridger/shared";

/**
 * Viewer tracker (SPEC §11.1). Runs only on the public viewer; never in preview, print,
 * for the owner (admin session in this browser; the server also checks the owner cookie
 * and excluded IPs), or under automation (navigator.webdriver).
 *
 *  - Session starts only after the page has been visible for 3 s with JS running, which
 *    filters out link scanners and preview bots.
 *  - Active time counts only while the tab is visible AND there was input in the last 30 s.
 *  - Block visibility: IntersectionObserver (≥50% visible), accumulated only while active.
 *  - Clicks/taps are stored relative to the block's box; mouse movement is desktop-only,
 *    sampled every 150 ms and only after moving 20+ px.
 *  - Batches flush every 15 s, and once more via sendBeacon when the page is hidden.
 */

const SESSION_DELAY_MS = 3_000;
const ACTIVE_WINDOW_MS = 30_000;
const FLUSH_MS = 15_000;
const TICK_MS = 1_000;
const MOVE_SAMPLE_MS = 150;
const MOVE_MIN_PX = 20;
const MAX_POINTS_PER_BATCH = 500; // keeps each request well under the 64 KB cap
const MAX_POINTS_TOTAL = 3_000;

export interface Tracker {
  pricing: (sectionId: string, itemId: string, action: "selected" | "deselected") => void;
  stop: () => void;
}

const noop: Tracker = { pricing: () => {}, stop: () => {} };

/** An admin (Supabase) session in this browser means the owner is looking. */
export function hasAdminSession(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) if (/^sb-.+-auth-token$/.test(localStorage.key(i) ?? "")) return true;
  } catch {
    /* storage blocked */
  }
  return false;
}

function visitorId(): string {
  const existing = /(?:^|;\s*)bdp_vid=([A-Za-z0-9_-]{8,64})/.exec(document.cookie)?.[1];
  if (existing) return existing;
  const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, "0")).join("");
  document.cookie = `bdp_vid=${id}; Path=/; Max-Age=${365 * 86_400}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  return id;
}

export function detectDevice(): Device {
  const w = window.innerWidth;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  if (w < 640) return "mobile";
  if (coarse && w < 1280) return "tablet";
  return "desktop";
}

export function startTracker(opts: { slug: string; version: number; root: HTMLElement }): Tracker {
  if (navigator.webdriver || hasAdminSession()) return noop;

  const device = detectDevice();
  let sessionId: string | null = null;
  let stopped = false;
  let pointsSent = 0;
  let lastInput = Date.now();
  let lastTick = Date.now();
  let visibleSince = document.visibilityState === "visible" ? Date.now() : null;
  let visibleTotal = 0;

  // Pending batch
  let activeMs = 0;
  let maxScroll = 0;
  const blockMs = new Map<string, number>();
  const entered = new Set<string>();
  let points: TrackEvents["points"] = [];
  let pricing: TrackEvents["pricing"] = [];

  const visibleBlocks = new Set<string>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.blockId;
        if (!id) continue;
        if (e.isIntersecting && e.intersectionRatio >= 0.5) {
          if (!visibleBlocks.has(id)) entered.add(id);
          visibleBlocks.add(id);
        } else visibleBlocks.delete(id);
      }
    },
    { threshold: [0, 0.5, 1] },
  );
  const observeBlocks = () => opts.root.querySelectorAll<HTMLElement>("[data-block-id]").forEach((el) => observer.observe(el));
  observeBlocks();

  const isActive = (now: number) => document.visibilityState === "visible" && now - lastInput < ACTIVE_WINDOW_MS;
  const markInput = () => {
    lastInput = Date.now();
  };

  const onScroll = () => {
    markInput();
    const doc = document.documentElement;
    const pct = Math.round(((window.scrollY + window.innerHeight) / Math.max(1, doc.scrollHeight)) * 100);
    maxScroll = Math.max(maxScroll, Math.min(100, pct));
  };
  onScroll();

  const pointFor = (e: PointerEvent | MouseEvent, kind: "click" | "tap" | "move") => {
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-block-id]");
    if (!el || pointsSent + points.length >= MAX_POINTS_TOTAL) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    points.push({ blockId: el.dataset.blockId!, kind, x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) });
  };
  const onPointerDown = (e: PointerEvent) => {
    markInput();
    pointFor(e, e.pointerType === "mouse" ? "click" : "tap");
  };
  let lastMove = { t: 0, x: -999, y: -999 };
  const onMouseMove = (e: MouseEvent) => {
    markInput();
    if (device !== "desktop") return;
    const now = Date.now();
    if (now - lastMove.t < MOVE_SAMPLE_MS || Math.hypot(e.clientX - lastMove.x, e.clientY - lastMove.y) < MOVE_MIN_PX) return;
    lastMove = { t: now, x: e.clientX, y: e.clientY };
    pointFor(e, "move");
  };

  const tick = () => {
    const now = Date.now();
    const dt = Math.min(now - lastTick, 5_000);
    lastTick = now;
    if (isActive(now)) {
      activeMs += dt;
      for (const id of visibleBlocks) blockMs.set(id, (blockMs.get(id) ?? 0) + dt);
    }
    if (!sessionId && visibleSince !== null && visibleTotal + (now - visibleSince) >= SESSION_DELAY_MS) void begin();
  };

  const payload = (): TrackEvents | null => {
    if (!sessionId) return null;
    const ids = new Set([...blockMs.keys(), ...entered]);
    const batch: TrackEvents = {
      sessionId,
      blockStats: [...ids].map((id) => ({ blockId: id, visibleMsDelta: Math.round(blockMs.get(id) ?? 0), entered: entered.has(id) })),
      points: points.slice(0, MAX_POINTS_PER_BATCH),
      pricing,
      activeMsDelta: Math.round(activeMs),
      maxScrollPct: maxScroll,
    };
    if (!batch.blockStats.length && !batch.points.length && !batch.pricing.length && !batch.activeMsDelta) return null;
    pointsSent += batch.points.length;
    points = points.slice(MAX_POINTS_PER_BATCH);
    pricing = [];
    activeMs = 0;
    blockMs.clear();
    entered.clear();
    return batch;
  };

  const flush = (beacon = false) => {
    const batch = payload();
    if (!batch) return;
    const body = JSON.stringify(batch);
    // text/plain keeps sendBeacon a "simple" request; the Worker parses the text.
    if (beacon && navigator.sendBeacon?.("/t/events", new Blob([body], { type: "text/plain" }))) return;
    void fetch("/t/events", { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(() => {});
  };

  async function begin() {
    if (sessionId || stopped) return;
    sessionId = "pending";
    try {
      const res = await fetch("/t/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: opts.slug, version: opts.version, visitorId: visitorId(), device, viewportW: innerWidth, viewportH: innerHeight, referrer: document.referrer || undefined }),
      });
      const r = res.ok ? ((await res.json()) as { sessionId: string; tracking: boolean }) : null;
      if (!r?.tracking) return stop();
      sessionId = r.sessionId;
      flush();
    } catch {
      stop();
    }
  }

  const onVisibility = () => {
    const now = Date.now();
    if (document.visibilityState === "visible") {
      visibleSince = now;
      markInput();
    } else {
      if (visibleSince !== null) visibleTotal += now - visibleSince;
      visibleSince = null;
      tick();
      flush(true);
    }
  };
  const onPageHide = () => {
    tick();
    flush(true);
  };

  const inputEvents = ["keydown", "wheel", "touchstart"] as const;
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("pointerdown", onPointerDown, { passive: true });
  window.addEventListener("mousemove", onMouseMove, { passive: true });
  inputEvents.forEach((ev) => window.addEventListener(ev, markInput, { passive: true }));
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  const ticker = setInterval(tick, TICK_MS);
  const flusher = setInterval(() => {
    tick();
    flush();
  }, FLUSH_MS);
  // Blocks can render after the tracker starts (lazy images, fonts): re-scan briefly.
  const rescan = setTimeout(observeBlocks, 1_500);

  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(ticker);
    clearInterval(flusher);
    clearTimeout(rescan);
    observer.disconnect();
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("mousemove", onMouseMove);
    inputEvents.forEach((ev) => window.removeEventListener(ev, markInput));
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
  }

  return {
    pricing: (sectionId, itemId, action) => {
      markInput();
      pricing.push({ sectionId, itemId, action });
    },
    stop: () => {
      tick();
      flush(true);
      stop();
    },
  };
}
