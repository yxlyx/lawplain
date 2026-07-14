This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Ask Lawplain — agentic natural-language search

The home page has an **Ask Lawplain** box that answers natural-language
questions about the corpus (e.g. *"What must a plaintiff prove in a defamation
claim?"*). It does **not** call a hosted LLM API directly — it drives a local
[`graff`](https://github.com/justrach/codegraff) coding agent via
[`@codegraff/sdk`](https://www.npmjs.com/package/@codegraff/sdk). The agent is
given the `sgjudge` REST endpoints as its tool surface and runs `curl` against
`backend.lawplain.com` itself, iterating over searches and detail fetches, then
writes a cited answer that streams back to the page.

Flow:

```
browser ─POST {question}─▶ /api/ask (Node runtime)
                              │  runAgent({ yolo, systemPrompt, cwd: <tmp> })
                              ▼
                          graff --json  ──bash+curl──▶  backend.lawplain.com
                              │  streams Event{ text | tool_call | turn }
                              ▼
                  Server-Sent Events ─▶ AskAgent.tsx (streaming markdown)
```

Files: `src/lib/agent.ts` (system prompt + `runAgent` wrapper),
`src/app/api/ask/route.ts` (SSE route, Node runtime),
`src/components/AskAgent.tsx` (client UI).

### Agent setup

The route handler spawns the `graff` binary as a subprocess, so:

1. **Install `graff`** (one line, macOS/Linux):
   ```bash
   curl -fsSL https://github.com/justrach/codegraff/releases/latest/download/install.sh | sh
   ```
2. **Give it a model key.** Any provider graff supports works — pick one and
   set its key:
   ```bash
   graff key set kimi sk-...          # or: export KIMI_API_KEY=sk-...
   graff key set deepseek sk-...      # or: export DEEPSEEK_API_KEY=sk-...
   graff key set openai sk-...        # or: export OPENAI_API_KEY=sk-...
   ```
   (`graff login` / `graff login codex` also work for the free codegraff key
   or a ChatGPT subscription.)
3. **Pick the model** (optional). Defaults to `glm-5.2`; override with:
   ```bash
   export LAWPLAIN_AGENT_MODEL=claude-sonnet-4-6   # any graff-supported model
   ```
   Binary not on PATH? `export LAWGRAFF_BINARY=/path/to/graff`.

4. **Enable Ask explicitly** in `.env.local` (it is fail-closed when omitted):
   ```bash
   LAWPLAIN_ASK_AGENT_ENABLED=true
   LAWPLAIN_PUBLIC_HOST=localhost
   LAWPLAIN_AGENT_CREDENTIAL=CODEGRAFF_API_KEY
   CODEGRAFF_API_KEY=...
   ```
   `LAWPLAIN_AGENT_CREDENTIAL` selects exactly one credential variable to pass
   to the agent; it defaults to `CODEGRAFF_API_KEY`. Do not configure it with a
   list of keys.

Then `npm run dev` and use the **Ask Lawplain** box. Without explicit enablement
or the selected credential, Ask reports that it is unavailable. The local
fallback runs `graff --yolo` on the developer machine and is intended only for
a trusted development environment. Configure `CUBESANDBOX_GATEWAY_URL` and
`CUBESANDBOX_TENANT_KEY` to exercise the isolated path; production always uses
CubeSandbox rather than treating the Worker host as a trusted shell.

Production Ask runs in CubeSandbox with CodeGraff `v0.0.200`, pinned at
SHA-256 `3fefe2bc01edd64f4974e0c9a529cab0b7ebd0cb0da5ef2e30c4d256d1856351`
and verified before extraction. Runs have a five-minute deadline, at most six
tool calls (with duplicate calls rejected), a 1 MB captured stdout limit and a
1 MB captured stderr limit; persisted event payloads are additionally bounded.
The local SDK path passes the same tool controls through its supported raw
`args` option, but production remains on the controlled sandbox path. The
default model remains `glm-5.2`; no paid benchmark was run to justify changing
it.

A fixed, secret-free benchmark fixture is available via `npm run benchmark:ask`.
It refuses to run unless both `LAWPLAIN_BENCHMARK_URL` and
`LAWPLAIN_BENCHMARK_RUN=yes` are set, and writes one JSONL metrics record to
stdout. Authentication, if required by the target, must be provided by the
operator's environment/network setup; the script does not print credentials.

## Authentication and D1 setup

Lawplain uses [Better Auth](https://www.better-auth.com/) for username/password accounts plus Google OAuth. Auth data is stored in a Cloudflare D1 database bound as `AUTH_DB`.

1. Generate a Better Auth secret:
   ```bash
   openssl rand -base64 32
   ```
2. In Google Cloud Console, create an OAuth 2.0 **Web application** client and add these authorized redirect URIs:
   - Local: `http://localhost:3000/api/auth/callback/google`
   - Production: `https://lawplain.com/api/auth/callback/google`
3. Copy `.env.example` to `.env.local` and set:
   ```bash
   BETTER_AUTH_SECRET=...
   BETTER_AUTH_URL=http://localhost:3000
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```
4. Create the authentication and private trajectory D1 databases:
   ```bash
   bun run d1:create
   bun run d1:create:trajectories
   ```
5. Copy the returned `database_id` values into their matching bindings in
   `wrangler.jsonc`.
6. Apply both schemas locally or remotely:
   ```bash
   bun run d1:migrate:local
   bun run d1:migrate:trajectories:local
   bun run d1:migrate:remote
   bun run d1:migrate:trajectories:remote
   ```
7. Run the app:
   ```bash
   bun run dev
   ```

For Cloudflare production, keep credentials out of `wrangler.jsonc` and set
them as Worker secrets:

```bash
bunx wrangler secret put BETTER_AUTH_SECRET
bunx wrangler secret put GOOGLE_CLIENT_ID
bunx wrangler secret put GOOGLE_CLIENT_SECRET
bunx wrangler secret put CODEGRAFF_API_KEY
bunx wrangler secret put CUBESANDBOX_GATEWAY_URL
bunx wrangler secret put CUBESANDBOX_TENANT_KEY
```

`wrangler.jsonc` deliberately sets the non-secret production controls
`LAWPLAIN_ASK_AGENT_ENABLED=true`, `LAWPLAIN_PUBLIC_HOST=lawplain.com`, and
`LAWPLAIN_AGENT_CREDENTIAL=CODEGRAFF_API_KEY`; retain them when deploying or Ask
will fail closed. `BETTER_AUTH_URL` is also set to `https://lawplain.com` and
must match the origin used by the production Google OAuth callback URL.

Account routes:

- `/sign-up` — create a username/password account.
- `/sign-in` — sign in with username/password.
- `/api/auth/*` — Better Auth handler.

`/api/ask` requires an authenticated session before it starts the long-running agent workflow.

Production Ask runs also write a private, Worker-only record to the separate
`TRAJECTORY_DB` binding. `ask_trajectories` stores the run input, final output,
status, timing and usage; `ask_trajectory_events` stores the ordered normalized
progress and tool events. No public route exposes this database.

## Saved research and Quotes

`/saved` is the canonical signed-in workspace for saved documents, search
history, Ask answers, and Quotes. Quotes are intentionally narrow, durable
excerpts from judgments and statutes only; they are not a general-purpose
highlighting or annotation suite.

### Notes & caveats

- **`yolo: true` is required** — without it the agent's `bash` (the `curl`
  calls) is blocked at the permission gate, since the JSON protocol has no human
  to approve. Production contains that shell in a disposable CubeSandbox VM;
  the local fallback uses an isolated temporary working directory but still
  executes on the trusted developer machine. Telemetry is disabled. Treat any
  local yolo shell as server-side code execution and review the system prompt
  in `src/lib/agent.ts`.
- **Latency.** A turn is several LLM round trips plus `curl`s, so it's slower
  than the keyword search above it — expect ~20–60s. The UI streams text and
  shows each search as a chip while it works.
- **Serverless.** This needs the Node runtime (it spawns a subprocess), so it
  won't run on Vercel Edge. For edge/serverless without the binary, run
  `graff serve` somewhere and swap `runAgent` for the SDK's
  `runAgentRemote`/`RemoteHarness` (from `@codegraff/sdk/remote`) in
  `src/lib/agent.ts`.
- The agent is instructed to cite and to **not fabricate** citations or section
  numbers; if the corpus lacks the answer it says so. Still: legal information,
  not legal advice.
