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
    expect(serviceDeclaration.parameters.required).toEqual(['customerName', 'category', 'issueDescription']);
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

  it.each([
    { functionName: 'submit_lead', eventType: 'lead' },
    { functionName: 'submit_service_request', eventType: 'service' },
  ])('rejects $functionName without a usable contact before reporting success', async ({ functionName, eventType }) => {
    const initialResponse = {
      candidates: [{
        content: {
          parts: [{ functionCall: { name: functionName, args: { customerName: 'Maria Schmidt' } } }],
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
});
