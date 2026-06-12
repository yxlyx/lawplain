import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, ExternalLinkIcon } from "@/components/icons";
import { JudgmentBody } from "@/components/JudgmentBody";
import {
  ApiError,
  type JudgmentDetail,
  parseJsonField,
  sgjudge,
} from "@/lib/sgjudge";

const PAGE = 60000;

async function load(citation: string): Promise<JudgmentDetail> {
  try {
    return await sgjudge.getJudgment(
      citation,
      { include_body: true, body_length: PAGE },
      { cache: "no-store" },
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ citation: string }>;
}): Promise<Metadata> {
  const { citation } = await params;
  const decoded = decodeURIComponent(citation);
  try {
    const j = await sgjudge.getJudgment(
      decoded,
      { body_length: 1 },
      { cache: "no-store" },
    );
    return {
      title: `${(j.title as string) || j.neutral_cite || decoded} — sgjudge`,
    };
  } catch {
    return { title: `${decoded} — sgjudge` };
  }
}

export default async function JudgmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ citation: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ citation }, { q }] = await Promise.all([params, searchParams]);
  const decoded = decodeURIComponent(citation);
  const j = await load(decoded);

  const judges = parseJsonField<string[]>(j.judges_json, []);
  const catchwords = parseJsonField<string[]>(j.catchwords_json, []);
  const initialLoaded = (j.body_offset ?? 0) + (j.body_text?.length ?? 0);

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8">
      <Link
        href="/?tab=judgments"
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to search
      </Link>

      <header className="border-b border-border pb-6">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          {j.court && (
            <span className="rounded bg-primary px-2 py-0.5 font-medium text-primary-fg">
              {j.court}
            </span>
          )}
          {j.neutral_cite && (
            <span className="text-muted">{j.neutral_cite}</span>
          )}
          {j.decision_date && (
            <span className="text-muted-2">· {j.decision_date}</span>
          )}
        </div>
        <h1 className="text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-3xl">
          {(j.title as string) || j.neutral_cite || decoded}
        </h1>

        {judges.length > 0 && (
          <p className="mt-3 text-sm text-muted">
            <span className="font-medium text-foreground">Coram:</span>{" "}
            {judges.join(", ")}
          </p>
        )}

        {catchwords.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {catchwords.map((c) => (
              <span
                key={c}
                className="rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs text-muted"
              >
                {c}
              </span>
            ))}
          </div>
        )}

        {typeof j.url === "string" && (
          <a
            href={j.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-border-strong px-3.5 py-2 text-sm font-medium text-muted transition-colors hover:border-accent hover:text-foreground"
          >
            <ExternalLinkIcon className="h-4 w-4" />
            View official judgment on eLitigation
          </a>
        )}
      </header>

      <section className="mt-8">
        <JudgmentBody
          citation={decoded}
          initialText={j.body_text ?? ""}
          initialLoaded={initialLoaded}
          total={j.body_length ?? initialLoaded}
          query={q ?? ""}
        />
      </section>
    </main>
  );
}
