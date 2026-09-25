import { resolveTheme, themeToCssVars, type Theme, type ThemeOverrides } from "@bridger/shared";
import { createContext, useContext, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Preloader } from "../components/Preloader";

export const FALLBACK_THEME: Theme = {
  colors: { primary: "#0F2A44", accent: "#E07A1F", background: "#FFFFFF", text: "#1B1F24" },
  headingFont: "Playfair Display",
  bodyFont: "Inter",
};

const DEFAULT_WEIGHTS = [400, 600, 700];
/** How long a slow font may hold back the page before it shows in the fallback font. */
const FONT_WAIT_MS = 2500;
const fontLoads = new Map<string, Promise<void>>();

/**
 * Loads Google Fonts once per family set and resolves when they're usable (stylesheet
 * loaded, then each weight fetched), or after FONT_WAIT_MS, whichever comes first.
 * Never rejects: a font failure just means the fallback font.
 */
export function loadGoogleFonts(families: string[], { weights = DEFAULT_WEIGHTS, fetchFaces: eager = true }: { weights?: number[]; fetchFaces?: boolean } = {}): Promise<void> {
  const key = `${families.join("|")}@${weights.join(",")}${eager ? "" : ":lazy"}`;
  let done = fontLoads.get(key);
  if (done) return done;
  const ready = new Promise<void>((resolve) => {
    const id = `gf-${`${families.join("|")}@${weights.join(",")}`.replace(/\W+/g, "-")}`;
    // Lazy: the stylesheet is enough; the browser fetches each face when text uses it.
    const fetchFaces = () =>
      eager ? void Promise.all(families.flatMap((f) => weights.map((w) => document.fonts.load(`${w} 1em "${f}"`)))).then(() => resolve(), () => resolve()) : resolve();
    const existing = document.getElementById(id) as HTMLLinkElement | null;
    if (existing) {
      if (existing.sheet) fetchFaces();
      else existing.addEventListener("load", fetchFaces, { once: true });
      existing.addEventListener("error", () => resolve(), { once: true });
      return;
    }
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?${families.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@${weights.join(";")}`).join("&")}&display=swap`;
    link.addEventListener("load", fetchFaces, { once: true });
    link.addEventListener("error", () => resolve(), { once: true });
    document.head.appendChild(link);
  });
  done = Promise.race([ready, new Promise<void>((r) => setTimeout(r, FONT_WAIT_MS))]);
  fontLoads.set(key, done);
  return done;
}

/** Loads fonts; returns true once they're ready (or the wait timed out). */
export function useGoogleFonts(families: string[], opts?: { weights?: number[]; fetchFaces?: boolean }): boolean {
  const key = `${families.join("|")}@${opts?.weights?.join(",") ?? ""}${opts?.fetchFaces === false ? ":lazy" : ""}`;
  const [readyKey, setReadyKey] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void loadGoogleFonts(families, opts).then(() => {
      if (live) setReadyKey(key);
    });
    return () => {
      live = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return readyKey === key;
}

/**
 * Shows the preloader until `families` are loaded, then fades the content in, so text
 * never renders in a fallback font and then jumps. Children stay mounted (hidden) while
 * waiting, so editors and trackers keep their state.
 */
export function FontGate({ families, weights, fullScreen = false, children }: { families: string[]; weights?: number[]; fullScreen?: boolean; children: ReactNode }) {
  const ready = useGoogleFonts(families, { weights });
  return (
    <div className="relative">
      {!ready && <Preloader label="Loading fonts" fullScreen={fullScreen} className={fullScreen ? "" : "absolute inset-x-0 top-0"} />}
      <div aria-hidden={!ready || undefined} className={`transition-opacity duration-300 motion-reduce:transition-none ${ready ? "opacity-100" : "invisible opacity-0"}`}>
        {children}
      </div>
    </div>
  );
}

const ThemeVarsContext = createContext<CSSProperties | undefined>(undefined);

/** The enclosing theme's CSS variables, for content portaled outside the scope (modals). */
export function useThemeVars(): CSSProperties | undefined {
  return useContext(ThemeVarsContext);
}

/** Applies brand theme + per-proposal overrides as CSS variables (SPEC §5.4). */
export function ThemeScope({ theme, overrides, children, className, gate = true, fullScreen = false }: { theme?: Theme | null; overrides?: ThemeOverrides; children: ReactNode; className?: string; gate?: boolean; fullScreen?: boolean }) {
  const resolved = resolveTheme(theme ?? FALLBACK_THEME, overrides);
  const families = [...new Set([resolved.headingFont, resolved.bodyFont])];
  useGoogleFonts(families);
  const vars = themeToCssVars(resolved) as CSSProperties;
  return (
    <ThemeVarsContext.Provider value={vars}>
      <div className={`proposal-theme ${className ?? ""}`} style={vars}>
        {gate ? (
          <FontGate families={families} fullScreen={fullScreen}>
            {children}
          </FontGate>
        ) : (
          children
        )}
      </div>
    </ThemeVarsContext.Provider>
  );
}
