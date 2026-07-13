const berlinFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'short',
});

function berlinParts(date: Date): Record<string, string> {
  return Object.fromEntries(
    berlinFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
}

export function formatBerlinDate(date = new Date()): string {
  const { year, month, day } = berlinParts(date);
  return `${year}-${month}-${day}`;
}

export function formatBerlinDateTime(date = new Date()): string {
  const { year, month, day, hour, minute, second, timeZoneName } = berlinParts(date);
  return `${year}-${month}-${day} ${hour}:${minute}:${second} ${timeZoneName}`;
}
