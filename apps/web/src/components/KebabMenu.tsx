import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface MenuAction {
  label: string;
  onSelect: () => void;
  /** Destructive: shown in red, separated from the rest. */
  danger?: boolean;
  disabled?: boolean;
  /** Why it's disabled (tooltip). */
  hint?: string;
}

/**
 * Row actions menu (⋮). Rendered in a portal so table overflow can't clip it.
 * Keyboard: Enter/Space/↓ opens, ↑/↓ move, Home/End jump, Esc closes, Tab leaves.
 */
export function KebabMenu({ label, actions }: { label: string; actions: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const safe = actions.filter((a) => !a.danger);
  const danger = actions.filter((a) => a.danger);
  const ordered = [...safe, ...danger];
  const enabled = ordered.map((a, i) => (a.disabled ? -1 : i)).filter((i) => i >= 0);

  useLayoutEffect(() => {
    if (!open || !button.current || !menu.current) return;
    return autoUpdate(button.current, menu.current, () => {
      if (!button.current || !menu.current) return;
      void computePosition(button.current, menu.current, { placement: "bottom-end", strategy: "fixed", middleware: [offset(4), flip(), shift({ padding: 8 })] }).then(({ x, y }) => {
        if (menu.current) Object.assign(menu.current.style, { left: `${x}px`, top: `${y}px` });
      });
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.focus();
  }, [open, active]);

  const show = () => {
    setActive(enabled[0] ?? 0);
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  const move = (d: 1 | -1) => {
    const at = enabled.indexOf(active);
    setActive(enabled[(at + d + enabled.length) % enabled.length] ?? 0);
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(e) => {
          e.stopPropagation();
          open ? close() : show();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            show();
          }
        }}
        className="inline-flex size-8 items-center justify-center rounded-md text-lg leading-none text-slate-500 hover:bg-slate-100 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
      >
        ⋮
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={id}
            role="menu"
            aria-label={label}
            className="fixed left-0 top-0 z-50 w-52 rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-lg"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") (e.preventDefault(), move(1));
              else if (e.key === "ArrowUp") (e.preventDefault(), move(-1));
              else if (e.key === "Home") (e.preventDefault(), setActive(enabled[0] ?? 0));
              else if (e.key === "End") (e.preventDefault(), setActive(enabled.at(-1) ?? 0));
              else if (e.key === "Escape") (e.preventDefault(), close());
              else if (e.key === "Tab") close(false);
            }}
          >
            {ordered.map((a, i) => (
              <div key={a.label}>
                {a.danger && i === safe.length && safe.length > 0 && <hr className="my-1 border-slate-100" />}
                <button
                  type="button"
                  role="menuitem"
                  data-index={i}
                  tabIndex={i === active ? 0 : -1}
                  disabled={a.disabled}
                  title={a.disabled ? a.hint : undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    close(false);
                    a.onSelect();
                  }}
                  className={`block w-full rounded px-3 py-1.5 text-left outline-none disabled:cursor-not-allowed disabled:opacity-40 ${
                    a.danger ? "text-red-600 hover:bg-red-50 focus:bg-red-50" : "text-ink hover:bg-slate-100 focus:bg-slate-100"
                  }`}
                >
                  {a.label}
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
