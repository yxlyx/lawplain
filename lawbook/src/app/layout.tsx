import type { Metadata } from "next";
import { Geist, Geist_Mono, Lora } from "next/font/google";
import Link from "next/link";
import { AnalyticsConsentBanner } from "@/components/AnalyticsConsentBanner";
import { AppShell } from "@/components/AppShell";
import { ChromeProvider } from "@/components/chrome/ChromeContext";
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  jsonLdScriptProps,
  OG_IMAGE,
  SITE_KEYWORDS,
  SITE_NAME,
  SITE_ORIGIN,
  webApplicationJsonLd,
  websiteJsonLd,
} from "@/lib/seo";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-google-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const lora = Lora({
  variable: "--font-serif",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  applicationName: SITE_NAME,
  title: {
    default: DEFAULT_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: DEFAULT_DESCRIPTION,
  keywords: SITE_KEYWORDS,
  category: "legal research",
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: "/favicon.ico",
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    url: "/",
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
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: [OG_IMAGE],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${lora.variable} h-full antialiased`}
    >
      <body className="flex min-h-svh flex-col overflow-x-clip bg-background text-foreground">
        <script
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD is serialized with JSON.stringify and escaped in jsonLdScriptProps.
          dangerouslySetInnerHTML={jsonLdScriptProps([
            websiteJsonLd(),
            webApplicationJsonLd(),
          ])}
        />
        <ChromeProvider>
          <AppShell footer={<SiteFooter />}>{children}</AppShell>
        </ChromeProvider>
        <AnalyticsConsentBanner />
      </body>
    </html>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface-2/35">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 py-4 text-xs leading-relaxed text-muted-2 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p className="flex items-center gap-2.5">
          <BrandMark className="h-5 w-5" />
          <span>
            <span className="font-semibold text-muted">Lawplain</span> — a
            read-only projection of the Singapore legal corpus.
          </span>
        </p>
        <nav className="flex items-center gap-4">
          <Link href="/faq" className="transition-colors hover:text-foreground">
            FAQ &amp; Help
          </Link>
          <Link
            href="/developers"
            className="transition-colors hover:text-foreground"
          >
            API
          </Link>
        </nav>
        <p>
          Not legal advice. Data via{" "}
          <span className="font-mono">backend.lawplain.com</span>
        </p>
      </div>
    </footer>
  );
}

function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 96 96"
      fill="none"
      aria-hidden="true"
    >
      <rect x="10" y="10" width="76" height="76" rx="18" fill="#18181B" />
      <path
        d="M26 39C35 39 42 41.5 48 46V68C42.2 63.8 35 61.5 26 61.5V39Z"
        fill="#FAFAFA"
      />
      <path
        d="M70 39C61 39 54 41.5 48 46V68C53.8 63.8 61 61.5 70 61.5V39Z"
        fill="#FAFAFA"
      />
      <path
        d="M48 45.5V69"
        stroke="#0d7561"
        strokeWidth={3.5}
        strokeLinecap="round"
      />
      <path
        d="M33 31H63"
        stroke="#0d7561"
        strokeWidth={4}
        strokeLinecap="round"
      />
      <path
        d="M48 26V36"
        stroke="#0d7561"
        strokeWidth={4}
        strokeLinecap="round"
      />
      <circle cx="33" cy="31" r="2.8" fill="#0d7561" />
      <circle cx="63" cy="31" r="2.8" fill="#0d7561" />
      <path
        d="M32 49H40"
        stroke="#18181B"
        strokeWidth={3}
        strokeLinecap="round"
      />
      <path
        d="M56 49H64"
        stroke="#18181B"
        strokeWidth={3}
        strokeLinecap="round"
      />
    </svg>
  );
}
