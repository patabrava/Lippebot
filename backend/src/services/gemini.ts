import { VertexAI, type FunctionDeclaration, FunctionDeclarationSchemaType, type Content, type Part } from '@google-cloud/vertexai';
import type { ChatMessage, Mode, LeadData, ServiceData, ConversationState } from '../types/index.js';
import { buildSystemPrompt } from '../prompts/system-prompt.js';

const reportStateFn: FunctionDeclaration = {
  name: 'report_state',
  description: 'Report the current conversation mode and any collected data after every response.',
  parameters: {
    type: FunctionDeclarationSchemaType.OBJECT,
    properties: {
      mode: {
        type: FunctionDeclarationSchemaType.STRING,
        enum: ['berater', 'anfrage', 'service', 'undetermined'],
        description: 'The current conversation mode',
      },
      collectedData: {
        type: FunctionDeclarationSchemaType.OBJECT,
        description: 'Any lead or service data collected so far',
        properties: {
          customerSegment: { type: FunctionDeclarationSchemaType.STRING },
          stairLocation: { type: FunctionDeclarationSchemaType.STRING },
          stairType: { type: FunctionDeclarationSchemaType.STRING },
          buildingType: { type: FunctionDeclarationSchemaType.STRING },
          liftType: { type: FunctionDeclarationSchemaType.STRING },
          firstName: { type: FunctionDeclarationSchemaType.STRING },
          lastName: { type: FunctionDeclarationSchemaType.STRING },
          phone: { type: FunctionDeclarationSchemaType.STRING },
          email: { type: FunctionDeclarationSchemaType.STRING },
          street: { type: FunctionDeclarationSchemaType.STRING },
          postalCode: { type: FunctionDeclarationSchemaType.STRING },
          city: { type: FunctionDeclarationSchemaType.STRING },
          availability: { type: FunctionDeclarationSchemaType.STRING },
          message: { type: FunctionDeclarationSchemaType.STRING },
          newsletter: { type: FunctionDeclarationSchemaType.STRING },
          customerName: { type: FunctionDeclarationSchemaType.STRING },
          category: {
            type: FunctionDeclarationSchemaType.STRING,
            enum: ['technik', 'finance', 'sales', 'lossau'],
          },
          issueDescription: { type: FunctionDeclarationSchemaType.STRING },
          liftModel: { type: FunctionDeclarationSchemaType.STRING },
          symptomDetails: { type: FunctionDeclarationSchemaType.STRING },
          triggerConditions: { type: FunctionDeclarationSchemaType.STRING },
          invoiceNumber: { type: FunctionDeclarationSchemaType.STRING },
          customerNumber: { type: FunctionDeclarationSchemaType.STRING },
          paymentReference: { type: FunctionDeclarationSchemaType.STRING },
          orderNumber: { type: FunctionDeclarationSchemaType.STRING },
          contractReference: { type: FunctionDeclarationSchemaType.STRING },
          sparePartReference: { type: FunctionDeclarationSchemaType.STRING },
          installationContext: { type: FunctionDeclarationSchemaType.STRING },
          defectContext: { type: FunctionDeclarationSchemaType.STRING },
        },
      },
    },
    required: ['mode'],
  },
};

const submitLeadFn: FunctionDeclaration = {
  name: 'submit_lead',
  description: 'Submit a qualified lead when all required contact information has been collected. After calling this, generate a warm confirmation message.',
  parameters: {
    type: FunctionDeclarationSchemaType.OBJECT,
    properties: {
      customerSegment: { type: FunctionDeclarationSchemaType.STRING },
      stairLocation: { type: FunctionDeclarationSchemaType.STRING },
      stairType: { type: FunctionDeclarationSchemaType.STRING },
      buildingType: { type: FunctionDeclarationSchemaType.STRING },
      liftType: { type: FunctionDeclarationSchemaType.STRING },
      firstName: { type: FunctionDeclarationSchemaType.STRING },
      lastName: { type: FunctionDeclarationSchemaType.STRING },
      phone: { type: FunctionDeclarationSchemaType.STRING },
      email: { type: FunctionDeclarationSchemaType.STRING },
      street: { type: FunctionDeclarationSchemaType.STRING },
      postalCode: { type: FunctionDeclarationSchemaType.STRING },
      city: { type: FunctionDeclarationSchemaType.STRING },
      availability: { type: FunctionDeclarationSchemaType.STRING },
      message: { type: FunctionDeclarationSchemaType.STRING },
      newsletter: { type: FunctionDeclarationSchemaType.STRING },
    },
    required: ['customerSegment', 'firstName', 'lastName', 'phone', 'street', 'postalCode', 'city', 'availability'],
  },
};

const submitServiceRequestFn: FunctionDeclaration = {
  name: 'submit_service_request',
  description: 'Submit an existing-customer support request after Sarah has the customer name, one primary support category, and a usable short issue summary. After calling this, generate a warm generic confirmation without mentioning CRM, Pipedrive, inboxes, or backend status.',
  parameters: {
    type: FunctionDeclarationSchemaType.OBJECT,
    properties: {
      customerName: { type: FunctionDeclarationSchemaType.STRING },
      phone: { type: FunctionDeclarationSchemaType.STRING },
      email: { type: FunctionDeclarationSchemaType.STRING },
      category: {
        type: FunctionDeclarationSchemaType.STRING,
        enum: ['technik', 'finance', 'sales', 'lossau'],
      },
      issueDescription: { type: FunctionDeclarationSchemaType.STRING },
      liftModel: { type: FunctionDeclarationSchemaType.STRING },
      symptomDetails: { type: FunctionDeclarationSchemaType.STRING },
      triggerConditions: { type: FunctionDeclarationSchemaType.STRING },
      invoiceNumber: { type: FunctionDeclarationSchemaType.STRING },
      customerNumber: { type: FunctionDeclarationSchemaType.STRING },
      paymentReference: { type: FunctionDeclarationSchemaType.STRING },
      orderNumber: { type: FunctionDeclarationSchemaType.STRING },
      contractReference: { type: FunctionDeclarationSchemaType.STRING },
      sparePartReference: { type: FunctionDeclarationSchemaType.STRING },
      installationContext: { type: FunctionDeclarationSchemaType.STRING },
      defectContext: { type: FunctionDeclarationSchemaType.STRING },
    },
    required: ['customerName', 'category', 'issueDescription'],
  },
};

const allFunctionDeclarations = [reportStateFn, submitLeadFn, submitServiceRequestFn];

interface VertexChatConfig {
  projectId: string;
  location: string;
  enabled?: boolean;
}

export function createGeminiService(config: VertexChatConfig) {
  if (config.enabled === false) {
    throw new Error('Vertex AI is disabled, but this backend only supports Vertex for LLM calls.');
  }

  const vertexAI = new VertexAI({
    project: config.projectId,
    location: config.location,
  });

  const model = vertexAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: buildSystemPrompt(),
    tools: [{ functionDeclarations: allFunctionDeclarations }],
  });

  function extractFunctionCalls(parts: Part[]): Array<{ name: string; args: Record<string, unknown> }> {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    for (const part of parts) {
      if (part.functionCall) {
        calls.push({ name: part.functionCall.name, args: (part.functionCall.args || {}) as Record<string, unknown> });
      }
    }
    return calls;
  }

  function extractText(parts: Part[]): string {
    return parts
      .filter((part) => 'text' in part && typeof part.text === 'string' && part.text.length > 0)
      .map((part) => (part as { text: string }).text)
      .join('');
  }

  async function* streamChat(
    sessionId: string,
    message: string,
    history: ChatMessage[],
  ): AsyncGenerator<{
    type: 'token' | 'state' | 'lead' | 'service';
    content?: string;
    state?: ConversationState;
    leadData?: LeadData;
    serviceData?: ServiceData;
  }> {
    const contents: Content[] = history.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));
    contents.push({ role: 'user', parts: [{ text: message }] });

    const result = await model.generateContentStream({ contents });

    for await (const chunk of result.stream) {
      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      const text = extractText(parts);
      if (text) {
        yield { type: 'token', content: text };
      }
    }

    const response = await result.response;
    const responseParts = response.candidates?.[0]?.content?.parts || [];
    const functionCalls = extractFunctionCalls(responseParts);

    let hasActionCalls = false;
    const functionResponses: Part[] = [];

    for (const call of functionCalls) {
      if (call.name === 'report_state') {
        yield {
          type: 'state',
          state: {
            sessionId,
            mode: (call.args as { mode: Mode }).mode,
            collectedData: (call.args as { collectedData?: Record<string, unknown> }).collectedData || {},
          },
        };
        functionResponses.push({
          functionResponse: { name: 'report_state', response: { success: true } },
        });
      } else if (call.name === 'submit_lead') {
        yield { type: 'lead', leadData: call.args as LeadData };
        hasActionCalls = true;
        functionResponses.push({
          functionResponse: {
            name: 'submit_lead',
            response: { success: true, message: 'Lead wurde erfolgreich erstellt. Bitte bestätige dem Kunden warmherzig.' },
          },
        });
      } else if (call.name === 'submit_service_request') {
        yield { type: 'service', serviceData: call.args as ServiceData };
        hasActionCalls = true;
        functionResponses.push({
          functionResponse: {
            name: 'submit_service_request',
            response: { success: true, message: 'Service-Anfrage wurde erfolgreich erstellt. Bitte bestätige dem Kunden.' },
          },
        });
      }
    }

    if (hasActionCalls && functionResponses.length > 0) {
      const followUpContents: Content[] = [
        ...contents,
        { role: 'model', parts: responseParts },
        { role: 'user', parts: functionResponses },
      ];

      const followUpResult = await model.generateContentStream({ contents: followUpContents });

      for await (const chunk of followUpResult.stream) {
        const parts = chunk.candidates?.[0]?.content?.parts ?? [];
        const text = extractText(parts);
        if (text) {
          yield { type: 'token', content: text };
        }
      }

      const followUpResponse = await followUpResult.response;
      const followUpParts = followUpResponse.candidates?.[0]?.content?.parts || [];
      const followUpCalls = extractFunctionCalls(followUpParts);
      for (const call of followUpCalls) {
        if (call.name === 'report_state') {
          yield {
            type: 'state',
            state: {
              sessionId,
              mode: (call.args as { mode: Mode }).mode,
              collectedData: (call.args as { collectedData?: Record<string, unknown> }).collectedData || {},
            },
          };
        }
      }
    }
  }

  return { streamChat };
}

export type GeminiService = ReturnType<typeof createGeminiService>;
