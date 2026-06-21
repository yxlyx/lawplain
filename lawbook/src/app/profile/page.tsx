import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

type SessionUser = {
  name?: string | null;
  email?: string | null;
  username?: string | null;
  createdAt?: Date | string | null;
};

export default async function ProfilePage() {
  const session = await getSession(await headers());
  if (!session?.user) redirect("/sign-in?next=/profile");

  const user = session.user as SessionUser;
  const username = user.username ?? user.name ?? "Lawplain user";
  const createdAt = user.createdAt ? new Date(user.createdAt) : null;

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-12 sm:px-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-2">
            Profile
          </p>
          <h1 className="mt-2 font-serif text-4xl font-medium tracking-tight text-foreground">
            {username}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {createdAt
              ? `Account created ${createdAt.toLocaleDateString()}.`
              : "Your Lawplain research profile."}
          </p>
        </div>
        <Link
          href="/ask"
          className="inline-flex rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-primary-fg transition-opacity hover:opacity-90"
        >
          Ask Lawplain
        </Link>
      </div>

      <section className="grid gap-4 sm:grid-cols-2">
        <ProfileCard
          title="Saved citations"
          description="Cases and statutes you bookmark will appear here."
        />
        <ProfileCard
          title="Saved highlights"
          description="Pinpoint passages and notes from judgments/statutes."
        />
        <ProfileCard
          title="Ask answers"
          description="Persisted AI research answers with source links."
        />
        <ProfileCard
          title="Recent searches"
          description="Search history and saved result sets for comparison."
        />
      </section>
    </main>
  );
}

function ProfileCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <article className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>
      <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-2">
        Coming soon
      </p>
    </article>
  );
}
