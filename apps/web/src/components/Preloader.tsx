/**
 * The loading indicator used everywhere: before the app boots (a static copy lives in
 * index.html), while routes load, and while fonts load (FontGate). Honors reduced motion.
 */
export function Preloader({ label = "Loading", fullScreen = false, className = "" }: { label?: string; fullScreen?: boolean; className?: string }) {
  return (
    <div role="status" aria-label={label} className={`flex items-center justify-center ${fullScreen ? "fixed inset-0 z-40" : "py-16"} ${className}`}>
      <span className="bdp-spinner" aria-hidden />
    </div>
  );
}
