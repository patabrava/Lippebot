# Single Pipedrive Conversation Note Design

## Problem

Completed Sarah conversations currently create two Pipedrive notes for the same CRM case. The lead or support action first writes a compact summary note, then the post-stream completion hook writes a second full-transcript note. The existing transcript idempotency guard only deduplicates transcript retries; it cannot consolidate these two intentional writes.

## Required outcome

Each completed sales or support conversation must create exactly one Pipedrive note. That note must contain:

1. A structured summary of the request and relevant contact or case details.
2. The complete timestamped Sarah transcript, including the final assistant response.
3. The stable Sarah chat session marker used for retry reconciliation.

The note must remain pinned to the concrete person and deal whenever both identifiers exist. Chat completion must continue to wait for the CRM note write, and retries or concurrent completion attempts must resolve to the same note.

## Architecture

The lead and support action handlers will remain responsible for resolving or creating the correct Pipedrive person and deal, but they will no longer write preliminary notes. After streaming completes, the route will build the appropriate structured summary from the collected sales or support data and combine it with the transcript in the existing Pipedrive-safe formatter. The existing marker lookup, in-flight lock, retry loop, and completion gate will persist that combined document as the sole note.

The support note status will represent the combined conversation note. It will become `created` only after that note is persisted; a failed combined-note write will keep completion from reporting success.

## Data flow

1. Gemini emits a completed sales or support action.
2. Pipedrive resolves or creates the target person and deal without creating a note.
3. Sarah finishes streaming the final response.
4. The route builds a sales or support summary from the collected structured data.
5. The formatter produces one HTML note containing the summary, session marker, and transcript.
6. The Pipedrive service reconciles by session marker, creates the note only if absent, and pins it to the resolved person and deal.
7. Only after the note and mandatory completed-chat email succeed does the route emit `done`.

## Summary contents

Sales summaries will retain the useful information previously placed in `Sarah Folgeanfrage` or deal notes: name, contact method, address, availability, prior-contact status and reference, message, and CRM outcome.

Support summaries will retain the useful information previously placed in the compact support note: customer, category, problem, contact method, prior-contact status and reference, available case identifiers or technical details, and CRM match state.

All summary and transcript content remains HTML escaped before submission to Pipedrive.

## Error handling and idempotency

- No preliminary note is created, so a failure between CRM case creation and stream completion cannot leave a compact note that later becomes a duplicate.
- The existing stable marker lookup handles process retries after an uncertain Pipedrive response.
- The existing in-flight promise prevents concurrent requests in one process from racing.
- The route retries the combined note write up to three times and does not emit `done` if persistence ultimately fails.
- Existing historical duplicate notes are not deleted; this change applies to conversations completed after deployment.

## Testing and live verification

Automated regression coverage will prove that:

- completed sales follow-ups make one note POST whose content contains both summary and transcript;
- newly created sales opportunities make one note POST;
- matched and newly created support cases make one note POST;
- repeated and concurrent completion attempts still produce one note;
- note-write failure still blocks successful completion;
- the complete backend suite and TypeScript build pass.

After deployment, controlled sales and support conversations will be submitted with unique markers. The resulting Pipedrive deals will be read back through the API and verified to contain exactly one Sarah-authored note per test conversation, with both summary and transcript sections. Synthetic verification records will be cleaned up after readback.
