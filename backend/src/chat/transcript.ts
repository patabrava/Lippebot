import { formatBerlinDateTime } from '../time/berlin.js';
import type { ChatMessage } from '../types/index.js';

interface PipedriveTranscriptInput {
  sessionId: string;
  summary: string;
  history: ChatMessage[];
  currentMessage: string;
  assistantText: string;
  currentUserTimestamp: number;
  assistantTimestamp: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatContent(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

function formatMessage(message: ChatMessage): string {
  const speaker = message.role === 'user' ? 'Nutzer' : 'Sarah';
  const timestamp = formatBerlinDateTime(new Date(message.timestamp));
  return `<p><strong>${speaker} · ${escapeHtml(timestamp)}</strong><br>${formatContent(message.content)}</p>`;
}

export function buildPipedriveTranscriptMarker(sessionId: string): string {
  return `[Sarah-Chat-ID:${encodeURIComponent(sessionId)}]`;
}

export function buildPipedriveTranscriptNote(input: PipedriveTranscriptInput): string {
  const messages: ChatMessage[] = [
    ...input.history,
    { role: 'user', content: input.currentMessage, timestamp: input.currentUserTimestamp },
  ];

  if (input.assistantText.trim()) {
    messages.push({
      role: 'assistant',
      content: input.assistantText,
      timestamp: input.assistantTimestamp,
    });
  }

  return [
    '<strong>Kurzfassung</strong>',
    `<p>${formatContent(input.summary)}</p>`,
    '<hr>',
    '<strong>Vollständiges Sarah-Chatprotokoll</strong>',
    `<small>Sitzung: ${escapeHtml(input.sessionId)} · ${buildPipedriveTranscriptMarker(input.sessionId)}</small>`,
    '<hr>',
    ...messages.map(formatMessage),
  ].join('\n');
}
