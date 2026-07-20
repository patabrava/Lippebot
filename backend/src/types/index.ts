export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ChatRequest {
  sessionId: string;
  message: string;
  history: ChatMessage[];
}

export type Mode = 'berater' | 'anfrage' | 'service' | 'undetermined';
export type PriorContactStatus = 'yes' | 'no' | 'unknown';

export type SupportCategory = 'technik' | 'finance' | 'sales' | 'lossau';
export type SupportMatchState = 'unique' | 'ambiguous' | 'unresolved';
export type SupportNoteStatus = 'created' | 'failed' | 'skipped';

export interface LeadData {
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
