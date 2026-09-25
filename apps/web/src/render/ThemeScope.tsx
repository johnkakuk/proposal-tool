import { resolveTheme, themeToCssVars, type Theme, type ThemeOverrides } from "@bridger/shared";
import { createContext, useContext, useEffect, type CSSProperties, type ReactNode } from "react";

export const FALLBACK_THEME: Theme = {
  colors: { primary: "#0F2A44", accent: "#E07A1F", background: "#FFFFFF", text: "#1B1F24" },
  headingFont: "Playfair Display",
  bodyFont: "Inter",
};

/** Loads Google Fonts once per family set. */
export function useGoogleFonts(families: string[]) {
  const key = families.join("|");
  useEffect(() => {
    const id = `gf-${key.replace(/\W+/g, "-")}`;
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?${families.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;600;700`).join("&")}&display=swap`;
    document.head.appendChild(link);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

const ThemeVarsContext = createContext<CSSProperties | undefined>(undefined);

/** The enclosing theme's CSS variables, for content portaled outside the scope (modals). */
export function useThemeVars(): CSSProperties | undefined {
  return useContext(ThemeVarsContext);
}

/** Applies brand theme + per-proposal overrides as CSS variables (SPEC §5.4). */
export function ThemeScope({ theme, overrides, children, className }: { theme?: Theme | null; overrides?: ThemeOverrides; children: ReactNode; className?: string }) {
  const resolved = resolveTheme(theme ?? FALLBACK_THEME, overrides);
  useGoogleFonts([...new Set([resolved.headingFont, resolved.bodyFont])]);
  const vars = themeToCssVars(resolved) as CSSProperties;
  return (
    <ThemeVarsContext.Provider value={vars}>
      <div className={`proposal-theme ${className ?? ""}`} style={vars}>
        {children}
      </div>
    </ThemeVarsContext.Provider>
  );
}
