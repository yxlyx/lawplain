"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { answerSources } from "@/lib/answer-sources";

const mdComponents: Components = {
  h1: ({ children }) => (
    <h2 className="mt-1 font-serif text-xl font-semibold text-foreground">
      {children}
    </h2>
  ),
  h2: ({ children }) => (
    <h2 className="mt-1 font-serif text-lg font-semibold text-foreground">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-1 font-serif text-base font-semibold text-foreground">
      {children}
    </h3>
  ),
  p: ({ children }) => <p className="leading-relaxed">{children}</p>,
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => {
    const h = href ?? "";
    const internal = h.startsWith("/") || h.startsWith("#");
    return (
      <a
        href={h}
        className="text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
        {...(internal ? {} : { target: "_blank", rel: "noreferrer noopener" })}
      >
        {children}
      </a>
    );
  },
  ol: ({ children }) => <ol className="ask-ol space-y-1.5">{children}</ol>,
  ul: ({ children }) => (
    <ul className="ask-ul space-y-1.5 pl-5 marker:text-accent">{children}</ul>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  code: ({ className, children }) =>
    (className ?? "").includes("language-") ? (
      <code className="font-mono text-[13px]">{children}</code>
    ) : (
      <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em] text-foreground">
        {children}
      </code>
    ),
  pre: ({ children }) => (
    <pre className="thin-scroll overflow-x-auto rounded-lg bg-surface-2 p-3 text-[13px]">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-3 text-muted">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-border" />,
  table: ({ children }) => (
    <div className="thin-scroll overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border bg-surface-2 px-2 py-1 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-2 py-1 align-top">{children}</td>
  ),
};

export const AnswerMarkdown = memo(function AnswerMarkdown({
  text,
}: {
  text: string;
}) {
  return (
    <div className="ask-md space-y-3">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
});

// Source cards follow Beautiful UI's streaming-answer pattern. Each card is
// derived from an actual citation link in the answer; no source is invented.
export function AnswerSources({ text }: { text: string }) {
  const sources = answerSources(text);
  if (!sources.length) return null;
  return (
    <nav className="answer-sources" aria-label="Sources cited in this answer">
      <p>
        SOURCES TO EXPLORE <span>{sources.length}</span>
      </p>
      <div>
        {sources.map((source, i) => (
          <a key={source.href} href={source.href}>
            <span className="answer-source-number">{i + 1}</span>
            <span>
              <strong>{source.label}</strong>
              <small>{source.kind}</small>
            </span>
            <span aria-hidden="true">↗</span>
          </a>
        ))}
      </div>
    </nav>
  );
}
