import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyCodeBlock } from "@/components/CopyCodeBlock";
import { MCP_ENDPOINT, MCP_GUIDE } from "@/lib/mcp-guide";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "MCP documentation — connect your legal research agent",
  description:
    "Connect Codex, Claude Code, Cursor or your own agent to Lawplain. Setup, authentication, tool reference and an agent-readable guide.",
  path: "/developers/mcp",
});

const sections = MCP_GUIDE.split(/\n## /).slice(1);
const anchor = (title: string) =>
  title.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export default function McpDocsPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 pb-20 sm:px-8">
      <Link
        href="/developers"
        className="mt-8 inline-block text-sm text-muted hover:text-foreground"
      >
        ← API & MCP access
      </Link>
      <header className="max-w-3xl py-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-2">
          Developer documentation
        </p>
        <h1 className="mt-3 font-serif text-4xl tracking-tight text-foreground sm:text-5xl">
          Singapore law, in your agent.
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-muted">
          Connect your agent to judgments, legislation and parliamentary records
          with eight read-only MCP tools.
        </p>
        <div className="mt-6 flex flex-wrap gap-3 text-sm">
          <Link
            href="/developers"
            className="rounded-lg bg-foreground px-4 py-2 text-background"
          >
            Manage MCP access
          </Link>
          <a
            href="/developers/mcp/llms.txt"
            className="rounded-lg border border-border px-4 py-2"
          >
            Read agent guide ↗
          </a>
        </div>
        <div className="mt-6">
          <CopyCodeBlock text={MCP_ENDPOINT} />
        </div>
      </header>
      <div className="grid items-start gap-10 lg:grid-cols-[190px_minmax(0,1fr)]">
        <nav
          aria-label="On this page"
          className="flex flex-wrap gap-x-5 gap-y-3 border-t border-border pt-5 text-sm lg:sticky lg:top-20 lg:flex-col"
        >
          {sections.map((section) => {
            const title = section.split("\n")[0];
            return (
              <a
                key={title}
                href={`#${anchor(title)}`}
                className="text-muted hover:text-foreground"
              >
                {title}
              </a>
            );
          })}
        </nav>
        <article className="min-w-0 max-w-3xl">
          {sections.map((section) => {
            const title = section.split("\n")[0];
            return (
              <section
                key={title}
                id={anchor(title)}
                className="scroll-mt-24 border-t border-border pb-9 pt-5"
              >
                <h2 className="mb-4 font-serif text-2xl text-foreground">
                  {title}
                </h2>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    p: ({ children }) => (
                      <p className="my-3 text-sm leading-7 text-muted">
                        {children}
                      </p>
                    ),
                    a: ({ href, children }) => (
                      <a
                        href={href}
                        className="underline underline-offset-4 hover:text-foreground"
                      >
                        {children}
                      </a>
                    ),
                    ol: ({ children }) => (
                      <ol className="my-3 list-decimal space-y-2 pl-5 text-sm leading-7 text-muted">
                        {children}
                      </ol>
                    ),
                    pre: ({ children }) => <>{children}</>,
                    code: ({ children }) => (
                      <CopyCodeBlock
                        text={String(children).replace(/\n$/, "")}
                      />
                    ),
                    table: ({ children }) => (
                      <div className="my-4 overflow-x-auto rounded-lg border border-border">
                        <table className="w-full min-w-[640px] text-left text-sm">
                          {children}
                        </table>
                      </div>
                    ),
                    th: ({ children }) => (
                      <th className="border-b border-border bg-surface-2/50 px-3 py-3 font-medium">
                        {children}
                      </th>
                    ),
                    td: ({ children }) => (
                      <td className="border-b border-border px-3 py-3 align-top leading-6 text-muted">
                        {children}
                      </td>
                    ),
                  }}
                >
                  {section.slice(title.length)}
                </ReactMarkdown>
              </section>
            );
          })}
        </article>
      </div>
    </main>
  );
}
