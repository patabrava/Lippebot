# Pipedrive Bypass Email Launch Plan

**Goal:** Add a reversible production launch mode in which Sarah never reads from or writes to Pipedrive and sends each completed or abandoned chat transcript to the configured internal recipients, initially `berg@lippelift.de` and `caechma@gmail.com`.

**Architecture:** Put one explicit feature-flag branch at the start of the request orchestrator. When bypass mode is enabled, the branch records that CRM was intentionally skipped, sends a neutral transcript email to every configured bypass recipient, and completes the request without calling any Pipedrive method or departmental routing path. When bypass mode is disabled, the existing Pipedrive and departmental-routing workflow executes unchanged. Keep the Pipedrive credentials configured so development and testing of the full workflow can continue without changing the launch-mode contract.

**Tech Stack:** TypeScript, Hono SSE, Zod configuration, Nodemailer SMTP, request-scoped journal checkpoints, Vitest, Docker Compose/Hostinger deployment.

---

## Product Contract

### Bypass mode enabled

- Pipedrive receives no API requests: no searches, reads, person creation, deal creation, updates, activities, or notes.
- Completed opportunity and service requests are emailed to every address in `PIPEDRIVE_BYPASS_EMAIL_TO`.
- General or unfinished chats submitted through the existing abandoned-chat endpoint use the same bypass recipient configuration.
- The email contains the request/session identifier, available customer and contact data, a concise concern summary, and the full transcript.
- The customer sees the existing generic successful-handoff message only after all configured recipients have accepted the email.
- Departmental destinations such as Sales, Technik, Finance, and Lossau are not added automatically.
- Recipient delivery is idempotent per request and per normalized email address.

### Bypass mode disabled

- The current request policy, Pipedrive behavior, departmental routing, and internal-copy configuration remain unchanged.
- No bypass recipient is injected into the full workflow unless it is also configured in that workflow's existing recipient variables.
- Switching modes requires only an environment-variable change and an application restart/redeployment, not a code change.

### Initial production configuration

```dotenv
PIPEDRIVE_BYPASS_ENABLED=true
PIPEDRIVE_BYPASS_EMAIL_TO=berg@lippelift.de,caechma@gmail.com
```

The recipient list is configuration, not a hard-coded business rule. It accepts comma- or semicolon-separated addresses, trims whitespace, and removes case-insensitive duplicates. A future recipient change updates only `PIPEDRIVE_BYPASS_EMAIL_TO`.

The safe default is:

```dotenv
PIPEDRIVE_BYPASS_ENABLED=false
PIPEDRIVE_BYPASS_EMAIL_TO=berg@lippelift.de,caechma@gmail.com
```

This prevents a missing deployment variable from silently disabling the full Pipedrive workflow. Production must explicitly enable bypass mode.

---

## File Structure

- Modify `backend/src/config/index.ts`: parse and validate the bypass flag and recipient list.
- Modify `backend/src/email/recipients.ts`: expose bypass-recipient resolution without forcing the existing internal-copy defaults into it.
- Modify `backend/src/services/email.ts`: add a neutral bypass notification renderer and sender.
- Modify `backend/src/request/request-orchestrator.ts`: add the early bypass execution path.
- Modify `backend/src/services/conversation-tracking.ts`: add an auditable `crm_bypassed` request checkpoint.
- Modify `backend/src/routes/chat.ts`: route abandoned-chat emails through bypass recipients while bypass mode is active.
- Modify `backend/src/index.ts`: inject bypass configuration and expose the active mode in the health response/logging.
- Modify `backend/.env.example`: document both bypass variables without adding credentials.
- Modify `deploy/hostinger-lippebot-demo.compose.yml`: pass both variables into the backend container.
- Modify `backend/tests/config.test.ts`: cover defaults, explicit enablement, and configurable recipients.
- Modify `backend/tests/email-recipients.test.ts`: cover parsing, deduplication, and recipient replacement.
- Modify `backend/tests/email.test.ts`: verify the neutral bypass email content and escaping.
- Modify `backend/tests/request-orchestrator.test.ts`: prove zero Pipedrive calls and reliable multi-recipient delivery.
- Modify `backend/tests/integration.test.ts`: verify the SSE completion/error behavior in both modes.

---

## Task 1: Define and Validate the Configuration Boundary

**Files:**

- Modify: `backend/src/config/index.ts`
- Modify: `backend/src/email/recipients.ts`
- Modify: `backend/.env.example`
- Test: `backend/tests/config.test.ts`
- Test: `backend/tests/email-recipients.test.ts`

- [ ] Add failing configuration tests for:
  - bypass defaults to `false`;
  - the default bypass recipients are Berg and caechma;
  - `true`, `1`, `yes`, and `on` enable the mode;
  - configured recipients replace the default list rather than being appended to it;
  - comma and semicolon separators are accepted;
  - whitespace and case-insensitive duplicates are removed;
  - enabling bypass with an explicitly blank or invalid recipient list fails at startup instead of dropping chat notifications.

- [ ] Add these typed configuration fields:

```ts
pipedriveBypassEnabled: boolean;
pipedriveBypassEmailTo: string;
```

- [ ] Read them from:

```dotenv
PIPEDRIVE_BYPASS_ENABLED
PIPEDRIVE_BYPASS_EMAIL_TO
```

- [ ] Add a focused `resolveBypassEmailRecipients()` helper. It must return the configured list when present and use `berg@lippelift.de,caechma@gmail.com` only as the default. Do not use `resolveInternalEmailRecipients()` because that helper deliberately appends its mandatory internal copies and would make bypass recipients impossible to replace through configuration.

- [ ] Document the variables in `backend/.env.example`, including the production-on and normal-development-off examples.

- [ ] Run:

```bash
cd backend
npm test -- tests/config.test.ts tests/email-recipients.test.ts
```

Expected: all focused tests pass.

---

## Task 2: Add a CRM-Neutral Bypass Email

**Files:**

- Modify: `backend/src/services/email.ts`
- Test: `backend/tests/email.test.ts`

- [ ] Add failing tests for a new `sendBypassNotification()` method.

- [ ] Define one payload that supports either opportunity or service data:

```ts
interface BypassNotification {
  sessionId: string;
  requestId: string;
  kind: 'opportunity' | 'service' | 'general';
  summary: string;
  transcript: string;
  completedAt: string;
  leadData?: LeadData;
  supportData?: SupportData;
}
```

- [ ] Render a neutral German subject such as:

```text
Sarah Chat [<requestId>] – Neue Anfrage
```

- [ ] Include:
  - request and session IDs;
  - completion time;
  - customer name;
  - telephone or email when available;
  - concern/category when available;
  - full chronological transcript.

- [ ] Do not include:
  - a Pipedrive button or link;
  - CRM outcome, match state, deal ID, person ID, or note status;
  - departmental-routing metadata;
  - wording that implies a CRM record was created or searched.

- [ ] Reuse the existing HTML escaping and per-recipient SMTP rejection checks.

- [ ] Test HTML escaping, missing optional fields, transcript inclusion, and SMTP rejection.

- [ ] Run:

```bash
cd backend
npm test -- tests/email.test.ts
```

Expected: all email tests pass.

---

## Task 3: Implement the Early Orchestrator Bypass

**Files:**

- Modify: `backend/src/request/request-orchestrator.ts`
- Modify: `backend/src/services/conversation-tracking.ts`
- Test: `backend/tests/request-orchestrator.test.ts`
- Test: `backend/tests/request-journal.test.ts`

- [ ] Extend the orchestrator dependencies with an immutable launch-mode configuration:

```ts
bypass: {
  enabled: boolean;
  recipients: string[];
}
```

- [ ] Add `crm_bypassed` to `RequestCheckpointStep`.

- [ ] At the beginning of `execute()`, after validating `requestId`, branch to `executeBypass()` when enabled. This branch must run before `executeOpportunity()`, `executeService()`, `classifyRequestPolicy()`, or any Pipedrive method.

- [ ] In `executeBypass()`:
  1. Determine only the neutral email kind from the validated request input.
  2. Record a `crm_bypassed` checkpoint containing `{ reason: 'launch_mode' }`.
  3. Send the bypass notification separately to every configured recipient.
  4. Use the existing `email_recipient:<normalized-address>` journal checkpoints.
  5. Record the aggregate `email` checkpoint only after all recipients succeed.
  6. Record `completed` only after email success.
  7. Return a result that contains no `crm`, `sourceCase`, person ID, or deal ID.

- [ ] Add tests proving, for both opportunity and service inputs:
  - every Pipedrive dependency has zero calls;
  - exactly Berg and caechma receive the message under the initial configuration;
  - Sales, Technik, Finance, and Lossau are not implicit recipients;
  - each email contains the complete request transcript;
  - duplicate recipient spelling/casing produces one delivery;
  - retry after one recipient failure sends only to the failed recipient;
  - a process restart with durable journal checkpoints does not resend confirmed recipients;
  - the request does not report completion when any configured recipient remains undelivered.

- [ ] Add a paired test with bypass disabled proving the existing Pipedrive and departmental flow is unchanged.

- [ ] Run:

```bash
cd backend
npm test -- tests/request-orchestrator.test.ts tests/request-journal.test.ts
```

Expected: all orchestration and journal tests pass.

---

## Task 4: Wire the Mode Through the Application

**Files:**

- Modify: `backend/src/index.ts`
- Modify: `backend/src/routes/chat.ts`
- Test: `backend/tests/integration.test.ts`

- [ ] Resolve the bypass recipients once during startup and inject the frozen list into the request orchestrator.

- [ ] Pass the same active-mode information to the chat route.

- [ ] When bypass is enabled, make `/api/chat/abandoned` send its existing summary and transcript to the bypass list. When disabled, preserve its current `SERVICE_EMAIL_TO` behavior.

- [ ] Keep actionable-request delivery in the orchestrator. Do not add a second route-level email for the same completed request.

- [ ] Extend `/api/health` with non-sensitive mode information:

```json
{
  "pipedriveBypass": true,
  "bypassRecipientCount": 2
}
```

Do not expose recipient addresses, SMTP credentials, or the Pipedrive key in health output.

- [ ] Log the active mode and recipient count at startup without logging addresses.

- [ ] Add integration tests proving:
  - bypass mode completes after both email deliveries;
  - bypass mode performs no Pipedrive operation;
  - final SMTP failure emits the existing generic SSE error and no success confirmation;
  - abandoned chats go to the bypass recipients;
  - disabled mode follows the existing full workflow.

- [ ] Run:

```bash
cd backend
npm test -- tests/integration.test.ts
```

Expected: all integration tests pass.

---

## Task 5: Add Deployment Configuration and Verification

**Files:**

- Modify: `deploy/hostinger-lippebot-demo.compose.yml`
- Optionally modify: other deployment manifests that actually run Sarah in production

- [ ] Pass through:

```yaml
PIPEDRIVE_BYPASS_ENABLED: ${PIPEDRIVE_BYPASS_ENABLED:-false}
PIPEDRIVE_BYPASS_EMAIL_TO: ${PIPEDRIVE_BYPASS_EMAIL_TO:-berg@lippelift.de,caechma@gmail.com}
```

- [ ] Leave `PIPEDRIVE_API_KEY` and all full-routing configuration in place. The bypass must be enforced by the application flag, not by deleting credentials.

- [ ] Run the complete local verification:

```bash
cd backend
npm test
npm run build
```

```bash
cd ../widget
npm test
npm run build
```

- [ ] Configure the production environment explicitly:

```dotenv
PIPEDRIVE_BYPASS_ENABLED=true
PIPEDRIVE_BYPASS_EMAIL_TO=berg@lippelift.de,caechma@gmail.com
```

- [ ] Deploy and verify `/api/health` reports email configured, bypass enabled, and two bypass recipients.

- [ ] Run labeled live smoke cases:

| Case | Input | Expected email | Expected Pipedrive result |
| --- | --- | --- | --- |
| BYPASS-01 | Completed opportunity | One message at Berg and one at caechma | No API call / no new or changed record |
| BYPASS-02 | Completed service request | One message at Berg and one at caechma | No API call / no new or changed record |
| BYPASS-03 | Abandoned general chat | One message at Berg and one at caechma | No API call / no new or changed record |
| BYPASS-04 | Retry after simulated recipient failure | Only the missing delivery is retried | No API call / no new or changed record |

- [ ] Confirm both inboxes received the full transcript and that no message was sent to a departmental address.

- [ ] Inspect application logs for Pipedrive request activity during the smoke-test window. There must be none.

- [ ] If read-only Pipedrive verification is acceptable, compare labeled-record counts before and after the test from a separate administrative verification process. This verification must not run through Sarah's bypass request path.

---

## Task 6: Document Switching and Rollback

- [ ] Add a short operational note to the deployment handoff:

### Keep bypass live

```dotenv
PIPEDRIVE_BYPASS_ENABLED=true
```

The full Pipedrive implementation can continue to be developed and tested locally or in a separate environment with the flag disabled.

### Return to the full routing workflow

```dotenv
PIPEDRIVE_BYPASS_ENABLED=false
```

Redeploy/restart, check health, and run one non-destructive full-routing smoke test before announcing the change.

- [ ] State clearly that toggling the flag affects new requests only. Requests already checkpointed under one mode must retain their original journal result and must not be replayed automatically through the other mode.

- [ ] Document the emergency fallback: if bypass email delivery is failing, disable the public chat handoff or show a temporary contact message. Do not switch automatically to Pipedrive writes.

---

## Acceptance Criteria

- [ ] Production bypass mode is enabled explicitly through configuration.
- [ ] `berg@lippelift.de` and `caechma@gmail.com` each receive one complete email per completed or abandoned chat under the initial configuration.
- [ ] Recipient configuration can be replaced without changing source code.
- [ ] No Sarah request causes any Pipedrive HTTP request while bypass mode is enabled.
- [ ] No department address is selected or added while bypass mode is enabled.
- [ ] Email failure prevents a false customer-facing success.
- [ ] Per-recipient checkpoints prevent duplicate messages during retries and restarts.
- [ ] Setting the flag to `false` preserves the existing advanced Pipedrive and departmental-routing path.
- [ ] Pipedrive credentials and full-workflow configuration remain available for continued development.
- [ ] Backend tests/build and widget tests/build pass before deployment.

---

## Out of Scope

- Removing or rewriting the existing Pipedrive integration.
- Changing Sarah's conversational qualification flow.
- Sending email to the customer.
- Creating Pipedrive records as a fallback when bypass email fails.
- Automatically replaying bypassed requests into Pipedrive later.
- Guaranteeing delivery when a visitor closes the browser before the existing abandoned-chat submission occurs; page-exit delivery can be planned separately if required.
