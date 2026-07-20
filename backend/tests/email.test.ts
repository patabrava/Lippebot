import { describe, it, expect, vi } from 'vitest';
import { createEmailService } from '../src/services/email.js';

describe('createEmailService', () => {
  it('returns unconfigured service when SMTP host is empty', () => {
    const service = createEmailService({ host: '', port: 587, user: '', pass: '' });
    expect(service.isConfigured()).toBe(false);
  });

  it('returns configured service when SMTP host is set', () => {
    const service = createEmailService({ host: 'smtp.test.com', port: 587, user: 'a', pass: 'b' });
    expect(service.isConfigured()).toBe(true);
  });

  it('sendLeadNotification formats email correctly', async () => {
    const sendMock = vi.fn().mockResolvedValue({ messageId: '123' });
    const service = createEmailService(
      { host: 'smtp.test.com', port: 587, user: 'a', pass: 'b' },
      sendMock,
    );

    await service.sendLeadNotification('test@example.com', {
      firstName: 'Max',
      lastName: 'Mustermann',
      phone: '0123',
      city: 'Lemgo',
      postalCode: '32657',
      availability: '08:00 - 12:00',
      stairLocation: 'innen',
      stairType: 'kurvig',
      liftType: 'sitzlift',
    });

    expect(sendMock).toHaveBeenCalledOnce();
    const call = sendMock.mock.calls[0][0];
    expect(call.to).toBe('test@example.com');
    expect(call.subject).toContain('Max Mustermann');
    expect(call.html).toContain('Sitzlift');
    expect(call.html).toContain('Lemgo');
  });

  it('sendLeadNotification renders an email-only lead without an undefined phone row', async () => {
    const sendMock = vi.fn().mockResolvedValue({ messageId: 'email-only-lead' });
    const service = createEmailService(
      { host: 'smtp.test.com', port: 587, user: 'a', pass: 'b' },
      sendMock,
    );

    await service.sendLeadNotification('test@example.com', {
      firstName: 'Max',
      lastName: 'Mustermann',
      email: 'max@example.de',
      city: 'Lemgo',
      postalCode: '32657',
      availability: '08:00 - 12:00',
    });

    const call = sendMock.mock.calls[0][0];
    expect(call.html).toContain('max@example.de');
    expect(call.html).not.toContain('<td>undefined</td>');
    expect(call.html).not.toContain('Telefon:</td>');
  });

  it('sendLeadNotification identifies a reused CRM case for the internal team', async () => {
    const sendMock = vi.fn().mockResolvedValue({ messageId: 'reused-lead' });
    const service = createEmailService(
      {
        host: 'smtp.test.com',
        port: 587,
        user: 'a',
        pass: 'b',
        pipedriveWebBaseUrl: 'https://lippelift.pipedrive.com',
      },
      sendMock,
    );

    await service.sendLeadNotification('test@example.com', {
      firstName: 'Max',
      lastName: 'Mustermann',
      email: 'max@example.de',
      city: 'Lemgo',
      postalCode: '32657',
      availability: '08:00 - 12:00',
    }, {
      outcome: 'reused',
      personId: 123,
      dealId: 456,
    });

    const call = sendMock.mock.calls[0][0];
    expect(call.html).toContain('Bestehender CRM-Fall wiederverwendet');
    expect(call.html).toContain('123');
    expect(call.html).toContain('456');
    expect(call.html).toContain('Fall in Pipedrive öffnen');
    expect(call.html).toContain('href="https://lippelift.pipedrive.com/deal/456"');
  });

  it('sendLeadNotification includes escaped prior-contact routing context', async () => {
    const sendMock = vi.fn().mockResolvedValue({ messageId: 'prior-contact-lead' });
    const service = createEmailService(
      { host: 'smtp.test.com', port: 587, user: 'a', pass: 'b' },
      sendMock,
    );

    await service.sendLeadNotification('test@example.com', {
      firstName: 'Max<script>',
      lastName: 'Mustermann',
      email: 'max@example.de',
      priorContact: 'yes',
      priorContactReference: 'ANG-42<script>',
      city: 'Lemgo',
      postalCode: '32657',
      availability: '08:00 - 12:00',
    });

    const call = sendMock.mock.calls[0][0];
    expect(call.html).toContain('Vorheriger Kontakt');
    expect(call.html).toContain('Referenz');
    expect(call.html).toContain('ANG-42&lt;script&gt;');
    expect(call.html).not.toContain('ANG-42<script>');
    expect(call.html).not.toContain('Max<script>');
  });

  it('sendLeadNotification links a newly created opportunity to its exact Pipedrive deal', async () => {
    const sendMock = vi.fn().mockResolvedValue({ messageId: 'created-lead' });
    const service = createEmailService(
      { host: 'smtp.test.com', port: 587, user: 'a', pass: 'b' },
      sendMock,
    );

    await service.sendLeadNotification('test@example.com', {
      firstName: 'Max',
      lastName: 'Mustermann',
    }, {
      outcome: 'created',
      personId: 321,
      dealId: 789,
    });

    const call = sendMock.mock.calls[0][0];
    expect(call.html).toContain('Neuer CRM-Fall erstellt');
    expect(call.html).toContain('href="https://lippelift.pipedrive.com/deal/789"');
  });

  it.each([
    ['identity_review', 'Manuelle Identitätsprüfung erforderlich'],
    ['person_review', 'Manuelle Fallauswahl erforderlich'],
    ['failed', 'CRM-Übertragung fehlgeschlagen'],
  ] as const)('sendLeadNotification renders the %s CRM outcome safely', async (outcome, expectedLabel) => {
    const sendMock = vi.fn().mockResolvedValue({ messageId: `lead-${outcome}` });
    const service = createEmailService(
      { host: 'smtp.test.com', port: 587, user: 'a', pass: 'b' },
      sendMock,
    );

    await service.sendLeadNotification('test@example.com', {
      firstName: 'Max',
      lastName: 'Mustermann',
      email: 'max@example.de',
      city: 'Lemgo',
      postalCode: '32657',
      availability: '08:00 - 12:00',
    }, {
      outcome,
      reason: '<unsafe reason>',
    });

    const call = sendMock.mock.calls[0][0];
    expect(call.html).toContain(expectedLabel);
    expect(call.html).toContain('&lt;unsafe reason&gt;');
    expect(call.html).not.toContain('<unsafe reason>');
    expect(call.html).toContain('Manuelle Prüfung erforderlich');
    expect(call.html).not.toContain('Fall in Pipedrive öffnen');
    expect(call.html).not.toContain('href="');
  });

  it('sendLeadNotification falls back to manual review for an unsafe CRM web URL', async () => {
    const sendMock = vi.fn().mockResolvedValue({ messageId: 'unsafe-link' });
    const service = createEmailService(
      {
        host: 'smtp.test.com',
        port: 587,
        user: 'a',
        pass: 'b',
        pipedriveWebBaseUrl: 'http://lippelift.pipedrive.com',
      },
      sendMock,
    );

    await service.sendLeadNotification('test@example.com', {
      firstName: 'Max',
      lastName: 'Mustermann',
    }, {
      outcome: 'reused',
      dealId: 456,
    });

    const call = sendMock.mock.calls[0][0];
    expect(call.html).toContain('Manuelle Prüfung erforderlich');
    expect(call.html).not.toContain('Fall in Pipedrive öffnen');
    expect(call.html).not.toContain('href="');
  });

  it('sendServiceNotification formats email correctly', async () => {
    const sendMock = vi.fn().mockResolvedValue({ messageId: '456' });
    const service = createEmailService(
      { host: 'smtp.test.com', port: 587, user: 'a', pass: 'b' },
      sendMock,
    );

    await service.sendServiceNotification('service@example.com', {
      customerName: 'Maria Schmidt',
      phone: '0987',
      issueDescription: 'Lift macht Geräusche',
    });

    expect(sendMock).toHaveBeenCalledOnce();
    const call = sendMock.mock.calls[0][0];
    expect(call.to).toBe('service@example.com');
    expect(call.subject).toContain('Service-Anfrage');
    expect(call.html).toContain('Maria Schmidt');
    expect(call.html).toContain('Lift macht Geräusche');
  });

  it('sendServiceNotification renders an email-only request without an undefined phone row', async () => {
    const sendMock = vi.fn().mockResolvedValue({ messageId: 'email-only-service' });
    const service = createEmailService(
      { host: 'smtp.test.com', port: 587, user: 'a', pass: 'b' },
      sendMock,
    );

    await service.sendServiceNotification('service@example.com', {
      customerName: 'Maria Schmidt',
      email: 'maria@example.de',
      issueDescription: 'Lift macht Geräusche',
    });

    const call = sendMock.mock.calls[0][0];
    expect(call.html).toContain('maria@example.de');
    expect(call.html).not.toContain('<td>undefined</td>');
    expect(call.html).not.toContain('Telefon:</td>');
  });

  it('sendSupportNotification sends unresolved match wording to the configured recipient', async () => {
    const sendMock = vi.fn().mockResolvedValue({ messageId: 'support-1' });
    const service = createEmailService(
      { host: 'smtp.test.com', port: 587, user: 'a', pass: 'b' },
      sendMock,
    );

    await service.sendSupportNotification('caechma@gmail.com', {
      data: {
        customerName: 'Maria Schmidt',
        phone: '05261 96660',
        category: 'finance',
        issueDescription: 'Frage zur Rechnung RE-123.',
        invoiceNumber: 'RE-123',
      },
      intendedInbox: 'finance@lippelift.de',
      matchState: 'unresolved',
      noteStatus: 'skipped',
    });

    expect(sendMock).toHaveBeenCalledOnce();
    const call = sendMock.mock.calls[0][0];
    expect(call.to).toBe('caechma@gmail.com');
    expect(call.subject).toBe('Sarah Support [finance]: Maria Schmidt');
    expect(call.html).toContain('Kein eindeutiger CRM-Treffer');
    expect(call.html).toContain('finance@lippelift.de');
    expect(call.html).toContain('RE-123');
    expect(call.html).toContain('Manuelle Prüfung erforderlich');
    expect(call.html).not.toContain('href="');
  });

  it('sendSupportNotification links to the exact resolved Pipedrive case', async () => {
    const sendMock = vi.fn().mockResolvedValue({ messageId: 'support-deal' });
    const service = createEmailService(
      { host: 'smtp.test.com', port: 587, user: 'a', pass: 'b' },
      sendMock,
    );

    await service.sendSupportNotification('caechma@gmail.com', {
      data: {
        customerName: 'Maria Schmidt',
        category: 'technik',
        issueDescription: 'Lift bleibt stehen.',
      },
      intendedInbox: 'technik@lippelift.de',
      matchState: 'unique',
      noteStatus: 'created',
      dealId: 1618,
    });

    const call = sendMock.mock.calls[0][0];
    expect(call.html).toContain('href="https://lippelift.pipedrive.com/deal/1618"');
    expect(call.html).not.toContain('Manuelle Prüfung erforderlich');
  });

  it('sendSupportNotification includes note failure for the team only', async () => {
    const sendMock = vi.fn().mockResolvedValue({ messageId: 'support-2' });
    const service = createEmailService(
      { host: 'smtp.test.com', port: 587, user: 'a', pass: 'b' },
      sendMock,
    );

    await service.sendSupportNotification('caechma@gmail.com', {
      data: {
        customerName: 'Maria Schmidt',
        category: 'technik',
        issueDescription: 'Lift bleibt stehen.',
      },
      intendedInbox: 'technik@lippelift.de',
      matchState: 'unique',
      noteStatus: 'failed',
      noteError: 'Pipedrive API error: 500 Internal Server Error',
    });

    const call = sendMock.mock.calls[0][0];
    expect(call.html).toContain('Eindeutiger CRM-Treffer');
    expect(call.html).toContain('CRM-Notizfehler');
    expect(call.html).toContain('Pipedrive API error');
    expect(call.html).toContain('Manuelle Prüfung erforderlich');
    expect(call.html).not.toContain('href="');
  });

  it('sendCompletedChatSummary renders an escaped summary before the full transcript', async () => {
    const sendMock = vi.fn().mockResolvedValue({ messageId: 'completed-general' });
    const service = createEmailService(
      { host: 'smtp.test.com', port: 587, user: 'a', pass: 'b' },
      sendMock,
    );

    await service.sendCompletedChatSummary('team@example.com', {
      sessionId: 'session-<unsafe>',
      mode: 'berater',
      kind: 'general',
      summary: 'Nutzer fragt nach <script>alert(1)</script>.',
      transcript: '<strong>Nutzer</strong>: Hallo\nSarah: Vollständige Antwort',
      completedAt: '2026-07-16T08:00:00.000Z',
    });

    const call = sendMock.mock.calls[0][0];
    expect(call.to).toBe('team@example.com');
    expect(call.subject).toContain('Chat-Zusammenfassung');
    expect(call.html.indexOf('Zusammenfassung')).toBeLessThan(call.html.indexOf('Vollständiges Transkript'));
    expect(call.html).toContain('Nutzer fragt nach &lt;script&gt;alert(1)&lt;/script&gt;.');
    expect(call.html).toContain('&lt;strong&gt;Nutzer&lt;/strong&gt;: Hallo');
    expect(call.html).toContain('Sarah: Vollständige Antwort');
    expect(call.html).not.toContain('<script>');
    expect(call.html).toContain('Chatende');
    expect(call.html).not.toContain('Session:');
    expect(call.html).not.toContain('Modus:');
    expect(call.html).not.toContain('Abgeschlossen:');
  });

  it('sendCompletedChatSummary includes opportunity data and the exact deal link', async () => {
    const sendMock = vi.fn().mockResolvedValue({ messageId: 'completed-opportunity' });
    const service = createEmailService(
      { host: 'smtp.test.com', port: 587, user: 'a', pass: 'b' },
      sendMock,
    );

    await service.sendCompletedChatSummary('sales@example.com', {
      sessionId: 'opportunity-1',
      mode: 'anfrage',
      kind: 'opportunity',
      summary: 'Max Mustermann benötigt einen Sitzlift in Lemgo.',
      transcript: 'Nutzer: Anfrage\nSarah: Anfrage aufgenommen',
      completedAt: '2026-07-16T08:00:00.000Z',
      leadData: {
        firstName: 'Max',
        lastName: 'Mustermann',
        email: 'max@example.de',
        postalCode: '32657',
        city: 'Lemgo',
        message: 'Sitzlift benötigt',
      },
      leadContext: { outcome: 'created', personId: 321, dealId: 789, createdPerson: true },
    });

    const call = sendMock.mock.calls[0][0];
    expect(call.subject).toContain('Opportunity');
    expect(call.html).toContain('Max Mustermann benötigt einen Sitzlift');
    expect(call.html).toContain('Sitzlift benötigt');
    expect(call.html).toContain('href="https://lippelift.pipedrive.com/deal/789"');
    expect(call.html).toContain('Vollständiges Transkript');
    expect(call.html).toContain('Kontaktstatus');
    expect(call.html).toContain('Neu');
    expect(call.html).not.toContain('Kontaktname');
    expect(call.html).not.toContain('Person-ID:');
    expect(call.html).not.toContain('Fall-ID:');
  });

  it('sendCompletedChatSummary includes case data and manual review without an unsafe link', async () => {
    const sendMock = vi.fn().mockResolvedValue({ messageId: 'completed-case' });
    const service = createEmailService(
      {
        host: 'smtp.test.com',
        port: 587,
        user: 'a',
        pass: 'b',
        pipedriveWebBaseUrl: 'http://unsafe.example.com',
      },
      sendMock,
    );

    await service.sendCompletedChatSummary('support@example.com', {
      sessionId: 'case-1',
      mode: 'service',
      kind: 'case',
      summary: 'Maria meldet einen technischen Stillstand.',
      transcript: 'Nutzer: Lift steht\nSarah: Servicefall aufgenommen',
      completedAt: '2026-07-16T08:00:00.000Z',
      supportData: {
        customerName: 'Maria Schmidt',
        category: 'technik',
        issueDescription: 'Lift bleibt stehen.',
      },
      supportContext: {
        matchState: 'unique',
        noteStatus: 'created',
        intendedInbox: 'technik@lippelift.de',
        dealId: 1618,
        createdPerson: false,
      },
    });

    const call = sendMock.mock.calls[0][0];
    expect(call.subject).toContain('Case');
    expect(call.html).toContain('Maria Schmidt');
    expect(call.html).toContain('Lift bleibt stehen.');
    expect(call.html).toContain('Manuelle Prüfung erforderlich');
    expect(call.html).not.toContain('href="');
    expect(call.html).toContain('Kontaktstatus');
    expect(call.html).toContain('Bestehend');
    expect(call.html).toContain('Kontaktname');
    expect(call.html).toContain('Maria Schmidt');
    expect(call.html).not.toContain('Person-ID:');
    expect(call.html).not.toContain('Fall-ID:');
  });
});
