# Berlin CRM Timestamps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Lippebot-authored Pipedrive support-case timestamps and opportunity request dates use DST-aware `Europe/Berlin` time.

**Architecture:** Add one dependency-free Berlin time-formatting module based on `Intl.DateTimeFormat(...).formatToParts()`. Route both CRM write paths through it while leaving Pipedrive-native UTC metadata untouched.

**Tech Stack:** TypeScript, Node.js `Intl`, Vitest, Pipedrive REST API

---

## File Structure

- Create `backend/src/time/berlin.ts`: format Berlin calendar dates and human-readable timestamps.
- Create `backend/tests/berlin-time.test.ts`: direct CET, CEST, and midnight-boundary coverage.
- Modify `backend/src/services/pipedrive.ts`: use the Berlin date for opportunity request dates.
- Modify `backend/src/support/support-routing.ts`: use the Berlin timestamp in support-note content.
- Modify `backend/tests/pipedrive.test.ts`: prove an opportunity created after Berlin midnight receives the next Berlin calendar date.
- Modify `backend/tests/support-routing.test.ts`: replace the UTC expectation with a Berlin-local CEST expectation.

### Task 1: Add failing Berlin-time regression tests

**Files:**
- Create: `backend/tests/berlin-time.test.ts`
- Modify: `backend/tests/pipedrive.test.ts`
- Modify: `backend/tests/support-routing.test.ts`

- [ ] **Step 1: Write direct formatter expectations**

Add tests expecting `2026-01-15T10:15:00Z` to format as `2026-01-15 11:15:00 CET`, `2026-05-21T20:34:05Z` as `2026-05-21 22:34:05 CEST`, and `2026-07-13T22:30:00Z` as Berlin date `2026-07-14`.

```ts
import { describe, expect, it } from 'vitest';
import { formatBerlinDate, formatBerlinDateTime } from '../src/time/berlin.js';

describe('Berlin time formatting', () => {
  it('formats winter timestamps as CET', () => {
    expect(formatBerlinDateTime(new Date('2026-01-15T10:15:00.000Z')))
      .toBe('2026-01-15 11:15:00 CET');
  });

  it('formats summer timestamps as CEST', () => {
    expect(formatBerlinDateTime(new Date('2026-05-21T20:34:05.000Z')))
      .toBe('2026-05-21 22:34:05 CEST');
  });

  it('uses the Berlin calendar date across the UTC midnight boundary', () => {
    expect(formatBerlinDate(new Date('2026-07-13T22:30:00.000Z'))).toBe('2026-07-14');
  });
});
```

- [ ] **Step 2: Change the support-note expectation**

For the existing May fixture, expect `Sarah Chatbot Support - 2026-05-21 12:15:00 CEST` and explicitly reject the UTC ISO timestamp.

```ts
expect(note).toContain('Sarah Chatbot Support - 2026-05-21 12:15:00 CEST');
expect(note).not.toContain('2026-05-21T10:15:00.000Z');
```

- [ ] **Step 3: Add the opportunity midnight-boundary test**

Use `vi.setSystemTime(new Date('2026-07-13T22:30:00.000Z'))`, create a mocked lead, and expect the request-date custom field to equal `2026-07-14`. Restore real timers in `afterEach`.

```ts
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('createLead uses the Berlin calendar date after local midnight', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-13T22:30:00.000Z'));
  const mockFetch = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true, data: { items: [] } }) })
    .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true, data: { id: 123 } }) })
    .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true, data: { id: 456 } }) })
    .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true, data: { id: 789 } }) });
  vi.stubGlobal('fetch', mockFetch);

  await createPipedriveService('test-key', 2, 3).createLead({
    firstName: 'Zeit',
    lastName: 'Test',
    email: 'zeit@example.de',
    availability: '08:00 - 12:00',
  });

  const dealBody = JSON.parse(mockFetch.mock.calls[2][1].body);
  expect(dealBody.eaf2557e218e842227f803c4abdc665291c99b91).toBe('2026-07-14');
});
```

- [ ] **Step 4: Run focused tests and verify RED**

Run: `npm test -- tests/berlin-time.test.ts tests/support-routing.test.ts tests/pipedrive.test.ts`

Expected: FAIL because the Berlin module does not exist and the current CRM code produces UTC values.

### Task 2: Implement the shared Berlin formatter

**Files:**
- Create: `backend/src/time/berlin.ts`

- [ ] **Step 1: Implement minimal formatters**

Create `formatBerlinDate(date = new Date())` and `formatBerlinDateTime(date = new Date())`. Use `timeZone: 'Europe/Berlin'`, `hourCycle: 'h23'`, and `formatToParts()` to assemble fixed `YYYY-MM-DD` and `YYYY-MM-DD HH:mm:ss CET/CEST` output.

```ts
const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'short',
});

function berlinParts(date: Date): Record<string, string> {
  return Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
}

export function formatBerlinDate(date = new Date()): string {
  const { year, month, day } = berlinParts(date);
  return `${year}-${month}-${day}`;
}

export function formatBerlinDateTime(date = new Date()): string {
  const { year, month, day, hour, minute, second, timeZoneName } = berlinParts(date);
  return `${year}-${month}-${day} ${hour}:${minute}:${second} ${timeZoneName}`;
}
```

- [ ] **Step 2: Run the direct formatter test**

Run: `npm test -- tests/berlin-time.test.ts`

Expected: PASS.

### Task 3: Route both CRM paths through the formatter

**Files:**
- Modify: `backend/src/services/pipedrive.ts`
- Modify: `backend/src/support/support-routing.ts`

- [ ] **Step 1: Replace the opportunity UTC date**

Import `formatBerlinDate` and replace `new Date().toISOString().slice(0, 10)` with `formatBerlinDate()`.

```ts
import { formatBerlinDate } from '../time/berlin.js';

function today(): string {
  return formatBerlinDate();
}
```

- [ ] **Step 2: Replace the support-note UTC timestamp**

Import `formatBerlinDateTime` and replace `now.toISOString()` with `formatBerlinDateTime(now)`.

```ts
import { formatBerlinDateTime } from '../time/berlin.js';

`Sarah Chatbot Support - ${formatBerlinDateTime(now)}`
```

- [ ] **Step 3: Run focused tests and verify GREEN**

Run: `npm test -- tests/berlin-time.test.ts tests/support-routing.test.ts tests/pipedrive.test.ts`

Expected: all focused tests pass.

- [ ] **Step 4: Commit implementation**

Stage only the time module, the two CRM files, and their three test files. Commit with `fix: use Berlin time for CRM records`.

### Task 4: Verify and exercise the live CRM

**Files:**
- No tracked file changes.

- [ ] **Step 1: Run complete verification**

Run `npm test`, `npm run build`, and `git diff --check`.

Expected: 0 failed tests, TypeScript exit 0, and no whitespace errors.

- [ ] **Step 2: Run a live Pipedrive create/readback/cleanup test**

Using the configured live API key and the implemented service, create a uniquely named temporary person, opportunity, deal note, and support note. Read back the opportunity request date and support-note first line. Require them to match the current Berlin date/time, then delete all temporary notes, the deal, and the person in a `finally` block.

The one-off script must record only non-secret IDs and formatted timestamps, query `/notes?deal_id=<id>` before cleanup, delete every returned test note, then delete the deal and person even if an assertion fails.

- [ ] **Step 3: Audit historical Sarah records**

Find existing notes whose first line contains a UTC `Sarah Chatbot Support` timestamp. Convert only that explicit timestamp to the equivalent Berlin CET/CEST string, preserve all other content, update the note, and read it back. Search current Sarah opportunities for date mismatches; update only unambiguous Lippebot-owned custom request dates.

The conversion pattern is anchored to `Sarah Chatbot Support - <ISO UTC timestamp>` at the beginning of the plain note content. The replacement is `Sarah Chatbot Support - <formatBerlinDateTime(parsedInstant)>`; all remaining content is byte-for-byte preserved.

- [ ] **Step 4: Merge and push main**

Merge the verified feature branch into local `main` without disturbing unrelated worktree changes, fetch and confirm `origin/main` has not diverged, push `main`, and verify the remote commit.
