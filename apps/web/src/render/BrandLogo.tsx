import { pickLogo, type Theme } from "@bridger/shared";
import type { ReactNode } from "react";

/**
 * The owner's logo, in the version that reads on `surface` (a hex color): the light
 * logo on dark backgrounds, the main logo on light ones. If only the other version
 * exists, it's shown on a small contrasting plate. Renders `fallback` when there's no logo.
 */
export function BrandLogo({ theme, surface, alt, className, fallback }: { theme: Pick<Theme, "logoUrl" | "logoOnDarkUrl"> | null | undefined; surface: string; alt: string; className?: string; fallback?: ReactNode }) {
  const logo = pickLogo(theme, surface);
  if (!logo) return <>{fallback}</>;
  const img = <img src={logo.url} alt={alt} className={className} />;
  return logo.plate ? (
    <span className="inline-flex rounded-md px-2 py-1" style={{ background: logo.plate }}>
      {img}
    </span>
  ) : (
    img
  );
}
