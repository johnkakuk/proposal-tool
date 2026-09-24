import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { SlashItem } from "./slashItems";

export interface SlashMenuHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

/** The "/" command menu. Arrow keys move, Enter/Tab inserts, Esc closes, typing filters. */
export const SlashMenu = forwardRef<SlashMenuHandle, { items: SlashItem[]; command: (item: SlashItem) => void; query: string }>(function SlashMenu(
  { items, command, query },
  ref,
) {
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const enabled = items.map((it, i) => (it.disabledReason ? -1 : i)).filter((i) => i >= 0);

  useEffect(() => setIndex(enabled[0] ?? 0), [query, items.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" }), [index]);

  const step = (d: 1 | -1) => {
    if (!enabled.length) return;
    const at = enabled.indexOf(index);
    setIndex(enabled[(at + d + enabled.length) % enabled.length]!);
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: (event) => {
      if (event.key === "ArrowDown") return step(1), true;
      if (event.key === "ArrowUp") return step(-1), true;
      if (event.key === "Enter" || event.key === "Tab") {
        const item = items[index];
        if (item && !item.disabledReason) command(item);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return <div className="w-72 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-500 shadow-lg">No matches for “{query}”</div>;
  }

  let lastGroup = "";
  return (
    <div ref={listRef} role="listbox" aria-label="Insert block" className="max-h-96 w-80 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
      {items.map((item, i) => {
        const header = item.group !== lastGroup ? item.group : null;
        lastGroup = item.group;
        return (
          <div key={item.id}>
            {header && <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{header}</div>}
            <button
              type="button"
              role="option"
              data-index={i}
              aria-selected={i === index}
              aria-disabled={Boolean(item.disabledReason)}
              disabled={Boolean(item.disabledReason)}
              onMouseEnter={() => !item.disabledReason && setIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                if (!item.disabledReason) command(item);
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left ${i === index ? "bg-brand/8" : ""} ${item.disabledReason ? "cursor-not-allowed opacity-40" : ""}`}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-sm font-semibold text-slate-600">{item.icon}</span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">{item.label}</span>
                <span className="block truncate text-xs text-slate-500">{item.disabledReason ?? item.description}</span>
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
});
