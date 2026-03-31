interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface StoredData {
  sessionId: string;
  messages: StoredMessage[];
  lastUpdated: number;
}

const STORAGE_KEY = 'sarah-chat-history';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function generateId(): string {
  return `sarah-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export class ChatHistory {
  private data: StoredData;

  constructor() {
    this.data = this.load();
  }

  private load(): StoredData {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { sessionId: generateId(), messages: [], lastUpdated: Date.now() };

      const parsed = JSON.parse(raw) as StoredData;
      if (Date.now() - parsed.lastUpdated > TTL_MS) {
        localStorage.removeItem(STORAGE_KEY);
        return { sessionId: generateId(), messages: [], lastUpdated: Date.now() };
      }
      return parsed;
    } catch {
      return { sessionId: generateId(), messages: [], lastUpdated: Date.now() };
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

  addMessage(role: 'user' | 'assistant', content: string): void {
    this.data.messages.push({ role, content, timestamp: Date.now() });
    this.save();
  }

  clear(): void {
    this.data = { sessionId: generateId(), messages: [], lastUpdated: Date.now() };
    localStorage.removeItem(STORAGE_KEY);
  }
}
