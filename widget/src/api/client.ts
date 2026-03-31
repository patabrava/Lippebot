export interface SSEEvent {
  type: 'token' | 'done' | 'action' | 'error';
  content?: string;
  mode?: string;
  collectedData?: Record<string, unknown>;
  action?: string;
  data?: Record<string, unknown>;
  error?: string;
}

export function parseSSELine(line: string): SSEEvent | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('data: ')) return null;
  try {
    return JSON.parse(trimmed.slice(6)) as SSEEvent;
  } catch {
    return null;
  }
}

export interface ChatClientOptions {
  apiUrl: string;
  onToken: (text: string) => void;
  onDone: (mode: string, collectedData: Record<string, unknown>) => void;
  onAction: (action: string, data: Record<string, unknown>) => void;
  onError: (error: string) => void;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export async function sendMessage(
  options: ChatClientOptions,
  sessionId: string,
  message: string,
  history: ChatMessage[],
): Promise<void> {
  const response = await fetch(`${options.apiUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, message, history }),
  });

  if (!response.ok || !response.body) {
    options.onError('Sarah ist gerade nicht erreichbar. Bitte versuchen Sie es später erneut.');
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const event = parseSSELine(line);
      if (!event) continue;

      switch (event.type) {
        case 'token':
          if (event.content) options.onToken(event.content);
          break;
        case 'done':
          options.onDone(event.mode || 'undetermined', event.collectedData || {});
          break;
        case 'action':
          if (event.action) options.onAction(event.action, event.data || {});
          break;
        case 'error':
          options.onError(event.error || 'Unbekannter Fehler');
          break;
      }
    }
  }
}
