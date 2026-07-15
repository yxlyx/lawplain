import type { Metadata } from "next";

export const SITE_NAME = "Lawplain";
export const SITE_ORIGIN = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://lawplain.com"
).replace(/\/+$/, "");
export const DEFAULT_TITLE = "Lawplain | Singapore Legal Research";
export const DEFAULT_DESCRIPTION =
  "Search Singapore judgments, statutes, Hansard and official agency guidance. Read-only legal information, not advice.";
export const OG_IMAGE = "/opengraph-image.png";

export const SITE_KEYWORDS = [
  "Singapore legal research",
  "Singapore judgments",
  "Singapore case law",
  "Singapore statutes",
  "subsidiary legislation",
  "Singapore Hansard",
  "Singapore bills",
  "practice directions",
  "Singapore agency guidance",
  "TAFEP guidelines",
  "PDPC guidance",
  "legal information",
  "Lawplain",
];

const INDEX_ROBOTS: Metadata["robots"] = {
  index: true,
  follow: true,
  googleBot: {
    index: true,
    follow: true,
    "max-image-preview": "large",
    "max-snippet": -1,
    "max-video-preview": -1,
  },
};

const NOINDEX_ROBOTS: Metadata["robots"] = {
  index: false,
  follow: false,
  googleBot: {
    index: false,
    follow: false,
  },
};

const NOINDEX_FOLLOW_ROBOTS: Metadata["robots"] = {
  index: false,
  follow: true,
  googleBot: {
    index: false,
    follow: true,
  },
};

type MetadataOptions = {
  title?: string;
  description?: string;
  path: string;
  absoluteTitle?: boolean;
  noIndex?: boolean;
  noIndexFollow?: boolean;
  type?: "website" | "article";
};

export function absoluteUrl(path = "/"): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_ORIGIN}${normalizedPath}`;
}

export function buildMetadata({
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
  path,
  absoluteTitle = false,
  noIndex = false,
  noIndexFollow = false,
  type = "website",
}: MetadataOptions): Metadata {
  const canonical = path.startsWith("/") ? path : `/${path}`;
  const titleValue: Metadata["title"] = absoluteTitle
    ? { absolute: title }
    : title;

  return {
    title: titleValue,
    description,
    alternates: {
      canonical,
    },
    openGraph: {
      type,
      title,
      description,
      url: canonical,
      siteName: SITE_NAME,
      locale: "en_SG",
      images: [
        {
          url: OG_IMAGE,
          width: 1200,
          height: 630,
          alt: "Lawplain Singapore legal research preview",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [OG_IMAGE],
    },
    robots: noIndex
      ? noIndexFollow
        ? NOINDEX_FOLLOW_ROBOTS
        : NOINDEX_ROBOTS
      : INDEX_ROBOTS,
  };
}

export function metaDescription(value: string, maxLength = 155): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 3).replace(/\s+\S*$/, "")}...`;
}

export function jsonLdScriptProps(value: unknown): {
  __html: string;
} {
  return {
    __html: JSON.stringify(value).replace(/</g, "\\u003c"),
  };
}

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${absoluteUrl("/")}#website`,
    name: SITE_NAME,
    url: absoluteUrl("/"),
    description: DEFAULT_DESCRIPTION,
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_ORIGIN}/?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

export function webApplicationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "@id": `${absoluteUrl("/")}#app`,
    name: SITE_NAME,
    url: absoluteUrl("/"),
    applicationCategory: "LegalApplication",
    operatingSystem: "Web",
    isAccessibleForFree: true,
    description: DEFAULT_DESCRIPTION,
    isPartOf: {
      "@id": `${absoluteUrl("/")}#website`,
    },
  };
}

export function creativeWorkJsonLd({
  name,
  path,
  description,
  citation,
  datePublished,
  workType = "CreativeWork",
}: {
  name: string;
  path: string;
  description: string;
  citation?: string;
  datePublished?: string;
  workType?: "CreativeWork" | "Legislation";
}) {
  return {
    "@context": "https://schema.org",
    "@type": workType,
    name,
    url: absoluteUrl(path),
    description,
    ...(citation ? { citation } : {}),
    ...(datePublished ? { datePublished } : {}),
    isPartOf: {
      "@id": `${absoluteUrl("/")}#website`,
      name: SITE_NAME,
    },
  };
}
