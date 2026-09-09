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
import "./garden.css";
import "./homepage.css";
import "./responsive.css";

const geistSans = Geist({
  variable: "--font-google-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  preload: false,
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

const THEME_BOOTSTRAP_SCRIPT = `try {
  const storedTheme = localStorage.getItem("lawplain:theme");
  if (storedTheme === "dark" || storedTheme === "light") {
    document.documentElement.dataset.theme = storedTheme;
    document.documentElement.style.colorScheme = storedTheme;
  }
} catch {}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${lora.variable} h-full antialiased`}
    >
      <body className="flex min-h-svh flex-col overflow-x-clip bg-background text-foreground">
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: The theme preference is validated before applying a fixed data attribute.
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
        />
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
    <footer className="site-footer">
      <div className="site-footer-inner">
        <Link className="site-footer-brand" href="/">
          Lawplain.
        </Link>
        <nav aria-label="Footer">
          <Link href="/research">Library</Link>
          <Link href="/faq">Help</Link>
          <Link href="/developers">API</Link>
          <a href="/llms.txt">For AI</a>
        </nav>
        <p>Legal information, not legal advice.</p>
      </div>
    </footer>
  );
}
