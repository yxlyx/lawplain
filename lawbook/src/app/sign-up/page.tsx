import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Create Account",
  description: "Create a Lawplain account for saved Singapore legal research.",
  path: "/sign-up",
  noIndex: true,
});

export default function SignUpPage() {
  return (
    <main className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 items-center px-5 py-6 sm:px-8">
      <Suspense>
        <AuthForm mode="sign-up" />
      </Suspense>
    </main>
  );
}
