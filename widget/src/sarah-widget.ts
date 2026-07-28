import { injectStyles } from './styles/theme.js';
import { ChatHistory } from './storage/history.js';
import { sendMessage, submitAbandonedChat } from './api/client.js';
import { renderMarkdown } from './utils/markdown.js';

const CHAT_ICON = `<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;
const CLOSE_ICON = '\u2715';
const SEND_ICON = `<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`;
const TEN_MINUTES_MS = 10 * 60 * 1000;

export const INACTIVITY_FOLLOW_UP_MESSAGE = 'Gibt es noch was was ich tun kann?';

export const GREETINGS = [
  'Hallo! Ich bin Sarah. Kann ich dir helfen?',
  'Hi! Ich bin Sarah \u{1F44B} Frag mich gerne alles rund um Treppenlifte.',
  'Servus! Sarah hier. Suchst du den passenden Lift?',
  'Hey! Ich bin Sarah. Was kann ich dir zeigen?',
];

export const OPENING_MESSAGES = [
  'Hallo! Ich bin Sarah, deine persönliche Beraterin bei LIPPE Lift. \u{1F60A} Womit kann ich dir helfen?',
  'Hi! Sarah von LIPPE Lift hier. Erzähl mir, worum es geht — ich helfe dir weiter.',
  'Schön, dass du da bist! Ich bin Sarah. Magst du wissen, welcher Lift zu dir passt, hast eine Frage zur Förderung, oder geht es um Service?',
];

export function pickGreeting<T>(pool: readonly T[], rng: () => number = Math.random): T {
  const idx = Math.min(Math.floor(rng() * pool.length), pool.length - 1);
  return pool[idx]!;
}

const QUICK_ACTIONS = [
  'Welcher Lift passt zu mir?',
  'Förderung & Zuschüsse',
  'Service & Wartung',
];

interface AssistantBubbleState {
  row: HTMLDivElement;
  content: HTMLDivElement;
  continueBtn: HTMLButtonElement;
  resizeObserver?: ResizeObserver;
}

interface AssistantBubble extends AssistantBubbleState {
  bubble: HTMLDivElement;
}

class SarahWidget {
  private apiUrl: string;
  private history: ChatHistory;
  private isOpen = false;
  private isStreaming = false;
  private container: HTMLDivElement;
  private bubble: HTMLButtonElement | null = null;
  private greetingEl: HTMLDivElement | null = null;
  private panel: HTMLDivElement | null = null;
  private messagesEl: HTMLDivElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private greetingDelay: number;
  private inactivityMs: number;
  private unansweredInactivityMs: number;
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private unansweredTimer: ReturnType<typeof setTimeout> | null = null;
  private followUpPending = false;
  private abandonedSummarySubmitted = false;

  constructor(apiUrl: string, options: {
    greeting?: string;
    delay?: number;
    inactivityMs?: number;
    unansweredInactivityMs?: number;
  } = {}) {
    this.apiUrl = apiUrl;
    this.history = new ChatHistory();
    this.greetingDelay = options.delay || 3000;
    this.inactivityMs = options.inactivityMs || TEN_MINUTES_MS;
    this.unansweredInactivityMs = options.unansweredInactivityMs || TEN_MINUTES_MS;

    this.container = document.createElement('div');
    this.container.className = 'sarah-widget';
    document.body.appendChild(this.container);

    injectStyles();
    this.renderBubble();
    this.renderPanel();

    if (this.history.getMessages().length === 0) {
      setTimeout(() => this.showGreeting(), this.greetingDelay);
    } else if (this.hasUserMessage() && !this.history.isConversationClosed()) {
      this.scheduleInactivityFollowUp();
    }
  }

  private renderBubble(): void {
    this.bubble = document.createElement('button');
    this.bubble.className = 'sarah-bubble';
    this.bubble.innerHTML = CHAT_ICON;
    this.bubble.setAttribute('aria-label', 'Chat mit Sarah öffnen');
    this.bubble.addEventListener('click', () => this.toggle());
    this.container.appendChild(this.bubble);
  }

  private showGreeting(): void {
    if (this.isOpen || this.greetingEl) return;
    this.greetingEl = document.createElement('div');
    this.greetingEl.className = 'sarah-greeting';
    this.greetingEl.textContent = `\u{1F44B} ${pickGreeting(GREETINGS)}`;
    this.greetingEl.addEventListener('click', () => this.toggle());
    this.container.appendChild(this.greetingEl);
  }

  private hideGreeting(): void {
    if (this.greetingEl) {
      this.greetingEl.remove();
      this.greetingEl = null;
    }
  }

  private renderPanel(): void {
    this.panel = document.createElement('div');
    this.panel.className = 'sarah-panel';
    this.panel.style.display = 'none';

    const header = document.createElement('div');
    header.className = 'sarah-header';
    header.innerHTML = `
      <div class="sarah-avatar">S</div>
      <div class="sarah-header-text">
        <h3>Sarah</h3>
        <span>LIPPE Lift Assistentin</span>
      </div>
    `;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'sarah-close';
    closeBtn.textContent = CLOSE_ICON;
    closeBtn.setAttribute('aria-label', 'Chat schließen');
    closeBtn.addEventListener('click', () => this.toggle());
    header.appendChild(closeBtn);
    this.panel.appendChild(header);

    this.messagesEl = document.createElement('div');
    this.messagesEl.className = 'sarah-messages';
    this.panel.appendChild(this.messagesEl);

    const inputArea = document.createElement('div');
    inputArea.className = 'sarah-input-area';

    this.inputEl = document.createElement('input');
    this.inputEl.className = 'sarah-input';
    this.inputEl.placeholder = 'Nachricht eingeben...';
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });

    this.sendBtn = document.createElement('button');
    this.sendBtn.className = 'sarah-send';
    this.sendBtn.innerHTML = SEND_ICON;
    this.sendBtn.setAttribute('aria-label', 'Nachricht senden');
    this.sendBtn.addEventListener('click', () => this.handleSend());

    inputArea.appendChild(this.inputEl);
    inputArea.appendChild(this.sendBtn);
    this.panel.appendChild(inputArea);

    this.container.appendChild(this.panel);
  }

  private toggle(): void {
    this.isOpen = !this.isOpen;
    this.hideGreeting();

    if (this.isOpen) {
      this.panel!.style.display = 'flex';
      this.bubble!.style.display = 'none';
      this.inputEl!.focus();

      if (this.history.getMessages().length === 0) {
        this.addBotMessage(pickGreeting(OPENING_MESSAGES));
        this.renderQuickActions();
      } else {
        this.restoreMessages();
      }
    } else {
      this.panel!.style.display = 'none';
      this.bubble!.style.display = 'flex';
    }
  }

  private restoreMessages(): void {
    this.messagesEl!.innerHTML = '';
    const messages = this.history.getMessages();
    for (const msg of messages) {
      this.appendMessageEl(msg.role === 'user' ? 'user' : 'bot', msg.content, false);
    }
  }

  private addBotMessage(text: string): void {
    this.history.addMessage('assistant', text);
    this.appendMessageEl('bot', text, true);
  }

  private addUserMessage(text: string): void {
    this.cancelInactivityTimers();
    this.followUpPending = false;
    this.history.addMessage('user', text);
    this.appendMessageEl('user', text, false);
  }

  private appendMessageEl(type: 'bot' | 'user', text: string, reveal = false): void {
    const wrapper = document.createElement('div');
    wrapper.className = `sarah-msg ${type}`;

    if (type === 'bot') {
      const bubble = this.createAssistantBubble();
      bubble.content.innerHTML = renderMarkdown(text);
      this.messagesEl!.appendChild(bubble.row);
      if (reveal) {
        requestAnimationFrame(() => this.scrollAssistantRowIntoView(bubble.row));
      }
      requestAnimationFrame(() => this.syncAssistantBubble(bubble));
      return;
    } else {
      wrapper.innerHTML = `
        <div class="sarah-msg-bubble">${this.escapeHtml(text)}</div>
      `;
    }

    this.messagesEl!.appendChild(wrapper);
  }

  private createAvatar(): HTMLDivElement {
    const avatar = document.createElement('div');
    avatar.className = 'sarah-msg-avatar';
    avatar.textContent = 'S';
    return avatar;
  }

  private createAssistantBubble(): AssistantBubble {
    const row = document.createElement('div');
    row.className = 'sarah-msg bot';

    const bubble = document.createElement('div');
    bubble.className = 'sarah-msg-bubble sarah-msg-bubble--assistant';

    const content = document.createElement('div');
    content.className = 'sarah-msg-content';

    const continueBtn = document.createElement('button');
    continueBtn.type = 'button';
    continueBtn.className = 'sarah-msg-continue';
    continueBtn.innerHTML = '↓';
    continueBtn.setAttribute('aria-label', 'Weiter zum nächsten Abschnitt');
    continueBtn.addEventListener('click', () => {
      const step = Math.max(Math.round(content.clientHeight * 0.9), 120);
      content.scrollBy({ top: step, behavior: 'smooth' });
    });

    const resizeObserver = new ResizeObserver(() => this.syncAssistantBubble({ content, continueBtn }));
    resizeObserver.observe(content);
    content.addEventListener('scroll', () => this.syncAssistantBubble({ content, continueBtn }));

    bubble.appendChild(content);
    bubble.appendChild(continueBtn);
    row.appendChild(this.createAvatar());
    row.appendChild(bubble);

    return { row, bubble, content, continueBtn, resizeObserver };
  }

  private syncAssistantBubble(bubble: AssistantBubbleState): void {
    const canScroll = bubble.content.scrollHeight > bubble.content.clientHeight + 1;
    const atBottom = bubble.content.scrollTop + bubble.content.clientHeight >= bubble.content.scrollHeight - 1;
    bubble.continueBtn.style.display = canScroll && !atBottom ? 'flex' : 'none';
  }

  private createStreamingBubble(): AssistantBubble {
    const bubble = this.createAssistantBubble();
    this.messagesEl!.appendChild(bubble.row);
    requestAnimationFrame(() => this.scrollAssistantRowIntoView(bubble.row));

    return bubble;
  }

  private showTypingIndicator(): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'sarah-msg bot';
    wrapper.innerHTML = `
      <div class="sarah-msg-avatar">S</div>
      <div class="sarah-typing"><span></span><span></span><span></span></div>
    `;
    this.messagesEl!.appendChild(wrapper);
    return wrapper;
  }

  private renderQuickActions(): void {
    const container = document.createElement('div');
    container.className = 'sarah-quick-actions';

    for (const action of QUICK_ACTIONS) {
      const btn = document.createElement('button');
      btn.className = 'sarah-quick-btn';
      btn.textContent = action;
      btn.addEventListener('click', () => {
        container.remove();
        this.sendUserMessage(action);
      });
      container.appendChild(btn);
    }

    this.messagesEl!.appendChild(container);
  }

  private renderFactoryNumberHelp(): void {
    if (this.messagesEl?.querySelector('.sarah-factory-help')) return;
    const card = document.createElement('div');
    card.className = 'sarah-factory-help';
    const image = document.createElement('img');
    image.src = `${new URL(this.apiUrl, window.location.href).origin}/fabriknummer-hinweis.png`;
    image.alt = 'Beispiel: Hier finden Sie die Fabriknummer auf dem Lift-Etikett';
    const caption = document.createElement('p');
    caption.textContent = 'Die Fabriknummer steht auf dem Etikett Ihres Lifts. Bitte schreiben Sie sie ab.';
    card.appendChild(image);
    card.appendChild(caption);
    this.messagesEl?.appendChild(card);
    requestAnimationFrame(() => this.scrollElementIntoView(card, 'end'));
  }

  private async handleSend(): Promise<void> {
    const text = this.inputEl!.value.trim();
    if (!text || this.isStreaming) return;
    this.inputEl!.value = '';
    this.sendUserMessage(text);
  }

  private async sendUserMessage(text: string): Promise<void> {
    this.addUserMessage(text);
    this.isStreaming = true;
    this.sendBtn!.disabled = true;

    const typingEl = this.showTypingIndicator();
    requestAnimationFrame(() => this.scrollElementIntoView(typingEl));
    let streamBubble: AssistantBubble | null = null;
    let fullResponse = '';

    try {
      await sendMessage(
        {
        apiUrl: this.apiUrl,
        onToken: (token) => {
          if (typingEl.parentNode) typingEl.remove();
          if (!streamBubble) {
            streamBubble = this.createStreamingBubble();
          }
          fullResponse += token;
          streamBubble.content.innerHTML = renderMarkdown(fullResponse);
          this.scrollAssistantRowIntoView(streamBubble.row, false);
          this.syncAssistantBubble(streamBubble);
        },
        onDone: () => {
          if (typingEl.parentNode) typingEl.remove();
          if (fullResponse) {
            this.history.addMessage('assistant', fullResponse);
          }
          this.scheduleInactivityFollowUp();
        },
        onAction: (action, data) => {
          if (action === 'show_factory_number_help') {
            this.renderFactoryNumberHelp();
          }
          if (action === 'start_new_request' && typeof data.completedRequestId === 'string') {
            this.history.completeRequest(data.completedRequestId);
          }
          if (action === 'conversation_closed' && typeof data.requestId === 'string') {
            this.history.closeConversation(data.requestId);
            this.followUpPending = false;
            this.cancelInactivityTimers();
          }
        },
        onError: (error) => {
          if (typingEl.parentNode) typingEl.remove();
          // Connection/provider errors are UI state, not assistant turns.
          // Persisting them poisons the next model request after a retry.
          this.appendMessageEl('bot', error, true);
          this.scheduleInactivityFollowUp();
        },
        },
        this.history.getSessionId(),
        this.history.getRequestId(),
        text,
        this.history.getMessages().slice(0, -1),
      );
    } finally {
      if (typingEl.parentNode) typingEl.remove();
      this.isStreaming = false;
      this.sendBtn!.disabled = false;
      this.inputEl!.focus();
    }
  }

  private hasUserMessage(): boolean {
    return this.history.getMessages().some((msg) => msg.role === 'user');
  }

  private cancelInactivityTimers(): void {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
    if (this.unansweredTimer) {
      clearTimeout(this.unansweredTimer);
      this.unansweredTimer = null;
    }
  }

  private scheduleInactivityFollowUp(): void {
    if (
      !this.hasUserMessage()
      || this.abandonedSummarySubmitted
      || this.history.isConversationClosed()
    ) return;

    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
    }

    this.inactivityTimer = setTimeout(() => {
      this.inactivityTimer = null;
      this.showInactivityFollowUp();
    }, this.inactivityMs);
  }

  private showInactivityFollowUp(): void {
    if (
      this.followUpPending
      || this.abandonedSummarySubmitted
      || !this.hasUserMessage()
      || this.history.isConversationClosed()
    ) return;

    this.followUpPending = true;
    this.addBotMessage(INACTIVITY_FOLLOW_UP_MESSAGE);

    this.unansweredTimer = setTimeout(() => {
      this.unansweredTimer = null;
      void this.submitUnansweredChat();
    }, this.unansweredInactivityMs);
  }

  private async submitUnansweredChat(): Promise<void> {
    if (
      !this.followUpPending
      || this.abandonedSummarySubmitted
      || this.history.isConversationClosed()
    ) return;

    const ok = await submitAbandonedChat({
      apiUrl: this.apiUrl,
      sessionId: this.history.getSessionId(),
      history: this.history.getMessages(),
      reason: 'no_answer_after_inactivity_prompt',
    });

    if (ok) {
      this.abandonedSummarySubmitted = true;
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private scrollAssistantRowIntoView(row: HTMLDivElement, smooth = true): void {
    this.scrollElementIntoView(row, 'end', smooth);
  }

  private scrollElementIntoView(element: HTMLElement, align: 'start' | 'end' = 'start', smooth = true): void {
    if (!this.messagesEl) return;
    const offset =
      align === 'end'
        ? Math.max(element.offsetTop + element.offsetHeight - this.messagesEl.clientHeight + 12, 0)
        : Math.max(element.offsetTop - 12, 0);
    this.messagesEl.scrollTo({ top: offset, behavior: smooth ? 'smooth' : 'auto' });
  }

  private disposeAssistantBubble(bubble: AssistantBubble | null): void {
    bubble?.resizeObserver?.disconnect();
  }
}

// Auto-initialize from script tag
function init(): void {
  const script = document.currentScript || document.querySelector('script[data-api-url]');
  if (!script) return;

  const apiUrl = script.getAttribute('data-api-url')?.trim() || window.location.origin;

  const delay = parseInt(script.getAttribute('data-delay') || '3000', 10);
  const inactivityMs = parseInt(script.getAttribute('data-inactivity-ms') || `${TEN_MINUTES_MS}`, 10);
  const unansweredInactivityMs = parseInt(
    script.getAttribute('data-unanswered-inactivity-ms') || `${TEN_MINUTES_MS}`,
    10,
  );
  const greeting = script.getAttribute('data-greeting') || undefined;

  new SarahWidget(apiUrl, { greeting, delay, inactivityMs, unansweredInactivityMs });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export { SarahWidget };
