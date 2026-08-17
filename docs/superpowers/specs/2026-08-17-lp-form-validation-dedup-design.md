# LP Form Validation + Lead Dedup — Design

Date: 2026-08-17
Status: approved (operator, session 2026-08-17)
Scope: `lp/index.html`, `lp/planilha-leads-completa.gs`, `lp/planilha-setup.md`
Closes: #7, #10 · Out of scope: #8 (public webhook token — next package)

## Context

The funnel LP (`form.moviaautomacoes.com.br`) posts leads to a Google Apps
Script webhook that appends rows to the Leads spreadsheet. Verified live on
2026-08-17: the happy path works end-to-end, but

- the `telefone` field is free text (accepts 100+ chars);
- `doPost` appends any payload with no validation and no dedup — the same
  lead can be recorded unlimited times (also trivially via curl);
- the client sends with `mode: 'no-cors'`, swallows errors, and redirects to
  `/obrigado` unconditionally after 400 ms (issue #7): on webhook failure the
  visitor sees success and the paid lead is silently lost.

Key finding: the Apps Script `/exec` endpoint already returns
`Access-Control-Allow-Origin: *` (verified via curl). With a CORS "simple
request" (`Content-Type: text/plain` — no preflight, which Apps Script cannot
answer), the browser CAN read the webhook response. The current `no-cors` mode
discards it needlessly.

## Decisions (operator-approved, do not re-debate)

1. **Scope**: validation + dedup + issue #7 (no blind redirect) + issue #10
   (mobile friction). Issue #8 (webhook secret) excluded.
2. **Duplicate UX**: show inline message "Já recebemos seus dados — nossa
   equipe vai te chamar 👍" and do NOT redirect. Rationale: `/obrigado`
   pageview is the ads conversion; duplicates must not fire it again.
3. **Dedup key**: same normalized `telefone` OR same normalized `email`
   (phone: digits only; email: trimmed lowercase).
4. **Dedup window**: 30 days. Older matching lead re-enters as a new row
   (renewed-interest signal for sales).
5. **Failure fallback**: automatic retry ×2 (short backoff), then error
   message "Não conseguimos enviar, tente novamente" with the submit button
   re-enabled. No WhatsApp fallback for now.

## Architecture

Single source of truth server-side (Apps Script). Client-side validation is
UX only; the server re-validates everything (protects against curl/spam).

### Response contract (webhook → form)

`doPost` returns `ContentService` JSON:

```json
{ "status": "ok" }          // row appended
{ "status": "duplicate" }   // phone or email seen in last 30 days
{ "status": "invalid" }     // payload failed server-side validation
```

Any network error, non-JSON body, or unexpected status is treated by the
client as failure (retry path). The deployment URL does not change (new
version of the same deployment), so LP and script ship independently —
mixed-version behavior is covered in Rollout.

### Client — `lp/index.html`

Field hardening (closes #10):

- `telefone`: `type="tel"`, `inputmode="numeric"`, `autocomplete="tel"`,
  `maxlength="16"`, input mask `(00) 00000-0000` while typing, JS validation
  requires 10–11 digits (DDD + landline/mobile) before submit.
- `email`: keep `type="email"`, add `autocomplete="email"`, `maxlength="120"`.
- `nome` / `empresa`: `maxlength="80"`, trimmed, min 2 chars;
  `autocomplete="name"` / `autocomplete="organization"`.
- Visible `<label>` for every field (currently placeholder-only).
- All fields remain `required`; selects unchanged.

Submit flow (replaces the unconditional `setTimeout` redirect; closes #7):

1. `preventDefault`, run `checkValidity()` + phone-digit check.
2. Disable button ("Enviando...").
3. `fetch(WEBHOOK_URL, { method:'POST', mode:'cors', headers:
   {'Content-Type':'text/plain;charset=utf-8'}, body: JSON, keepalive:true })`
   and **await** the response; parse JSON.
4. Dispatch on `status`:
   - `ok` → push `form_submit_funil` to dataLayer (moved here from
     pre-send, so the GTM event fires only on confirmed writes), then
     `window.location.href = '/obrigado'`.
   - `duplicate` → hide/disable form controls, show inline notice
     "Já recebemos seus dados — nossa equipe vai te chamar 👍". No redirect,
     no dataLayer event.
   - `invalid` → show generic inline error asking to review the fields,
     re-enable button.
   - fetch rejection / non-2xx / unparseable → retry up to 2 more times
     (backoff ~1.5 s); after 3rd failure show "Não conseguimos enviar,
     tente novamente" and re-enable the button.

### Server — `lp/planilha-leads-completa.gs` (`doPost` v3)

1. `JSON.parse` inside try/catch → `invalid` on bad JSON.
2. Validate: `nome`/`empresa` 2–80 chars; `telefone` normalizes to 10–11
   digits; `email` matches a simple regex, ≤120 chars; every other field
   capped at 100 chars. Failure → `invalid`, nothing written.
3. Normalize: phone digits-only, email trim+lowercase (stored values keep
   the visitor's original formatting; normalization is compare-only).
4. Dedup: read `Leads` sheet data, compare normalized phone/email of rows
   whose `Data` is within the last 30 days → on match return `duplicate`.
5. Wrap check+append in `LockService.getScriptLock()` (30 s wait) so two
   concurrent submits of the same lead cannot both pass the dedup check.
6. Append row (unchanged column layout) → return `ok`.

Documentation fix (part of #7): rewrite the `.gs` header comment — editing
the script REQUIRES "Implantar → Gerenciar implantações → editar → Nova
versão" for `/exec` to pick it up. Align `lp/planilha-setup.md` (already
correct) and remove the "NÃO precisa reimplantar" claim.

## Rollout order

1. Merge PR; Railway redeploys `movia-form` only (watch paths, PR #14).
2. Operator pastes the new `.gs` into the spreadsheet editor and publishes a
   **new version** of the existing deployment (URL unchanged).
3. Ordering note: deploy the **script first, then the LP** ideally — but the
   contract degrades safely in either order: the new client treats the legacy
   `ok` text response as a failed JSON parse → retries → shows the error
   message (lead still written once; duplicates blocked only after script
   update). Window is minutes; acceptable.
4. Post-deploy smoke: curl invalid payload → `invalid`; same payload twice →
   second returns `duplicate`; browser submit → `/obrigado` + sheet row;
   immediate resubmit → inline duplicate notice.

## Acceptance criteria

- Phone input cannot hold 100 chars; mobile shows numeric keyboard; 9-digit
  mobile with DDD passes, 5-digit garbage fails client AND server.
- Same phone or email submitted twice within 30 days → second attempt shows
  the duplicate notice, no new sheet row, no GTM conversion event.
- Webhook down/unreachable → after 3 attempts the visitor sees the error
  message with an active button — never a false `/obrigado`.
- Valid new lead → exactly one sheet row, `form_submit_funil` fires,
  redirect to `/obrigado`.
- curl with a 500-char payload or malformed JSON → `invalid`, sheet
  untouched.
- `.gs` header no longer claims redeploy is unnecessary.

## Testing

No JS test harness exists in `lp/` (static page); verification is the
post-deploy smoke above plus curl-based contract checks against `/exec`.
Client logic is kept in small named functions (mask, validate, submit) to
stay reviewable.
