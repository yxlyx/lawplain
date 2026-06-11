import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "@/components/icons";
import { ApiError, type StatuteDetail, sgjudge } from "@/lib/sgjudge";

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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ reference: string }>;
}): Promise<Metadata> {
  const { reference } = await params;
  const decoded = decodeURIComponent(reference);
  try {
    const s = await sgjudge.getStatute(decoded, {}, { cache: "no-store" });
    return { title: `${s.short_title || decoded} — sgjudge` };
  } catch {
    return { title: `${decoded} — sgjudge` };
  }
}

export default async function StatutePage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  const decoded = decodeURIComponent(reference);
  const s = await load(decoded);
  const sections = s.sections ?? [];

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8">
      <Link
        href="/?tab=statutes"
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
        <h1 className="font-serif text-2xl font-semibold leading-tight text-foreground sm:text-3xl">
          {s.short_title || s.act_id || decoded}
        </h1>
      </header>

      {sections.length > 1 && (
        <nav className="mt-6 rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-2">
            Sections
          </h2>
          <ul className="flex flex-wrap gap-1.5">
            {sections.map((sec) => (
              <li key={sec.section_no}>
                <a
                  href={`#s-${sec.section_no}`}
                  className="inline-block rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-xs text-muted transition-colors hover:border-accent hover:text-foreground"
                >
                  {sec.section_no}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <section className="mt-8 flex flex-col gap-8">
        {sections.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-strong bg-surface p-8 text-center text-sm text-muted">
            No section text available for this statute.
          </p>
        ) : (
          sections.map((sec) => (
            <article
              key={sec.section_no}
              id={`s-${sec.section_no}`}
              className="scroll-mt-24"
            >
              <h3 className="mb-2 font-serif text-lg font-semibold text-foreground">
                <span className="text-accent">§ {sec.section_no}</span>
                {sec.heading ? ` — ${sec.heading}` : ""}
              </h3>
              {sec.text && (
                <p className="whitespace-pre-wrap text-[15px] leading-7 text-foreground/90">
                  {sec.text}
                </p>
              )}
            </article>
          ))
        )}
      </section>
    </main>
  );
}
