import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentBody } from "@/components/DocumentBody";
import { ArrowLeftIcon, ExternalLinkIcon } from "@/components/icons";
import { Snippet } from "@/components/Snippet";
import {
  type DocumentDetail,
  type DocumentKind,
  isDocumentKind,
  sgjudge,
} from "@/lib/sgjudge";

const PAGE = 60000;

const KIND_LABELS: Record<DocumentKind, string> = {
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
    q?: string;
    title?: string;
    snippet?: string;
    meta?: string;
    returnTo?: string;
  }>;
}) {
  const [{ kind, id }, { q, title, snippet, meta, returnTo }] =
    await Promise.all([params, searchParams]);
  const decodedKind = decodeURIComponent(kind);
  const decodedId = decodeURIComponent(id);
  if (!isDocumentKind(decodedKind)) notFound();
  const label = KIND_LABELS[decodedKind];

  const detail = await loadDetail(decodedKind, decodedId);
  const displayTitle =
    detailTitle(detail) || (title ? title : undefined) || label;
  const metaItems =
    detail && detailMeta(decodedKind, detail).length > 0
      ? detailMeta(decodedKind, detail)
      : parseMeta(meta);

  const initialText = (detail?.body_text as string) ?? "";
  const initialLoaded =
    (detail?.body_offset ?? 0) + (detail?.body_text?.length ?? 0);
  const total = (detail?.body_length as number) ?? initialLoaded;
  const sourceUrl = typeof detail?.url === "string" ? detail.url : undefined;
  const hasBody = Boolean(detail && initialText);

  return (
    <main className="mx-auto w-full max-w-[76ch] px-5 py-10 sm:px-8">
      <Link
        href={
          safeReturnTo(returnTo) ?? `/?tab=${encodeURIComponent(decodedKind)}`
        }
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to search
      </Link>

      <header className="border-b border-border pb-6">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-2">
          <span className="rounded bg-primary px-2 py-0.5 font-medium text-primary-fg">
            {label}
          </span>
          <span className="font-mono">{decodedId}</span>
        </div>

        <h1 className="font-serif text-2xl font-medium leading-tight tracking-tight text-foreground sm:text-3xl">
          {displayTitle}
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

        {sourceUrl && (
          <div className="mt-5">
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong px-3.5 py-2 text-sm font-medium text-muted transition-colors hover:border-accent hover:text-foreground"
            >
              <ExternalLinkIcon className="h-4 w-4" />
              View official source
            </a>
          </div>
        )}
      </header>

      <section className="mt-8">
        {hasBody ? (
          <DocumentBody
            kind={decodedKind}
            docId={decodedId}
            initialText={initialText}
            initialLoaded={initialLoaded}
            total={total}
            query={q ?? ""}
          />
        ) : snippet ? (
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-2">
              Matching excerpt
            </h2>
            <Snippet html={snippet} className="text-base" />
            <p className="mt-4 text-xs text-muted-2">
              Full document text is not available for this result.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">
            Full document text is not available for this result.
          </p>
        )}
      </section>
    </main>
  );
}

async function loadDetail(
  kind: DocumentKind,
  id: string,
): Promise<DocumentDetail | null> {
  try {
    return await sgjudge.getDocument(
      kind,
      id,
      { include_body: true, body_length: PAGE },
      { cache: "no-store" },
    );
  } catch {
    // Detail API may not cover this corpus/id; fall back to the snippet card.
    return null;
  }
}

function detailTitle(detail: DocumentDetail | null): string | undefined {
  if (!detail) return undefined;
  const topic = typeof detail.topic === "string" ? detail.topic.trim() : "";
  const shortTitle =
    typeof detail.short_title === "string" ? detail.short_title.trim() : "";
  return topic || shortTitle || undefined;
}

function detailMeta(
  kind: DocumentKind,
  detail: DocumentDetail,
): [string, string][] {
  const rows: [string, string][] = [];
  const add = (label: string, value: unknown) => {
    if (typeof value === "string" && value.trim()) {
      rows.push([label, value.trim()]);
    } else if (typeof value === "number") {
      rows.push([label, String(value)]);
    }
  };

  if (kind === "hansard") {
    add("Speaker", detail.speaker);
    add("Party", detail.party);
    add("Constituency", detail.constituency);
    add("Date", detail.date);
    add("Sitting", detail.sitting_no);
  } else if (kind === "bills") {
    add("Bill Number", detail.bill_number);
    add("Year", detail.year);
    add("Status", detail.status);
    add("Introduced", detail.introduced_date);
    add("Second Reading", detail.second_reading_date);
    add("Session", detail.session);
  } else if (kind === "subsidiary") {
    add("SL Number", detail.sl_number);
    add("Parent Act", detail.parent_act_id);
    add("Date", detail.doc_date);
  } else if (kind === "practice") {
    add("Court", detail.court);
    add("PD Number", detail.pd_number);
    add("Effective Date", detail.effective_date);
    add("Supersedes", detail.supersedes);
  }

  return rows;
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
