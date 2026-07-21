import { VertexAI, type FunctionDeclaration, FunctionDeclarationSchemaType, type Content, type Part } from '@google-cloud/vertexai';
import type { ChatMessage, Mode, LeadData, ServiceData, ConversationState } from '../types/index.js';
import { buildSystemPrompt } from '../prompts/system-prompt.js';
import { hasContactMethod } from '../contact/contact-method.js';
import { hasPriorContactStatus } from '../contact/prior-contact.js';

const priorContactProperty = {
  type: FunctionDeclarationSchemaType.STRING,
  enum: ['yes', 'no', 'unknown'],
};

const ownsLiftProperty = {
  type: FunctionDeclarationSchemaType.STRING,
  enum: ['yes', 'no', 'unknown'],
};

const liftManufacturerProperty = {
  type: FunctionDeclarationSchemaType.STRING,
  enum: ['lippe', 'other', 'unknown'],
};

const factoryNumberStatusProperty = {
  type: FunctionDeclarationSchemaType.STRING,
  enum: ['provided', 'unavailable', 'unknown'],
};

const serviceRequestTypeProperty = {
  type: FunctionDeclarationSchemaType.STRING,
  enum: [
    'maintenance',
    'repair',
    'technical',
    'invoice_payment',
    'sales_contract_order',
    'spare_parts_installation_warranty',
  ],
};

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
          ownsLift: ownsLiftProperty,
          liftManufacturer: liftManufacturerProperty,
          factoryNumber: { type: FunctionDeclarationSchemaType.STRING },
          factoryNumberStatus: factoryNumberStatusProperty,
          serviceRequestType: serviceRequestTypeProperty,
          priorContact: priorContactProperty,
          priorContactReference: { type: FunctionDeclarationSchemaType.STRING },
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
          offerNumber: { type: FunctionDeclarationSchemaType.STRING },
          leadId: { type: FunctionDeclarationSchemaType.STRING },
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
  description: 'Submit a qualified new-lift opportunity only when ownsLift is no, all required information, prior-contact status, and at least one contact method (phone or email) have been collected. Do not confirm completion; the backend owns the final confirmation.',
  parameters: {
    type: FunctionDeclarationSchemaType.OBJECT,
    properties: {
      ownsLift: ownsLiftProperty,
      priorContact: priorContactProperty,
      priorContactReference: { type: FunctionDeclarationSchemaType.STRING },
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
    required: ['ownsLift', 'customerSegment', 'firstName', 'lastName', 'street', 'postalCode', 'city', 'availability', 'priorContact'],
  },
};

const submitServiceRequestFn: FunctionDeclaration = {
  name: 'submit_service_request',
  description: 'Submit an owned-lift service request only after Sarah has ownership, manufacturer, service type, customer name, one primary category, a short issue summary, and at least one contact method (phone or email). A LIPPE lift also needs a provided factory number or explicit unavailability. Do not confirm completion; the backend owns the final confirmation.',
  parameters: {
    type: FunctionDeclarationSchemaType.OBJECT,
    properties: {
      ownsLift: ownsLiftProperty,
      liftManufacturer: liftManufacturerProperty,
      factoryNumber: { type: FunctionDeclarationSchemaType.STRING },
      factoryNumberStatus: factoryNumberStatusProperty,
      serviceRequestType: serviceRequestTypeProperty,
      priorContact: priorContactProperty,
      priorContactReference: { type: FunctionDeclarationSchemaType.STRING },
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
      offerNumber: { type: FunctionDeclarationSchemaType.STRING },
      leadId: { type: FunctionDeclarationSchemaType.STRING },
      contractReference: { type: FunctionDeclarationSchemaType.STRING },
      sparePartReference: { type: FunctionDeclarationSchemaType.STRING },
      installationContext: { type: FunctionDeclarationSchemaType.STRING },
      defectContext: { type: FunctionDeclarationSchemaType.STRING },
    },
    required: ['ownsLift', 'liftManufacturer', 'serviceRequestType', 'customerName', 'category', 'issueDescription'],
  },
};

const allFunctionDeclarations = [reportStateFn, submitLeadFn, submitServiceRequestFn];

function isValidLeadSubmission(args: Record<string, unknown>): boolean {
  return args.ownsLift === 'no' && hasPriorContactStatus(args) && hasContactMethod(args);
}

function isValidServiceSubmission(args: Record<string, unknown>): boolean {
  if (args.ownsLift !== 'yes' || !['lippe', 'other'].includes(String(args.liftManufacturer))) {
    return false;
  }
  if (!serviceRequestTypeProperty.enum?.includes(String(args.serviceRequestType))) {
    return false;
  }
  if (!hasContactMethod(args)) return false;
  if (args.liftManufacturer === 'other') return true;
  if (args.factoryNumberStatus === 'unavailable') return true;
  return args.factoryNumberStatus === 'provided'
    && typeof args.factoryNumber === 'string'
    && args.factoryNumber.trim().length > 0;
}

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
    const initialTextChunks: string[] = [];

    for await (const chunk of result.stream) {
      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      const text = extractText(parts);
      if (text) {
        initialTextChunks.push(text);
      }
    }

    const response = await result.response;
    const responseParts = response.candidates?.[0]?.content?.parts || [];
    const functionCalls = extractFunctionCalls(responseParts);
    const hasInvalidSubmission = functionCalls.some((call) => (
      (call.name === 'submit_lead' && !isValidLeadSubmission(call.args))
      || (call.name === 'submit_service_request' && !isValidServiceSubmission(call.args))
    ));

    if (!hasInvalidSubmission) {
      for (const content of initialTextChunks) {
        yield { type: 'token', content };
      }
    }

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
        hasActionCalls = true;
        if (call.args.ownsLift !== 'no') {
          functionResponses.push({
            functionResponse: {
              name: 'submit_lead',
              response: {
                success: false,
                needsOwnership: true,
                message: 'Kläre zuerst, ob die Person bereits einen Lift besitzt. submit_lead ist nur bei ownsLift=no erlaubt.',
              },
            },
          });
          continue;
        }
        if (!hasPriorContactStatus(call.args)) {
          functionResponses.push({
            functionResponse: {
              name: 'submit_lead',
              response: {
                success: false,
                needsPriorContact: true,
                message: 'Kläre zuerst mit genau einer natürlichen Frage, ob die Person wegen dieses Anliegens schon Kontakt mit uns hatte. Wenn sie es nicht weiß oder nicht sagen möchte, verwende unknown.',
              },
            },
          });
          continue;
        }
        if (!hasContactMethod(call.args)) {
          functionResponses.push({
            functionResponse: {
              name: 'submit_lead',
              response: {
                success: false,
                needsContact: true,
                message: 'Es fehlt eine gültige Kontaktmöglichkeit. Frage natürlich nach entweder Telefonnummer oder E-Mail-Adresse und bestätige noch keine Übergabe.',
              },
            },
          });
          continue;
        }
        yield { type: 'lead', leadData: call.args as LeadData };
        functionResponses.push({
          functionResponse: {
            name: 'submit_lead',
            response: { success: true, message: 'Daten sind vollständig. Warte auf die Backend-Bestätigung und bestätige die Übergabe noch nicht.' },
          },
        });
      } else if (call.name === 'submit_service_request') {
        hasActionCalls = true;
        if (call.args.ownsLift !== 'yes' || !['lippe', 'other'].includes(String(call.args.liftManufacturer))) {
          functionResponses.push({
            functionResponse: {
              name: 'submit_service_request',
              response: {
                success: false,
                needsOwnership: true,
                message: 'Kläre zuerst, ob ein Lift vorhanden ist und ob er von LIPPE Lift stammt.',
              },
            },
          });
          continue;
        }
        if (!hasContactMethod(call.args)) {
          functionResponses.push({
            functionResponse: {
              name: 'submit_service_request',
              response: {
                success: false,
                needsContact: true,
                message: 'Es fehlt eine gültige Kontaktmöglichkeit. Frage natürlich nach entweder Telefonnummer oder E-Mail-Adresse und bestätige noch keine Übergabe.',
              },
            },
          });
          continue;
        }
        if (!serviceRequestTypeProperty.enum?.includes(String(call.args.serviceRequestType))) {
          functionResponses.push({
            functionResponse: {
              name: 'submit_service_request',
              response: {
                success: false,
                needsServiceType: true,
                message: 'Ordne das Anliegen genau einem Service-Typ zu und bestätige noch keine Übergabe.',
              },
            },
          });
          continue;
        }
        const hasFactoryDecision = call.args.liftManufacturer === 'other'
          || call.args.factoryNumberStatus === 'unavailable'
          || (call.args.factoryNumberStatus === 'provided'
            && typeof call.args.factoryNumber === 'string'
            && call.args.factoryNumber.trim().length > 0);
        if (!hasFactoryDecision) {
          functionResponses.push({
            functionResponse: {
              name: 'submit_service_request',
              response: {
                success: false,
                needsFactoryNumber: true,
                message: 'Bitte die Fabriknummer abfragen oder ausdrücklich als nicht verfügbar markieren.',
              },
            },
          });
          continue;
        }
        yield { type: 'service', serviceData: call.args as ServiceData };
        functionResponses.push({
          functionResponse: {
            name: 'submit_service_request',
            response: { success: true, message: 'Daten sind vollständig. Warte auf die Backend-Bestätigung und bestätige die Übergabe noch nicht.' },
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
