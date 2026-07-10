import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Sign In",
  description: "Sign in to your Lawplain research workspace.",
  path: "/sign-in",
  noIndex: true,
});

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 items-center px-5 py-6 sm:px-8">
      <Suspense>
        <AuthForm mode="sign-in" />
      </Suspense>
    </main>
  );
}
