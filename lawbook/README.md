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
3. **Pick the model** (optional). Defaults to `kimi-k2.7`; override with:
   ```bash
   export LAWPLAIN_AGENT_MODEL=claude-sonnet-4-6   # any graff-supported model
   ```
   Binary not on PATH? `export LAWGRAFF_BINARY=/path/to/graff`.

Then `npm run dev` and use the **Ask Lawplain** box. With no key configured the
route returns an `error` event explaining the model is unavailable.

## Authentication and D1 setup

Lawplain uses [Better Auth](https://www.better-auth.com/) for username/password accounts. Auth data is stored in a Cloudflare D1 database bound as `AUTH_DB`.

1. Generate a Better Auth secret:
   ```bash
   openssl rand -base64 32
   ```
2. Copy `.env.example` to `.env.local` and set:
   ```bash
   BETTER_AUTH_SECRET=...
   BETTER_AUTH_URL=http://localhost:3000
   ```
3. Create the D1 database:
   ```bash
   bun run d1:create
   ```
4. Copy the returned `database_id` into `wrangler.jsonc`.
5. Apply the auth schema locally or remotely:
   ```bash
   bun run d1:migrate:local
   bun run d1:migrate:remote
   ```
6. Run the app:
   ```bash
   bun run dev
   ```

Account routes:

- `/sign-up` — create a username/password account.
- `/sign-in` — sign in with username/password.
- `/api/auth/*` — Better Auth handler.

`/api/ask` now requires an authenticated session before it starts the long-running agent workflow.

### Notes & caveats

- **`yolo: true` is required** — without it the agent's `bash` (the `curl`
  calls) is blocked at the permission gate, since the JSON protocol has no human
  to approve. The agent runs in an **isolated temp cwd** so it cannot touch the
  project source, and `GRAFF_NO_TELEMETRY=1` keeps the SDK's outbound fleet
  telemetry off. Treat the yolo bash surface as you would any server-side code
  execution: don't expose `/api/ask` unauthenticated on a public host without
  rate-limiting and your own review of the system prompt in `src/lib/agent.ts`.
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
