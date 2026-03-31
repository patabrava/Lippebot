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

export interface LeadData {
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

export interface ServiceData {
  customerName?: string;
  phone?: string;
  email?: string;
  issueDescription?: string;
  liftModel?: string;
}

export interface ConversationState {
  sessionId: string;
  mode: Mode;
  collectedData: Partial<LeadData & ServiceData>;
}

export interface SSEEvent {
  type: 'token' | 'done' | 'action' | 'error';
  content?: string;
  mode?: Mode;
  collectedData?: Partial<LeadData & ServiceData>;
  action?: string;
  data?: Record<string, unknown>;
  error?: string;
}
