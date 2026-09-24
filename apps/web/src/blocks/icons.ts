/** Named icons for deliverables. Stored by name in content so AI authors can pick them. */
export const DELIVERABLE_ICONS: Record<string, string> = {
  check: "✓",
  video: "🎬",
  film: "🎞️",
  camera: "📷",
  calendar: "📅",
  mic: "🎙️",
  chart: "📈",
  sparkles: "✨",
  scissors: "✂️",
  globe: "🌐",
  pencil: "✏️",
  megaphone: "📣",
  target: "🎯",
  rocket: "🚀",
};
export const iconFor = (name?: string) => (name && DELIVERABLE_ICONS[name]) ?? DELIVERABLE_ICONS.check!;
