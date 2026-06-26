import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyActions } from "@/components/CopyActions";
import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  SparkleIcon,
} from "@/components/icons";
import { SavedAuthorityButton } from "@/components/SavedAuthorityButton";
import { StatuteSectionShell } from "@/components/StatuteSectionShell";
import {
  ApiError,
  type StatuteDetail,
  sgjudge,
  sortStatuteSections,
  statuteSectionDisplayText,
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

function firstString(value?: string | string[]): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function provisionLevel(marker: string): number {
  const value = marker.slice(1, -1).toLowerCase();
  if (/^\d+$/.test(value)) return 0;
  if (
    /^(?=[mdclxvi])m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/.test(
      value,
    )
  ) {
    return 2;
  }
  return 1;
}

function provisionLines(text: string): string[] {
  return text
    .replace(/([.;:—–-])\s+(?=\((?:\d+|[a-z]|[ivxlcdm]+)\)\s+)/gi, "$1\n")
    .split(/\n+/);
}

function ProvisionText({ text }: { text: string }) {
  const lines = provisionLines(text)
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <div className="mt-3 flex max-w-[68ch] flex-col gap-4 font-serif text-[17px] leading-7 text-foreground/90">
      {lines.map((line, index) => {
        const match = line.match(
          /^(\((?:\d+|[a-z]|[ivxlcdm]+)\))\s*([\s\S]*)$/i,
        );
        if (!match) {
          return (
            <p key={`${index}-${line}`} className="scroll-mt-24 pl-10">
              {line}
            </p>
          );
        }

        const marker = match[1];
        const body = match[2];
        const level = provisionLevel(marker);
        return (
          <p
            key={`${index}-${line}`}
            className="flex scroll-mt-24 gap-3"
            style={{ marginLeft: `${level * 1.25}rem` }}
          >
            <span className="w-7 shrink-0 select-none text-right font-sans text-sm font-medium tabular-nums text-muted-2">
              {marker}
            </span>
            <span className="flex-1">{body}</span>
          </p>
        );
      })}
    </div>
  );
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
  searchParams: Promise<{
    q?: string | string[];
    returnTo?: string | string[];
  }>;
}) {
  const [{ reference }, rawSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);
  const q = firstString(rawSearchParams.q);
  const returnTo = firstString(rawSearchParams.returnTo);
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
    <main className="mx-auto w-full max-w-[calc(68ch+16rem+1.5rem+4rem)] px-5 py-10 sm:px-8">
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
              ? `${sec.section_no} ${sec.heading}`
              : sec.section_no,
          }))}
        >
          <div className="flex flex-col gap-4">
            {sections.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border-strong bg-surface p-8 text-center text-sm text-muted">
                No section text available for this statute.
              </p>
            ) : (
              sections.map((sec) => {
                const text = statuteSectionDisplayText(sec);
                return (
                  <article
                    key={sec.section_no}
                    id={`s-${sec.section_no}`}
                    data-section-id={`s-${sec.section_no}`}
                    className="scroll-mt-24"
                  >
                    <h2 className="grid max-w-[68ch] grid-cols-[2.25rem_1fr] gap-3 pt-3 font-sans text-xs font-semibold uppercase tracking-[0.14em] text-accent">
                      <span className="select-none text-right text-sm font-medium tabular-nums text-muted-2">
                        {sec.section_no}
                      </span>
                      <span>{sec.heading || "Section"}</span>
                    </h2>
                    {text && <ProvisionText text={text} />}
                  </article>
                );
              })
            )}
          </div>
        </StatuteSectionShell>
      </div>
    </main>
  );
}
