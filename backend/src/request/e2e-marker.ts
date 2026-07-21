const e2eSubjectPattern = /\[LIPPEBOT E2E\]\[UC-\d{2}\]\[[A-Za-z0-9-]+\]\s+[^\r\n]{1,120}/;

export function extractE2ESubject(value: string | undefined): string | undefined {
  if (!value || /[\r\n]/.test(value)) return undefined;
  const match = value.match(e2eSubjectPattern)?.[0]?.trim();
  if (!match) return undefined;
  return match.replace(/[\u0000-\u001f\u007f]/g, '').trim();
}
