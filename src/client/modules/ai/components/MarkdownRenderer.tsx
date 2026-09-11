import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function unescapeMarkdown(text: string): string {
  return text.replace(/\\([!*[\]()#>_~`|])/g, "$1");
}

export function MarkdownRenderer({ content, className = "" }: { content: string; className?: string }) {
  return (
    <div class={`chat-md ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ src, alt }) => (
            <a href={src} target="_blank" rel="noopener noreferrer">
              <img src={src} alt={alt || ""} loading="lazy" />
            </a>
          ),
          code: ({ className: codeClass, children }) => (
            <code class={codeClass}>{children}</code>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
