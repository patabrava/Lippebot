export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ChatRequest {
  sessionId: string;
  requestId?: string;
  message: string;
  history: ChatMessage[];
}

export type Mode = 'berater' | 'anfrage' | 'service' | 'undetermined';
export type YesNoUnknown = 'yes' | 'no' | 'unknown';
export type PriorContactStatus = YesNoUnknown;
export type RequestSituation = 'new_lift' | 'ordered_not_installed' | 'installed_lift';

export type LiftManufacturer = 'lippe' | 'other' | 'unknown';
export type FactoryNumberStatus = 'provided' | 'unavailable' | 'unknown';
export type ServiceRequestType =
  | 'maintenance'
  | 'repair'
  | 'technical'
  | 'invoice_payment'
  | 'sales_contract_order'
  | 'spare_parts_installation_warranty';
export type RequestLifecycle = 'collecting' | 'matching' | 'ready' | 'processing' | 'completed' | 'failed';

export interface RequestContext {
  requestId: string;
  ownsLift?: YesNoUnknown;
  liftManufacturer?: LiftManufacturer;
  factoryNumber?: string;
  factoryNumberStatus?: FactoryNumberStatus;
  serviceRequestType?: ServiceRequestType;
}

export type FactoryCaseResult =
  | {
      matchState: 'unique';
      personId: number;
      dealId: number;
      factoryNumber: string;
      hasMontageDate?: boolean;
    }
  | { matchState: 'unresolved'; candidateCount: 0 }
  | { matchState: 'ambiguous'; candidateCount: number };

export interface ServiceRequestCrmResult {
  personId: number;
  dealId: number;
  noteId: number;
  sourceDealId: number;
  sourceDealUrl?: string;
  serviceDealUrl?: string;
  reused: boolean;
}

export type SupportCategory = 'technik' | 'finance' | 'sales' | 'lossau';
export type SupportMatchState = 'unique' | 'ambiguous' | 'unresolved';
export type SupportNoteStatus = 'created' | 'failed' | 'skipped';

export interface LeadData {
  requestSituation?: RequestSituation;
  ownsLift?: YesNoUnknown;
  priorContact?: PriorContactStatus;
  priorContactReference?: string;
  customerSegment?: 'privatperson' | 'firma';
  stairLocation?: 'innen' | 'aussen';
  stairType?: 'gerade' | 'kurvig';
  buildingType?: 'einfamilienhaus' | 'mehrfamilienhaus';
  liftType?: 'sitzlift' | 'rollstuhlgeeignet';
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  street?: string;
  postalCode?: string;
  city?: string;
  availability?: '08:00 - 12:00' | '12:00 - 16:00' | '16:00 - 20:00';
  message?: string;
  newsletter?: 'Ja' | 'Nein';
}

export type LeadCrmOutcome = 'created' | 'reused' | 'person_review' | 'identity_review';

export interface LeadCrmResult {
  outcome: LeadCrmOutcome;
  personId?: number;
  dealId?: number;
  createdPerson?: boolean;
  candidateCount?: number;
  reason?: string;
}

export interface SupportData {
  requestSituation?: RequestSituation;
  ownsLift?: YesNoUnknown;
  liftManufacturer?: LiftManufacturer;
  factoryNumber?: string;
  factoryNumberStatus?: FactoryNumberStatus;
  serviceRequestType?: ServiceRequestType;
  priorContact?: PriorContactStatus;
  priorContactReference?: string;
  customerName?: string;
  phone?: string;
  email?: string;
  category?: SupportCategory;
  issueDescription?: string;
  liftModel?: string;
  symptomDetails?: string;
  triggerConditions?: string;
  invoiceNumber?: string;
  customerNumber?: string;
  paymentReference?: string;
  orderNumber?: string;
  offerNumber?: string;
  leadId?: string;
  contractReference?: string;
  sparePartReference?: string;
  installationContext?: string;
  defectContext?: string;
}

export interface SupportMatchResult {
  matchState: SupportMatchState;
  personId?: number;
  dealId?: number;
  candidateCount: number;
}

export type SupportReferenceCaseResult =
  | { matchState: 'unique'; personId: number; dealId: number; candidateCount: 1 }
  | { matchState: 'unresolved'; candidateCount: 0 }
  | { matchState: 'ambiguous'; candidateCount: number };

export interface SupportHandoffResult {
  matchState: SupportMatchState;
  personId?: number;
  dealId?: number;
  createdPerson?: boolean;
  intendedInbox: string;
  emailRecipient: string;
  noteStatus: SupportNoteStatus;
  noteError?: string;
}

export type ServiceData = SupportData;

export interface ConversationState {
  sessionId: string;
  mode: Mode;
  collectedData: Partial<LeadData & SupportData>;
}

export interface SSEEvent {
  type: 'token' | 'done' | 'action' | 'error';
  content?: string;
  mode?: Mode;
  collectedData?: Partial<LeadData & SupportData>;
  action?: string;
  data?: Record<string, unknown>;
  error?: string;
}
