import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon } from "@/components/icons";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "FAQ & Help",
  description:
    "How to search Singapore law on Lawplain, ask plain-English questions, save and resume research threads, and use the API.",
  path: "/faq",
});

type QA = { q: string; a: React.ReactNode };
type Section = { id: string; title: string; items: QA[] };

const SECTIONS: Section[] = [
  {
    id: "search",
    title: "Searching",
    items: [
      {
        q: "What can I search?",
        a: (
          <>
            Singapore{" "}
            <strong>
              judgments, statutes, subsidiary legislation, Hansard, bills
            </strong>{" "}
            and <strong>practice directions</strong>. Pick a tab under the
            search box; results are full-text ranked (relevance, with the
            matched phrase highlighted).
          </>
        ),
      },
      {
        q: "How do I narrow results?",
        a: (
          <>
            Open <strong>Filters</strong> under the tabs to limit by court, year
            range, judge, speaker and more (filters vary by tab). Search updates
            as you type — three characters or more.
          </>
        ),
      },
      {
        q: "Why did a search briefly take a while?",
        a: (
          <>
            The corpus API can be cold after a quiet spell; the first request
            warms it and the rest are fast. Repeated queries are also cached at
            the edge.
          </>
        ),
      },
    ],
  },
  {
    id: "ask",
    title: "Ask Lawplain",
    items: [
      {
        q: "What is Ask Lawplain?",
        a: (
          <>
            Ask a question in plain English (e.g.{" "}
            <em>“What must a plaintiff prove in a defamation claim?”</em>). An
            agent runs real searches across the corpus, then writes a{" "}
            <strong>cited</strong> answer that streams back. Open it from{" "}
            <Link href="/ask" className="text-accent underline">
              Ask Lawplain
            </Link>{" "}
            in the nav.
          </>
        ),
      },
      {
        q: "Can I trust the citations?",
        a: (
          <>
            The agent is instructed to cite its sources and to never fabricate
            citations or section numbers — if the corpus doesn’t contain the
            answer, it says so. It’s legal{" "}
            <strong>information, not advice</strong>; verify against the primary
            source.
          </>
        ),
      },
      {
        q: "It takes a little while — is that normal?",
        a: (
          <>
            Yes. A full answer is several search-and-read steps, so expect
            roughly 20–60 seconds. The page streams text and shows each search
            as it runs.
          </>
        ),
      },
    ],
  },
  {
    id: "threads",
    title: "Saving & resuming research",
    items: [
      {
        q: "Do my conversations stick around?",
        a: (
          <>
            Yes — each thread gets its own address like{" "}
            <span className="font-mono">/ask/&lt;id&gt;</span>. Leave and come
            back to the same URL and the conversation is restored. Open{" "}
            <strong>History</strong> (the left sidebar in Ask) to browse, search
            and reopen past threads.
          </>
        ),
      },
      {
        q: "I started a question, then opened it in another tab — will I see it?",
        a: (
          <>
            Yes. A running thread shows a <strong>“researching…”</strong> badge
            and reconnects to the live run in any of your tabs, so you can
            follow it or close the original and come back. Only you can see your
            own threads.
          </>
        ),
      },
      {
        q: "Can I keep specific answers or authorities?",
        a: (
          <>
            Yes — save answers and authorities to your{" "}
            <Link href="/saved" className="text-accent underline">
              Saved
            </Link>{" "}
            workspace, and copy or export answers from the Ask page.
          </>
        ),
      },
    ],
  },
  {
    id: "api",
    title: "API access",
    items: [
      {
        q: "Can my own agent or script use this?",
        a: (
          <>
            Yes. Create a personal API key on the{" "}
            <Link href="/developers" className="text-accent underline">
              Developers
            </Link>{" "}
            page and call the read-only corpus API with it:
            <code className="mt-2 block overflow-x-auto rounded-lg border border-border bg-surface-2/50 px-3 py-2 font-mono text-[13px]">
              curl -H &quot;Authorization: Bearer lp_live_…&quot;
              &quot;https://lawplain.com/api/v1/judgments/search?q=negligence&quot;
            </code>
          </>
        ),
      },
      {
        q: "What can the key do?",
        a: (
          <>
            It grants read-only (GET) access to the same endpoints the app uses
            — judgments, statutes, Hansard, bills, subsidiary legislation and
            practice directions. Keys are shown once at creation and can be
            revoked anytime.
          </>
        ),
      },
    ],
  },
  {
    id: "accounts",
    title: "Accounts",
    items: [
      {
        q: "Do I need an account?",
        a: (
          <>
            Searching is open to everyone. An account (a{" "}
            <Link href="/sign-up" className="text-accent underline">
              username and password
            </Link>
            ) unlocks Ask Lawplain, saved threads, a saved workspace and API
            keys.
          </>
        ),
      },
    ],
  },
];

export default function FaqPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 pb-16 sm:px-8">
      <div className="pt-6 sm:pt-8">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-2 transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to search
        </Link>
      </div>

      <header className="mt-6">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">
          FAQ &amp; Help
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          How to get around Lawplain — searching, asking questions, saving your
          research, and using the API.
        </p>
        <nav className="mt-4 flex flex-wrap gap-2">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="rounded-full border border-border bg-surface-2/50 px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-border-strong hover:text-foreground"
            >
              {s.title}
            </a>
          ))}
        </nav>
      </header>

      <div className="mt-8 flex flex-col gap-10">
        {SECTIONS.map((s) => (
          <section key={s.id} id={s.id} className="scroll-mt-20">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-2">
              {s.title}
            </h2>
            <dl className="mt-3 flex flex-col divide-y divide-border rounded-xl border border-border">
              {s.items.map((item) => (
                <div key={item.q} className="px-4 py-4">
                  <dt className="text-sm font-medium text-foreground">
                    {item.q}
                  </dt>
                  <dd className="mt-1.5 text-sm leading-relaxed text-muted">
                    {item.a}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>

      <p className="mt-10 text-xs leading-relaxed text-muted-2">
        Lawplain provides read-only legal information, not legal advice. Always
        verify against the primary source before relying on anything here.
      </p>
    </main>
  );
}
