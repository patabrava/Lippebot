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
      priorContact: 'yes',
      priorContactReference: 'VORGANG-TEST-42',
    };

    const note = buildSupportNoteContent(data, 'unique', new Date('2026-05-21T10:15:00.000Z'));

    expect(note).toContain('Sarah Chatbot Support - 2026-05-21 12:15:00 CEST');
    expect(note).not.toContain('2026-05-21T10:15:00.000Z');
    expect(note).toContain('Sarah Chatbot');
    expect(note).toContain('Kategorie: technik');
    expect(note).toContain('Kurzfassung: Lift bleibt im Erdgeschoss stehen und piept.');
    expect(note).toContain('Telefon: 05261 96660');
    expect(note).toContain('E-Mail: maria@example.de');
    expect(note).toContain('Lift-Modell: VARIO PLUS');
    expect(note).toContain('Vorheriger Kontakt: yes');
    expect(note).toContain('Referenz: VORGANG-TEST-42');
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
    expect(html).toContain('Manuelle Prüfung erforderlich');
    expect(html).not.toContain('Fall in Pipedrive öffnen');
    expect(html).not.toContain('href="');
  });

  it('shows and escapes prior-contact routing context in support emails', () => {
    const html = buildSupportEmailHtml({
      data: {
        customerName: 'Test Kunde',
        category: 'sales',
        priorContact: 'yes',
        priorContactReference: 'ANG-42<script>',
      },
      intendedInbox: 'sales@lippelift.de',
      matchState: 'unique',
      noteStatus: 'created',
      dealUrl: 'https://lippelift.pipedrive.com/deal/42',
    });

    expect(html).toContain('Vorheriger Kontakt');
    expect(html).toContain('yes');
    expect(html).toContain('Referenz');
    expect(html).toContain('ANG-42&lt;script&gt;');
    expect(html).not.toContain('ANG-42<script>');
  });

  it('links a unique support match to the exact Pipedrive deal', () => {
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

    expect(html).toContain('Serviceanfrage in Pipedrive öffnen');
    expect(html).toContain('href="https://lippelift.pipedrive.com/deal/1618"');
    expect(html).not.toContain('Manuelle Prüfung erforderlich');
  });

  it('escapes a supplied deal URL before rendering the email action', () => {
    const html = buildSupportEmailHtml({
      data: { customerName: 'Maria Schmidt', category: 'technik' },
      intendedInbox: 'technik@lippelift.de',
      matchState: 'unique',
      noteStatus: 'created',
      dealUrl: 'https://lippelift.pipedrive.com/deal/1618?x=" onmouseover="alert(1)',
    });

    expect(html).toContain('&quot; onmouseover=&quot;');
    expect(html).not.toContain('" onmouseover="');
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

  it('builds a traceable normal request subject', () => {
    expect(buildSupportEmailSubject({ customerName: 'Erika Muster', category: 'technik' }, 'req-42'))
      .toBe('Sarah [technik] [req-42]: Erika Muster');
  });

  it('preserves the strict E2E marker and use-case label as the entire subject', () => {
    expect(buildSupportEmailSubject({
      customerName: 'Erika Muster',
      category: 'technik',
      issueDescription: '[LIPPEBOT E2E][UC-11][20260721-a] LIPPE exact match - technical service',
    }, 'req-e2e')).toBe('[LIPPEBOT E2E][UC-11][20260721-a] LIPPE exact match - technical service');
  });

  it('renders request, lift, exact links, and full transcript without guessing a link', () => {
    const html = buildSupportEmailHtml({
      requestId: 'req-42',
      data: {
        customerName: 'Erika Muster',
        category: 'technik',
        issueDescription: 'Steuerung reagiert nicht.',
        liftManufacturer: 'lippe',
        factoryNumber: 'FN-42',
      },
      intendedInbox: 'technik@lippelift.de',
      matchState: 'unique',
      noteStatus: 'created',
      sourceDealUrl: 'https://lippelift.pipedrive.com/deal/701',
      serviceDealUrl: 'https://lippelift.pipedrive.com/deal/801',
      transcript: 'Nutzer: <Fehler>\nSarah: Danke.',
    });

    expect(html).toContain('req-42');
    expect(html).toContain('lippe');
    expect(html).toContain('FN-42');
    expect(html).toContain('https://lippelift.pipedrive.com/deal/701');
    expect(html).toContain('https://lippelift.pipedrive.com/deal/801');
    expect(html).toContain('Vollständiges Anfrage-Transkript');
    expect(html).toContain('Nutzer: &lt;Fehler&gt;');
    expect(html).not.toContain('Nutzer: <Fehler>');
  });
});
