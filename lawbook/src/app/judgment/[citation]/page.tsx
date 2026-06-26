import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyActions } from "@/components/CopyActions";
import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  SparkleIcon,
} from "@/components/icons";
import { JudgmentBody } from "@/components/JudgmentBody";
import { SavedAuthorityButton } from "@/components/SavedAuthorityButton";
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
      title: `${(j.title as string) || j.neutral_cite || decoded} — Lawplain`,
    };
  } catch {
    return { title: `${decoded} — Lawplain` };
  }
}

export default async function JudgmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ citation: string }>;
  searchParams: Promise<{ q?: string; returnTo?: string }>;
}) {
  const [{ citation }, { q, returnTo }] = await Promise.all([
    params,
    searchParams,
  ]);
  const decoded = decodeURIComponent(citation);
  const j = await load(decoded);

  const judges = parseJsonField<string[]>(j.judges_json, []);
  const catchwords = parseJsonField<string[]>(j.catchwords_json, []);
  const counsel = parseJsonField<CounselEntry[]>(j.counsel_json, []);
  const counselGroups = groupCounsel(counsel);
  const initialLoaded = (j.body_offset ?? 0) + (j.body_text?.length ?? 0);
  const title = (j.title as string) || j.neutral_cite || decoded;
  const source = {
    kind: "judgment" as const,
    title,
    citation: j.neutral_cite || j.citation || decoded,
    court: j.court ? courtName(j.court) : undefined,
    date: j.decision_date ? formatDate(j.decision_date) : undefined,
    year: j.year,
  };
  const pagePath = `/judgment/${encodeURIComponent(decoded)}`;

  const metaRows: { label: string; value: React.ReactNode }[] = [];
  if (j.court) metaRows.push({ label: "Tribunal", value: courtName(j.court) });
  if (j.case_no) metaRows.push({ label: "Case Number", value: j.case_no });
  if (j.decision_date)
    metaRows.push({
      label: "Decision Date",
      value: formatDate(j.decision_date),
    });
  if (j.hearing_date)
    metaRows.push({ label: "Hearing Date", value: formatDate(j.hearing_date) });
  if (judges.length > 0)
    metaRows.push({ label: "Coram", value: judges.join(", ") });
  if (counselGroups.length > 0)
    metaRows.push({
      label: "Counsel",
      value: (
        <span className="flex flex-col gap-1.5">
          {counselGroups.map((g) => (
            <span key={g.role} className="block">
              <span className="text-foreground">{g.names.join(", ")}</span>{" "}
              <span className="text-muted-2">({g.role})</span>
            </span>
          ))}
        </span>
      ),
    });

  return (
    <main className="mx-auto w-full max-w-[calc(68ch+16rem+1.5rem+4rem)] px-5 py-10 sm:px-8">
      <Link
        href={safeReturnTo(returnTo) ?? "/?tab=judgments"}
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
            <span className="font-mono text-muted">{j.neutral_cite}</span>
          )}
        </div>
        <h1 className="font-serif text-2xl font-medium leading-tight tracking-tight text-foreground sm:text-3xl">
          {title}
        </h1>

        {metaRows.length > 0 && (
          <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-2.5 text-sm sm:grid-cols-[max-content_1fr]">
            {metaRows.map((row) => (
              <div key={row.label} className="sm:contents">
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-2 sm:pt-0.5">
                  {row.label}
                </dt>
                <dd className="mb-1 text-muted sm:mb-0">{row.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {catchwords.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-x-2 gap-y-1.5 border-l-2 border-border-strong pl-4">
            {catchwords.flatMap((c) =>
              catchwordSearchTerms(c).map((term) => (
                <Link
                  key={`${c}-${term}`}
                  href={{
                    pathname: "/",
                    query: { tab: "judgments", q: term },
                  }}
                  title={c}
                  className="font-serif text-sm italic leading-relaxed text-muted transition-colors hover:text-accent"
                >
                  {term}
                </Link>
              )),
            )}
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {typeof j.url === "string" && (
            <a
              href={j.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong px-3.5 py-2 text-sm font-medium text-muted transition-colors hover:border-accent hover:text-foreground"
            >
              <ExternalLinkIcon className="h-4 w-4" />
              View official judgment on eLitigation
            </a>
          )}

          <CopyActions source={source} path={pagePath} />

          <SavedAuthorityButton
            docType="judgment"
            docId={decoded}
            title={title}
            path={pagePath}
          />

          <Link
            href={`/ask?cite=${encodeURIComponent(decoded)}&kind=judgment`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft px-3.5 py-2 text-sm font-medium text-accent transition-colors hover:border-accent hover:bg-accent hover:text-primary-fg"
          >
            <SparkleIcon className="h-4 w-4" />
            Ask Lawplain about this
          </Link>
        </div>
      </header>

      <section className="mt-8">
        <JudgmentBody
          citation={decoded}
          initialText={j.body_text ?? ""}
          initialLoaded={initialLoaded}
          total={j.body_length ?? initialLoaded}
          query={q ?? ""}
          initialSections={j.sections}
        />
      </section>
    </main>
  );
}

interface CounselEntry {
  role?: string;
  name?: string;
  firm?: string;
}

const COURT_NAMES: Record<string, string> = {
  SGCA: "Singapore Court of Appeal",
  SGHC: "Singapore High Court",
  "SGHC(A)": "Appellate Division of the High Court",
  "SGHC(I)": "Singapore International Commercial Court",
  SGHCF: "High Court (Family Division)",
  SGDC: "District Court",
  SGMC: "Magistrates' Court",
  SGFC: "Family Court",
  SGYC: "Youth Court",
  SGCAB: "Court of Appeal",
};

function courtName(code: string): string {
  return COURT_NAMES[code] ? `${COURT_NAMES[code]} (${code})` : code;
}

function safeReturnTo(value?: string): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-SG", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function catchwordSearchTerms(catchword: string): string[] {
  const bracketedTerms = [...catchword.matchAll(/\[([^\]]+)\]/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);

  const sourceTerms =
    bracketedTerms.length > 0
      ? bracketedTerms
      : catchword
          .trim()
          .split(/\s+[–—]\s+/)
          .map((part) => part.trim())
          .filter(Boolean);

  return [...new Set(sourceTerms.flatMap(conciseSearchTerms))];
}

function conciseSearchTerms(term: string): string[] {
  const normalized = term
    .replace(/^applicable test for\s+/i, "")
    .replace(/^principles? (?:relating to|concerning)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return [];
  if (wordCount(normalized) <= 5) return [normalized];

  const terms: string[] = [];

  const liabilityMatch = normalized.match(/^liability in (.+?) for (.+)$/i);
  if (liabilityMatch?.[1] && liabilityMatch[2]) {
    terms.push(`liability in ${liabilityMatch[1].trim()}`);
    terms.push(liabilityMatch[2].trim());
  }

  const dueToMatch = normalized.match(/\bdue to (.+)$/i);
  if (dueToMatch?.[1]) terms.push(dueToMatch[1].trim());

  for (const phrase of [
    "pure economic loss",
    "breach of duty",
    "remoteness of damage",
    "limitation of actions",
    "set-offs",
    "negligence",
    "damages",
    "costs",
  ]) {
    if (normalized.toLowerCase().includes(phrase)) terms.push(phrase);
  }

  const conciseTerms = terms
    .map((phrase) => phrase.replace(/\s+/g, " ").trim())
    .filter((phrase) => phrase && wordCount(phrase) <= 5);

  if (conciseTerms.length > 0) return conciseTerms;

  return [lastContentWords(normalized, 4)];
}

function wordCount(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

function lastContentWords(value: string, limit: number): string {
  const stopWords = new Set([
    "a",
    "an",
    "and",
    "as",
    "for",
    "in",
    "of",
    "on",
    "or",
    "part",
    "that",
    "the",
    "this",
    "to",
    "whether",
  ]);
  const words = value
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((word) => word && !stopWords.has(word.toLowerCase()));

  return words.slice(-limit).join(" ") || value;
}

function groupCounsel(
  counsel: CounselEntry[],
): { role: string; names: string[] }[] {
  const order: string[] = [];
  const byRole = new Map<string, string[]>();
  for (const c of counsel) {
    const role = (c.role ?? "counsel").trim();
    const label = c.firm ? `${c.name} (${c.firm})` : (c.name ?? "");
    if (!label) continue;
    if (!byRole.has(role)) {
      byRole.set(role, []);
      order.push(role);
    }
    byRole.get(role)?.push(label);
  }
  return order.map((role) => ({
    role: role.charAt(0).toUpperCase() + role.slice(1),
    names: byRole.get(role) ?? [],
  }));
}
