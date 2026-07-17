import { describe, expect, it } from 'vitest';
import { buildPipedriveTranscriptNote } from '../src/chat/transcript.js';

describe('buildPipedriveTranscriptNote', () => {
  it('preserves the complete ordered exchange with Berlin timestamps', () => {
    const note = buildPipedriveTranscriptNote({
      sessionId: 'chat-session-42',
      summary: 'E-Mail: test@example.com\nErreichbarkeit: 08:00 - 12:00',
      history: [
        { role: 'assistant', content: 'Wie kann ich helfen?', timestamp: Date.parse('2026-07-13T08:00:00Z') },
        { role: 'user', content: 'Mein Lift ist defekt.', timestamp: Date.parse('2026-07-13T08:01:00Z') },
      ],
      currentMessage: 'Bitte eröffne einen Fall.',
      assistantText: 'Der Fall wurde aufgenommen.',
      currentUserTimestamp: Date.parse('2026-07-13T08:02:00Z'),
      assistantTimestamp: Date.parse('2026-07-13T08:02:30Z'),
    });

    expect(note).toContain('<strong>Kurzfassung</strong>');
    expect(note).toContain('E-Mail: test@example.com<br>Erreichbarkeit: 08:00 - 12:00');
    expect(note.indexOf('Kurzfassung')).toBeLessThan(note.indexOf('Vollständiges Sarah-Chatprotokoll'));
    expect(note).toContain('Vollständiges Sarah-Chatprotokoll');
    expect(note).toContain('chat-session-42');
    expect(note).toContain('[Sarah-Chat-ID:chat-session-42]');
    expect(note).toContain('2026-07-13 10:00:00');
    expect(note).toContain('2026-07-13 10:02:30');
    expect(note.indexOf('Wie kann ich helfen?')).toBeLessThan(note.indexOf('Mein Lift ist defekt.'));
    expect(note.indexOf('Mein Lift ist defekt.')).toBeLessThan(note.indexOf('Bitte eröffne einen Fall.'));
    expect(note.indexOf('Bitte eröffne einen Fall.')).toBeLessThan(note.indexOf('Der Fall wurde aufgenommen.'));
    expect(note.match(/Nutzer/g)).toHaveLength(2);
    expect(note.match(/Sarah/g)!.length).toBeGreaterThanOrEqual(3);
  });

  it('escapes dynamic HTML and preserves multiline content', () => {
    const note = buildPipedriveTranscriptNote({
      sessionId: 'session-<unsafe>&"',
      summary: 'E-Mail: <unsafe@example.com>\nHinweis: A & B',
      history: [],
      currentMessage: '<script>alert("x")</script> & weiter',
      assistantText: 'Zeile 1\nZeile 2',
      currentUserTimestamp: Date.parse('2026-07-13T08:02:00Z'),
      assistantTimestamp: Date.parse('2026-07-13T08:02:30Z'),
    });

    expect(note).not.toContain('<script>');
    expect(note).toContain('E-Mail: &lt;unsafe@example.com&gt;<br>Hinweis: A &amp; B');
    expect(note).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; weiter');
    expect(note).toContain('session-&lt;unsafe&gt;&amp;&quot;');
    expect(note).toContain('Zeile 1<br>Zeile 2');
  });

  it('does not invent an assistant message when the final response is empty', () => {
    const note = buildPipedriveTranscriptNote({
      sessionId: 'no-final-answer',
      summary: 'Nur eine Kurzfassung',
      history: [],
      currentMessage: 'Nur Nutzertext',
      assistantText: '   ',
      currentUserTimestamp: Date.parse('2026-07-13T08:02:00Z'),
      assistantTimestamp: Date.parse('2026-07-13T08:02:30Z'),
    });

    expect(note.match(/<strong>Nutzer ·/g)).toHaveLength(1);
    expect(note.match(/<strong>Sarah/g)).toBeNull();
  });
});
