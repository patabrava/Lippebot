# Pipedrive Email Deep Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe direct link from each internal Sarah notification email to the exact Pipedrive opportunity or support case resolved by the backend.

**Architecture:** A focused CRM URL helper validates the configurable HTTPS Pipedrive base URL and positive deal ID, then returns the canonical `/deal/{dealId}` URL. The email service owns URL construction, while the lead and support renderers display either the exact deal action or a manual-review fallback; the route passes only the already-resolved support `dealId` and keeps all CRM details out of browser responses.

**Tech Stack:** TypeScript, Hono, Nodemailer, Zod, Vitest, Docker Compose

---

## File Structure

- Create `backend/src/crm/pipedrive-links.ts`: validate CRM web configuration and build one canonical Pipedrive deal URL.
- Create `backend/tests/pipedrive-links.test.ts`: focused URL validation and construction tests.
- Modify `backend/src/config/index.ts`: expose `pipedriveWebBaseUrl` with the LIPPE LIFT default.
- Modify `backend/tests/config.test.ts`: prove default and environment override behavior.
- Modify `backend/src/index.ts`: pass the configured web base URL to the email service.
- Modify `backend/src/services/email.ts`: construct deal URLs and render lead deep links or manual-review fallback.
- Modify `backend/src/support/support-routing.ts`: render the support deep-link action or manual-review fallback.
- Modify `backend/src/routes/chat.ts`: pass the exact resolved support `dealId` to the internal email context.
- Modify `backend/tests/email.test.ts`: cover exact lead and support email links and missing/unsafe link fallbacks.
- Modify `backend/tests/support-routing.test.ts`: cover support action rendering and HTML safety.
- Modify `backend/tests/integration.test.ts`: prove route propagation and browser-response privacy.
- Modify `backend/.env.example`: document `PIPEDRIVE_WEB_BASE_URL`.
- Modify `deploy/hostinger-lippebot-demo.compose.yml`: provide the deployment default without disturbing the existing recipient edits.

### Task 1: Safe Pipedrive Deal URL Builder

**Files:**
- Create: `backend/src/crm/pipedrive-links.ts`
- Create: `backend/tests/pipedrive-links.test.ts`

- [ ] **Step 1: Write the failing URL-builder tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildPipedriveDealUrl } from '../src/crm/pipedrive-links.js';

describe('buildPipedriveDealUrl', () => {
  it('builds the exact deal detail URL', () => {
    expect(buildPipedriveDealUrl('https://lippelift.pipedrive.com', 1618))
      .toBe('https://lippelift.pipedrive.com/deal/1618');
  });

  it('normalizes a trailing slash', () => {
    expect(buildPipedriveDealUrl('https://lippelift.pipedrive.com/', 456))
      .toBe('https://lippelift.pipedrive.com/deal/456');
  });

  it.each([
    ['', 456],
    ['http://lippelift.pipedrive.com', 456],
    ['not-a-url', 456],
    ['https://user:pass@lippelift.pipedrive.com', 456],
    ['https://lippelift.pipedrive.com', 0],
    ['https://lippelift.pipedrive.com', -1],
    ['https://lippelift.pipedrive.com', 1.5],
    ['https://lippelift.pipedrive.com', Number.NaN],
  ])('rejects unsafe or invalid input: %s %s', (baseUrl, dealId) => {
    expect(buildPipedriveDealUrl(baseUrl, dealId)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `cd backend && npm test -- pipedrive-links.test.ts`

Expected: FAIL because `../src/crm/pipedrive-links.js` does not exist.

- [ ] **Step 3: Implement the minimal focused helper**

```ts
export function buildPipedriveDealUrl(
  baseUrl: string,
  dealId: number | undefined,
): string | undefined {
  if (!Number.isSafeInteger(dealId) || (dealId ?? 0) <= 0) return undefined;

  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    url.pathname = `/deal/${dealId}`;
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `cd backend && npm test -- pipedrive-links.test.ts`

Expected: PASS with 10 URL cases.

- [ ] **Step 5: Commit the isolated helper**

```bash
git add backend/src/crm/pipedrive-links.ts backend/tests/pipedrive-links.test.ts
git commit -m "feat: build safe pipedrive deal links"
```

### Task 2: Configuration and Application Wiring

**Files:**
- Modify: `backend/src/config/index.ts:19-62`
- Modify: `backend/tests/config.test.ts:20-50`
- Modify: `backend/src/index.ts:14-24`
- Modify: `backend/.env.example`
- Modify: `deploy/hostinger-lippebot-demo.compose.yml:24-33`

- [ ] **Step 1: Add failing configuration assertions**

Extend the existing `loads config with Vertex AI settings` test:

```ts
delete process.env.PIPEDRIVE_WEB_BASE_URL;
const config = loadConfig();
expect(config.pipedriveWebBaseUrl).toBe('https://lippelift.pipedrive.com');
```

Add an override test:

```ts
it('loads a configured Pipedrive web base URL', () => {
  process.env.VERTEX_AI_PROJECT_ID = 'test-project';
  process.env.PIPEDRIVE_WEB_BASE_URL = 'https://example.pipedrive.com';

  expect(loadConfig().pipedriveWebBaseUrl).toBe('https://example.pipedrive.com');
});
```

- [ ] **Step 2: Run the config test and verify it fails**

Run: `cd backend && npm test -- config.test.ts`

Expected: FAIL because `pipedriveWebBaseUrl` is absent.

- [ ] **Step 3: Add the string configuration with a stable default**

Add to `configSchema`:

```ts
pipedriveWebBaseUrl: z.string().default('https://lippelift.pipedrive.com'),
```

Add to `loadConfig()`:

```ts
pipedriveWebBaseUrl: process.env.PIPEDRIVE_WEB_BASE_URL,
```

Do not make Zod reject invalid URLs here; the email link helper must degrade to manual review instead of preventing backend startup or notification delivery.

- [ ] **Step 4: Pass configuration into the email service**

Extend the SMTP object in `backend/src/index.ts`:

```ts
const email = createEmailService({
  host: config.smtpHost,
  port: config.smtpPort,
  user: config.smtpUser,
  pass: config.smtpPass,
  pipedriveWebBaseUrl: config.pipedriveWebBaseUrl,
});
```

Extend the email service configuration type in Task 3 with optional `pipedriveWebBaseUrl`, preserving every existing test constructor.

- [ ] **Step 5: Document and deploy the setting**

Add to `backend/.env.example`:

```dotenv
PIPEDRIVE_WEB_BASE_URL=https://lippelift.pipedrive.com
```

Add immediately after the existing Pipedrive stage setting in the compose file:

```yaml
PIPEDRIVE_WEB_BASE_URL: ${PIPEDRIVE_WEB_BASE_URL:-https://lippelift.pipedrive.com}
```

Preserve the pre-existing `SERVICE_EMAIL_TO:-berg@lippelift.de` worktree change.

- [ ] **Step 6: Run the config test and TypeScript build**

Run: `cd backend && npm test -- config.test.ts && npm run build`

Expected: config tests PASS and `tsc` exits 0 after Task 3 has extended the email configuration type. If executing tasks strictly in isolation, run the config test now and defer `npm run build` until Task 3.

- [ ] **Step 7: Commit only feature hunks**

Use interactive staging for files that already contain unrelated edits:

```bash
git add backend/src/config/index.ts backend/tests/config.test.ts backend/src/index.ts backend/.env.example
git add -p deploy/hostinger-lippebot-demo.compose.yml
git commit -m "feat: configure pipedrive web links"
```

Verify the staged compose hunk contains only `PIPEDRIVE_WEB_BASE_URL` and does not absorb the existing recipient change.

### Task 3: Lead Email Deep Link and Fallback

**Files:**
- Modify: `backend/src/services/email.ts:19-111`
- Modify: `backend/tests/email.test.ts:55-118`

- [ ] **Step 1: Add failing lead-email assertions**

Update the reused-case test service configuration:

```ts
const service = createEmailService(
  {
    host: 'smtp.test.com',
    port: 587,
    user: 'a',
    pass: 'b',
    pipedriveWebBaseUrl: 'https://lippelift.pipedrive.com',
  },
  sendMock,
);
```

Replace the ID-only expectations with:

```ts
expect(call.html).toContain('Bestehender CRM-Fall wiederverwendet');
expect(call.html).toContain('Fall in Pipedrive öffnen');
expect(call.html).toContain('href="https://lippelift.pipedrive.com/deal/456"');
```

Add a created-case test with `outcome: 'created'` and `dealId: 789`, expecting `/deal/789`. Extend the review/failure cases to assert:

```ts
expect(call.html).toContain('Manuelle Prüfung erforderlich');
expect(call.html).not.toContain('Fall in Pipedrive öffnen');
expect(call.html).not.toContain('href="');
```

Add a unique outcome with an invalid base URL and assert the same manual-review fallback.

- [ ] **Step 2: Run the lead email tests and verify they fail**

Run: `cd backend && npm test -- email.test.ts`

Expected: FAIL because no Pipedrive action link or fallback is rendered.

- [ ] **Step 3: Extend email configuration and render the lead action**

Import the helper:

```ts
import { buildPipedriveDealUrl } from '../crm/pipedrive-links.js';
```

Extend `SmtpConfig` without breaking existing callers:

```ts
interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  pipedriveWebBaseUrl?: string;
}
```

Inside `createEmailService`, set:

```ts
const pipedriveWebBaseUrl = smtp.pipedriveWebBaseUrl ?? 'https://lippelift.pipedrive.com';
```

Inside `sendLeadNotification`, build the URL and action:

```ts
const dealUrl = buildPipedriveDealUrl(pipedriveWebBaseUrl, crmContext?.dealId);
const crmAction = crmContext
  ? dealUrl
    ? `<p><a href="${escapeHtml(dealUrl)}" style="display:inline-block;padding:10px 16px;background:#0b63ce;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">Fall in Pipedrive öffnen</a></p>`
    : '<p><strong>Manuelle Prüfung erforderlich</strong></p>'
  : '';
```

Place `${crmAction}` directly after the lead `<h2>` and keep the outcome and numeric IDs as secondary table rows.

- [ ] **Step 4: Run the lead email tests and build**

Run: `cd backend && npm test -- email.test.ts && npm run build`

Expected: email tests PASS and `tsc` exits 0.

- [ ] **Step 5: Commit only the deep-link hunks**

Because `backend/tests/email.test.ts` already contains recipient edits, stage only the new deep-link hunks:

```bash
git add backend/src/services/email.ts
git add -p backend/tests/email.test.ts
git commit -m "feat: link lead emails to pipedrive deals"
```

### Task 4: Support Email Deep Link and Privacy

**Files:**
- Modify: `backend/src/services/email.ts:131-145`
- Modify: `backend/src/support/support-routing.ts:145-186`
- Modify: `backend/src/routes/chat.ts:317-326`
- Modify: `backend/tests/email.test.ts:150-220`
- Modify: `backend/tests/support-routing.test.ts:50-92`
- Modify: `backend/tests/integration.test.ts:930-990`

- [ ] **Step 1: Add failing support renderer tests**

Extend the support HTML input type and tests with `dealUrl?: string`. For a unique match:

```ts
const html = buildSupportEmailHtml({
  data: {
    customerName: 'Maria Schmidt',
    category: 'technik',
    issueDescription: 'Lift bleibt stehen.',
  },
  intendedInbox: 'technik@lippelift.de',
  matchState: 'unique',
  noteStatus: 'created',
  dealUrl: 'https://lippelift.pipedrive.com/deal/1618',
});

expect(html).toContain('Fall in Pipedrive öffnen');
expect(html).toContain('href="https://lippelift.pipedrive.com/deal/1618"');
expect(html).not.toContain('Manuelle Prüfung erforderlich');
```

For unresolved and unique person-only cases, assert:

```ts
expect(html).toContain('Manuelle Prüfung erforderlich');
expect(html).not.toContain('Fall in Pipedrive öffnen');
expect(html).not.toContain('href="');
```

Also prove the renderer escapes the URL even if called outside the validated email-service path:

```ts
const unsafeHtml = buildSupportEmailHtml({
  data: { customerName: 'Maria Schmidt', category: 'technik' },
  intendedInbox: 'technik@lippelift.de',
  matchState: 'unique',
  noteStatus: 'created',
  dealUrl: 'https://lippelift.pipedrive.com/deal/1618?x=" onmouseover="alert(1)',
});

expect(unsafeHtml).toContain('&quot; onmouseover=&quot;');
expect(unsafeHtml).not.toContain('" onmouseover="');
```

- [ ] **Step 2: Add failing email-service and route propagation tests**

Call `sendSupportNotification` with `dealId: 1618` and assert the sent HTML targets `/deal/1618`. In the existing route integration test, extend the expectation:

```ts
const resolveSupportPerson = vi.fn().mockResolvedValue({
  matchState: 'unique',
  personId: 501,
  dealId: 654,
  candidateCount: 1,
});
```

Update the note assertion so the same exact resolved deal is used:

```ts
expect(createSupportNote).toHaveBeenCalledWith(501, supportData, 654);
```

Then extend the email assertion:

```ts
expect(sendSupportNotification).toHaveBeenCalledWith(
  'berg@lippelift.de',
  expect.objectContaining({
    data: supportData,
    matchState: 'unique',
    noteStatus: 'created',
    dealId: 654,
  }),
);
```

Keep or add response privacy assertions:

```ts
expect(text).not.toContain('lippelift.pipedrive.com');
expect(text).not.toContain('/deal/654');
expect(text).not.toContain('"dealId"');
```

- [ ] **Step 3: Run focused tests and verify they fail**

Run: `cd backend && npm test -- support-routing.test.ts email.test.ts integration.test.ts`

Expected: FAIL because support inputs do not accept or forward `dealId`/`dealUrl` and the renderer has no action.

- [ ] **Step 4: Construct the support URL in the email service**

Extend `sendSupportNotification` input:

```ts
dealId?: number;
```

Pass the safe URL to the renderer:

```ts
html: buildSupportEmailHtml({
  ...input,
  dealUrl: buildPipedriveDealUrl(pipedriveWebBaseUrl, input.dealId),
}),
```

- [ ] **Step 5: Render the support action or manual-review fallback**

Extend `buildSupportEmailHtml` input:

```ts
dealUrl?: string;
```

After `<h2>`, render:

```ts
${input.dealUrl
  ? `<p><a href="${escapeHtml(input.dealUrl)}" style="display:inline-block;padding:10px 16px;background:#0b63ce;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">Fall in Pipedrive öffnen</a></p>`
  : '<p><strong>Manuelle Prüfung erforderlich</strong></p>'}
```

- [ ] **Step 6: Pass only the resolved support deal ID from the route**

In `emitSupportAction`, add the existing safe `dealId` to the email input:

```ts
await deps.email.sendSupportNotification(emailRecipient, {
  data: normalizedSupportData,
  intendedInbox,
  matchState,
  noteStatus,
  noteError,
  dealId,
});
```

Do not add `dealId` or the URL to `buildSupportClientActionResult` or SSE payloads.

- [ ] **Step 7: Run the focused tests and verify they pass**

Run: `cd backend && npm test -- support-routing.test.ts email.test.ts integration.test.ts`

Expected: all focused tests PASS; unique deal emails contain the exact URL, while unresolved/person-only cases contain no link and browser responses contain no CRM details.

- [ ] **Step 8: Commit only support deep-link hunks**

The route and test files already contain unrelated recipient edits, so use interactive staging:

```bash
git add backend/src/services/email.ts backend/src/support/support-routing.ts backend/tests/support-routing.test.ts
git add -p backend/src/routes/chat.ts backend/tests/email.test.ts backend/tests/integration.test.ts
git commit -m "feat: link support emails to exact pipedrive cases"
```

### Task 5: Full Regression and Live Proof

**Files:**
- Verify: all files changed in Tasks 1-4

- [ ] **Step 1: Inspect the complete feature diff and unrelated changes**

Run:

```bash
git status --short
git diff --check
git diff -- backend/src backend/tests backend/.env.example deploy/hostinger-lippebot-demo.compose.yml
```

Expected: no whitespace errors; the existing `berg@lippelift.de` edits and other user files remain intact.

- [ ] **Step 2: Run the complete backend verification suite**

Run: `cd backend && npm test && npm run build`

Expected: all Vitest tests PASS and TypeScript compilation exits 0.

- [ ] **Step 3: Verify one controlled email before deployment**

Use the email service test double or a controlled local submission with external CRM writes disabled. Inspect the generated HTML and confirm that a known `dealId` such as `1618` produces exactly:

```text
https://lippelift.pipedrive.com/deal/1618
```

Expected: the anchor is present only when the CRM result contains that unique deal ID.

- [ ] **Step 4: Deploy through the existing `lippebot-demo` workflow**

Deploy the verified commit using the repository's established Hostinger project flow. Preserve the current production environment and ensure `PIPEDRIVE_WEB_BASE_URL` resolves to `https://lippelift.pipedrive.com` through the compose default or explicit environment setting.

- [ ] **Step 5: Verify the deployed service and exact live email target**

Run the existing health check and complete one controlled lead or support submission that safely resolves a known test deal. Open the notification email and click `Fall in Pipedrive öffnen`.

Expected:

- `/api/health` reports the backend healthy with Pipedrive and email configured;
- the email href ends in `/deal/{the exact dealId returned by that CRM operation}`;
- clicking the link opens that same opportunity/case in the LIPPE LIFT Pipedrive account;
- an ambiguous or person-only controlled case produces `Manuelle Prüfung erforderlich` and no CRM anchor;
- the chatbot response contains neither the CRM URL nor the deal ID.

- [ ] **Step 6: Record the final verification commit if test-only adjustments were required**

```bash
git add -p
git commit -m "test: verify pipedrive email deep links"
```

Skip this commit when verification required no file changes.
