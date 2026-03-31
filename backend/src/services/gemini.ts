import {
  GoogleGenerativeAI,
  type FunctionDeclaration,
  SchemaType,
  type GenerateContentRequest,
  type Content,
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
  description: 'Submit a qualified lead when all required contact information has been collected.',
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
  description: 'Submit a service request when the customer has described their issue and provided contact info.',
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

export interface GeminiStreamResult {
  textStream: AsyncIterable<string>;
  getState: () => Promise<ConversationState | null>;
  getLeadData: () => Promise<LeadData | null>;
  getServiceData: () => Promise<ServiceData | null>;
}

export function createGeminiService(apiKey: string) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: buildSystemPrompt(),
    tools: [{ functionDeclarations: [reportStateFn, submitLeadFn, submitServiceRequestFn] }],
  });

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
      // Handle text parts
      const text = chunk.text();
      if (text) {
        yield { type: 'token', content: text };
      }

      // Handle function calls
      const candidates = chunk.candidates;
      if (candidates) {
        for (const candidate of candidates) {
          for (const part of candidate.content.parts) {
            if (part.functionCall) {
              const { name, args } = part.functionCall;
              if (name === 'report_state') {
                yield {
                  type: 'state',
                  state: {
                    sessionId,
                    mode: (args as { mode: Mode }).mode,
                    collectedData: (args as { collectedData?: Record<string, unknown> }).collectedData || {},
                  },
                };
              } else if (name === 'submit_lead') {
                yield { type: 'lead', leadData: args as LeadData };
              } else if (name === 'submit_service_request') {
                yield { type: 'service', serviceData: args as ServiceData };
              }
            }
          }
        }
      }
    }
  }

  return { streamChat };
}

export type GeminiService = ReturnType<typeof createGeminiService>;
