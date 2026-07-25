# Private notes and Ask — the privacy contract (#200)

What happens when a reader chooses to use their own annotations with Ask, and what
does not happen. #200 requires this be documented before launch; this is that
document.

## The contract

**Off by default, per request.** `includePrivateNotes` must be literally `true` in
the request body. There is no stored preference, no remembered default and no
"always allow". Closing the dialog or reloading returns to off, because there was
never anything to return from — consent is not persisted anywhere.

**Nothing is included without being named.** Consent carries the exact annotation
ids and document-note authority ids to use. An empty list is not "everything"; it
is nothing, and the request answers with an empty manifest and a plain sentence
saying so.

**Fails closed.** Malformed, oversized or partially-valid consent becomes
`NO_CONSENT`. The worst outcome of a bug in parsing must be that notes are left
out, never that they are sent.

**Inspectable before sending.** `preview: true` returns the manifest — every item,
its citation, and a preview of the note text that would be used. The manifest is
built from the same rows the request will use, so it cannot drift from what is
actually sent.

**Authorization is rechecked server-side.** The client's claim about which
annotations it may use is a request, not a fact. Every id is re-filtered by the
session's own user id, so a borrowed id does not come back from the query and
cannot enter a prompt.

**Provenance survives.** Source law, the reader's notes and generated text are
separate blocks with separate `provenance` values, never a pre-merged paragraph.
A generated claim cites the `ref` of the block it came from, and
`verifyClaimCitations` reports any claim that cites nothing or an unknown ref
rather than presenting it as grounded.

**Logs and analytics see counts, not content.** `redactForLogs` yields block
counts and refs. Refs identify rows the owner already has and carry no note text.
No route logs the note itself, and `privateRoute` keeps payloads out of error logs.

**A caveat always ships with output.** Every manifest carries `LEGAL_CAVEAT`, so a
generated brief cannot be presented as advice.

## Provider and retention

The model provider is Anthropic, reached from the Cloudflare Worker. What this
means for note text a reader has explicitly opted in:

| Question | Answer |
|---|---|
| Is note text sent to the provider? | Only for a request carrying explicit consent, and only the named items. |
| Is it used for training? | No. Anthropic does not train on API inputs or outputs by default. |
| How long does the provider retain it? | Per Anthropic's API data-retention policy for the account in use. Verify the current term before launch and record it here; do not assume it. |
| Is it reused across chats? | No. Context is assembled per request from the consented ids and is not carried into another thread. |
| Where is consent stored? | Nowhere. It exists for the lifetime of the request. |
| What is stored about the request? | Only what the caller records, and the only shape offered is the redacted summary. |
| What happens on deletion? | Deleting an annotation or document note removes the only copy this product holds. Provider-side retention is governed by the row above. |

**Before launch, confirm and record here:** the account's actual retention term,
whether zero-retention is enabled, and the deletion path for anything the provider
holds. Two of those depend on account configuration rather than on this code, so
they cannot be asserted in a test — which is why they are written down.

## Failure behaviour

| Failure | Behaviour |
|---|---|
| Not signed in | 401, nothing read |
| Malformed consent | Empty manifest, plain explanation, nothing read |
| Borrowed annotation id | Silently absent from the manifest; not an error the caller can probe with |
| Provider unavailable | The reader's notes are unchanged; a generated result is never written over them |
| Reader cancels | No draft persisted, no default changed |

## What is deliberately not here

No "remember this choice", no account-level toggle, and no default-on path. Each
would turn a per-request decision into a standing one, which is the failure mode
#200 exists to prevent.
