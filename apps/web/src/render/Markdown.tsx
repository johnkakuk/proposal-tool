import ReactMarkdown from "react-markdown";

/**
 * Renders the limited Markdown subset (SPEC §5.2): headings, bold, italic, links,
 * lists, blockquotes. Raw HTML is never rendered; other elements are unwrapped to text.
 */
const ALLOWED = ["p", "strong", "em", "a", "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "h4", "br"];

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={`proposal-prose ${className ?? ""}`}>
      <ReactMarkdown
        allowedElements={ALLOWED}
        unwrapDisallowed
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
