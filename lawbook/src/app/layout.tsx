import type { Metadata } from "next";
import { Geist, Geist_Mono, Source_Serif_4 } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const sourceSerif = Source_Serif_4({
  variable: "--font-serif",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "sgjudge — Singapore Legal Research",
  description:
    "Search Singapore judgments, statutes, subsidiary legislation, Hansard, bills and practice directions across the sgjudge legal corpus.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${sourceSerif.variable} h-full antialiased`}
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
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-fg">
            <BalanceMark className="h-4.5 w-4.5" />
          </span>
          <span className="flex flex-col leading-none">
            <span className="font-serif text-lg font-semibold tracking-tight text-foreground">
              sgjudge
            </span>
            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-2">
              Legal Corpus
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
    <footer className="border-t border-border bg-surface-2/40">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p>
          <span className="font-serif font-semibold text-foreground">
            sgjudge
          </span>{" "}
          — a read-only projection of the Singapore legal corpus.
        </p>
        <p className="text-xs text-muted-2">
          Not legal advice. Data via{" "}
          <span className="font-mono">backend.lawplain.com</span>
        </p>
      </div>
    </footer>
  );
}

function BalanceMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v18" />
      <path d="M7 21h10" />
      <path d="M5 7h14" />
      <path d="M9 7 6 14a3 3 0 0 0 6 0z" opacity={0.9} />
      <path d="M15 7l3 7a3 3 0 0 1-6 0z" opacity={0.9} />
    </svg>
  );
}
