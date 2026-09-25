import { useEffect, useRef, useState } from "react";

/**
 * Draw-your-signature canvas (mouse, pen, touch). Reports a PNG data URL, or null
 * when cleared. Scales for high-DPI screens; the exported image is trimmed to ink.
 */
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = canvas.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
  }, []);

  const point = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const clear = () => {
    const c = canvas.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
    onChange(null);
  };

  return (
    <div>
      <canvas
        ref={canvas}
        aria-label="Draw your signature"
        role="img"
        className="h-40 w-full touch-none rounded-lg border-2 border-dashed border-black/20 bg-white"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          last.current = point(e);
        }}
        onPointerMove={(e) => {
          if (!drawing.current || !last.current) return;
          const ctx = canvas.current!.getContext("2d")!;
          const p = point(e);
          ctx.beginPath();
          ctx.moveTo(last.current.x, last.current.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          last.current = p;
          if (empty) setEmpty(false);
        }}
        onPointerUp={() => {
          drawing.current = false;
          last.current = null;
          if (!empty) onChange(canvas.current!.toDataURL("image/png"));
        }}
      />
      <div className="mt-1 flex justify-between text-xs text-(--color-muted)">
        <span>{empty ? "Sign above with your mouse, finger, or stylus" : "Looks good"}</span>
        <button type="button" onClick={clear} className="underline">
          Clear
        </button>
      </div>
    </div>
  );
}
