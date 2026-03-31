import nodemailer from 'nodemailer';
import type { LeadData, ServiceData } from '../types/index.js';

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
}

interface MailOptions {
  from: string;
  to: string;
  subject: string;
  html: string;
}

type SendFn = (options: MailOptions) => Promise<unknown>;

export function createEmailService(smtp: SmtpConfig, sendOverride?: SendFn) {
  const configured = smtp.host.length > 0;

  let sendFn: SendFn;
  if (sendOverride) {
    sendFn = sendOverride;
  } else if (configured) {
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: { user: smtp.user, pass: smtp.pass },
    });
    sendFn = (options) => transporter.sendMail(options);
  } else {
    sendFn = async () => {};
  }

  const from = smtp.user || 'sarah@lippelift.de';

  async function sendLeadNotification(to: string, data: LeadData): Promise<void> {
    if (!configured && !sendOverride) return;

    const html = `
      <h2>Neue Anfrage über Sarah (Chatbot)</h2>
      <table style="border-collapse:collapse;">
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Name:</td><td>${data.firstName} ${data.lastName}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Telefon:</td><td>${data.phone}</td></tr>
        ${data.email ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">E-Mail:</td><td>${data.email}</td></tr>` : ''}
        ${data.street ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Straße:</td><td>${data.street}</td></tr>` : ''}
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">PLZ / Stadt:</td><td>${data.postalCode} ${data.city}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Erreichbarkeit:</td><td>${data.availability}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Treppe:</td><td>${data.stairLocation || 'k.A.'} / ${data.stairType || 'k.A.'}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Gebäude:</td><td>${data.buildingType || 'k.A.'}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Lifttyp:</td><td>${data.liftType === 'sitzlift' ? 'Sitzlift' : data.liftType === 'rollstuhlgeeignet' ? 'Rollstuhlgeeignet' : 'k.A.'}</td></tr>
        ${data.message ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Nachricht:</td><td>${data.message}</td></tr>` : ''}
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Newsletter:</td><td>${data.newsletter || 'k.A.'}</td></tr>
      </table>
    `;

    await sendFn({ from, to, subject: `Sarah Lead: ${data.firstName} ${data.lastName}`, html });
  }

  async function sendServiceNotification(to: string, data: ServiceData): Promise<void> {
    if (!configured && !sendOverride) return;

    const html = `
      <h2>Service-Anfrage über Sarah (Chatbot)</h2>
      <table style="border-collapse:collapse;">
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Kunde:</td><td>${data.customerName}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Telefon:</td><td>${data.phone}</td></tr>
        ${data.email ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">E-Mail:</td><td>${data.email}</td></tr>` : ''}
        ${data.liftModel ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Lift-Modell:</td><td>${data.liftModel}</td></tr>` : ''}
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Problem:</td><td>${data.issueDescription}</td></tr>
      </table>
    `;

    await sendFn({ from, to, subject: `Service-Anfrage: ${data.customerName}`, html });
  }

  return { isConfigured: () => configured, sendLeadNotification, sendServiceNotification };
}

export type EmailService = ReturnType<typeof createEmailService>;
