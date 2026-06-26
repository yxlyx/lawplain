"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CopyIcon, LinkIcon } from "@/components/icons";
import { useExclusiveToolbarPopover } from "@/components/useExclusiveToolbarPopover";
import {
  CITATION_FORMAT_LABELS,
  type CitationFormat,
  type CitationSource,
  formatCitation,
} from "@/lib/citations";

interface CopyActionsProps {
  source: CitationSource;
  path?: string;
  citationLabel?: string;
  linkLabel?: string;
  compact?: boolean;
  className?: string;
}

const DEFAULT_FORMATS = Object.entries(CITATION_FORMAT_LABELS) as [
  CitationFormat,
  string,
][];

let cachedUsageRows:
  | { format?: string; count?: number; lastUsedAt?: number }[]
  | null = null;
let usagePromise: Promise<
  { format?: string; count?: number; lastUsedAt?: number }[] | null
> | null = null;

export function CopyActions({
  source,
  path,
  citationLabel = "Copy citation",
  linkLabel = "Copy link",
  compact = false,
  className = "",
}: CopyActionsProps) {
  const [formats, setFormats] = useState(DEFAULT_FORMATS);
  const [hasUsage, setHasUsage] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState<"citation" | "link" | "failed" | null>(
    null,
  );
  const menuRef = useRef<HTMLSpanElement>(null);
  const announceToolbarPopoverOpen = useExclusiveToolbarPopover(() => {
    setMenuOpen(false);
  });

  const appPath = path ?? (source.url ? undefined : "");
  const activeFormat = formats[0]?.[0] ?? "legal";

  useEffect(() => {
    if (!menuOpen) return;
    let cancelled = false;
    loadCitationFormatUsage().then((rows) => {
      if (cancelled || !rows) return;
      setFormats(orderFormats(rows));
      setHasUsage(rows.length > 0);
    });
    return () => {
      cancelled = true;
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const toggleCitationMenu = () => {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }

    announceToolbarPopoverOpen();
    setMenuOpen(true);
  };

  const copyCitation = async (format: CitationFormat) => {
    try {
      await writeCitationClipboard(formatCitation(source, format));
      void recordCitationFormat(format).then((rows) => {
        if (!rows) return;
        setFormats(orderFormats(rows));
        setHasUsage(rows.length > 0);
      });
      setCopied("citation");
      setMenuOpen(false);
    } catch {
      setCopied("failed");
    }
    window.setTimeout(() => setCopied(null), 1600);
  };

  const copyLink = async () => {
    announceToolbarPopoverOpen();
    setMenuOpen(false);

    try {
      await writePlainClipboard(absoluteUrl(appPath));
      setCopied("link");
    } catch {
      setCopied("failed");
    }
    window.setTimeout(() => setCopied(null), 1600);
  };

  const buttonClass = compact
    ? "inline-flex items-center gap-1 rounded-md border border-border bg-surface/90 px-2 py-1 text-xs font-medium text-muted transition-colors hover:border-accent hover:text-foreground"
    : "inline-flex items-center gap-1.5 rounded-lg border border-border-strong px-3.5 py-2 text-sm font-medium text-muted transition-colors hover:border-accent hover:text-foreground";
  const menuClass = compact
    ? "absolute left-0 top-full z-30 mt-1 min-w-32 overflow-hidden rounded-lg border border-border-strong bg-surface py-1 shadow-lg"
    : "absolute left-0 top-full z-30 mt-1 min-w-40 overflow-hidden rounded-lg border border-border-strong bg-surface py-1 shadow-lg";

  const statusLabel = useMemo(() => {
    if (copied === "citation") return "Copied";
    if (copied === "failed") return "Copy failed";
    return citationLabel;
  }, [copied, citationLabel]);

  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${className}`}>
      <span ref={menuRef} className="relative inline-flex">
        <button
          type="button"
          onClick={toggleCitationMenu}
          className={buttonClass}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title={
            hasUsage
              ? `Most used: ${CITATION_FORMAT_LABELS[activeFormat]}`
              : "Choose citation format"
          }
        >
          <CopyIcon className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
          {statusLabel}
        </button>
        {menuOpen && (
          <span role="menu" className={menuClass}>
            {formats.map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="menuitem"
                onClick={() => copyCitation(value)}
                className="block w-full px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                <span className="font-medium text-foreground">{label}</span>
                {hasUsage && value === activeFormat && (
                  <span className="ml-1 text-xs text-muted-2">most used</span>
                )}
              </button>
            ))}
          </span>
        )}
      </span>
      {appPath !== undefined && (
        <button type="button" onClick={copyLink} className={buttonClass}>
          <LinkIcon className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
          {copied === "link"
            ? "Copied"
            : copied === "failed"
              ? "Copy failed"
              : linkLabel}
        </button>
      )}
    </span>
  );
}

async function loadCitationFormatUsage(): Promise<
  { format?: string; count?: number; lastUsedAt?: number }[] | null
> {
  if (cachedUsageRows) return cachedUsageRows;
  usagePromise ??= fetch("/api/citation-formats/usage", {
    cache: "no-store",
  })
    .then(async (res) => {
      if (!res.ok) return null;
      const data = (await res.json()) as {
        usage?: { format?: string; count?: number; lastUsedAt?: number }[];
      };
      cachedUsageRows = data.usage ?? [];
      return cachedUsageRows;
    })
    .catch(() => null);
  return usagePromise;
}

async function recordCitationFormat(
  format: CitationFormat,
): Promise<{ format?: string; count?: number; lastUsedAt?: number }[] | null> {
  const res = await fetch("/api/citation-formats/usage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    usage?: { format?: string; count?: number; lastUsedAt?: number }[];
  };
  cachedUsageRows = data.usage ?? [];
  usagePromise = Promise.resolve(cachedUsageRows);
  return cachedUsageRows;
}

function orderFormats(
  rows: { format?: string; count?: number; lastUsedAt?: number }[],
): [CitationFormat, string][] {
  const usage = new Map<CitationFormat, { count: number; last: number }>();
  for (const row of rows) {
    if (isCitationFormat(row.format)) {
      usage.set(row.format, {
        count: typeof row.count === "number" ? row.count : 0,
        last: typeof row.lastUsedAt === "number" ? row.lastUsedAt : 0,
      });
    }
  }
  return [...DEFAULT_FORMATS].sort(([a], [b]) => {
    const aUsage = usage.get(a);
    const bUsage = usage.get(b);
    const byCount = (bUsage?.count ?? 0) - (aUsage?.count ?? 0);
    if (byCount !== 0) return byCount;
    const byLast = (bUsage?.last ?? 0) - (aUsage?.last ?? 0);
    if (byLast !== 0) return byLast;
    return defaultIndex(a) - defaultIndex(b);
  });
}

function defaultIndex(format: CitationFormat): number {
  return DEFAULT_FORMATS.findIndex(([value]) => value === format);
}

function isCitationFormat(value: unknown): value is CitationFormat {
  return (
    typeof value === "string" && Object.hasOwn(CITATION_FORMAT_LABELS, value)
  );
}

async function writeCitationClipboard(citation: {
  plain: string;
  html: string;
}): Promise<void> {
  if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([citation.plain], { type: "text/plain" }),
        "text/html": new Blob([`<cite>${citation.html}</cite>`], {
          type: "text/html",
        }),
      }),
    ]);
    return;
  }
  await writePlainClipboard(citation.plain);
}

async function writePlainClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!ok) throw new Error("Copy command failed");
}

function absoluteUrl(path?: string): string {
  if (typeof window === "undefined") return path ?? "";
  if (!path) return window.location.href;
  return new URL(path, window.location.origin).toString();
}
