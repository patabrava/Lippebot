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
});
