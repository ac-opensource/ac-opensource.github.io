# Contact records and Signals publication contract

The production Contact page never opens an email client and never equates an animation, iframe load, or network attempt with persistence. A completion state appears only after a configured record service returns a contract-valid opaque receipt.

The checked-in `assets/data/contact-runtime.json` is public configuration, not a secret store. Its default state remains disabled with blank endpoints until the personal Sheet bridge is deployed and externally verified. In that state, the submit control is disabled and the page says that no record service is connected.

## Runtime transports

Version 1 runtime configuration has six exact fields: `version`, `enabled`, `transport`, `endpoint`, `publicFeedEndpoint`, and `requestTimeoutMs`.

- `disabled`: blank endpoints and no submission. This is the checked-in state.
- `json_endpoint`: a CORS-aware JSON service used by the exact-loopback integration environment and retained as a provider-neutral future option.
- `apps_script_iframe`: a normal POST into a hidden iframe backed by a private Google Sheet. The returned relay message is accepted only from the submitted iframe, from a Google Apps Script acknowledgement origin, and for the pending high-entropy request ID.

Legacy five-field runtime objects remain readable only so isolated experiment pages keep working. A disabled legacy object uses the historical email-app handoff; the production page always publishes the explicit six-field config and does not use that path.

## Contact payload and acknowledgement

Production submissions use payload version 2. Private payloads contain exactly:

- `version`
- `submissionId`
- `intent`
- `name`
- `email`
- `privateMessage`
- local `contextPath`

Private contact requests require non-empty trimmed message text up to 4000 characters, including a brief message such as `Hi!`. Public review requests may leave that private message empty and instead add one `public` object containing a non-empty quote of up to 280 characters, one allowlisted local target, an explicit anonymous or named display choice, and consent set to true. The private message is never inferred to be the public quote. Public attribution is anonymous by default.

The record service may acknowledge only:

- Private: matching version, opaque `receiptId`, private intent, and `confirmed` state.
- Public: matching version, opaque `receiptId`, public intent, and `pending_moderation` state.

Retries reuse the same `submissionId`. The storage boundary must return the original receipt rather than append a duplicate. A public response of `approved` is invalid and the client rejects it.

The Apps Script relay posts the response on channel `ac-contact-v2` only after its Sheet append, flush, and request-ID readback succeed. A timeout or malformed relay preserves the form and produces a failure state. It does not claim that the row might have been stored.

## No-JavaScript behavior

The no-JavaScript control remains disabled and explains the alternate LinkedIn route, whether or not the record bridge is configured. Verified storage depends on the high-entropy browser idempotency key and authenticated acknowledgement relay, so the static fallback never posts, opens a mail client, or risks ambiguous duplicate rows.

## Private Sheet bridge

The deployable source and setup guide live under `integrations/google-apps-script/contact-records/`. The script:

- executes as the personal Sheet owner;
- accepts anonymous POSTs but no credentials from the browser;
- validates exact fields, lengths, consent, context paths, and a honeypot;
- serializes and deduplicates writes under a script lock;
- escapes formula-like cell prefixes;
- stores private data only in a non-public Sheet;
- never logs private message content;
- returns a receipt only after row readback.

The endpoint URL is public by design and is not an abuse control. Apps Script cannot provide strong per-IP rate limiting. If spam becomes material, keep the same payload/receipt contract behind a rate-limited serverless endpoint and a challenge such as Turnstile.

## Signals boundary

Contact storage does not automatically publish a Signal. Public feedback remains pending until a human creates an approved feed record. The GET `publicFeedEndpoint`, when separately configured, returns version 1 and a `records` array. The public registry accepts only:

- Approved: stable opaque ID, approved status, anonymous or named display label, non-empty quote of up to 280 characters, exactly one allowlisted local target, created and approved dates, and deterministic slot.
- Removed: stable opaque ID, removed status, and deterministic slot only.

Pending, rejected, unknown, external-link, protocol-relative, duplicate-ID, duplicate-slot, private, and structurally inconsistent records fail the build or runtime contract. Removed records expose no quote, attribution, target, dates, private message, email, moderation notes, or rejection reason.

The checked-in Signals feed remains intentionally empty and the page stays `noindex,follow` until an approved record exists.

## Exact-loopback development

After building the site, run:

    node scripts/local-contact-signals-server.js

The server binds only `127.0.0.1`, rejects a non-exact Host header, injects a `json_endpoint` runtime at response time, and writes validated Contact submissions to an isolated SQLite record store. It serves unmistakably local feed fixtures. The server, database, and fixture data are never copied to `dist/`.

The local browser matrix verifies persistent insert, idempotent retry, invalid-response rejection, content preservation, private/public boundaries, reduced motion, no-JavaScript behavior, and responsive overflow. A separate disposable submission against the real personal Apps Script deployment is still required before publication activation can be called proven.
