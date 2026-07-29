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
      if (url.pathname.endsWith('/persons/search') && url.searchParams.get('fields') === 'name') {
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: { items: [{ item: { id: 321, name: 'Max Mustermann' } }] } }),
        };
      }
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

    expect(result).toEqual({ outcome: 'reused', personId: 321, dealId: 456, createdPerson: false });
    expect(mockFetch.mock.calls.some(([url, init]) => (
      new URL(String(url)).pathname.endsWith('/deals') && init?.method === 'POST'
    ))).toBe(false);
    const noteCall = mockFetch.mock.calls.find(([url]) => new URL(String(url)).pathname.endsWith('/notes'));
    expect(noteCall).toBeUndefined();
  });

  it('createLead reuses one exact open reference deal and deduplicates repeated search hits', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/deals/search')) {
        expect(url.searchParams.get('term')).toBe('ANG-TEST-42');
        expect(url.searchParams.get('fields')).toBe('custom_fields');
        expect(url.searchParams.get('exact_match')).toBe('true');
        return {
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: {
              items: [
                { item: { id: 456, status: 'open', person: { id: 321 } } },
                { item: { id: 456, status: 'open', person: { id: 321 } } },
              ],
            },
          }),
        };
      }
      if (url.pathname.endsWith('/persons/search')) {
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: { items: [{ item: { id: 321 } }] } }),
        };
      }
      if (url.pathname.endsWith('/persons/321') && init?.method === 'PUT') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 321 } }) };
      }
      if (url.pathname.endsWith('/notes') && init?.method === 'POST') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 9010 } }) };
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await createPipedriveService('test-key', 2, 3).createLead({
      priorContact: 'yes',
      priorContactReference: 'ANG-TEST-42',
      firstName: 'Max',
      lastName: 'Mustermann',
      email: 'returning@example.de',
      street: 'Musterstrasse 1',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
      message: 'Bitte dem vorhandenen Angebot zuordnen.',
    });

    expect(result).toEqual({ outcome: 'reused', personId: 321, dealId: 456, createdPerson: false });
    expect(mockFetch.mock.calls.some(([url]) => new URL(String(url)).pathname.endsWith('/persons/321/deals'))).toBe(false);
    const noteCall = mockFetch.mock.calls.find(([url]) => new URL(String(url)).pathname.endsWith('/notes'));
    expect(noteCall).toBeUndefined();
  });

  it('createLead lets an exact open reference override an uncorroborated name-only match', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/deals/search')) {
        return {
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { items: [{ item: { id: 456, status: 'open', person: { id: 321 } } }] },
          }),
        };
      }
      if (url.pathname.endsWith('/persons/search') && url.searchParams.get('fields') === 'email') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { items: [] } }) };
      }
      if (url.pathname.endsWith('/persons/search') && url.searchParams.get('fields') === 'name') {
        return {
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { items: [{ item: { id: 999, name: 'Max Mustermann' } }] },
          }),
        };
      }
      if (url.pathname.endsWith('/persons/999') && !init?.method) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: {} }) };
      }
      if (url.pathname.endsWith('/persons/321') && init?.method === 'PUT') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 321 } }) };
      }
      if (url.pathname.endsWith('/notes') && init?.method === 'POST') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 9012 } }) };
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await createPipedriveService('test-key', 2, 3).createLead({
      priorContact: 'yes',
      priorContactReference: 'ANG-NAME-OVERRIDE-42',
      firstName: 'Max',
      lastName: 'Mustermann',
      email: 'new-address@example.de',
      street: 'Musterstrasse 1',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
    });

    expect(result).toEqual({ outcome: 'reused', personId: 321, dealId: 456, createdPerson: false });
  });

  it('createLead sends an exact reference and contact conflict to identity review without mutation', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/deals/search')) {
        return {
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { items: [{ item: { id: 456, status: 'open', person: { id: 321 } } }] },
          }),
        };
      }
      if (url.pathname.endsWith('/persons/search')) {
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: { items: [{ item: { id: 654 } }] } }),
        };
      }
      throw new Error(`Unexpected mutation: ${init?.method ?? 'GET'} ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await createPipedriveService('test-key', 2, 3).createLead({
      priorContact: 'yes',
      priorContactReference: 'ANG-CONFLICT-42',
      firstName: 'Max',
      lastName: 'Mustermann',
      email: 'different-person@example.de',
      street: 'Musterstrasse 1',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
    });

    expect(result).toEqual({
      outcome: 'identity_review',
      candidateCount: 2,
      reason: 'reference_contact_conflict',
    });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('createLead sends multiple exact open reference deals to review without mutation', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/deals/search')) {
        return {
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: {
              items: [
                { item: { id: 456, status: 'open', person: { id: 321 } } },
                { item: { id: 457, status: 'open', person: { id: 321 } } },
              ],
            },
          }),
        };
      }
      throw new Error(`Unexpected mutation: ${init?.method ?? 'GET'} ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await createPipedriveService('test-key', 2, 3).createLead({
      priorContact: 'yes',
      priorContactReference: 'ANG-MULTIPLE-42',
      firstName: 'Max',
      lastName: 'Mustermann',
      email: 'returning@example.de',
      street: 'Musterstrasse 1',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
    });

    expect(result).toEqual({
      outcome: 'identity_review',
      candidateCount: 2,
      reason: 'ambiguous_case_reference',
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('createLead creates a new deal for an email-matched contact when only a closed reference exists', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/deals/search')) {
        return {
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { items: [{ item: { id: 456, status: 'won', person: { id: 321 } } }] },
          }),
        };
      }
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
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 789 } }) };
      }
      if (url.pathname.endsWith('/notes') && init?.method === 'POST') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 9011 } }) };
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await createPipedriveService('test-key', 2, 3).createLead({
      priorContact: 'yes',
      priorContactReference: 'ANG-CLOSED-42',
      firstName: 'Max',
      lastName: 'Mustermann',
      email: 'returning@example.de',
      street: 'Musterstrasse 1',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
    });

    expect(result).toEqual({ outcome: 'created', personId: 321, dealId: 789, createdPerson: false });
    expect(mockFetch.mock.calls.some(([url, init]) => (
      new URL(String(url)).pathname.endsWith('/deals') && init?.method === 'POST'
    ))).toBe(true);
    expect(mockFetch.mock.calls.some(([url, init]) => (
      new URL(String(url)).pathname.endsWith('/persons/321') && init?.method === 'PUT'
    ))).toBe(false);
  });

  it('createLead makes no CRM mutation when exact reference search fails', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/deals/search')) {
        return { ok: false, status: 503, statusText: 'Reference Search Unavailable' };
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(createPipedriveService('test-key', 2, 3).createLead({
      priorContact: 'yes',
      priorContactReference: 'ANG-FAIL-42',
      firstName: 'Max',
      lastName: 'Mustermann',
      email: 'returning@example.de',
      street: 'Musterstrasse 1',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
    })).rejects.toThrow('Pipedrive API error: 503 Reference Search Unavailable');

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('createLead gives one exact email match priority over conflicting name and phone data', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/persons/search')) {
        const id = url.searchParams.get('fields') === 'email' ? 321 : 654;
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: { items: [{ item: { id } }] } }),
        };
      }
      if (url.pathname.endsWith('/persons/321/deals')) {
        return {
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: [
              { id: 456, status: 'open', add_time: '2026-07-01 10:00:00' },
              { id: 457, status: 'open', add_time: '2026-07-28 10:00:00' },
            ],
          }),
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
      phone: '05261 96660',
      street: 'Musterstrasse 1',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
    });

    expect(result).toEqual({ outcome: 'reused', personId: 321, dealId: 457, createdPerson: false });
    expect(mockFetch.mock.calls.some(([url, init]) => (
      new URL(String(url)).pathname.endsWith('/persons/321') && init?.method === 'PUT'
    ))).toBe(false);
  });

  it('createLead rejects a shared email that points outside the name candidates even with a unique phone', async () => {
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

    expect(result).toEqual({
      outcome: 'identity_review',
      candidateCount: 2,
      reason: 'ambiguous_email_identifier',
    });
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
      phone: '05261 96660',
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
      phone: '05261 96660',
      street: 'Musterstrasse 1',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
    })).rejects.toThrow('Pipedrive API error: 500 Update Failed');

    expect(mockFetch.mock.calls.some(([url, init]) => (
      new URL(String(url)).pathname.endsWith('/deals') && init?.method === 'POST'
    ))).toBe(false);
  });

  it('createLead reuses the deal without writing a preliminary note', async () => {
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
    })).resolves.toEqual({ outcome: 'reused', personId: 321, dealId: 456, createdPerson: false });

    expect(mockFetch.mock.calls.some(([url, init]) => (
      new URL(String(url)).pathname.endsWith('/deals') && init?.method === 'POST'
    ))).toBe(false);
    expect(mockFetch.mock.calls.some(([url, init]) => (
      new URL(String(url)).pathname.endsWith('/notes') && init?.method === 'POST'
    ))).toBe(false);
  });

  it('createLead reuses the newest open deal for an exact email-matched person', async () => {
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
            data: [
              { id: 457, status: 'open', add_time: '2026-07-20 09:00:00' },
              { id: 456, status: 'open', add_time: '2026-07-27 09:00:00' },
            ],
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

    expect(result).toEqual({ outcome: 'reused', personId: 321, dealId: 456, createdPerson: false });
    expect(mockFetch.mock.calls.some(([url, init]) => (
      new URL(String(url)).pathname.endsWith('/notes') && init?.method === 'POST'
    ))).toBe(false);
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

    expect(result).toEqual({ outcome: 'reused', personId: 321, dealId: 456, createdPerson: false });
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

    expect(result).toEqual({ outcome: 'reused', personId: 321, dealId: 456, createdPerson: false });
    expect(searchTerms).toEqual(['Max Mustermann', '0049526196660']);
  });

  it('createLead creates a deal for an email-matched person with no open deal', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/persons/search')) {
        const fields = url.searchParams.get('fields');
        const items = fields === 'name'
          ? [{ item: { id: 321, name: 'Max Mustermann' } }]
          : fields === 'email'
            ? [{ item: { id: 321 } }]
            : [];
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

    expect(result).toEqual({ outcome: 'created', personId: 321, dealId: 456, createdPerson: false });

    expect(mockFetch.mock.calls[0][0]).toContain('/persons/search');
    expect(mockFetch.mock.calls[0][0]).toContain('term=Max+Mustermann');
    expect(mockFetch.mock.calls[0][0]).toContain('fields=name');
    expect(mockFetch.mock.calls[1][0]).toContain('fields=phone');
    expect(mockFetch.mock.calls[2][0]).toContain('term=max%40example.de');
    expect(mockFetch.mock.calls[2][0]).toContain('fields=email');

    const personUpdate = mockFetch.mock.calls.find(([url, init]) => (
      new URL(String(url)).pathname.endsWith('/persons/321') && init?.method === 'PUT'
    ));
    expect(personUpdate).toBeUndefined();
    const dealCall = mockFetch.mock.calls.find(([url, init]) => (
      new URL(String(url)).pathname.endsWith('/deals') && init?.method === 'POST'
    ));
    expect(dealCall).toBeDefined();
    const dealBody = JSON.parse(dealCall![1]!.body as string);
    expect(dealBody.person_id).toBe(321);
  });

  it('createLead does not overwrite an existing contact matched by exact email', async () => {
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
    expect(updateCall).toBeUndefined();

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

    expect(result).toEqual({ outcome: 'created', personId: 654, dealId: 456, createdPerson: false });
    expect(mockFetch.mock.calls[0][0]).toContain('/persons/search');
    expect(mockFetch.mock.calls[0][0]).toContain('term=Max+Mustermann');
    expect(mockFetch.mock.calls[0][0]).toContain('fields=name');
    expect(mockFetch.mock.calls[1][0]).toContain('term=0049526196660');
    expect(mockFetch.mock.calls[1][0]).toContain('fields=phone');

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
      if (url.includes('/persons/search') && url.includes('fields=name')) {
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: { items: [] } }),
        };
      }
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

    expect(result).toEqual({ outcome: 'created', personId: 123, dealId: 456, createdPerson: true });
    expect(mockFetch.mock.calls[0][0]).toContain('fields=name');
    expect(mockFetch.mock.calls[1][0]).toContain('fields=email');
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

    expect(result).toEqual({ outcome: 'created', personId: 123, dealId: 456, createdPerson: true });
    expect(mockFetch.mock.calls[0][0]).toContain('fields=name');
    expect(mockFetch.mock.calls[1][0]).toContain('fields=phone');
    expect(mockFetch.mock.calls[2][0]).toContain('fields=email');
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

    expect(first).toEqual({ outcome: 'created', personId: 123, dealId: 456, createdPerson: true });
    expect(second).toEqual({ outcome: 'reused', personId: 123, dealId: 456, createdPerson: false });

    const searchCalls = mockFetch.mock.calls.filter(([url]) => String(url).includes('/persons/search'));
    expect(searchCalls).toHaveLength(6);
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

    expect(result).toEqual({ outcome: 'created', personId: 123, dealId: 456, createdPerson: true });

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

    expect(mockFetch.mock.calls.some(([url, init]) => (
      new URL(String(url)).pathname.endsWith('/notes') && init?.method === 'POST'
    ))).toBe(false);
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

  it('createLead leaves note persistence to the completed conversation writer', async () => {
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

    const noteCalls = mockFetch.mock.calls.filter(([url, init]) => (
      new URL(String(url)).pathname.endsWith('/notes') && init?.method === 'POST'
    ));
    expect(noteCalls).toHaveLength(0);
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

  it('resolveSupportPerson resolves a generic prior-contact reference to its exact open opportunity', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        data: {
          items: [{
            item: {
              id: 7010,
              status: 'open',
              person: { id: 510, name: 'Test Kunde' },
            },
          }],
        },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await createPipedriveService('test-key', 1, 2).resolveSupportPerson({
      customerName: '',
      priorContact: 'yes',
      priorContactReference: 'VORGANG-TEST-7010',
    });

    expect(result).toEqual({ matchState: 'unique', personId: 510, dealId: 7010, candidateCount: 1 });
    expect(mockFetch.mock.calls[0][0]).toContain('term=VORGANG-TEST-7010');
    expect(mockFetch.mock.calls[0][0]).toContain('fields=custom_fields');
  });

  it('resolveSupportPerson refuses a reference that conflicts with the identified contact', async () => {
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
        json: () => Promise.resolve({
          success: true,
          data: {
            items: [{ item: { id: 7011, status: 'open', person: { id: 777, name: 'Andere Person' } } }],
          },
        }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const result = await createPipedriveService('test-key', 1, 2).resolveSupportPerson({
      customerName: 'Maria Schmidt',
      priorContact: 'yes',
      priorContactReference: 'VORGANG-CONFLICT-7011',
    });

    expect(result).toEqual({ matchState: 'ambiguous', candidateCount: 2 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
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

  it('createChatTranscriptNote pins a full chat transcript to its person and opportunity', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 9101 } }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 1, 2);
    const content = '<strong>Vollständiges Sarah-Chatprotokoll</strong><small>[Sarah-Chat-ID:session-deal]</small>';
    const result = await service.createChatTranscriptNote('session-deal', 501, 7001, content);

    expect(result).toEqual({ noteId: 9101 });
    expect(mockFetch.mock.calls[0][0]).toContain('/notes?');
    expect(mockFetch.mock.calls[0][0]).toContain('deal_id=7001');
    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body).toEqual({
      person_id: 501,
      deal_id: 7001,
      content,
      pinned_to_person_flag: 1,
      pinned_to_deal_flag: 1,
    });
  });

  it('createChatTranscriptNote pins a case transcript to its person when no opportunity exists', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 9102 } }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 1, 2);
    const content = '<strong>Vollständiges Sarah-Chatprotokoll</strong><small>[Sarah-Chat-ID:session-person]</small>';
    const result = await service.createChatTranscriptNote('session-person', 501, undefined, content);

    expect(result).toEqual({ noteId: 9102 });
    expect(mockFetch.mock.calls[0][0]).toContain('person_id=501');
    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body).toEqual({
      person_id: 501,
      content,
      pinned_to_person_flag: 1,
    });
  });

  it('createChatTranscriptNote reconciles a committed transcript after an uncertain response', async () => {
    const marker = '[Sarah-Chat-ID:session-reconcile]';
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: [] }),
      })
      .mockRejectedValueOnce(new Error('socket closed after commit'))
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: [{ id: 9199, content: `<strong>Transcript</strong><small>${marker}</small>` }],
        }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 1, 2);
    await expect(service.createChatTranscriptNote(
      'session-reconcile',
      501,
      7001,
      `<strong>Transcript</strong><small>${marker}</small>`,
    )).rejects.toThrow('socket closed after commit');

    await expect(service.createChatTranscriptNote(
      'session-reconcile',
      501,
      7001,
      `<strong>Transcript</strong><small>${marker}</small>`,
    )).resolves.toEqual({ noteId: 9199 });

    const postCalls = mockFetch.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(postCalls).toHaveLength(1);
  });

  it('createSupportCase creates a reviewable person and deal for an unresolved request', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/persons') && init?.method === 'POST') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 701 } }) };
      }
      if (url.pathname.endsWith('/deals') && init?.method === 'POST') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 801 } }) };
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await createPipedriveService('test-key', 1, 2).createSupportCase({
      customerName: 'Camilo',
      email: ' CAECHMA@gmail.com ',
      category: 'lossau',
      issueDescription: 'Der Treppenlift muss noch installiert werden.',
    }, {
      matchState: 'unresolved',
      candidateCount: 0,
    });

    expect(result).toEqual({ personId: 701, dealId: 801, createdPerson: true });
    const personCall = mockFetch.mock.calls.find(([url]) => new URL(String(url)).pathname.endsWith('/persons'));
    expect(JSON.parse(personCall![1]!.body as string)).toEqual(expect.objectContaining({
      name: 'Camilo',
      email: [{ value: 'caechma@gmail.com', primary: true }],
    }));
    const dealCall = mockFetch.mock.calls.find(([url]) => new URL(String(url)).pathname.endsWith('/deals'));
    expect(JSON.parse(dealCall![1]!.body as string)).toEqual(expect.objectContaining({
      title: 'Sarah Support [lossau]: Camilo – Zuordnung prüfen',
      person_id: 701,
      pipeline_id: 1,
      stage_id: 2,
    }));
  });

  it('createSupportCase reuses a uniquely matched person that has no open deal', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/deals') && init?.method === 'POST') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 802 } }) };
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await createPipedriveService('test-key', 1, 2).createSupportCase({
      customerName: 'Maria Schmidt',
      phone: '05261 96660',
      category: 'technik',
      issueDescription: 'Der Lift bleibt stehen.',
    }, {
      matchState: 'unique',
      personId: 501,
      candidateCount: 1,
    });

    expect(result).toEqual({ personId: 501, dealId: 802, createdPerson: false });
    expect(mockFetch.mock.calls.some(([url]) => new URL(String(url)).pathname.endsWith('/persons'))).toBe(false);
    const dealBody = JSON.parse(mockFetch.mock.calls[0][1]!.body as string);
    expect(dealBody).toEqual(expect.objectContaining({ person_id: 501, pipeline_id: 1, stage_id: 2 }));
  });

  it('createSupportCase reuses its newly created person when an immediate deal retry is needed', async () => {
    let dealAttempts = 0;
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/persons') && init?.method === 'POST') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 703 } }) };
      }
      if (url.pathname.endsWith('/deals') && init?.method === 'POST') {
        dealAttempts += 1;
        if (dealAttempts === 1) {
          return { ok: false, status: 503, statusText: 'Service Unavailable' };
        }
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 803 } }) };
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);
    const service = createPipedriveService('test-key', 1, 2);
    const data = {
      customerName: 'Retry Kunde',
      email: 'retry@example.de',
      category: 'lossau' as const,
      issueDescription: 'Installation ausstehend.',
    };
    const match = { matchState: 'unresolved' as const, candidateCount: 0 };

    await expect(service.createSupportCase(data, match)).rejects.toThrow('503 Service Unavailable');
    await expect(service.createSupportCase(data, match)).resolves.toEqual({
      personId: 703,
      dealId: 803,
      createdPerson: false,
    });

    const personPosts = mockFetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith('/persons'));
    expect(personPosts).toHaveLength(1);
  });

  it('createLead establishes full-name candidates before using email to corroborate them', async () => {
    const requestedFields: string[] = [];
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/persons/search')) {
        const fields = url.searchParams.get('fields')!;
        requestedFields.push(fields);
        const items = fields === 'name'
          ? [{ item: { id: 321, name: 'Max Mustermann' } }, { item: { id: 654, name: 'Max Mustermann' } }]
          : [{ item: { id: 321 } }];
        return { ok: true, json: () => Promise.resolve({ success: true, data: { items } }) };
      }
      if (url.pathname.endsWith('/persons/321/deals')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: [{ id: 456, status: 'open', pipeline_id: 2 }] }) };
      }
      if (url.pathname.endsWith('/persons/321') && init?.method === 'PUT') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 321 } }) };
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await createPipedriveService('test-key', 2, 3).createLead({
      ownsLift: 'no',
      priorContact: 'no',
      firstName: 'Max',
      lastName: 'Mustermann',
      email: 'max@example.de',
      street: 'Musterstrasse 1',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
    });

    expect(requestedFields.slice(0, 2)).toEqual(['name', 'email']);
    expect(result).toEqual({ outcome: 'reused', personId: 321, dealId: 456, createdPerson: false });
  });

  it('createLead treats an exact email match as authoritative over submitted-name candidates', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/persons/search')) {
        const fields = url.searchParams.get('fields');
        const items = fields === 'name'
          ? [{ item: { id: 321, name: 'Max Mustermann' } }]
          : [{ item: { id: 654 } }];
        return { ok: true, json: () => Promise.resolve({ success: true, data: { items } }) };
      }
      if (url.pathname.endsWith('/persons/654/deals')) {
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: [{ id: 777, status: 'open' }] }),
        };
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await createPipedriveService('test-key', 2, 3).createLead({
      ownsLift: 'no',
      priorContact: 'no',
      firstName: 'Max',
      lastName: 'Mustermann',
      email: 'other@example.de',
      street: 'Musterstrasse 1',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
    });

    expect(result).toEqual({ outcome: 'reused', personId: 654, dealId: 777, createdPerson: false });
    expect(mockFetch.mock.calls.some(([url, init]) => (
      new URL(String(url)).pathname.endsWith('/persons/654') && init?.method === 'PUT'
    ))).toBe(false);
  });

  it('createLead with prior contact creates nothing when no exact person or sales opportunity is found', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/persons/search')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { items: [] } }) };
      }
      throw new Error(`Unexpected mutation: ${init?.method ?? 'GET'} ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await createPipedriveService('test-key', 2, 3).createLead({
      ownsLift: 'no',
      priorContact: 'yes',
      firstName: 'Unbekannt',
      lastName: 'Zurueckkehrend',
      email: 'unknown@example.de',
      street: 'Musterstrasse 1',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
    });

    expect(result).toEqual({
      outcome: 'identity_review',
      candidateCount: 0,
      reason: 'prior_contact_case_not_found',
    });
  });

  it('createLead reuses the newest open deal across the matched contact', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/persons/search')) {
        const fields = url.searchParams.get('fields');
        const items = fields === 'name'
          ? [{ item: { id: 321, name: 'Max Mustermann' } }]
          : [{ item: { id: 321 } }];
        return { ok: true, json: () => Promise.resolve({ success: true, data: { items } }) };
      }
      if (url.pathname.endsWith('/persons/321/deals')) {
        return {
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: [
              { id: 700, status: 'open', pipeline_id: 1, add_time: '2026-07-28 10:00:00' },
              { id: 456, status: 'open', pipeline_id: 2, add_time: '2026-07-01 10:00:00' },
            ],
          }),
        };
      }
      if (url.pathname.endsWith('/persons/321') && init?.method === 'PUT') {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 321 } }) };
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await createPipedriveService('test-key', 2, 3).createLead({
      ownsLift: 'no',
      priorContact: 'no',
      firstName: 'Max',
      lastName: 'Mustermann',
      email: 'max@example.de',
      street: 'Musterstrasse 1',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
    });

    expect(result).toEqual({ outcome: 'reused', personId: 321, dealId: 700, createdPerson: false });
  });

  it('resolveFactoryCase returns one exact Fabriknummer match including a closed source deal', async () => {
    const factoryKey = 'factory-field-key';
    const montageDateKey = 'montage-date-field-key';
    const mockFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/dealFields')) {
        return {
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: [
              { id: 91, key: factoryKey, name: 'Fabriknummer' },
              { id: 92, key: montageDateKey, name: 'Montagedatum' },
            ],
          }),
        };
      }
      if (url.pathname.endsWith('/deals/search')) {
        expect(url.searchParams.get('fields')).toBe('custom_fields');
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: { items: [{ item: { id: 701 } }] } }),
        };
      }
      if (url.pathname.endsWith('/deals/701')) {
        return {
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: {
              id: 701,
              status: 'won',
              person_id: { value: 501 },
              [factoryKey]: ' FN  42 ',
              [montageDateKey]: '2026-07-15',
            },
          }),
        };
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(createPipedriveService('test-key', 2, 3).resolveFactoryCase('fn 42')).resolves.toEqual({
      matchState: 'unique',
      personId: 501,
      dealId: 701,
      factoryNumber: 'fn 42',
      hasMontageDate: true,
    });
  });

  it('resolveFactoryCase ignores search hits whose Fabriknummer field does not match', async () => {
    const factoryKey = 'factory-field-key';
    const mockFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/dealFields')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: [{ key: factoryKey, name: 'Fabriknummer' }] }) };
      }
      if (url.pathname.endsWith('/deals/search')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { items: [{ item: { id: 701 } }] } }) };
      }
      if (url.pathname.endsWith('/deals/701')) {
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: { id: 701, person_id: { value: 501 }, [factoryKey]: 'OTHER-99' } }),
        };
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(createPipedriveService('test-key', 2, 3).resolveFactoryCase('FN-42')).resolves.toEqual({
      matchState: 'unresolved',
      candidateCount: 0,
    });
  });

  it('resolveFactoryCase reports multiple exact deals as ambiguous after deduplication', async () => {
    const factoryKey = 'factory-field-key';
    const mockFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/dealFields')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: [{ key: factoryKey, name: 'Fabriknummer' }] }) };
      }
      if (url.pathname.endsWith('/deals/search')) {
        return {
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: { items: [{ item: { id: 701 } }, { item: { id: 701 } }, { item: { id: 702 } }] },
          }),
        };
      }
      if (url.pathname.endsWith('/deals/701') || url.pathname.endsWith('/deals/702')) {
        const id = Number(url.pathname.split('/').pop());
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id, person_id: { value: 501 }, [factoryKey]: 'FN-42' } }) };
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(createPipedriveService('test-key', 2, 3).resolveFactoryCase('FN-42')).resolves.toEqual({
      matchState: 'ambiguous',
      candidateCount: 2,
    });
  });

  it('resolveFactoryCase never returns a writable match without an attached person', async () => {
    const factoryKey = 'factory-field-key';
    const mockFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/dealFields')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: [{ key: factoryKey, name: 'Fabriknummer' }] }) };
      }
      if (url.pathname.endsWith('/deals/search')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { items: [{ item: { id: 701 } }] } }) };
      }
      if (url.pathname.endsWith('/deals/701')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 701, [factoryKey]: 'FN-42' } }) };
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(createPipedriveService('test-key', 2, 3).resolveFactoryCase('FN-42')).resolves.toEqual({
      matchState: 'ambiguous',
      candidateCount: 1,
    });
  });

  it('resolveFactoryCase fails closed when the Fabriknummer field cannot be uniquely identified', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        data: [{ key: 'a', name: 'Fabriknummer' }, { key: 'b', name: 'Fabriknummer' }],
      }),
    }));
    vi.stubGlobal('fetch', mockFetch);

    await expect(createPipedriveService('test-key', 2, 3).resolveFactoryCase('FN-42'))
      .rejects.toThrow('Fabriknummer field is not uniquely configured');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('createServiceRequest writes and reads back the exact Serviceanfrage format', async () => {
    const requestId = 'req-uc-11';
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/notes') && !init?.method) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: [] }) };
      }
      if (url.pathname.endsWith('/pipelines/1')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 1, name: 'Akquise' } }) };
      }
      if (url.pathname.endsWith('/stages/2')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 2, name: 'Kontaktieren', pipeline_id: 1 } }) };
      }
      if (url.pathname.endsWith('/users/24093328')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 24093328, name: 'Marco Lossau' } }) };
      }
      if (url.pathname.endsWith('/deals') && init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        expect(body).toEqual(expect.objectContaining({
          title: 'Serviceanfrage - Erika Muster',
          person_id: 321,
          pipeline_id: 1,
          stage_id: 2,
          user_id: 24093328,
          value: 0,
          currency: 'EUR',
          status: 'open',
        }));
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 801 } }) };
      }
      if (url.pathname.endsWith('/notes') && init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        expect(body.person_id).toBe(321);
        expect(body.deal_id).toBe(801);
        expect(body.content).toContain(`[LIPPEBOT REQUEST:${requestId}]`);
        expect(body.content).toContain('Originaler Vorgang: 701');
        expect(body.content).toContain('Vorheriger Kontakt: ja');
        expect(body.content).toContain('Referenz: KEEP-CASE-42');
        expect(body.content).toContain('https://lippelift.pipedrive.com/deal/701');
        expect(body.content).toContain('Vollstaendiger Anfrage-Transkript');
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 901 } }) };
      }
      if (url.pathname.endsWith('/deals/801')) {
        return {
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: {
              id: 801,
              title: 'Serviceanfrage - Erika Muster',
              person_id: { value: 321 },
              pipeline_id: 1,
              stage_id: 2,
              user_id: { id: 24093328 },
              value: 0,
              currency: 'EUR',
              status: 'open',
            },
          }),
        };
      }
      if (url.pathname.endsWith('/notes/901')) {
        return {
          ok: true,
          json: () => Promise.resolve({ success: true, data: { id: 901, deal_id: 801, content: `[LIPPEBOT REQUEST:${requestId}]` } }),
        };
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const service = createPipedriveService('test-key', 9, 10, {
      webBaseUrl: 'https://lippelift.pipedrive.com',
      servicePipelineId: 1,
      serviceStageId: 2,
      serviceOwnerId: 24093328,
    });
    await expect(service.createServiceRequest({
      requestId,
      data: {
        customerName: 'Erika Muster',
        email: 'erika@example.de',
        issueDescription: 'Die Steuerung reagiert nicht.',
        liftManufacturer: 'lippe',
        factoryNumber: 'FN-42',
        factoryNumberStatus: 'provided',
        serviceRequestType: 'technical',
        priorContact: 'yes',
        priorContactReference: 'KEEP-CASE-42',
        category: 'technik',
      },
      sourceCase: { matchState: 'unique', personId: 321, dealId: 701, factoryNumber: 'FN-42' },
      transcript: 'Kunde: Der Lift reagiert nicht.\nSarah: Danke.',
    })).resolves.toEqual({
      personId: 321,
      dealId: 801,
      noteId: 901,
      sourceDealId: 701,
      sourceDealUrl: 'https://lippelift.pipedrive.com/deal/701',
      serviceDealUrl: 'https://lippelift.pipedrive.com/deal/801',
      reused: false,
    });
  });

  it('createServiceRequest rejects readback drift before reporting success', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/notes') && !init?.method) return { ok: true, json: () => Promise.resolve({ success: true, data: [] }) };
      if (url.pathname.endsWith('/pipelines/1')) return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 1, name: 'Akquise' } }) };
      if (url.pathname.endsWith('/stages/2')) return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 2, name: 'Kontaktieren', pipeline_id: 1 } }) };
      if (url.pathname.endsWith('/users/24093328')) return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 24093328, name: 'Marco Lossau' } }) };
      if (url.pathname.endsWith('/deals') && init?.method === 'POST') return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 801 } }) };
      if (url.pathname.endsWith('/notes') && init?.method === 'POST') return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 901 } }) };
      if (url.pathname.endsWith('/deals/801')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 801, title: 'Serviceanfrage - Erika Muster', person_id: { value: 321 }, pipeline_id: 99, stage_id: 2, user_id: { id: 24093328 }, value: 0, currency: 'EUR', status: 'open' } }) };
      }
      if (url.pathname.endsWith('/notes/901')) return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 901, deal_id: 801, content: '[LIPPEBOT REQUEST:req-drift]' } }) };
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);
    const service = createPipedriveService('test-key', 9, 10, {
      webBaseUrl: 'https://lippelift.pipedrive.com', servicePipelineId: 1, serviceStageId: 2, serviceOwnerId: 24093328,
    });

    await expect(service.createServiceRequest({
      requestId: 'req-drift',
      data: { customerName: 'Erika Muster', issueDescription: 'Test' },
      sourceCase: { matchState: 'unique', personId: 321, dealId: 701, factoryNumber: 'FN-42' },
      transcript: 'Test',
    })).rejects.toThrow('Serviceanfrage readback mismatch: pipeline_id');
  });

  it('createServiceRequest reuses an existing exact request marker without another write', async () => {
    const marker = '[LIPPEBOT REQUEST:req-retry]';
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (init?.method) throw new Error(`Unexpected mutation: ${init.method} ${url.pathname}`);
      if (url.pathname.endsWith('/notes')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: [{ id: 901, deal_id: 801, person_id: 321, content: marker }] }) };
      }
      if (url.pathname.endsWith('/deals/801')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 801, title: 'Serviceanfrage - Erika Muster', person_id: { value: 321 }, pipeline_id: 1, stage_id: 2, user_id: { id: 24093328 }, value: 0, currency: 'EUR', status: 'open' } }) };
      }
      if (url.pathname.endsWith('/notes/901')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 901, deal_id: 801, person_id: 321, content: marker } }) };
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);
    const service = createPipedriveService('test-key', 9, 10, {
      webBaseUrl: 'https://lippelift.pipedrive.com', servicePipelineId: 1, serviceStageId: 2, serviceOwnerId: 24093328,
    });

    await expect(service.createServiceRequest({
      requestId: 'req-retry',
      data: { customerName: 'Erika Muster', issueDescription: 'Test' },
      sourceCase: { matchState: 'unique', personId: 321, dealId: 701, factoryNumber: 'FN-42' },
      transcript: 'Test',
    })).resolves.toMatchObject({ personId: 321, dealId: 801, noteId: 901, reused: true });
    expect(mockFetch.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });

  it('appendServiceRequestToExistingCase pins one request-marked note and reads the existing deal back', async () => {
    const requestId = 'follow-up-request-42';
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/notes') && !init?.method) {
        expect(url.searchParams.get('deal_id')).toBe('801');
        return { ok: true, json: () => Promise.resolve({ success: true, data: [] }) };
      }
      if (url.pathname.endsWith('/notes') && init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        expect(body).toEqual(expect.objectContaining({ person_id: 321, deal_id: 801 }));
        expect(body.content).toContain(`[LIPPEBOT REQUEST:${requestId}]`);
        expect(body.content).toContain('Originaler Vorgang: 701');
        expect(body.content).toContain('Vollstaendiger Anfrage-Transkript');
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 902 } }) };
      }
      if (url.pathname.endsWith('/deals/801')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 801, person_id: { value: 321 }, status: 'open' } }) };
      }
      if (url.pathname.endsWith('/notes/902')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 902, deal_id: 801, person_id: 321, content: `[LIPPEBOT REQUEST:${requestId}]` } }) };
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);
    const service = createPipedriveService('test-key', 9, 10, { webBaseUrl: 'https://lippelift.pipedrive.com' });

    await expect(service.appendServiceRequestToExistingCase({
      requestId,
      data: {
        customerName: 'Erika Muster', email: 'erika@example.de', issueDescription: 'Folgefrage',
        liftManufacturer: 'lippe', factoryNumber: 'FN-42', factoryNumberStatus: 'provided', serviceRequestType: 'technical',
      },
      sourceCase: { matchState: 'unique', personId: 321, dealId: 701, factoryNumber: 'FN-42' },
      targetCase: { matchState: 'unique', personId: 321, dealId: 801, candidateCount: 1 },
      transcript: 'Kunde: Noch eine Frage.\nSarah: Danke.',
    })).resolves.toEqual({
      personId: 321,
      dealId: 801,
      noteId: 902,
      sourceDealId: 701,
      sourceDealUrl: 'https://lippelift.pipedrive.com/deal/701',
      serviceDealUrl: 'https://lippelift.pipedrive.com/deal/801',
      reused: true,
    });
    expect(mockFetch.mock.calls.some(([url, init]) => new URL(String(url)).pathname.endsWith('/deals') && init?.method === 'POST')).toBe(false);
  });

  it('resolveSupportReferenceCase deduplicates one exact open referenced deal', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.pathname).toMatch(/\/deals\/search$/);
      expect(url.searchParams.get('term')).toBe('CASE-KEEP-42');
      expect(url.searchParams.get('fields')).toBe('custom_fields');
      return {
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: { items: [
            { item: { id: 801, status: 'open', person: { id: 321 } } },
            { item: { id: 801, status: 'open', person: { id: 321 } } },
          ] },
        }),
      };
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(createPipedriveService('test-key', 9, 10).resolveSupportReferenceCase({
      priorContactReference: 'CASE-KEEP-42',
    })).resolves.toEqual({ matchState: 'unique', personId: 321, dealId: 801, candidateCount: 1 });
  });

  it('appendServiceRequestToExistingCase reuses its exact marker without another mutation', async () => {
    const marker = '[LIPPEBOT REQUEST:follow-up-existing]';
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (init?.method) throw new Error(`Unexpected mutation: ${init.method} ${url.pathname}`);
      if (url.pathname.endsWith('/notes')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: [{ id: 902, deal_id: 801, person_id: 321, content: marker }] }) };
      }
      if (url.pathname.endsWith('/deals/801')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 801, person_id: { value: 321 }, status: 'open' } }) };
      }
      if (url.pathname.endsWith('/notes/902')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { id: 902, deal_id: 801, person_id: 321, content: marker } }) };
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(createPipedriveService('test-key', 9, 10, { webBaseUrl: 'https://lippelift.pipedrive.com' })
      .appendServiceRequestToExistingCase({
        requestId: 'follow-up-existing',
        data: { customerName: 'Erika Muster', issueDescription: 'Test' },
        sourceCase: { matchState: 'unique', personId: 321, dealId: 701, factoryNumber: 'FN-42' },
        targetCase: { matchState: 'unique', personId: 321, dealId: 801, candidateCount: 1 },
        transcript: 'Test',
      })).resolves.toMatchObject({ dealId: 801, noteId: 902, reused: true });
    expect(mockFetch.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });

  it('resolveSupportFollowUpCase reuses the one open Serviceanfrage for the exact factory person', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/persons/search')) {
        expect(url.searchParams.get('fields')).toBe('email');
        expect(url.searchParams.get('exact_match')).toBe('true');
        return { ok: true, json: () => Promise.resolve({ success: true, data: { items: [{ item: { id: 321, name: 'Erika Muster' } }] } }) };
      }
      if (url.pathname.endsWith('/persons/321/deals')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: [
          { id: 701, title: 'LIPPEBOT QA KEEP source', status: 'open', person_id: { value: 321 } },
          { id: 801, title: 'Serviceanfrage - Erika Muster', status: 'open', person_id: { value: 321 } },
          { id: 901, title: 'Neue Verkaufschance', status: 'open', person_id: { value: 321 } },
        ] }) };
      }
      if (url.pathname.endsWith('/notes')) {
        expect(url.searchParams.get('deal_id')).toBe('801');
        return { ok: true, json: () => Promise.resolve({ success: true, data: [
          { id: 991, deal_id: 801, content: '<div>Originaler Vorgang: 701</div><div>LIPPEBOT QA KEEP</div>' },
        ] }) };
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(createPipedriveService('test-key', 9, 10).resolveSupportFollowUpCase(
      { email: 'erika@example.de', priorContact: 'yes' },
      { matchState: 'unique', personId: 321, dealId: 701, factoryNumber: 'FN-42' },
    )).resolves.toEqual({ matchState: 'unique', personId: 321, dealId: 801, candidateCount: 1 });
  });

  it('resolveSupportFollowUpCase refuses an exact contact that points to another person', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/persons/search')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { items: [{ item: { id: 999 } }] } }) };
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(createPipedriveService('test-key', 9, 10).resolveSupportFollowUpCase(
      { email: 'wrong@example.de', priorContact: 'yes' },
      { matchState: 'unique', personId: 321, dealId: 701, factoryNumber: 'FN-42' },
    )).resolves.toEqual({ matchState: 'ambiguous', candidateCount: 1 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('resolveSupportFollowUpCase refuses multiple open Serviceanfragen', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/persons/search')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { items: [] } }) };
      }
      if (url.pathname.endsWith('/persons/321/deals')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: [
          { id: 701, title: 'Source', status: 'open', person_id: { value: 321 } },
          { id: 801, title: 'Serviceanfrage - Erika Muster', status: 'open', person_id: { value: 321 } },
          { id: 802, title: 'Serviceanfrage - Erika Muster', status: 'open', person_id: { value: 321 } },
        ] }) };
      }
      if (url.pathname.endsWith('/notes')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: [
          { id: Number(url.searchParams.get('deal_id')) + 100, content: 'Originaler Vorgang: 701' },
        ] }) };
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(createPipedriveService('test-key', 9, 10).resolveSupportFollowUpCase(
      { email: 'new@example.de', priorContact: 'yes' },
      { matchState: 'unique', personId: 321, dealId: 701, factoryNumber: 'FN-42' },
    )).resolves.toEqual({ matchState: 'ambiguous', candidateCount: 2 });
  });

  it('resolveSupportFollowUpCase ignores a service case linked to another factory source deal', async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/persons/search')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: { items: [{ item: { id: 321 } }] } }) };
      }
      if (url.pathname.endsWith('/persons/321/deals')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: [
          { id: 701, title: 'Source Lift A', status: 'open', person_id: { value: 321 } },
          { id: 801, title: 'Serviceanfrage - Erika Muster', status: 'open', person_id: { value: 321 } },
        ] }) };
      }
      if (url.pathname.endsWith('/notes')) {
        return { ok: true, json: () => Promise.resolve({ success: true, data: [
          { id: 991, deal_id: 801, content: 'Originaler Vorgang: 777' },
        ] }) };
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(createPipedriveService('test-key', 9, 10).resolveSupportFollowUpCase(
      { email: 'erika@example.de', priorContact: 'yes' },
      { matchState: 'unique', personId: 321, dealId: 701, factoryNumber: 'FN-A' },
    )).resolves.toEqual({ matchState: 'unresolved', candidateCount: 0 });
  });
});
