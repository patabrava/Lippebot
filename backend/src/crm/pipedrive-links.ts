export function buildPipedriveDealUrl(
  baseUrl: string,
  dealId: number | undefined,
): string | undefined {
  if (!Number.isSafeInteger(dealId) || (dealId ?? 0) <= 0) return undefined;

  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    url.pathname = `/deal/${dealId}`;
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}
