import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyActions } from "@/components/CopyActions";
import { HighlightSaver } from "@/components/HighlightSaver";
import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  SparkleIcon,
} from "@/components/icons";
import { SavedAuthorityButton } from "@/components/SavedAuthorityButton";
import { StatuteSectionShell } from "@/components/StatuteSectionShell";
import { statuteSectionPinpointLabel } from "@/lib/citations";
import {
  ApiError,
  type StatuteDetail,
  sgjudge,
  sortStatuteSections,
  statuteSectionText,
} from "@/lib/sgjudge";

async function load(reference: string): Promise<StatuteDetail> {
  try {
    return await sgjudge.getStatute(
      reference,
      { include_body: true },
      { cache: "no-store" },
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
}

function safeReturnTo(value?: string): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ reference: string }>;
}): Promise<Metadata> {
  const { reference } = await params;
  const decoded = decodeURIComponent(reference);
  try {
    const s = await sgjudge.getStatute(decoded, {}, { cache: "no-store" });
    return { title: `${s.short_title || decoded} — Lawplain` };
  } catch {
    return { title: `${decoded} — Lawplain` };
  }
}

export default async function StatutePage({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  searchParams: Promise<{ q?: string; returnTo?: string }>;
}) {
  const [{ reference }, { q = "", returnTo }] = await Promise.all([
    params,
    searchParams,
  ]);
  const decoded = decodeURIComponent(reference);
  const s = await load(decoded);
  const sections = sortStatuteSections(s.sections);
  const title = s.short_title || s.act_id || decoded;
  const pagePath = `/statute/${encodeURIComponent(decoded)}`;
  const source = {
    kind: "statute" as const,
    title,
    reference: s.act_id ?? decoded,
    year: s.year_enacted,
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8">
      <Link
        href={safeReturnTo(returnTo) ?? "/?tab=statutes"}
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to search
      </Link>

      <header className="border-b border-border pb-6">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded bg-primary px-2 py-0.5 font-mono font-medium text-primary-fg">
            {s.act_id ?? decoded}
          </span>
          {s.kind && <span className="text-muted">{s.kind}</span>}
          {s.year_enacted && (
            <span className="text-muted-2">· {s.year_enacted}</span>
          )}
        </div>
        <h1 className="font-serif text-2xl font-medium leading-tight tracking-tight text-foreground sm:text-3xl">
          {title}
        </h1>

        {typeof s.url === "string" && (
          <a
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-border-strong px-3.5 py-2 text-sm font-medium text-muted transition-colors hover:border-accent hover:text-foreground"
          >
            <ExternalLinkIcon className="h-4 w-4" />
            View official text on Singapore Statutes Online
          </a>
        )}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <CopyActions source={source} path={pagePath} />

          <SavedAuthorityButton
            docType="statute"
            docId={decoded}
            title={title}
            path={pagePath}
          />
          <Link
            href={`/ask?cite=${encodeURIComponent(decoded)}&kind=statute`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft px-3.5 py-2 text-sm font-medium text-accent transition-colors hover:border-accent hover:bg-accent hover:text-primary-fg"
          >
            <SparkleIcon className="h-4 w-4" />
            Ask Lawplain about this
          </Link>
        </div>
      </header>

      <div className="mt-8">
        <StatuteSectionShell
          docId={decoded}
          query={q}
          sections={sections.map((sec) => ({
            id: `s-${sec.section_no}`,
            label: sec.heading
              ? `${sec.section_no} — ${sec.heading}`
              : sec.section_no,
          }))}
        >
          <HighlightSaver
            docType="statute"
            docId={decoded}
            title={title}
            path={pagePath}
            className="flex flex-col gap-8"
          >
            {sections.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border-strong bg-surface p-8 text-center text-sm text-muted">
                No section text available for this statute.
              </p>
            ) : (
              sections.map((sec) => {
                const text = statuteSectionText(sec);
                return (
                  <article
                    key={sec.section_no}
                    id={`s-${sec.section_no}`}
                    data-section-id={`s-${sec.section_no}`}
                    className="scroll-mt-24"
                  >
                    <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <h3 className="font-serif text-lg font-semibold text-foreground">
                        <span className="text-accent">§ {sec.section_no}</span>
                        {sec.heading ? ` — ${sec.heading}` : ""}
                      </h3>
                      <CopyActions
                        source={{
                          ...source,
                          pinpoint: statuteSectionPinpointLabel(sec.section_no),
                        }}
                        path={`${pagePath}#s-${sec.section_no}`}
                        citationLabel="Copy section"
                        compact
                      />
                    </div>
                    {text && (
                      <p className="whitespace-pre-wrap text-[15px] leading-7 text-foreground/90">
                        {text}
                      </p>
                    )}
                  </article>
                );
              })
            )}
          </HighlightSaver>
        </StatuteSectionShell>
      </div>
    </main>
  );
}
