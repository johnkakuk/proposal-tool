import { useRenderContext } from "../render/RenderContext";
import { OptionalTextInput, TextInput } from "./fields";
import type { BlockUI } from "./types";

/** Converts a YouTube, Vimeo, or Loom share URL into its embed URL. */
export function videoEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return `https://www.youtube-nocookie.com/embed/${u.pathname.slice(1)}`;
    if (host === "youtube.com" || host === "m.youtube.com") {
      const id = u.searchParams.get("v") ?? /^\/(?:embed|shorts)\/([\w-]+)/.exec(u.pathname)?.[1];
      return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    }
    if (host === "vimeo.com" || host === "player.vimeo.com") {
      const id = /(\d+)/.exec(u.pathname)?.[1];
      return id ? `https://player.vimeo.com/video/${id}` : null;
    }
    if (host === "loom.com") {
      const id = /^\/(?:share|embed)\/([\w-]+)/.exec(u.pathname)?.[1];
      return id ? `https://www.loom.com/embed/${id}` : null;
    }
  } catch {
    /* not a URL */
  }
  return null;
}

function VideoRenderer({ props }: { props: { url: string; caption?: string } }) {
  const { mode } = useRenderContext();
  const embed = videoEmbedUrl(props.url);
  return (
    <figure className="mx-auto max-w-3xl">
      {!embed ? (
        <div className="flex aspect-video items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-400">Add a YouTube, Vimeo, or Loom link</div>
      ) : mode === "print" ? (
        <a href={props.url}>{props.url}</a>
      ) : (
        <div className="aspect-video overflow-hidden rounded-lg bg-black">
          {/* In the editor, clicks select the object instead of playing the video. */}
          <iframe src={embed} title={props.caption ?? "Video"} className={`size-full ${mode === "editor" ? "pointer-events-none" : ""}`} allow="fullscreen; picture-in-picture" loading="lazy" />
        </div>
      )}
      {props.caption && <figcaption className="mt-2 text-center text-sm opacity-70">{props.caption}</figcaption>}
    </figure>
  );
}

export const video: BlockUI<"video"> = {
  type: "video",
  menu: { description: "Embed a YouTube, Vimeo, or Loom video", icon: "▶️", keywords: ["youtube", "vimeo", "loom", "embed"], group: "Media" },
  Renderer: VideoRenderer,
  Editor: ({ props, onChange }) => (
    <div className="space-y-3">
      <TextInput label="Video URL" value={props.url} onChange={(url) => onChange({ ...props, url })} placeholder="https://www.youtube.com/watch?v=…" hint="YouTube, Vimeo, or Loom" />
      <OptionalTextInput label="Caption" value={props.caption} onChange={(caption) => onChange({ ...props, caption })} />
    </div>
  ),
};
