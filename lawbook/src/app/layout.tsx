import type { Metadata } from "next";
import { EB_Garamond, Geist_Mono, Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const ebGaramond = EB_Garamond({
  variable: "--font-serif",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Lawbook — Singapore Legal Research",
  description:
    "Search Singapore judgments, statutes, subsidiary legislation, Hansard, bills and practice directions across the Lawbook legal corpus.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} ${ebGaramond.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/65">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="group flex items-center gap-3">
          <BrandMark className="h-9 w-9 transition-transform duration-200 group-hover:-translate-y-0.5" />
          <span className="flex flex-col leading-none">
            <span className="text-[15px] font-semibold tracking-tight text-foreground">
              Lawbook
            </span>
            <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-2">
              Singapore Legal Research
            </span>
          </span>
        </Link>
        <a
          href="https://backend.lawplain.com/v1/stats"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-border-strong px-3.5 py-1.5 text-xs font-medium text-muted transition-colors hover:border-accent hover:text-foreground"
        >
          API
        </a>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-border bg-surface-2/40">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p className="flex items-center gap-2.5">
          <BrandMark className="h-6 w-6" />
          <span>
            <span className="font-semibold text-foreground">Lawbook</span> — a
            read-only projection of the Singapore legal corpus.
          </span>
        </p>
        <p className="text-xs text-muted-2">
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
      role="img"
      aria-label="Lawbook"
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
        stroke="#0088FF"
        strokeWidth={3.5}
        strokeLinecap="round"
      />
      <path
        d="M33 31H63"
        stroke="#0088FF"
        strokeWidth={4}
        strokeLinecap="round"
      />
      <path
        d="M48 26V36"
        stroke="#0088FF"
        strokeWidth={4}
        strokeLinecap="round"
      />
      <circle cx="33" cy="31" r="2.8" fill="#0088FF" />
      <circle cx="63" cy="31" r="2.8" fill="#0088FF" />
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
