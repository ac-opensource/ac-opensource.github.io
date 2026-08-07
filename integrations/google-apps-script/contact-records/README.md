# Contact Records Google Sheet bridge

This Apps Script web app is the private persistence boundary for the production Contact page. It writes one idempotent row to a private Google Sheet and returns an iframe acknowledgement only after `SpreadsheetApp.flush()` and a request-ID readback succeed.

It is intentionally not deployed from this repository. The checked-in source contains no spreadsheet ID, deployment URL, credential, or private response.

## Personal-account setup

1. Sign into the personal Google account that should own portfolio contacts.
2. Create a private spreadsheet, copy its ID, and do not enable public link sharing.
3. Create a standalone Apps Script project and copy `Code.gs` and `appsscript.json` into it.
4. In **Project Settings → Script properties**, set:
   - `SPREADSHEET_ID` to the private spreadsheet ID.
   - `SHEET_NAME` to `Contact Records` (optional; this is the default).
   - `ALLOWED_ORIGINS` to `https://ac-opensource.github.io`. Add an exact temporary preview origin only while testing it.
5. Run `setupContactSheet()` once from the editor and approve only the requested spreadsheet scope.
6. Deploy as a **Web app**, execute as **Me**, with access set to **Anyone**. Use the `/exec` URL; `/dev` is editor-only.
7. Run the deployment verifier below and confirm its printed request ID appears in exactly one private Sheet row.
8. Only after that check passes, put the `/exec` URL in `assets/data/contact-runtime.json`, set `enabled` to `true`, and set `transport` to `apps_script_iframe`.
9. Build the site and submit one disposable browser contact. Confirm both the opaque in-page receipt and the exact private Sheet row before publishing.

## Deployment verification

Before enabling the endpoint in the public runtime, run the narrow deployment verifier against the `/exec` URL:

```bash
npm run contact:verify-apps-script -- --endpoint=https://script.google.com/macros/s/<deployment-id>/exec
```

The URL can instead come from the environment:

```bash
CONTACT_APPS_SCRIPT_ENDPOINT=https://script.google.com/macros/s/<deployment-id>/exec npm run contact:verify-apps-script
```

The verifier accepts only an HTTPS `script.google.com/macros/s/<deployment-id>/exec` URL with no credentials, query, or fragment. It posts one disposable private version-2 record, repeats the identical request and requires the same opaque receipt, then changes the content under the same request ID and requires the explicit not-stored page.

Apps Script wraps authored HTML in a `script.google.com` frame and renders it from a nested `script.googleusercontent.com` frame. The acknowledgement intentionally targets `window.top`; the portfolio accepts it only from those exact Google origins and only when its channel and high-entropy request ID match the pending submission.

Passing proves only that the deployed Apps Script reported its own Sheet flush/readback acknowledgement, idempotent replay, and conflict rejection. It does not independently read the Sheet. Use the printed request ID to confirm exactly one matching row and its fields in the private Sheet, then delete the disposable row if it is no longer needed. Do not activate the public runtime until that manual row check also passes.

The public deployment URL is not a credential. The Sheet ID and editor/deployment management URLs should remain outside the published site and repository.

JavaScript remains required on the portfolio page so each attempt carries a high-entropy idempotency key and receives a matched storage acknowledgement. The no-JavaScript fallback keeps the form disabled and offers the alternate LinkedIn route rather than risking an ambiguous duplicate row.

## Notification later

Programmatic Sheet writes do not fire a Form submit trigger. Add either:

- notification delivery directly after the row has been safely stored, recording mail failure separately; or
- a time-driven worker that finds `notification_status = pending`, emails the owner, and marks the row sent.

The time-driven worker is safer because contact persistence remains successful even when email delivery is temporarily unavailable.

## Abuse and privacy boundary

The anonymous web endpoint is public. It validates every field, rejects unknown parameters and a honeypot hit, enforces lengths and consent, serializes writes under a script lock, deduplicates request IDs, and escapes formula-like cell prefixes. Apps Script does not provide strong per-IP throttling; if spam becomes material, retain the same client contract behind a rate-limited serverless endpoint with a challenge such as Turnstile.
