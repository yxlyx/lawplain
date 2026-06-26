import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "@/components/icons";
import { Snippet } from "@/components/Snippet";

const KIND_LABELS: Record<string, string> = {
  hansard: "Hansard",
  bills: "Bill",
  subsidiary: "Subsidiary Legislation",
  practice: "Practice Direction",
};

export default async function DocumentResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; id: string }>;
  searchParams: Promise<{
    title?: string;
    snippet?: string;
    meta?: string;
    returnTo?: string;
  }>;
}) {
  const [{ kind, id }, { title, snippet, meta, returnTo }] = await Promise.all([
    params,
    searchParams,
  ]);
  const decodedKind = decodeURIComponent(kind);
  const decodedId = decodeURIComponent(id);
  const label = KIND_LABELS[decodedKind];
  if (!label) notFound();

  const metaItems = parseMeta(meta);

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8">
      <Link
        href={
          safeReturnTo(returnTo) ?? `/?tab=${encodeURIComponent(decodedKind)}`
        }
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to search
      </Link>

      <article className="rounded-2xl border border-border bg-surface p-6">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-2">
          <span className="rounded bg-primary px-2 py-0.5 font-medium text-primary-fg">
            {label}
          </span>
          <span className="font-mono">{decodedId}</span>
        </div>

        <h1 className="font-serif text-2xl font-medium leading-tight tracking-tight text-foreground sm:text-3xl">
          {title || label}
        </h1>

        {metaItems.length > 0 && (
          <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-2.5 text-sm sm:grid-cols-[max-content_1fr]">
            {metaItems.map(([key, value]) => (
              <div key={key} className="sm:contents">
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-2 sm:pt-0.5">
                  {key}
                </dt>
                <dd className="mb-1 text-muted sm:mb-0">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {snippet && (
          <section className="mt-6 border-t border-border pt-5">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-2">
              Matching excerpt
            </h2>
            <Snippet html={snippet} className="text-base" />
          </section>
        )}
      </article>
    </main>
  );
}

function parseMeta(value?: string): [string, string][] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!Array.isArray(item) || item.length !== 2) return [];
      const [key, val] = item;
      if (typeof key !== "string" || typeof val !== "string" || !val) {
        return [];
      }
      return [[key, val] as [string, string]];
    });
  } catch {
    return [];
  }
}

function safeReturnTo(value?: string): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}
