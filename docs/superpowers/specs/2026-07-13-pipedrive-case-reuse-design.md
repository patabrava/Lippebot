# Pipedrive Case Reuse Design

## Goal

Prevent Lippebot from creating a new Pipedrive deal when a completed chat can be linked safely to an existing customer and exactly one existing open deal. Matching must tolerate common name variations without attaching a chat to the wrong customer or case.

## Current Behavior

The support flow already resolves an existing person and can pin a note to a unique open deal. The new-lead flow searches for a person by email and then phone, but it always creates a new deal after resolving the person. It does not use the person's name, does not detect conflicting identity results, and does not look for an existing open deal.

The route-level session cache prevents duplicate actions only within one backend process and browser session. It does not protect against a returning customer, a new browser session, or a backend restart.

## Matching Policy

### Contact identifiers

Email and phone are the strongest identifiers.

- Normalize email by trimming whitespace and comparing case-insensitively.
- Normalize German phone numbers into one canonical digit representation. Ignore spaces, punctuation, slash characters, and equivalent `0`, `+49`, and `0049` prefixes.
- Search all supplied strong identifiers instead of stopping after the first result.
- When email and phone resolve to the same unique person, use that person.
- When only one supplied strong identifier resolves uniquely and the other returns no result, use the unique result.
- When supplied strong identifiers resolve to different people, classify the match as ambiguous. Do not update either person, create a person, select a deal, or create a deal.
- When a strong identifier returns multiple people and the other supplied data cannot reduce the candidates to one, classify the match as ambiguous.

### Name matching

Name matching is a fallback when email and phone do not resolve a person.

Normalize names by:

- trimming and collapsing whitespace;
- comparing case-insensitively;
- removing punctuation and common German personal titles;
- treating common German umlaut spellings as equivalent, such as `Müller` and `Mueller`;
- comparing name tokens independently of order so `Schmidt, Maria` and `Maria Schmidt` can match;
- allowing extra middle-name tokens when the remaining given-name and surname tokens agree.

A normalized name may trigger automatic reuse only when it produces one candidate and another supplied value corroborates that candidate. Corroborators include postal code, address, customer number, invoice/order/offer number, lead ID, contract/payment/spare-part reference, or another exact CRM identifier available in the chat data.

A similar name without corroboration is a manual-review result. The bot sends the normal internal notification but does not create a person or deal and does not attach a note automatically.

## Deal Resolution

After resolving one person, query that person's open Pipedrive deals across all pipelines.

- Exactly one open deal: reuse it.
- No open deals: create a new deal using the existing lead payload and configured pipeline/stage.
- More than one open deal: do not choose a deal and do not create another one. Attach a review note to the uniquely resolved person only, and include the ambiguity in the internal notification.

Reusing a deal must not change its pipeline, stage, status, owner, or existing field values. The new chat context is stored as a pinned note. Fresh, unambiguous person contact details may update the matched person using the existing update behavior.

## Chat and Notification Behavior

The customer-facing conversation remains generic and must not mention Pipedrive, matching, ambiguity, or internal review.

The CRM operation returns one of these outcomes to the route:

- `created`: a new person/deal or a new deal for an existing person;
- `reused`: an existing person's single open deal received the new chat note;
- `person_review`: one person was resolved but multiple open deals prevented safe case selection;
- `identity_review`: the person could not be resolved safely;
- `failed`: Pipedrive was unavailable or returned an unexpected response.

Notification email delivery is independent of CRM success. The internal notification is still sent for review outcomes and API failures. Conversation tracking records the outcome and any safe person/deal IDs, but the browser receives no CRM-sensitive details.

## Failure Handling

- A search failure must not fall through to person or deal creation because the absence of search results has not been established.
- A person update or note failure must not cause a second person or deal to be created.
- If Pipedrive is unavailable, record the failure, send the internal notification, and leave the CRM unchanged.
- In-memory session deduplication remains as a fast guard, while CRM lookup provides protection across sessions and restarts.

## Testing

Service tests will cover:

- exact email reuse;
- normalized phone reuse, including punctuation and German prefix variants;
- agreement and conflict between email and phone results;
- normalized name variants with corroborating postal code, address, or reference data;
- fuzzy or normalized name matches without corroboration;
- zero, one, and multiple open deals;
- a pinned note on reused deals without changing deal stage/status;
- person-only review notes for multiple open deals;
- Pipedrive search, update, note, and deal-creation failures.

Route tests will prove that:

- notification email still sends for `reused`, review, and failure outcomes;
- tracking stores the selected outcome and safe IDs;
- the customer-facing action does not expose CRM details;
- repeated events in one session remain idempotent.

The full backend test suite and TypeScript build must pass before deployment. Live verification will use a known test contact to confirm that a second completed chat reuses the same person and single open deal without increasing the deal count.

## Non-Goals

- Automatically merging existing duplicate Pipedrive people.
- Choosing among multiple open deals by recency or title similarity.
- Reopening won or lost deals.
- Changing support routing destinations, deal stages, pipeline configuration, or customer-facing copy.
- Cleaning up historical duplicate deals automatically.
