import { notFound } from "next/navigation";
import Link from "next/link";
import { AnswerMarkdown, AnswerSources } from "@/components/ask/AnswerContent";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Local answer design preview",
  robots: { index: false, follow: false },
};
const sample = `## Finding your way through a judgment

A useful research answer gives you a clear explanation **and a path back to the original source**. This preview demonstrates the layout with example text; it is not a legal conclusion.

### Three things to look for

1. **The issue** — what question did the court need to decide?
2. **The reasoning** — which facts, rules, and earlier cases mattered?
3. **The outcome** — what did the court ultimately order?

For an example of a full judgment, open [2010 SGCA 26](/judgment/2010_SGCA_26). Citations stay beside the text, and the source is also collected below.

> Read the relevant paragraphs in context. A short explanation is a starting point for research, not a substitute for the judgment.

You can save useful answers, copy the text, or export it using the controls in a real conversation.`;
export default function Preview() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <main className="mx-auto w-full max-w-[880px] px-5 py-10">
      <p className="garden-kicker">LOCAL DESIGN PREVIEW · SAMPLE CONTENT</p>
      <div className="flex justify-end my-7">
        <p className="rounded-2xl border border-border bg-surface-2 px-5 py-3 text-sm">
          How should I read a Singapore judgment?
        </p>
      </div>
      <div className="answer-header text-sm mb-4">
        ✦ Lawplain <small>Research companion</small>
      </div>
      <details className="answer-research mb-4">
        <summary>
          <span className="research-complete">✓</span>Research activity{" "}
          <span>· Example presentation</span>
        </summary>
        <p className="text-xs text-muted">
          In a live answer, this panel shows the research steps reported by the
          agent.
        </p>
      </details>
      <article className="answer-sheet">
        <AnswerMarkdown text={sample} />
      </article>
      <AnswerSources text={sample} />
      <div className="flex justify-between mt-6 text-xs text-muted">
        <span>Sample answer · Layout preview only</span>
        <Link href="/ask">Try Ask Lawplain ↗</Link>
      </div>
    </main>
  );
}
