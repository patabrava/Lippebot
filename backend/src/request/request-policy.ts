import type {
  FactoryNumberStatus,
  LiftManufacturer,
  RequestSituation,
  ServiceRequestType,
  YesNoUnknown,
} from '../types/index.js';

export type SupportInbox =
  | 'technik@lippelift.de'
  | 'finance@lippelift.de'
  | 'sales@lippelift.de'
  | 'lossau@lippelift.de';

export type CrmPermission =
  | 'sales_opportunity'
  | 'forbidden'
  | 'read_only'
  | 'create_service_request';

export interface RequestPolicyInput {
  requestSituation?: RequestSituation;
  ownsLift?: YesNoUnknown;
  liftManufacturer?: LiftManufacturer;
  factoryNumberStatus?: FactoryNumberStatus;
  serviceRequestType?: ServiceRequestType;
}

export interface RequestPolicy {
  kind: 'opportunity' | 'service';
  crm: CrmPermission;
  recipient?: SupportInbox;
  needsFactoryNumber: boolean;
}

const recipients: Record<ServiceRequestType, SupportInbox> = {
  maintenance: 'technik@lippelift.de',
  repair: 'technik@lippelift.de',
  technical: 'technik@lippelift.de',
  invoice_payment: 'finance@lippelift.de',
  sales_contract_order: 'sales@lippelift.de',
  spare_parts_installation_warranty: 'lossau@lippelift.de',
};

export function getServiceRecipient(serviceRequestType: ServiceRequestType): SupportInbox {
  return recipients[serviceRequestType];
}

export function classifyRequestPolicy(input: RequestPolicyInput): RequestPolicy {
  if (input.requestSituation === 'ordered_not_installed') {
    return {
      kind: 'service',
      crm: 'forbidden',
      recipient: 'sales@lippelift.de',
      needsFactoryNumber: false,
    };
  }
  if (input.ownsLift === 'no') {
    return {
      kind: 'opportunity',
      crm: 'sales_opportunity',
      needsFactoryNumber: false,
    };
  }

  const serviceRequestType = input.serviceRequestType ?? 'technical';
  const recipient = getServiceRecipient(serviceRequestType);

  if (input.liftManufacturer !== 'lippe') {
    return {
      kind: 'service',
      crm: 'forbidden',
      recipient,
      needsFactoryNumber: false,
    };
  }

  if (!input.factoryNumberStatus || input.factoryNumberStatus === 'unknown') {
    return {
      kind: 'service',
      crm: 'forbidden',
      recipient,
      needsFactoryNumber: true,
    };
  }

  if (input.factoryNumberStatus === 'unavailable') {
    return {
      kind: 'service',
      crm: 'forbidden',
      recipient,
      needsFactoryNumber: false,
    };
  }

  if (serviceRequestType === 'maintenance' || serviceRequestType === 'repair') {
    return {
      kind: 'service',
      crm: 'read_only',
      recipient,
      needsFactoryNumber: false,
    };
  }

  return {
    kind: 'service',
    crm: 'create_service_request',
    recipient,
    needsFactoryNumber: false,
  };
}

const trappedPattern = /\b(?:eingeschlossen|eingeklemmt|gefangen|steckt\s+(?:im|in\s+dem)\s+lift\s+fest)\b/i;
const injuryPattern = /\b(?:verletzt|verletzung|bewusstlos|blutet|medizinischer\s+notfall)\b/i;
const firePattern = /\b(?:brand|feuer|rauch|verbrannt(?:er|e|es|en)?\s+geruch)\b/i;
const dangerPattern = /\b(?:akute?|unmittelbare?)\s+gefahr\b/i;

export function detectEmergency(message: string): { emergency: boolean; show112: boolean } {
  const emergency = [trappedPattern, injuryPattern, firePattern, dangerPattern]
    .some((pattern) => pattern.test(message));
  return { emergency, show112: emergency };
}
