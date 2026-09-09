# Managed MCP access

Lawplain exposes a read-only MCP server at `/mcp`. The Developers page (`/developers`) lets a signed-in user request access, create a personal API key, enable MCP on that key, and inspect their own usage. `/admin/mcp` lets administrators approve or suspend accounts, restrict search and source-reading tools, change account request limits, and pause the service.

The research flow is: identify an issue, search for relevant authorities, read the exact judgment passage or statutory provision, then cite the source in the user's research or drafting workflow. The eight tools cover judgments, Acts, statutory sections, and supporting documents (Hansard, bills, subsidiary legislation, practice directions, and agency guidance). They call the corpus directly and never start an Ask sandbox. They do not access private notes or matters and do not observe a client's unrelated conversations.

## Access enforcement

Every POST checks a hashed Bearer key against the existing key store, checks that the key is not revoked and has MCP enabled, checks the global service switch, and requires the account's access status to be approved. A new account is pending; a new key has MCP disabled. Search and read permissions determine both the advertised tools and which handlers exist for that request. Checks run afresh on every request, including requests from clients that already connected. Suspension and pause block new calls; already executing reads may complete.

Limits are enforced per account across all its keys by an atomic D1 upsert in a one-minute window. Initialization and tool discovery count as requests too. A rejected quota returns HTTP 429 and Retry-After. JSON-RPC batches are rejected so one HTTP request cannot execute multiple metered tools. There is a 32 KB request limit, bounded search counts and passage lengths, a 512 KB upstream response limit, and a 15-second upstream timeout. The server accepts only the fixed corpus tool routes and does not follow upstream redirects.

This controls `lawplain.com/mcp`. The existing REST API and publicly accessible legal corpus are separate surfaces. MCP approval is not a paywall or a restriction on accessing public law through those other surfaces.

## Administrator setup

Apply migration `0024_mcp_access.sql` before deploying the updated Worker. Set the Worker variable or secret `LAWPLAIN_ADMIN_USER_IDS` to a comma-separated list of the intended administrators' existing, immutable Lawplain account IDs. Resolve the exact account from the owner's supplied username or email. Do not infer administrators from display names or grant based on a client-supplied email or role. An empty value grants no administrator access. The local `.env.example` documents this setting; local Worker bindings must supply the same variable.

Administrators sign in normally and open `/admin/mcp`, or follow “Manage MCP access” from `/developers`. Non-admin sessions cannot read or write the admin API. Browser mutations check same-origin requests. Permission edits and global service changes are recorded separately with the authenticated administrator identity.

## Client connection

Use `https://lawplain.com/mcp` as a Streamable HTTP endpoint, with the HTTP header:

```
Authorization: Bearer <your personal Lawplain key>
```

The MCP SDK handles the 2026-07-28 protocol and stateless compatibility with 2025-era clients. The key must be copied when created and explicitly enabled for MCP. Only clients supporting custom Authorization headers are supported by this setup; OAuth discovery, browser consent, and dynamic client registration are not implemented. API keys are never accepted from a query parameter at the MCP endpoint.

Protocol references: [official TypeScript SDK HTTP serving](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28), [Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

## Activity and retention

The activity store contains account ID, key ID, an allowlisted operation name, outcome, elapsed time, response bytes, and timestamp. Key names are joined for display. It does not persist tool arguments, queries, document bodies, tokens, IP addresses, or assistant conversations. Users can inspect only their own activity. Administrators can inspect all MCP activity and filter by account. The dashboard polls every 15 seconds while visible and displays the most recent 100 requests; summary metrics cover the past 24 hours. Failed authentication with an unknown key is not attributed to a user.

Activity and permission-change records older than 30 days are excluded from reads and deleted by an hourly Worker scheduled handler (minute 17 UTC) as well as request-time cleanup. Old rate windows are also purged. No exact dollar-cost attribution is claimed: corpus calls do not incur Ask-agent or sandbox provisioning, but hosting and client-model costs are separate.

## Verification

`npm test` includes SQLite-backed policy, quota, ownership, retention, failure, and payload-limit tests plus official MCP-client tests in legacy and modern modes. `npm run cf:build` checks the production Worker bundle.

An isolated local Cloudflare Worker with migrated D1 and fictional test accounts was also exercised through the real authentication and management routes: request access, enable a key, approve, discover tools, retrieve actual corpus results with all eight tools, suspend, narrow permissions, pause/resume globally, and inspect private activity. The browser controls were exercised in the same local runtime. These tests do not grant production roles or create billable Ask sandboxes.
