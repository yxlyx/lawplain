import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-0 w-full max-w-md flex-1 items-center px-5 py-6 sm:px-8">
      <Suspense>
        <AuthForm mode="sign-in" />
      </Suspense>
    </main>
  );
}
