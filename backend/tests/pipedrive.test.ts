import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPipedriveService } from '../src/services/pipedrive.js';

describe('createPipedriveService', () => {
  it('returns noop service when API key is empty', () => {
    const service = createPipedriveService('', 1, 1);
    expect(service.isConfigured()).toBe(false);
  });

  it('returns configured service when API key is provided', () => {
    const service = createPipedriveService('test-key', 1, 1);
    expect(service.isConfigured()).toBe(true);
  });

  it('createLead reuses an existing person found by email before creating a deal', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { items: [{ item: { id: 321 } }] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 321 } }),
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
      email: ' MAX@EXAMPLE.DE ',
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
    });

    expect(result).toEqual({ personId: 321, dealId: 456 });
    expect(mockFetch).toHaveBeenCalledTimes(4);

    expect(mockFetch.mock.calls[0][0]).toContain('/persons/search');
    expect(mockFetch.mock.calls[0][0]).toContain('term=max%40example.de');
    expect(mockFetch.mock.calls[0][0]).toContain('fields=email');
    expect(mockFetch.mock.calls[0][0]).toContain('exact_match=true');

    expect(mockFetch.mock.calls[1][0]).toContain('/persons/321');
    expect(mockFetch.mock.calls[2][0]).toContain('/deals');
    const dealBody = JSON.parse(mockFetch.mock.calls[2][1].body);
    expect(dealBody.person_id).toBe(321);

    vi.unstubAllGlobals();
  });

  it('createLead updates a reused person with fresh contact details before creating the deal', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { items: [{ item: { id: 321 } }] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 321 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 456 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 789 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 101 } }),
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

    expect(mockFetch.mock.calls[1][0]).toContain('/persons/321');
    expect(mockFetch.mock.calls[1][1].method).toBe('PUT');
    const patchBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(patchBody.name).toBe('Max Mustermann');
    expect(patchBody.phone).toEqual([{ value: '0049526196660', primary: true }]);
    expect(patchBody.email).toEqual([{ value: 'max@example.de', primary: true }]);
    expect(patchBody['2f068d0e83a4ea944b6f91f97769a45557b62425']).toBe('Musterstrasse 1, 12345 Lemgo');
    expect(patchBody.fd1928c889e5888dd2b7964ab9f2d8c129d1aa40).toBe(138);

    expect(mockFetch.mock.calls[2][0]).toContain('/deals');

    vi.unstubAllGlobals();
  });

  it('createLead falls back to phone search when no email is available', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { items: [{ item: { id: 654 } }] } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 654 } }),
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
      postalCode: '12345',
      city: 'Lemgo',
      availability: '08:00 - 12:00',
    });

    expect(result).toEqual({ personId: 654, dealId: 456 });
    expect(mockFetch.mock.calls[0][0]).toContain('/persons/search');
    expect(mockFetch.mock.calls[0][0]).toContain('term=0049526196660');
    expect(mockFetch.mock.calls[0][0]).toContain('fields=phone');

    expect(mockFetch.mock.calls[1][0]).toContain('/persons/654');
    expect(mockFetch.mock.calls[2][0]).toContain('/deals');
    const dealBody = JSON.parse(mockFetch.mock.calls[2][1].body);
    expect(dealBody.person_id).toBe(654);

    vi.unstubAllGlobals();
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

    expect(result).toEqual({ personId: 123, dealId: 456 });
    expect(mockFetch.mock.calls[0][0]).toContain('fields=email');
    expect(mockFetch.mock.calls[1][0]).toContain('fields=phone');
    expect(mockFetch.mock.calls[2][0]).toContain('/persons');
    expect(mockFetch.mock.calls[3][0]).toContain('/deals');

    const personBody = JSON.parse(mockFetch.mock.calls[2][1].body);
    expect(personBody.name).toBe('Max Mustermann');

    const dealBody = JSON.parse(mockFetch.mock.calls[3][1].body);
    expect(dealBody.person_id).toBe(123);

    vi.unstubAllGlobals();
  });

  it('createLead reuses a recently created person before Pipedrive search indexing catches up', async () => {
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
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 123 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 457 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 790 } }),
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

    expect(first).toEqual({ personId: 123, dealId: 456 });
    expect(second).toEqual({ personId: 123, dealId: 457 });

    const searchCalls = mockFetch.mock.calls.filter((call) => call[0].includes('/persons/search'));
    expect(searchCalls).toHaveLength(2);
    expect(mockFetch.mock.calls[5][0]).toContain('/persons/123');
    expect(mockFetch.mock.calls[6][0]).toContain('/deals');
    const secondDealBody = JSON.parse(mockFetch.mock.calls[6][1].body);
    expect(secondDealBody.person_id).toBe(123);

    vi.unstubAllGlobals();
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

    expect(result).toEqual({ personId: 123, dealId: 456 });

    const personCall = mockFetch.mock.calls[2];
    expect(personCall[0]).toContain('/persons');
    const personBody = JSON.parse(personCall[1].body);
    expect(personBody.name).toBe('Max Mustermann');
    expect(personBody.owner_id).toBe(24093350);
    expect(personBody.phone).toEqual([{ value: '0049526196660', primary: true }]);
    expect(personBody.email).toEqual([{ value: 'max@example.de', primary: true }]);
    expect(personBody['2f068d0e83a4ea944b6f91f97769a45557b62425']).toBe('Musterstrasse 1, 12345 Lemgo');
    expect(personBody['43c2a08a7993307990ced6639183ca91f7608b2b']).toBe('152');
    expect(personBody.e0cb479c4f405997f2e53b58ddc84ecb6d4c7b49).toBe(140);

    const dealCall = mockFetch.mock.calls[3];
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

    vi.unstubAllGlobals();
  });

  it('createLead omits custom option fields when values are unknown', async () => {
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

    const dealBody = JSON.parse(mockFetch.mock.calls[2][1].body);
    expect(dealBody['59745cb0d3eb04f89e70543d01f49813175ad6a3']).toBe(57);
    expect(dealBody['300c5e3ef98a1a25e2f80262af2bd0942b95c231']).toBe(177);
    expect(dealBody.aff4a71d003cb374585aeef67732b05828b62050).toBeUndefined();
    expect(dealBody['36241991692b59873ce73c478b98aab6ad4054c1']).toBeUndefined();
    expect(dealBody['9c08a82b8cad15eab222f89a6a961c59bc8c95e3']).toBeUndefined();
    expect(dealBody['684a7860061d276f4a76498fd1653d721e37cb6f']).toBeUndefined();

    const noteBody = JSON.parse(mockFetch.mock.calls[3][1].body);
    expect(noteBody.content).toBe('Erreichbarkeit: 12:00 - 16:00');

    vi.unstubAllGlobals();
  });

  it('createLead maps German display labels to custom option IDs', async () => {
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

    const dealBody = JSON.parse(mockFetch.mock.calls[2][1].body);
    expect(dealBody.aff4a71d003cb374585aeef67732b05828b62050).toBe(118);
    expect(dealBody['36241991692b59873ce73c478b98aab6ad4054c1']).toBe(120);
    expect(dealBody['9c08a82b8cad15eab222f89a6a961c59bc8c95e3']).toBe(122);
    expect(dealBody['684a7860061d276f4a76498fd1653d721e37cb6f']).toBe(128);

    vi.unstubAllGlobals();
  });

  it('createLead only stores non-structured data in the deal note', async () => {
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

    const noteBody = JSON.parse(mockFetch.mock.calls[3][1].body);
    expect(noteBody.content).toBe('Erreichbarkeit: 08:00 - 12:00\nNachricht: Bitte am besten vormittags anrufen.');
    expect(noteBody.content).not.toContain('Treppe:');
    expect(noteBody.content).not.toContain('Adresse:');
    expect(noteBody.content).not.toContain('Newsletter:');

    vi.unstubAllGlobals();
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

    vi.unstubAllGlobals();
  });
});
