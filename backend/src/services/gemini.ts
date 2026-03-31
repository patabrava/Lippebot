import {
  GoogleGenerativeAI,
  type FunctionDeclaration,
  SchemaType,
  type Content,
  type Part,
  FunctionCallingMode,
} from '@google/generative-ai';
import type { ChatMessage, Mode, LeadData, ServiceData, ConversationState } from '../types/index.js';
import { buildSystemPrompt } from '../prompts/system-prompt.js';

const reportStateFn: FunctionDeclaration = {
  name: 'report_state',
  description: 'Report the current conversation mode and any collected data after every response.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      mode: {
        type: SchemaType.STRING,
        format: 'enum',
        enum: ['berater', 'anfrage', 'service', 'undetermined'],
        description: 'The current conversation mode',
      },
      collectedData: {
        type: SchemaType.OBJECT,
        description: 'Any lead or service data collected so far',
        properties: {
          stairLocation: { type: SchemaType.STRING },
          stairType: { type: SchemaType.STRING },
          buildingType: { type: SchemaType.STRING },
          liftType: { type: SchemaType.STRING },
          firstName: { type: SchemaType.STRING },
          lastName: { type: SchemaType.STRING },
          phone: { type: SchemaType.STRING },
          email: { type: SchemaType.STRING },
          street: { type: SchemaType.STRING },
          postalCode: { type: SchemaType.STRING },
          city: { type: SchemaType.STRING },
          availability: { type: SchemaType.STRING },
          message: { type: SchemaType.STRING },
          newsletter: { type: SchemaType.STRING },
          customerName: { type: SchemaType.STRING },
          issueDescription: { type: SchemaType.STRING },
          liftModel: { type: SchemaType.STRING },
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
    type: SchemaType.OBJECT,
    properties: {
      stairLocation: { type: SchemaType.STRING },
      stairType: { type: SchemaType.STRING },
      buildingType: { type: SchemaType.STRING },
      liftType: { type: SchemaType.STRING },
      firstName: { type: SchemaType.STRING },
      lastName: { type: SchemaType.STRING },
      phone: { type: SchemaType.STRING },
      email: { type: SchemaType.STRING },
      street: { type: SchemaType.STRING },
      postalCode: { type: SchemaType.STRING },
      city: { type: SchemaType.STRING },
      availability: { type: SchemaType.STRING },
      message: { type: SchemaType.STRING },
      newsletter: { type: SchemaType.STRING },
    },
    required: ['firstName', 'lastName', 'phone', 'postalCode', 'city', 'availability'],
  },
};

const submitServiceRequestFn: FunctionDeclaration = {
  name: 'submit_service_request',
  description: 'Submit a service request when the customer has described their issue and provided contact info. After calling this, generate a warm confirmation message.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      customerName: { type: SchemaType.STRING },
      phone: { type: SchemaType.STRING },
      email: { type: SchemaType.STRING },
      issueDescription: { type: SchemaType.STRING },
      liftModel: { type: SchemaType.STRING },
    },
    required: ['customerName', 'phone', 'issueDescription'],
  },
};

const allFunctionDeclarations = [reportStateFn, submitLeadFn, submitServiceRequestFn];

export function createGeminiService(apiKey: string) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
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
      .filter((p) => 'text' in p && p.text)
      .map((p) => (p as { text: string }).text)
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
    // Build conversation contents
    const contents: Content[] = history.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));
    contents.push({ role: 'user', parts: [{ text: message }] });

    // First call: stream the initial response
    const result = await model.generateContentStream({ contents });

    let allResponseParts: Part[] = [];

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        yield { type: 'token', content: text };
      }

      // Collect all parts for function call detection after stream completes
      const candidates = chunk.candidates;
      if (candidates) {
        for (const candidate of candidates) {
          if (candidate.content?.parts) {
            allResponseParts.push(...candidate.content.parts);
          }
        }
      }
    }

    // After stream completes, check for function calls in the aggregated response
    const response = await result.response;
    const responseParts = response.candidates?.[0]?.content?.parts || [];
    const functionCalls = extractFunctionCalls(responseParts);

    // Process function calls
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

    // If there were action function calls (submit_lead, submit_service_request),
    // send function responses back to Gemini and stream the confirmation message
    if (hasActionCalls && functionResponses.length > 0) {
      const followUpContents: Content[] = [
        ...contents,
        { role: 'model', parts: responseParts },
        { role: 'function', parts: functionResponses },
      ];

      const followUpResult = await model.generateContentStream({ contents: followUpContents });

      for await (const chunk of followUpResult.stream) {
        const text = chunk.text();
        if (text) {
          yield { type: 'token', content: text };
        }
      }

      // Check for report_state in follow-up
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
