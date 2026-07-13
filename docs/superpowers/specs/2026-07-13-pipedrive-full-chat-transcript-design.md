# Pipedrive Full Chat Transcript Design

## Goal

Every chat that creates, reuses, or resolves a Pipedrive opportunity or support case must attach the complete chat transcript to that CRM record before the backend reports the chat as finished.

## Current Behavior

The opportunity flow creates or reuses a person and deal while Gemini is still streaming. It writes only structured lead details or a compact follow-up note. The support flow similarly writes a compact support note before Sarah's final response has completed. Neither path writes the complete chat transcript to Pipedrive.

The browser sends the full preceding chat history with each request. The route also has the current user message and accumulates Sarah's streamed response, so the complete transcript is available only after the Gemini stream ends.

## Transcript Format

A focused transcript formatter will construct a Pipedrive-safe HTML note containing:

- the heading `Vollständiges Sarah-Chatprotokoll`;
- the chat session ID for audit and deduplication;
- every preceding user and assistant message in original order;
- the current user message;
- Sarah's complete final response;
- a Berlin-local timestamp and clear `Nutzer` or `Sarah` speaker label for every message.

All dynamic values will be HTML-escaped. The formatter will not summarize, truncate, or omit messages.

## CRM Attachment

The Pipedrive service will expose one dedicated operation for transcript notes. It will create a pinned person note and, when a deal ID exists, pin the same note to that deal.

The route will retain the CRM result from opportunity and support actions while Gemini finishes streaming. After the final token:

- a created or reused opportunity attaches the transcript to its person and deal;
- an opportunity needing manual deal review attaches the transcript to the safely resolved person;
- a uniquely resolved support case attaches the transcript to its person and matched deal when present;
- unresolved or identity-ambiguous requests without a safe CRM target do not attach a note because no record can be selected safely.

Existing compact lead and support notes remain unchanged and separate.

## Mandatory Completion and Failure Handling

Transcript persistence is part of chat completion, not a fire-and-forget side effect. The route will make up to three awaited attempts. It will emit the final `done` event only after the note succeeds or when no safe CRM target exists.

If all attempts fail, the route will record a `crm_transcript_note_failed` audit event with the safe person/deal IDs and error, then follow the existing stream error path instead of falsely reporting completion. A successful write records `crm_transcript_note_created`.

An in-memory completion key based on session, person, and deal prevents repeated Gemini action events or repeated requests in the same backend process from creating duplicate transcript notes. The key is stored only after a successful write, so a later request can retry a failed note.

Conversation tracking remains an audit mechanism and is not required for the Pipedrive write itself.

## Testing

Unit tests will prove that transcript formatting preserves message order, includes the final exchange, uses Berlin timestamps, and escapes HTML.

Pipedrive service tests will prove that transcript notes pin to both person and deal, and fall back to a person-only note when no deal exists.

Route tests will prove that opportunity and support completion both write the full transcript, wait for the write before `done`, retry transient failures, suppress duplicates after success, expose no CRM identifiers to the browser, and audit terminal failures.

The complete backend test suite and TypeScript build must pass. Live verification will create controlled opportunity and support test chats, read the resulting notes back from Pipedrive, and confirm that the first and final messages are present on the correct records.

## Non-Goals

- Changing customer-facing chat wording.
- Replacing existing compact CRM notes.
- Attaching ambiguous chats to a guessed person or deal.
- Modifying deal ownership, pipeline, stage, or status.
- Backfilling historical chats that lack a recoverable transcript.
