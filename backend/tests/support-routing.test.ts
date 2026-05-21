import { describe, expect, it } from 'vitest';
import {
  buildSupportEmailSubject,
  buildSupportEmailHtml,
  buildSupportNoteContent,
  getSupportInbox,
  inferSupportCategory,
} from '../src/support/support-routing.js';
import type { SupportData } from '../src/types/index.js';

describe('support routing helpers', () => {
  it('routes malfunctions to technik even when another category is mentioned', () => {
    expect(inferSupportCategory('Die Rechnung ist okay, aber der Lift zeigt einen Fehlercode und bleibt stehen')).toBe('technik');
    expect(getSupportInbox('technik')).toBe('technik@lippelift.de');
  });

  it('routes spare parts and installation defects to lossau', () => {
    expect(inferSupportCategory('Ich brauche ein Ersatzteil fuer die Montage, eine Schiene ist defekt')).toBe('lossau');
    expect(getSupportInbox('lossau')).toBe('lossau@lippelift.de');
  });

  it('routes invoice and admin paperwork to finance', () => {
    expect(inferSupportCategory('Ich habe eine Frage zur Rechnung und zur Zahlungserinnerung')).toBe('finance');
    expect(getSupportInbox('finance')).toBe('finance@lippelift.de');
  });

  it('routes contract confirmations and order status to sales', () => {
    expect(inferSupportCategory('Ich moechte eine Vertragsbestaetigung und den Status meiner Bestellung')).toBe('sales');
    expect(getSupportInbox('sales')).toBe('sales@lippelift.de');
  });

  it('builds a compact CRM note without dumping a transcript', () => {
    const data: SupportData = {
      customerName: 'Maria Schmidt',
      phone: '05261 96660',
      email: 'maria@example.de',
      category: 'technik',
      issueDescription: 'Lift bleibt im Erdgeschoss stehen und piept.',
      liftModel: 'VARIO PLUS',
    };

    const note = buildSupportNoteContent(data, 'unique', new Date('2026-05-21T10:15:00.000Z'));

    expect(note).toContain('Sarah Chatbot Support - 2026-05-21T10:15:00.000Z');
    expect(note).toContain('Sarah Chatbot');
    expect(note).toContain('Kategorie: technik');
    expect(note).toContain('Kurzfassung: Lift bleibt im Erdgeschoss stehen und piept.');
    expect(note).toContain('Telefon: 05261 96660');
    expect(note).toContain('E-Mail: maria@example.de');
    expect(note).toContain('Lift-Modell: VARIO PLUS');
    expect(note).not.toContain('Nutzer:');
    expect(note).not.toContain('Sarah:');
  });

  it('builds a richer unresolved-match email with the required wording', () => {
    const html = buildSupportEmailHtml({
      data: {
        customerName: 'Unbekannter Kunde',
        phone: '05261 11111',
        category: 'finance',
        issueDescription: 'Frage zu einer offenen Rechnung.',
        invoiceNumber: 'RE-2026-17',
      },
      intendedInbox: 'finance@lippelift.de',
      matchState: 'unresolved',
      noteStatus: 'skipped',
    });

    expect(html).toContain('Kein eindeutiger CRM-Treffer');
    expect(html).toContain('finance');
    expect(html).toContain('finance@lippelift.de');
    expect(html).toContain('RE-2026-17');
    expect(html).toContain('Frage zu einer offenen Rechnung.');
  });

  it('puts the routed category and customer name in the email subject', () => {
    expect(buildSupportEmailSubject({
      customerName: 'Maria Schmidt',
      category: 'lossau',
      issueDescription: 'Ersatzteil fuer Schiene benoetigt',
    })).toBe('Sarah Support [lossau]: Maria Schmidt');
  });

  it('sanitizes customer names used in email subjects', () => {
    expect(buildSupportEmailSubject({
      customerName: 'Maria\r\nBcc: attacker@example.com',
      category: 'technik',
      issueDescription: 'Lift bleibt stehen',
    })).toBe('Sarah Support [technik]: Maria Bcc: attacker@example.com');
  });
});
