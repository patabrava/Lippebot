import { afterEach, describe, it, expect, vi } from 'vitest';
import { createPipedriveService } from '../src/services/pipedrive.js';

describe('createPipedriveService', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('returns noop service when API key is empty', () => {
    const service = createPipedriveService('', 1, 1);
    expect(service.isConfigured()).toBe(false);
  });

  it('returns configured service when API key is provided', () => {
    const service = createPipedriveService('test-key', 1, 1);
    expect(service.isConfigured()).toBe(true);
  });

  it('createLead reuses the same single open deal in a separate service instance', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/persons/search') && url.searchParams.get('fields') === 'email') {
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: { items: [{ item: { id: 321 } }] } }),
        };
      }
      if (url.pathname.endsWith('/persons/321/deals')) {
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: [{ id: 456, status: 'open' }] }),
        };
      }
      if (url.pathname.endsWith('/persons/321') && init?.method === 'PUT') {
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: { id: 321 } }),
        };
      }
      if (url.pathname.endsWith('/notes') && init?.method === 'POST') {
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: { id: 9001 } }),
        };
      }
      if (url.pathname.endsWith('/deals') && init?.method === 'POST') {
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: { id: 999 } }),
        };
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 2, 3);
    const result = await service.createLead({
      firstName: 'Max',
      lastName: 'Mustermann',
      email: 'max@example.de',
      street: 'Musterstrasse 1',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
      message: 'Folgeanfrage zum selben Fall',
    });

    expect(result).toEqual({ outcome: 'reused', personId: 321, dealId: 456 });
    expect(mockFetch.mock.calls.some(([url, init]) => (
      new URL(String(url)).pathname.endsWith('/deals') && init?.method === 'POST'
    ))).toBe(false);
    const noteCall = mockFetch.mock.calls.find(([url]) => new URL(String(url)).pathname.endsWith('/notes'));
    expect(noteCall).toBeDefined();
    expect(JSON.parse(noteCall![1]!.body as string)).toEqual(expect.objectContaining({
      person_id: 321,
      deal_id: 456,
      pinned_to_person_flag: 1,
      pinned_to_deal_flag: 1,
    }));
  });

  it('createLead sends conflicting exact email and phone matches to identity review without CRM mutation', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/persons/search')) {
        const id = url.searchParams.get('fields') === 'email' ? 321 : 654;
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: { items: [{ item: { id } }] } }),
        };
      }
      throw new Error(`Unexpected mutation: ${init?.method ?? 'GET'} ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 2, 3);
    const result = await service.createLead({
      firstName: 'Max',
      lastName: 'Mustermann',
      email: 'max@example.de',
      phone: '05261 96660',
      street: 'Musterstrasse 1',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
    });

    expect(result).toEqual({
      outcome: 'identity_review',
      candidateCount: 2,
      reason: 'conflicting_contact_identifiers',
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('createLead lets a unique phone match disambiguate duplicate email matches', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/persons/search')) {
        const items = url.searchParams.get('fields') === 'email'
          ? [{ item: { id: 321 } }, { item: { id: 654 } }]
          : [{ item: { id: 321 } }];
        return { ok: true, json: () => Promise.resolve({ success: true, data: { items } }) };
      }
      if (url.pathname.endsWith('/persons/321/deals')) {
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: [{ id: 456, status: 'open' }] }),
        };
      }
      if (url.pathname.endsWith('/persons/321') && init?.method === 'PUT') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 321 } }) };
      }
      if (url.pathname.endsWith('/notes') && init?.method === 'POST') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 9005 } }) };
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 2, 3);
    const result = await service.createLead({
      firstName: 'Max',
      lastName: 'Mustermann',
      email: 'shared@example.de',
      phone: '05261 96660',
      street: 'Musterstrasse 1',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
    });

    expect(result).toEqual({ outcome: 'reused', personId: 321, dealId: 456 });
  });

  it('createLead never creates a person or deal when identity search fails', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    }));
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 2, 3);
    await expect(service.createLead({
      firstName: 'Max',
      lastName: 'Mustermann',
      email: 'max@example.de',
      street: 'Musterstrasse 1',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
    })).rejects.toThrow('Pipedrive API error: 503 Service Unavailable');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  });

  it('createLead never creates a deal after an existing-person update fails', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/persons/search')) {
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: { items: [{ item: { id: 321 } }] } }),
        };
      }
      if (url.pathname.endsWith('/persons/321/deals')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: [] }) };
      }
      if (url.pathname.endsWith('/persons/321') && init?.method === 'PUT') {
        return { ok: false, status: 500, statusText: 'Update Failed' };
      }
      throw new Error(`Unexpected mutation: ${init?.method ?? 'GET'} ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 2, 3);
    await expect(service.createLead({
      firstName: 'Max',
      lastName: 'Mustermann',
      email: 'max@example.de',
      street: 'Musterstrasse 1',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
    })).rejects.toThrow('Pipedrive API error: 500 Update Failed');

    expect(mockFetch.mock.calls.some(([url, init]) => (
      new URL(String(url)).pathname.endsWith('/deals') && init?.method === 'POST'
    ))).toBe(false);
  });

  it('createLead never creates a second deal when the reused-deal note fails', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/persons/search')) {
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: { items: [{ item: { id: 321 } }] } }),
        };
      }
      if (url.pathname.endsWith('/persons/321/deals')) {
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: [{ id: 456, status: 'open' }] }),
        };
      }
      if (url.pathname.endsWith('/persons/321') && init?.method === 'PUT') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 321 } }) };
      }
      if (url.pathname.endsWith('/notes') && init?.method === 'POST') {
        return { ok: false, status: 500, statusText: 'Note Failed' };
      }
      throw new Error(`Unexpected mutation: ${init?.method ?? 'GET'} ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 2, 3);
    await expect(service.createLead({
      firstName: 'Max',
      lastName: 'Mustermann',
      email: 'max@example.de',
      street: 'Musterstrasse 1',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
    })).rejects.toThrow('Pipedrive API error: 500 Note Failed');

    expect(mockFetch.mock.calls.some(([url, init]) => (
      new URL(String(url)).pathname.endsWith('/deals') && init?.method === 'POST'
    ))).toBe(false);
  });

  it('createLead keeps a unique person with multiple open deals in person review', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/persons/search')) {
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: { items: [{ item: { id: 321 } }] } }),
        };
      }
      if (url.pathname.endsWith('/persons/321/deals')) {
        return {
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: [{ id: 456, status: 'open' }, { id: 457, status: 'open' }],
          }),
        };
      }
      if (url.pathname.endsWith('/notes') && init?.method === 'POST') {
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: { id: 9002 } }),
        };
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 2, 3);
    const result = await service.createLead({
      firstName: 'Max',
      lastName: 'Mustermann',
      email: 'max@example.de',
      street: 'Musterstrasse 1',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
    });

    expect(result).toEqual({
      outcome: 'person_review',
      personId: 321,
      candidateCount: 2,
      reason: 'multiple_open_deals',
    });
    const noteBody = JSON.parse(mockFetch.mock.calls[2][1].body as string);
    expect(noteBody).toEqual(expect.objectContaining({
      person_id: 321,
      pinned_to_person_flag: 1,
    }));
    expect(noteBody).not.toHaveProperty('deal_id');
  });

  it('createLead reuses a normalized name match only when the stored address corroborates it', async () => {
    const addressField = '2f068d0e83a4ea944b6f91f97769a45557b62425';
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/persons/search') && url.searchParams.get('fields') === 'email') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { items: [] } }) };
      }
      if (url.pathname.endsWith('/persons/search') && url.searchParams.get('fields') === 'name') {
        return {
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { items: [{ item: { id: 321, name: 'Schmidt, Maria Anna' } }] },
          }),
        };
      }
      if (url.pathname.endsWith('/persons/321') && !init?.method) {
        return {
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { id: 321, name: 'Schmidt, Maria Anna', [addressField]: 'Musterstraße 1, 12345 Lemgo' },
          }),
        };
      }
      if (url.pathname.endsWith('/persons/321/deals')) {
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: [{ id: 456, status: 'open' }] }),
        };
      }
      if (url.pathname.endsWith('/persons/321') && init?.method === 'PUT') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 321 } }) };
      }
      if (url.pathname.endsWith('/notes') && init?.method === 'POST') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 9003 } }) };
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 2, 3);
    const result = await service.createLead({
      firstName: 'Maria',
      lastName: 'Schmidt',
      email: 'maria.new@example.de',
      street: 'Musterstrasse 1',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
    });

    expect(result).toEqual({ outcome: 'reused', personId: 321, dealId: 456 });
    expect(mockFetch.mock.calls.some(([url, init]) => (
      new URL(String(url)).pathname.endsWith('/persons') && init?.method === 'POST'
    ))).toBe(false);
  });

  it('createLead does not auto-link a normalized name without address corroboration', async () => {
    const addressField = '2f068d0e83a4ea944b6f91f97769a45557b62425';
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/persons/search') && url.searchParams.get('fields') === 'email') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { items: [] } }) };
      }
      if (url.pathname.endsWith('/persons/search') && url.searchParams.get('fields') === 'name') {
        return {
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { items: [{ item: { id: 321, name: 'Maria Schmidt' } }] },
          }),
        };
      }
      if (url.pathname.endsWith('/persons/321') && !init?.method) {
        return {
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { id: 321, name: 'Maria Schmidt', [addressField]: 'Andere Straße 8, 32756 Detmold' },
          }),
        };
      }
      throw new Error(`Unexpected mutation: ${init?.method ?? 'GET'} ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 2, 3);
    const result = await service.createLead({
      firstName: 'Maria',
      lastName: 'Schmidt',
      email: 'maria.new@example.de',
      street: 'Musterstrasse 1',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
    });

    expect(result).toEqual({
      outcome: 'identity_review',
      candidateCount: 1,
      reason: 'name_match_requires_corroboration',
    });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it.each([
    '05261 96660',
    '+49 (0) 5261 96660',
    '0049 5261 96660',
  ])('createLead treats German phone format %s as the same identifier', async (phone) => {
    const searchTerms: string[] = [];
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/persons/search')) {
        searchTerms.push(url.searchParams.get('term') ?? '');
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: { items: [{ item: { id: 321 } }] } }),
        };
      }
      if (url.pathname.endsWith('/persons/321/deals')) {
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: [{ id: 456, status: 'open' }] }),
        };
      }
      if (url.pathname.endsWith('/persons/321') && init?.method === 'PUT') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 321 } }) };
      }
      if (url.pathname.endsWith('/notes') && init?.method === 'POST') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 9004 } }) };
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 2, 3);
    const result = await service.createLead({
      firstName: 'Max',
      lastName: 'Mustermann',
      phone,
      street: 'Musterstrasse 1',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
    });

    expect(result).toEqual({ outcome: 'reused', personId: 321, dealId: 456 });
    expect(searchTerms).toEqual(['0049526196660']);
  });

  it('createLead creates a deal for an email-matched person with no open deal', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/persons/search')) {
        const items = url.searchParams.get('fields') === 'email' ? [{ item: { id: 321 } }] : [];
        return { ok: true, json: () => Promise.resolve({ success: true, data: { items } }) };
      }
      if (url.pathname.endsWith('/persons/321/deals')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: [] }) };
      }
      if (url.pathname.endsWith('/persons/321') && init?.method === 'PUT') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 321 } }) };
      }
      if (url.pathname.endsWith('/deals') && init?.method === 'POST') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 456 } }) };
      }
      if (url.pathname.endsWith('/notes') && init?.method === 'POST') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 789 } }) };
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 2, 3);
    const result = await service.createLead({
      firstName: 'Max',
      lastName: 'Mustermann',
      phone: '05261 96660',
      email: ' MAX@EXAMPLE.DE ',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
    });

    expect(result).toEqual({ outcome: 'created', personId: 321, dealId: 456 });

    expect(mockFetch.mock.calls[0][0]).toContain('/persons/search');
    expect(mockFetch.mock.calls[0][0]).toContain('term=max%40example.de');
    expect(mockFetch.mock.calls[0][0]).toContain('fields=email');
    expect(mockFetch.mock.calls[0][0]).toContain('exact_match=true');

    const personUpdate = mockFetch.mock.calls.find(([url, init]) => (
      new URL(String(url)).pathname.endsWith('/persons/321') && init?.method === 'PUT'
    ));
    expect(personUpdate).toBeDefined();
    const dealCall = mockFetch.mock.calls.find(([url, init]) => (
      new URL(String(url)).pathname.endsWith('/deals') && init?.method === 'POST'
    ));
    expect(dealCall).toBeDefined();
    const dealBody = JSON.parse(dealCall![1]!.body as string);
    expect(dealBody.person_id).toBe(321);
  });

  it('createLead updates a reused person with fresh contact details before creating the deal', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/persons/search')) {
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: { items: [{ item: { id: 321 } }] } }),
        };
      }
      if (url.pathname.endsWith('/persons/321/deals')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: [] }) };
      }
      if (url.pathname.endsWith('/persons/321') && init?.method === 'PUT') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 321 } }) };
      }
      if (url.pathname.endsWith('/deals') && init?.method === 'POST') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 456 } }) };
      }
      if (url.pathname.endsWith('/notes') && init?.method === 'POST') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 101 } }) };
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 2, 3);
    await service.createLead({
      firstName: 'Max',
      lastName: 'Mustermann',
      phone: '05261 96660',
      email: 'max@example.de',
      street: 'Musterstrasse 1',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
      newsletter: 'Ja',
    });

    const updateCall = mockFetch.mock.calls.find(([url, init]) => (
      new URL(String(url)).pathname.endsWith('/persons/321') && init?.method === 'PUT'
    ));
    expect(updateCall).toBeDefined();
    const patchBody = JSON.parse(updateCall![1]!.body as string);
    expect(patchBody.name).toBe('Max Mustermann');
    expect(patchBody.phone).toEqual([{ value: '0049526196660', primary: true }]);
    expect(patchBody.email).toEqual([{ value: 'max@example.de', primary: true }]);
    expect(patchBody['2f068d0e83a4ea944b6f91f97769a45557b62425']).toBe('Musterstrasse 1, 12345 Lemgo');
    expect(patchBody.fd1928c889e5888dd2b7964ab9f2d8c129d1aa40).toBe(138);

    expect(mockFetch.mock.calls.some(([url, init]) => (
      new URL(String(url)).pathname.endsWith('/deals') && init?.method === 'POST'
    ))).toBe(true);
  });

  it('createLead falls back to phone search when no email is available', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/persons/search')) {
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: { items: [{ item: { id: 654 } }] } }),
        };
      }
      if (url.pathname.endsWith('/persons/654/deals')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: [] }) };
      }
      if (url.pathname.endsWith('/persons/654') && init?.method === 'PUT') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 654 } }) };
      }
      if (url.pathname.endsWith('/deals') && init?.method === 'POST') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 456 } }) };
      }
      if (url.pathname.endsWith('/notes') && init?.method === 'POST') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 789 } }) };
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 2, 3);
    const result = await service.createLead({
      firstName: 'Max',
      lastName: 'Mustermann',
      phone: '05261 96660',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
    });

    expect(result).toEqual({ outcome: 'created', personId: 654, dealId: 456 });
    expect(mockFetch.mock.calls[0][0]).toContain('/persons/search');
    expect(mockFetch.mock.calls[0][0]).toContain('term=0049526196660');
    expect(mockFetch.mock.calls[0][0]).toContain('fields=phone');

    const dealCall = mockFetch.mock.calls.find(([url, init]) => (
      new URL(String(url)).pathname.endsWith('/deals') && init?.method === 'POST'
    ));
    expect(dealCall).toBeDefined();
    const dealBody = JSON.parse(dealCall![1]!.body as string);
    expect(dealBody.person_id).toBe(654);
  });

  it('createLead creates an email-only person without searching or writing a placeholder phone', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const pathname = new URL(url).pathname;
      if (url.includes('/persons/search') && url.includes('fields=email')) {
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: { items: [] } }),
        };
      }
      if (url.includes('/persons/search') && url.includes('fields=phone')) {
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: { items: [] } }),
        };
      }
      if (pathname.endsWith('/persons') && init?.method === 'POST') {
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: { id: 123 } }),
        };
      }
      if (pathname.endsWith('/deals')) {
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: { id: 456 } }),
        };
      }
      return {
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 789 } }),
      };
    });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 2, 3);
    const result = await service.createLead({
      firstName: 'Max',
      lastName: 'Mustermann',
      email: ' MAX@EXAMPLE.DE ',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
    });

    expect(result).toEqual({ outcome: 'created', personId: 123, dealId: 456 });
    expect(mockFetch.mock.calls[0][0]).toContain('fields=email');
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('fields=phone'))).toBe(false);
    const personCall = mockFetch.mock.calls.find(([url]) => new URL(String(url)).pathname.endsWith('/persons'));
    expect(personCall).toBeDefined();
    const personBody = JSON.parse(personCall![1]!.body as string);
    expect(personBody).not.toHaveProperty('phone');
    expect(personBody.email).toEqual([{ value: 'max@example.de', primary: true }]);
    expect(JSON.stringify(personBody)).not.toContain('nicht ausgefüllt');
  });

  it('createLead creates a new person when searches find no existing person', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { items: [] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { items: [] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { items: [] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 123 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 456 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 789 } }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 2, 3);
    const result = await service.createLead({
      firstName: 'Max',
      lastName: 'Mustermann',
      phone: '05261 96660',
      email: 'max@example.de',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
    });

    expect(result).toEqual({ outcome: 'created', personId: 123, dealId: 456 });
    expect(mockFetch.mock.calls[0][0]).toContain('fields=email');
    expect(mockFetch.mock.calls[1][0]).toContain('fields=phone');
    expect(mockFetch.mock.calls[2][0]).toContain('fields=name');
    expect(mockFetch.mock.calls[3][0]).toContain('/persons');
    expect(mockFetch.mock.calls[4][0]).toContain('/deals');

    const personBody = JSON.parse(mockFetch.mock.calls[3][1].body);
    expect(personBody.name).toBe('Max Mustermann');

    const dealBody = JSON.parse(mockFetch.mock.calls[4][1].body);
    expect(dealBody.person_id).toBe(123);
  });

  it('createLead reuses a recently created person before Pipedrive search indexing catches up', async () => {
    let nextNoteId = 789;
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/persons/search')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { items: [] } }) };
      }
      if (url.pathname.endsWith('/persons') && init?.method === 'POST') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 123 } }) };
      }
      if (url.pathname.endsWith('/persons/123/deals')) {
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: [{ id: 456, status: 'open' }] }),
        };
      }
      if (url.pathname.endsWith('/persons/123') && init?.method === 'PUT') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 123 } }) };
      }
      if (url.pathname.endsWith('/deals') && init?.method === 'POST') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 456 } }) };
      }
      if (url.pathname.endsWith('/notes') && init?.method === 'POST') {
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: { id: nextNoteId++ } }),
        };
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 2, 3);
    const leadData = {
      firstName: 'Max',
      lastName: 'Mustermann',
      phone: '05261 96660',
      email: 'max@example.de',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00' as const,
    };

    const first = await service.createLead(leadData);
    const second = await service.createLead(leadData);

    expect(first).toEqual({ outcome: 'created', personId: 123, dealId: 456 });
    expect(second).toEqual({ outcome: 'reused', personId: 123, dealId: 456 });

    const searchCalls = mockFetch.mock.calls.filter(([url]) => String(url).includes('/persons/search'));
    expect(searchCalls).toHaveLength(5);
    const dealPosts = mockFetch.mock.calls.filter(([url, init]) => (
      new URL(String(url)).pathname.endsWith('/deals') && init?.method === 'POST'
    ));
    expect(dealPosts).toHaveLength(1);
  });

  it('createLead normalizes contact fields and sends custom option IDs', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { items: [] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { items: [] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { items: [] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 123 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 456 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 789 } }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 2, 3);
    const result = await service.createLead({
      firstName: 'max',
      lastName: 'MUSTERMANN',
      phone: '05261 9666 0',
      email: ' MAX@EXAMPLE.DE ',
      postalCode: '12345',
      city: 'lemgo',
      street: 'musterstrasse 1',
      availability: '08:00 - 12:00',
      customerSegment: 'privatperson',
      stairLocation: 'Innenbereich' as never,
      stairType: 'kurvig',
      buildingType: 'einfamilienhaus',
      liftType: 'sitzlift',
    });

    expect(result).toEqual({ outcome: 'created', personId: 123, dealId: 456 });

    const personCall = mockFetch.mock.calls[3];
    expect(personCall[0]).toContain('/persons');
    const personBody = JSON.parse(personCall[1].body);
    expect(personBody.name).toBe('Max Mustermann');
    expect(personBody.owner_id).toBe(24093350);
    expect(personBody.phone).toEqual([{ value: '0049526196660', primary: true }]);
    expect(personBody.email).toEqual([{ value: 'max@example.de', primary: true }]);
    expect(personBody['2f068d0e83a4ea944b6f91f97769a45557b62425']).toBe('Musterstrasse 1, 12345 Lemgo');
    expect(personBody['43c2a08a7993307990ced6639183ca91f7608b2b']).toBe('152');
    expect(personBody.e0cb479c4f405997f2e53b58ddc84ecb6d4c7b49).toBe(140);

    const dealCall = mockFetch.mock.calls[4];
    expect(dealCall[0]).toContain('/deals');
    const dealBody = JSON.parse(dealCall[1].body);
    expect(dealBody.person_id).toBe(123);
    expect(dealBody.pipeline_id).toBe(2);
    expect(dealBody.stage_id).toBe(3);
    expect(dealBody['59745cb0d3eb04f89e70543d01f49813175ad6a3']).toBe(56);
    expect(dealBody['300c5e3ef98a1a25e2f80262af2bd0942b95c231']).toBe(177);
    expect(dealBody.eaf2557e218e842227f803c4abdc665291c99b91).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dealBody.user_id).toBe(24093350);
    expect(dealBody.owner_id).toBeUndefined();
    expect(dealBody.aff4a71d003cb374585aeef67732b05828b62050).toBe(118);
    expect(dealBody['36241991692b59873ce73c478b98aab6ad4054c1']).toBe(120);
    expect(dealBody['9c08a82b8cad15eab222f89a6a961c59bc8c95e3']).toBe(122);
    expect(dealBody['684a7860061d276f4a76498fd1653d721e37cb6f']).toBe(128);
  });

  it('createLead uses the Berlin calendar date after local midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T22:30:00.000Z'));
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { items: [] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 123 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 456 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 789 } }),
      });
    vi.stubGlobal('fetch', mockFetch);

    await createPipedriveService('test-key', 2, 3).createLead({
      firstName: 'Zeit',
      lastName: 'Test',
      email: 'zeit@example.de',
      availability: '08:00 - 12:00',
    });

    const dealCall = mockFetch.mock.calls.find((call) => (
      String(call[0]).includes('/deals?') && call[1]?.method === 'POST'
    ));
    expect(dealCall).toBeDefined();
    const dealBody = JSON.parse(dealCall![1].body);
    expect(dealBody.eaf2557e218e842227f803c4abdc665291c99b91).toBe('2026-07-14');
  });

  it('createLead omits custom option fields when values are unknown', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { items: [] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { items: [] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 123 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 456 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 789 } }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 2, 3);
    await service.createLead({
      firstName: 'Max',
      lastName: 'Mustermann',
      phone: '+49 5261 96660',
      postalCode: 'abc',
      city: 'Lemgo',
      availability: '12:00 - 16:00',
      customerSegment: 'Firmenkunde' as never,
    });

    const dealBody = JSON.parse(mockFetch.mock.calls[3][1].body);
    expect(dealBody['59745cb0d3eb04f89e70543d01f49813175ad6a3']).toBe(57);
    expect(dealBody['300c5e3ef98a1a25e2f80262af2bd0942b95c231']).toBe(177);
    expect(dealBody.aff4a71d003cb374585aeef67732b05828b62050).toBeUndefined();
    expect(dealBody['36241991692b59873ce73c478b98aab6ad4054c1']).toBeUndefined();
    expect(dealBody['9c08a82b8cad15eab222f89a6a961c59bc8c95e3']).toBeUndefined();
    expect(dealBody['684a7860061d276f4a76498fd1653d721e37cb6f']).toBeUndefined();

    const noteBody = JSON.parse(mockFetch.mock.calls[4][1].body);
    expect(noteBody.content).toBe('Erreichbarkeit: 12:00 - 16:00');
  });

  it('createLead maps German display labels to custom option IDs', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { items: [] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { items: [] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 123 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 456 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 789 } }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 2, 3);
    await service.createLead({
      firstName: 'Max',
      lastName: 'Mustermann',
      phone: '05261 96660',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
      stairLocation: 'Innentreppe' as never,
      stairType: 'Kurvig' as never,
      buildingType: 'Einfamilienhaus' as never,
      liftType: 'Sitzlift' as never,
    });

    const dealBody = JSON.parse(mockFetch.mock.calls[3][1].body);
    expect(dealBody.aff4a71d003cb374585aeef67732b05828b62050).toBe(118);
    expect(dealBody['36241991692b59873ce73c478b98aab6ad4054c1']).toBe(120);
    expect(dealBody['9c08a82b8cad15eab222f89a6a961c59bc8c95e3']).toBe(122);
    expect(dealBody['684a7860061d276f4a76498fd1653d721e37cb6f']).toBe(128);
  });

  it('createLead only stores non-structured data in the deal note', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { items: [] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { items: [] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 123 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 456 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 789 } }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 2, 3);
    await service.createLead({
      firstName: 'Max',
      lastName: 'Mustermann',
      phone: '05261 96660',
      street: 'Musterstrasse 1',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
      customerSegment: 'privatperson',
      stairLocation: 'innen',
      stairType: 'gerade',
      buildingType: 'einfamilienhaus',
      liftType: 'rollstuhlgeeignet',
      newsletter: 'Ja',
      message: 'Bitte am besten vormittags anrufen.',
    });

    const noteBody = JSON.parse(mockFetch.mock.calls[4][1].body);
    expect(noteBody.content).toBe('Erreichbarkeit: 08:00 - 12:00\nNachricht: Bitte am besten vormittags anrufen.');
    expect(noteBody.content).not.toContain('Treppe:');
    expect(noteBody.content).not.toContain('Adresse:');
    expect(noteBody.content).not.toContain('Newsletter:');
  });

  it('createServiceActivity builds correct activity payload', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 789 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 101 } }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 1, 1);
    const result = await service.createServiceActivity({
      customerName: 'Maria Schmidt',
      phone: '0987654321',
      issueDescription: 'Lift macht Geräusche beim Hochfahren',
    });

    expect(result).toEqual({ personId: 789, activityId: 101 });
  });

  it('resolveSupportPerson returns unique when name search has one exact person', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: { items: [{ item: { id: 501, name: 'Maria Schmidt' } }] },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: [] }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 1, 2);
    const result = await service.resolveSupportPerson({ customerName: '  maria   schmidt  ' });

    expect(result).toEqual({ matchState: 'unique', personId: 501, candidateCount: 1 });
    expect(mockFetch.mock.calls[0][0]).toContain('/persons/search');
    expect(mockFetch.mock.calls[0][0]).toContain('term=maria+schmidt');
    expect(mockFetch.mock.calls[0][0]).toContain('fields=name');
    expect(mockFetch.mock.calls[0][0]).toContain('exact_match=true');
  });

  it('resolveSupportPerson includes a single open opportunity for a unique person', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: { items: [{ item: { id: 501, name: 'Maria Schmidt' } }] },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: [{ id: 7001, status: 'open', person_id: { value: 501 } }] }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 1, 2);
    const result = await service.resolveSupportPerson({ customerName: 'Maria Schmidt' });

    expect(result).toEqual({ matchState: 'unique', personId: 501, dealId: 7001, candidateCount: 1 });
    expect(mockFetch.mock.calls[1][0]).toContain('/persons/501/deals');
    expect(mockFetch.mock.calls[1][0]).toContain('status=open');
  });

  it('resolveSupportPerson asks for disambiguation when name search has multiple people and no phone or email', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        data: {
          items: [
            { item: { id: 501, name: 'Maria Schmidt' } },
            { item: { id: 502, name: 'Maria Schmidt' } },
          ],
        },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 1, 2);
    const result = await service.resolveSupportPerson({ customerName: 'Maria Schmidt' });

    expect(result).toEqual({ matchState: 'ambiguous', candidateCount: 2 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('resolveSupportPerson uses email disambiguation after ambiguous name search', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            items: [
              { item: { id: 501, name: 'Maria Schmidt' } },
              { item: { id: 502, name: 'Maria Schmidt' } },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: { items: [{ item: { id: 502, name: 'Maria Schmidt' } }] },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: [] }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 1, 2);
    const result = await service.resolveSupportPerson({
      customerName: 'Maria Schmidt',
      email: ' MARIA@example.de ',
    });

    expect(result).toEqual({ matchState: 'unique', personId: 502, candidateCount: 1 });
    expect(mockFetch.mock.calls[1][0]).toContain('fields=email');
    expect(mockFetch.mock.calls[1][0]).toContain('term=maria%40example.de');
  });

  it('resolveSupportPerson does not use an email match outside the ambiguous name candidates', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            items: [
              { item: { id: 501, name: 'Maria Schmidt' } },
              { item: { id: 502, name: 'Maria Schmidt' } },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: { items: [{ item: { id: 777, name: 'Andere Person' } }] },
        }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 1, 2);
    const result = await service.resolveSupportPerson({
      customerName: 'Maria Schmidt',
      email: 'maria@example.de',
    });

    expect(result).toEqual({ matchState: 'unresolved', candidateCount: 0 });
  });

  it('resolveSupportPerson uses phone disambiguation only inside ambiguous name candidates', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            items: [
              { item: { id: 501, name: 'Maria Schmidt' } },
              { item: { id: 502, name: 'Maria Schmidt' } },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: { items: [{ item: { id: 501, name: 'Maria Schmidt' } }] },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: [] }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 1, 2);
    const result = await service.resolveSupportPerson({
      customerName: 'Maria Schmidt',
      phone: '05261 96660',
    });

    expect(result).toEqual({ matchState: 'unique', personId: 501, candidateCount: 1 });
  });

  it('resolveSupportPerson ignores blank email and still uses phone disambiguation', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            items: [
              { item: { id: 501, name: 'Maria Schmidt' } },
              { item: { id: 502, name: 'Maria Schmidt' } },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: { items: [{ item: { id: 502, name: 'Maria Schmidt' } }] },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: [] }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 1, 2);
    const result = await service.resolveSupportPerson({
      customerName: 'Maria Schmidt',
      email: '   ',
      phone: '05261 96660',
    });

    expect(result).toEqual({ matchState: 'unique', personId: 502, candidateCount: 1 });
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch.mock.calls[1][0]).toContain('fields=phone');
  });

  it('resolveSupportPerson can resolve a person and opportunity by Angebotsnummer custom-field search', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { items: [] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            items: [{
              item: {
                id: 7001,
                status: 'open',
                person: { id: 501, name: 'Maria Schmidt' },
              },
            }],
          },
        }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 1, 2);
    const result = await service.resolveSupportPerson({
      customerName: 'Maria Schmidt',
      offerNumber: '14.28',
    });

    expect(result).toEqual({ matchState: 'unique', personId: 501, dealId: 7001, candidateCount: 1 });
    expect(mockFetch.mock.calls[1][0]).toContain('/deals/search');
    expect(mockFetch.mock.calls[1][0]).toContain('term=14.28');
    expect(mockFetch.mock.calls[1][0]).toContain('fields=custom_fields');
    expect(mockFetch.mock.calls[1][0]).toContain('exact_match=true');
  });

  it('resolveSupportPerson can resolve by Lead-ID even when the customer name is missing', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        data: {
          items: [{
            item: {
              id: 7001,
              status: 'open',
              person: { id: 501, name: 'Maria Schmidt' },
            },
          }],
        },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 1, 2);
    const result = await service.resolveSupportPerson({
      customerName: ' ',
      leadId: 'PT-313235',
    });

    expect(result).toEqual({ matchState: 'unique', personId: 501, dealId: 7001, candidateCount: 1 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain('/deals/search');
    expect(mockFetch.mock.calls[0][0]).toContain('term=PT-313235');
  });

  it('resolveSupportPerson marks identifier matches ambiguous when multiple open opportunities match', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        data: {
          items: [
            { item: { id: 7001, status: 'open', person: { id: 501, name: 'Maria Schmidt' } } },
            { item: { id: 7002, status: 'open', person: { id: 502, name: 'Mario Schmidt' } } },
          ],
        },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 1, 2);
    const result = await service.resolveSupportPerson({
      customerName: '',
      orderNumber: 'A-100',
    });

    expect(result).toEqual({ matchState: 'ambiguous', candidateCount: 2 });
  });

  it('resolveSupportPerson does not use a phone match outside the ambiguous name candidates', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            items: [
              { item: { id: 501, name: 'Maria Schmidt' } },
              { item: { id: 502, name: 'Maria Schmidt' } },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: { items: [{ item: { id: 777, name: 'Andere Person' } }] },
        }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 1, 2);
    const result = await service.resolveSupportPerson({
      customerName: 'Maria Schmidt',
      phone: '05261 96660',
    });

    expect(result).toEqual({ matchState: 'unresolved', candidateCount: 0 });
  });

  it('resolveSupportPerson returns unresolved when disambiguation still finds no unique person', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            items: [
              { item: { id: 501, name: 'Maria Schmidt' } },
              { item: { id: 502, name: 'Maria Schmidt' } },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { items: [] } }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 1, 2);
    const result = await service.resolveSupportPerson({
      customerName: 'Maria Schmidt',
      phone: '05261 96660',
    });

    expect(result).toEqual({ matchState: 'unresolved', candidateCount: 0 });
    expect(mockFetch.mock.calls[1][0]).toContain('fields=phone');
    expect(mockFetch.mock.calls[1][0]).toContain('term=0049526196660');
  });

  it('createSupportNote writes a compact person note only for a unique support match', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { id: 9001 } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 1, 2);
    const result = await service.createSupportNote(501, {
      customerName: 'Maria Schmidt',
      category: 'technik',
      issueDescription: 'Lift bleibt stehen.',
      phone: '05261 96660',
    });

    expect(result).toEqual({ noteId: 9001 });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.person_id).toBe(501);
    expect(body.content).toContain('Sarah Chatbot');
    expect(body.content).toContain('Kategorie: technik');
    expect(body.content).toContain('Kurzfassung: Lift bleibt stehen.');
    expect(body.content).not.toContain('activity_id');
    expect(body.content).not.toContain('deal_id');
  });

  it('createSupportNote pins the same support note to the matched opportunity when provided', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { id: 9002 } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 1, 2);
    const result = await service.createSupportNote(501, {
      customerName: 'Maria Schmidt',
      category: 'sales',
      issueDescription: 'TEST NOTE',
      offerNumber: '14.28',
      leadId: 'LEAD-123',
    }, 7001);

    expect(result).toEqual({ noteId: 9002 });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.person_id).toBe(501);
    expect(body.deal_id).toBe(7001);
    expect(body.pinned_to_person_flag).toBe(1);
    expect(body.pinned_to_deal_flag).toBe(1);
    expect(body.content).toContain('Kurzfassung: TEST NOTE');
    expect(body.content).toContain('Angebotsnummer: 14.28');
    expect(body.content).toContain('Lead-ID: LEAD-123');
  });

  it('createChatTranscriptNote pins a full chat transcript to its person and opportunity', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { id: 9101 } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 1, 2);
    const content = '<strong>Vollständiges Sarah-Chatprotokoll</strong>';
    const result = await service.createChatTranscriptNote(501, 7001, content);

    expect(result).toEqual({ noteId: 9101 });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({
      person_id: 501,
      deal_id: 7001,
      content,
      pinned_to_person_flag: 1,
      pinned_to_deal_flag: 1,
    });
  });

  it('createChatTranscriptNote pins a case transcript to its person when no opportunity exists', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { id: 9102 } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 1, 2);
    const content = '<strong>Vollständiges Sarah-Chatprotokoll</strong>';
    const result = await service.createChatTranscriptNote(501, undefined, content);

    expect(result).toEqual({ noteId: 9102 });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({
      person_id: 501,
      content,
      pinned_to_person_flag: 1,
    });
  });
});
