# Pipedrive Email Deep Links Design

## Goal

Make every internal Sarah notification email with a safely resolved Pipedrive opportunity or case link directly to that exact deal. Reviewers must be able to open the relevant CRM record without searching by status text or numeric IDs.

## Current Behavior

Lead notification emails show a CRM assignment label plus person and deal IDs. Support notification emails show CRM match and note statuses but do not include the resolved person or deal ID. Both backend paths already retain the exact Pipedrive `dealId` when a unique opportunity or support case has been created, reused, or matched.

## Configuration

Add `PIPEDRIVE_WEB_BASE_URL` to backend configuration and deployment configuration. Its LIPPE LIFT default is:

`https://lippelift.pipedrive.com`

The value must be a valid HTTPS URL. URL construction must use URL parsing rather than string concatenation so trailing slashes cannot produce malformed links. The deployment value remains configurable in case the Pipedrive company domain changes.

## Link Construction

For a positive integer `dealId`, construct the deal detail URL at:

`https://lippelift.pipedrive.com/deal/{dealId}`

The ID must come directly from the completed CRM operation. A person ID, candidate ID, user-submitted identifier, or guessed deal must never be used as the URL target.

The link builder should be a focused unit with one responsibility: accept the configured base URL and a safe deal ID, then return the canonical deal detail URL. Email renderers consume the resulting URL and do not independently reconstruct it.

## Email Behavior

Lead emails receive the CRM outcome and resolved IDs as they do today. When the result contains a safe `dealId`, the email shows a prominent clickable action labeled `Fall in Pipedrive öffnen`. The link opens the exact created or reused Pipedrive deal. The human-readable outcome, such as a newly created or reused case, remains as secondary context.

Support emails receive the resolved `dealId` in addition to the existing match and note statuses. A uniquely matched support case shows the same `Fall in Pipedrive öffnen` action and targets that exact deal.

When no unique deal is available, the email contains no CRM link and displays `Manuelle Prüfung erforderlich`. This applies to:

- identity ambiguity;
- multiple open deals;
- unresolved matches;
- person-only matches without a unique deal;
- CRM failures;
- missing or invalid deal IDs;
- invalid CRM web URL configuration.

Numeric person or deal IDs may remain as secondary diagnostic context, but they must not be presented as substitutes for a direct link.

## Data Flow and Privacy

The Pipedrive service continues to return the safe CRM result to the chat route. The route passes the exact deal ID into the appropriate internal email context. The email layer constructs and renders the link from the configured base URL and deal ID.

The browser-facing action remains generic. Neither the Pipedrive URL nor CRM identifiers are returned in chatbot SSE responses or exposed to the visitor.

## Failure Handling

Email delivery remains independent of CRM success, matching the existing behavior. A CRM review or failure outcome still sends the internal notification, but without a link and with the manual-review message.

An invalid or missing configured web base URL must not produce a broken or unsafe hyperlink and must not prevent the rest of the notification from being sent. The renderer falls back to the manual-review presentation.

## Testing and Verification

Unit tests will cover:

- a newly created lead deal links to its exact `dealId`;
- a reused lead deal links to its exact `dealId`;
- a uniquely matched support case links to its exact `dealId`;
- the configured base URL handles optional trailing slashes;
- ambiguous, unresolved, person-only, failed, missing-ID, and invalid-ID outcomes produce no link;
- invalid or non-HTTPS base URLs produce no link;
- labels and dynamic values remain HTML-safe;
- CRM URLs and IDs remain absent from customer-facing SSE responses.

The complete backend test suite and TypeScript build must pass. After deployment, a controlled lead or support submission will be used to generate a notification. The link in that email must be opened and verified to land on the same Pipedrive deal ID returned by the CRM operation.

## Out of Scope

- Linking to a person page when no unique deal exists.
- Choosing among multiple open deals.
- Changing Pipedrive matching, opportunity creation, ownership, pipelines, stages, or statuses.
- Changing notification recipients or customer-facing chat wording.
- Exposing CRM links in the chatbot interface.
