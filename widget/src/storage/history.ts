interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface StoredData {
  sessionId: string;
  messages: StoredMessage[];
  lastUpdated: number;
  requestSequence: number;
  activeRequestId: string;
}

const LEGACY_STORAGE_KEY = 'sarah-chat-history';
const STORAGE_KEY = 'sarah-chat-history-v3-verified-flow';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function generateId(): string {
  return `sarah-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function requestId(sessionId: string, sequence: number): string {
  return `${sessionId}-request-${sequence}`;
}

function freshData(): StoredData {
  const sessionId = generateId();
  return {
    sessionId,
    messages: [],
    lastUpdated: Date.now(),
    requestSequence: 1,
    activeRequestId: requestId(sessionId, 1),
  };
}

export class ChatHistory {
  private data: StoredData;

  constructor() {
    this.data = this.load();
    this.save();
  }

  private load(): StoredData {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return freshData();

      const parsed = JSON.parse(raw) as StoredData;
      if (Date.now() - parsed.lastUpdated > TTL_MS) {
        localStorage.removeItem(STORAGE_KEY);
        return freshData();
      }
      if (!Number.isSafeInteger(parsed.requestSequence) || parsed.requestSequence < 1 || !parsed.activeRequestId) {
        parsed.requestSequence = 1;
        parsed.activeRequestId = requestId(parsed.sessionId, parsed.requestSequence);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      }
      return parsed;
    } catch {
      return freshData();
    }
  }

  private save(): void {
    this.data.lastUpdated = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
  }

  getMessages(): StoredMessage[] {
    return [...this.data.messages];
  }

  getSessionId(): string {
    return this.data.sessionId;
  }

  getRequestId(): string {
    return this.data.activeRequestId;
  }

  completeRequest(completedRequestId: string): boolean {
    if (completedRequestId !== this.data.activeRequestId) return false;
    this.data.requestSequence += 1;
    this.data.activeRequestId = requestId(this.data.sessionId, this.data.requestSequence);
    this.save();
    return true;
  }

  addMessage(role: 'user' | 'assistant', content: string): void {
    this.data.messages.push({ role, content, timestamp: Date.now() });
    this.save();
  }

  clear(): void {
    this.data = freshData();
    localStorage.removeItem(STORAGE_KEY);
  }
}
