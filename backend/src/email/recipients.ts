export const DEFAULT_INTERNAL_EMAIL_RECIPIENTS = 'berg@lippelift.de,caechma@gmail.com';
export const DEFAULT_BYPASS_EMAIL_RECIPIENTS = 'berg@lippelift.de,caechma@gmail.com';

export function parseEmailRecipients(...values: Array<string | undefined>): string[] {
  const recipients: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    for (const candidate of value?.split(/[,;]/) ?? []) {
      const recipient = candidate.trim();
      if (!recipient) continue;
      const canonical = recipient.toLowerCase();
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      recipients.push(recipient);
    }
  }

  return recipients;
}

export function resolveInternalEmailRecipients(value: string | undefined): string {
  return parseEmailRecipients(
    value,
    DEFAULT_INTERNAL_EMAIL_RECIPIENTS,
  ).join(',');
}

export function resolveBypassEmailRecipients(value: string | undefined): string[] {
  return parseEmailRecipients(
    value === undefined ? DEFAULT_BYPASS_EMAIL_RECIPIENTS : value,
  );
}

export function emailRecipientCheckpointStep(recipient: string): `email_recipient:${string}` {
  return `email_recipient:${recipient.trim().toLowerCase()}`;
}
