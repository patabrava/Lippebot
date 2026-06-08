import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getGenerativeModelMock } = vi.hoisted(() => ({
  getGenerativeModelMock: vi.fn(() => ({
    generateContentStream: vi.fn(),
  })),
}));

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
});
