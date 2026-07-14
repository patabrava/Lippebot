type ContactData = {
  phone?: unknown;
  email?: unknown;
};

function isUsableEmail(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length > 254 || trimmed.includes('..')) return false;

  const separatorIndex = trimmed.lastIndexOf('@');
  if (separatorIndex <= 0 || separatorIndex !== trimmed.indexOf('@')) return false;

  const localPart = trimmed.slice(0, separatorIndex);
  const domain = trimmed.slice(separatorIndex + 1);
  if (localPart.startsWith('.') || localPart.endsWith('.')) return false;
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(localPart)) return false;

  const labels = domain.split('.');
  if (labels.length < 2 || labels.at(-1)!.length < 2) return false;
  return labels.every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label));
}

function isUsablePhone(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!/^[+\d\s()./-]+$/.test(trimmed)) return false;
  if (/([()./-])\1{2,}/.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 6 || digits.length > 15) return false;
  return new Set(digits).size >= 2;
}

export function hasContactMethod(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const data = value as ContactData;
  return isUsablePhone(data.phone) || isUsableEmail(data.email);
}
