# Berlin CRM Timestamp Design

**Date:** 2026-07-13

## Goal

Ensure every timestamp or calendar date written by Lippebot into a Pipedrive support case or opportunity reflects the `Europe/Berlin` timezone, including daylight-saving changes between CET and CEST.

## Root Cause

The backend currently uses `Date.prototype.toISOString()` for both CRM paths. ISO strings are always expressed in UTC:

- support notes embed the UTC ISO string directly in their content;
- opportunity request dates slice the UTC calendar date from the ISO string.

Support-note times are therefore one hour behind Berlin in winter and two hours behind in summer. Opportunity dates can be one day behind during the first one or two hours after Berlin midnight.

## Design

Add a small shared time module that formats a supplied `Date` explicitly with the IANA timezone `Europe/Berlin`. It will expose:

- a `YYYY-MM-DD` Berlin calendar-date formatter for Pipedrive opportunity fields;
- a `YYYY-MM-DD HH:mm:ss CET/CEST` formatter for human-readable support-note content.

Both functions will use `Intl.DateTimeFormat(...).formatToParts()` instead of the host process timezone. This keeps results identical in local development, tests, and the production container, while automatically following Berlin daylight-saving rules.

The opportunity creation path will use the Berlin date helper for the custom request-date field. The support-note builder will use the Berlin timestamp helper and retain its injectable `Date` argument for deterministic tests.

Pipedrive's native `add_time` remains unchanged because the API defines it as UTC and the Pipedrive UI is responsible for displaying it in the account timezone. Only Lippebot-authored date fields and timestamp text are converted.

## Historical Records

After deployment, inspect existing Sarah-generated support notes and opportunities. Correct explicit Lippebot-authored timestamp text or request dates only when the original instant is available and the Berlin value can be derived unambiguously. Do not rewrite Pipedrive's native UTC `add_time`, and do not modify unrelated CRM records.

## Testing

Regression tests will cover:

- a winter instant formatting as CET (`UTC+1`);
- a summer instant formatting as CEST (`UTC+2`);
- an opportunity created after Berlin midnight but before UTC midnight receiving the Berlin calendar date;
- support-note content containing the Berlin-local timestamp rather than a UTC ISO string.

The focused regression tests, complete backend test suite, and TypeScript build must pass before the change is pushed to `main`.

## Scope

This change does not alter CRM matching, deal reuse, pipelines, stages, owners, notification routing, or customer-facing chat behavior.
