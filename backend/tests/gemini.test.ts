import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateContentStreamMock, getGenerativeModelMock } = vi.hoisted(() => {
  const generateContentStreamMock = vi.fn();
  return {
    generateContentStreamMock,
    getGenerativeModelMock: vi.fn(() => ({ generateContentStream: generateContentStreamMock })),
  };
});

vi.mock('@google-cloud/vertexai', () => ({
  FunctionDeclarationSchemaType: {
    OBJECT: 'OBJECT',
    STRING: 'STRING',
  },
  VertexAI: vi.fn(() => ({
    getGenerativeModel: getGenerativeModelMock,
  })),
}));

describe('createGeminiService', () => {
  beforeEach(() => {
    getGenerativeModelMock.mockClear();
    generateContentStreamMock.mockReset();
  });

  it('creates a service with streamChat method', async () => {
    const { createGeminiService } = await import('../src/services/gemini.js');
    const service = createGeminiService({
      projectId: 'test-project',
      location: 'us-central1',
    });
    expect(service).toHaveProperty('streamChat');
    expect(typeof service.streamChat).toBe('function');
  });

  it('registers submit_service_request with support category fields', async () => {
    const { createGeminiService } = await import('../src/services/gemini.js');
    createGeminiService({ projectId: 'test-project', location: 'us-central1' });

    const declarations = getGenerativeModelMock.mock.calls[0][0].tools[0].functionDeclarations;
    const serviceDeclaration = declarations.find((declaration: { name: string }) => declaration.name === 'submit_service_request');

    expect(serviceDeclaration.parameters.properties.category.enum).toEqual(['technik', 'finance', 'sales', 'lossau']);
    expect(serviceDeclaration.parameters.properties.customerName).toBeDefined();
    expect(serviceDeclaration.parameters.properties.issueDescription).toBeDefined();
    expect(serviceDeclaration.parameters.properties.invoiceNumber).toBeDefined();
    expect(serviceDeclaration.parameters.properties.orderNumber).toBeDefined();
    expect(serviceDeclaration.parameters.properties.offerNumber).toBeDefined();
    expect(serviceDeclaration.parameters.properties.leadId).toBeDefined();
    expect(serviceDeclaration.parameters.properties.sparePartReference).toBeDefined();
    expect(serviceDeclaration.parameters.required).toEqual([
      'ownsLift',
      'liftManufacturer',
      'serviceRequestType',
      'customerName',
      'category',
      'issueDescription',
      'priorContact',
    ]);
  });

  it('registers prior-contact status and reference on state and both submission tools', async () => {
    const { createGeminiService } = await import('../src/services/gemini.js');
    createGeminiService({ projectId: 'test-project', location: 'us-central1' });

    const declarations = getGenerativeModelMock.mock.calls[0][0].tools[0].functionDeclarations;
    const stateDeclaration = declarations.find((declaration: { name: string }) => declaration.name === 'report_state');
    const leadDeclaration = declarations.find((declaration: { name: string }) => declaration.name === 'submit_lead');
    const serviceDeclaration = declarations.find((declaration: { name: string }) => declaration.name === 'submit_service_request');

    expect(stateDeclaration.parameters.properties.collectedData.properties.priorContact.enum).toEqual(['yes', 'no', 'unknown']);
    expect(stateDeclaration.parameters.properties.collectedData.properties.priorContactReference).toBeDefined();
    expect(leadDeclaration.parameters.properties.priorContact.enum).toEqual(['yes', 'no', 'unknown']);
    expect(leadDeclaration.parameters.properties.priorContactReference).toBeDefined();
    expect(leadDeclaration.parameters.required).toContain('priorContact');
    expect(serviceDeclaration.parameters.properties.priorContact.enum).toEqual(['yes', 'no', 'unknown']);
    expect(serviceDeclaration.parameters.properties.priorContactReference).toBeDefined();
    expect(serviceDeclaration.parameters.required).toContain('priorContact');
  });

  it('registers phone-or-email submission contracts without requiring phone specifically', async () => {
    const { createGeminiService } = await import('../src/services/gemini.js');
    createGeminiService({ projectId: 'test-project', location: 'us-central1' });

    const declarations = getGenerativeModelMock.mock.calls[0][0].tools[0].functionDeclarations;
    const leadDeclaration = declarations.find((declaration: { name: string }) => declaration.name === 'submit_lead');
    const serviceDeclaration = declarations.find((declaration: { name: string }) => declaration.name === 'submit_service_request');

    expect(leadDeclaration.parameters.properties.phone).toBeDefined();
    expect(leadDeclaration.parameters.properties.email).toBeDefined();
    expect(leadDeclaration.parameters.required).not.toContain('phone');
    expect(leadDeclaration.parameters.required).not.toContain('email');
    expect(leadDeclaration.description).toContain('at least one contact method (phone or email)');
    expect(serviceDeclaration.description).toContain('at least one contact method (phone or email)');
  });

  it('registers ownership, manufacturer, factory-number, and service-type contracts', async () => {
    const { createGeminiService } = await import('../src/services/gemini.js');
    createGeminiService({ projectId: 'test-project', location: 'us-central1' });

    const declarations = getGenerativeModelMock.mock.calls[0][0].tools[0].functionDeclarations;
    const stateProperties = declarations
      .find((declaration: { name: string }) => declaration.name === 'report_state')
      .parameters.properties.collectedData.properties;
    const leadDeclaration = declarations.find((declaration: { name: string }) => declaration.name === 'submit_lead');
    const serviceDeclaration = declarations.find((declaration: { name: string }) => declaration.name === 'submit_service_request');

    expect(stateProperties.ownsLift.enum).toEqual(['yes', 'no', 'unknown']);
    expect(stateProperties.liftManufacturer.enum).toEqual(['lippe', 'other', 'unknown']);
    expect(stateProperties.factoryNumberStatus.enum).toEqual(['provided', 'unavailable', 'unknown']);
    expect(stateProperties.factoryNumber).toBeDefined();
    expect(stateProperties.serviceRequestType.enum).toEqual([
      'maintenance',
      'repair',
      'technical',
      'invoice_payment',
      'sales_contract_order',
      'spare_parts_installation_warranty',
    ]);
    expect(leadDeclaration.parameters.properties.ownsLift.enum).toEqual(['yes', 'no', 'unknown']);
    expect(leadDeclaration.parameters.required).toContain('ownsLift');
    expect(serviceDeclaration.parameters.properties.ownsLift.enum).toEqual(['yes', 'no', 'unknown']);
    expect(serviceDeclaration.parameters.properties.liftManufacturer.enum).toEqual(['lippe', 'other', 'unknown']);
    expect(serviceDeclaration.parameters.properties.factoryNumber).toBeDefined();
    expect(serviceDeclaration.parameters.properties.factoryNumberStatus.enum).toEqual(['provided', 'unavailable', 'unknown']);
    expect(serviceDeclaration.parameters.properties.serviceRequestType.enum).toEqual(stateProperties.serviceRequestType.enum);
    expect(serviceDeclaration.parameters.required).toEqual(expect.arrayContaining([
      'ownsLift',
      'liftManufacturer',
      'serviceRequestType',
    ]));
  });

  it.each([
    { functionName: 'submit_lead', eventType: 'lead', args: { ownsLift: 'no', priorContact: 'unknown' } },
    {
      functionName: 'submit_service_request',
      eventType: 'service',
      args: {
        ownsLift: 'yes',
        liftManufacturer: 'other',
        serviceRequestType: 'technical',
        priorContact: 'unknown',
      },
    },
  ])('rejects $functionName without a usable contact before reporting success', async ({ functionName, eventType, args }) => {
    const initialResponse = {
      candidates: [{
        content: {
          parts: [{ functionCall: { name: functionName, args: { customerName: 'Maria Schmidt', ...args } } }],
        },
      }],
    };
    const followUpResponse = { candidates: [{ content: { parts: [] } }] };
    generateContentStreamMock
      .mockResolvedValueOnce({
        stream: (async function* () {
          yield { candidates: [{ content: { parts: [{ text: 'Dein Anliegen wurde erfolgreich übergeben.' }] } }] };
        })(),
        response: Promise.resolve(initialResponse),
      })
      .mockResolvedValueOnce({
        stream: (async function* () {
          yield { candidates: [{ content: { parts: [{ text: 'Wie können wir dich am besten erreichen?' }] } }] };
        })(),
        response: Promise.resolve(followUpResponse),
      });

    const { createGeminiService } = await import('../src/services/gemini.js');
    const service = createGeminiService({ projectId: 'test-project', location: 'us-central1' });
    const events = [];
    for await (const event of service.streamChat('missing-contact', 'Das ist alles', [])) {
      events.push(event);
    }

    expect(events.some((event) => event.type === eventType)).toBe(false);
    expect(events).not.toContainEqual({ type: 'token', content: 'Dein Anliegen wurde erfolgreich übergeben.' });
    expect(events).toContainEqual({ type: 'token', content: 'Wie können wir dich am besten erreichen?' });
    expect(generateContentStreamMock).toHaveBeenCalledTimes(2);
    const followUpContents = generateContentStreamMock.mock.calls[1][0].contents;
    const functionResponse = followUpContents.at(-1).parts[0].functionResponse;
    expect(functionResponse.name).toBe(functionName);
    expect(functionResponse.response).toEqual(expect.objectContaining({
      success: false,
      needsContact: true,
    }));
  });

  it.each([
    {
      functionName: 'submit_lead',
      eventType: 'lead',
      args: { ownsLift: 'no', customerName: 'Maria Schmidt', email: 'maria@example.de' },
    },
    {
      functionName: 'submit_service_request',
      eventType: 'service',
      args: {
        ownsLift: 'yes',
        liftManufacturer: 'other',
        serviceRequestType: 'technical',
        customerName: 'Maria Schmidt',
        category: 'technik',
        issueDescription: 'Lift bleibt stehen.',
        email: 'maria@example.de',
      },
    },
  ])('rejects $functionName without prior-contact status before reporting success', async ({ functionName, eventType, args }) => {
    const initialResponse = {
      candidates: [{
        content: {
          parts: [{ functionCall: { name: functionName, args } }],
        },
      }],
    };
    const followUpResponse = { candidates: [{ content: { parts: [] } }] };
    generateContentStreamMock
      .mockResolvedValueOnce({
        stream: (async function* () {
          yield { candidates: [{ content: { parts: [{ text: 'Dein Anliegen wurde erfolgreich übergeben.' }] } }] };
        })(),
        response: Promise.resolve(initialResponse),
      })
      .mockResolvedValueOnce({
        stream: (async function* () {
          yield { candidates: [{ content: { parts: [{ text: 'Hattest du wegen dieses Anliegens schon einmal Kontakt mit uns?' }] } }] };
        })(),
        response: Promise.resolve(followUpResponse),
      });

    const { createGeminiService } = await import('../src/services/gemini.js');
    const service = createGeminiService({ projectId: 'test-project', location: 'us-central1' });
    const events = [];
    for await (const event of service.streamChat('missing-prior-contact', 'Das ist alles', [])) {
      events.push(event);
    }

    expect(events.some((event) => event.type === eventType)).toBe(false);
    expect(events).not.toContainEqual({ type: 'token', content: 'Dein Anliegen wurde erfolgreich übergeben.' });
    expect(events).toContainEqual({
      type: 'token',
      content: 'Hattest du wegen dieses Anliegens schon einmal Kontakt mit uns?',
    });
    expect(generateContentStreamMock).toHaveBeenCalledTimes(2);
    const followUpContents = generateContentStreamMock.mock.calls[1][0].contents;
    const functionResponse = followUpContents.at(-1).parts[0].functionResponse;
    expect(functionResponse.name).toBe(functionName);
    expect(functionResponse.response).toEqual(expect.objectContaining({
      success: false,
      needsPriorContact: true,
    }));
  });
});
