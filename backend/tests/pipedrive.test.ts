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

  it('createLead normalizes contact fields and sends custom option IDs', async () => {
    const mockFetch = vi.fn()
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
      stairLocation: 'innen',
      stairType: 'kurvig',
      buildingType: 'einfamilienhaus',
      liftType: 'sitzlift',
    });

    expect(result).toEqual({ personId: 123, dealId: 456 });

    const personCall = mockFetch.mock.calls[0];
    expect(personCall[0]).toContain('/persons');
    const personBody = JSON.parse(personCall[1].body);
    expect(personBody.name).toBe('Max Mustermann');
    expect(personBody.phone).toEqual([{ value: '0049526196660', primary: true }]);
    expect(personBody.email).toEqual([{ value: 'max@example.de', primary: true }]);
    expect(personBody['2f068d0e83a4ea944b6f91f97769a45557b62425']).toBe('Musterstrasse 1, 12345 Lemgo');
    expect(personBody['43c2a08a7993307990ced6639183ca91f7608b2b']).toBe('152');
    expect(personBody.e0cb479c4f405997f2e53b58ddc84ecb6d4c7b49).toBe(140);

    const dealCall = mockFetch.mock.calls[1];
    expect(dealCall[0]).toContain('/deals');
    const dealBody = JSON.parse(dealCall[1].body);
    expect(dealBody.person_id).toBe(123);
    expect(dealBody.pipeline_id).toBe(2);
    expect(dealBody.stage_id).toBe(3);
    expect(dealBody['59745cb0d3eb04f89e70543d01f49813175ad6a3']).toBe(56);
    expect(dealBody['300c5e3ef98a1a25e2f80262af2bd0942b95c231']).toBe(177);
    expect(dealBody.eaf2557e218e842227f803c4abdc665291c99b91).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dealBody.owner_id).toBe(24093350);
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
      customerSegment: 'firma',
    });

    const dealBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(dealBody['59745cb0d3eb04f89e70543d01f49813175ad6a3']).toBe(57);
    expect(dealBody['300c5e3ef98a1a25e2f80262af2bd0942b95c231']).toBe(177);
    expect(dealBody.aff4a71d003cb374585aeef67732b05828b62050).toBeUndefined();
    expect(dealBody['36241991692b59873ce73c478b98aab6ad4054c1']).toBeUndefined();
    expect(dealBody['9c08a82b8cad15eab222f89a6a961c59bc8c95e3']).toBeUndefined();
    expect(dealBody['684a7860061d276f4a76498fd1653d721e37cb6f']).toBeUndefined();

    const noteBody = JSON.parse(mockFetch.mock.calls[2][1].body);
    expect(noteBody.content).toContain('PLZ: nicht ausgefüllt');

    vi.unstubAllGlobals();
  });

  it('createLead maps German display labels to custom option IDs', async () => {
    const mockFetch = vi.fn()
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

    const dealBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(dealBody.aff4a71d003cb374585aeef67732b05828b62050).toBe(118);
    expect(dealBody['36241991692b59873ce73c478b98aab6ad4054c1']).toBe(120);
    expect(dealBody['9c08a82b8cad15eab222f89a6a961c59bc8c95e3']).toBe(122);
    expect(dealBody['684a7860061d276f4a76498fd1653d721e37cb6f']).toBe(128);

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
