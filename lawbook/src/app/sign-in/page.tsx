import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";

export default function SignInPage() {
  return (
    <main className="mx-auto w-full max-w-md px-5 py-16 sm:px-8">
      <Suspense>
        <AuthForm mode="sign-in" />
      </Suspense>
    </main>
  );
}
