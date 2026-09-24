import { resolveTheme, themeToCssVars, type Theme, type ThemeOverrides } from "@bridger/shared";
import { useEffect, type CSSProperties, type ReactNode } from "react";

export const FALLBACK_THEME: Theme = {
  colors: { primary: "#0F2A44", accent: "#E07A1F", background: "#FFFFFF", text: "#1B1F24" },
  headingFont: "Playfair Display",
  bodyFont: "Inter",
};

/** Loads the theme's Google Fonts once per family pair. */
function useGoogleFonts(families: string[]) {
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

/** Applies brand theme + per-proposal overrides as CSS variables (SPEC §5.4). */
export function ThemeScope({ theme, overrides, children, className }: { theme?: Theme | null; overrides?: ThemeOverrides; children: ReactNode; className?: string }) {
  const resolved = resolveTheme(theme ?? FALLBACK_THEME, overrides);
  useGoogleFonts([...new Set([resolved.headingFont, resolved.bodyFont])]);
  return (
    <div className={`proposal-theme ${className ?? ""}`} style={themeToCssVars(resolved) as CSSProperties}>
      {children}
    </div>
  );
}
