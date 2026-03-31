import { injectStyles } from './styles/theme.js';
import { ChatHistory } from './storage/history.js';
import { sendMessage } from './api/client.js';
import { renderMarkdown } from './utils/markdown.js';

const CHAT_ICON = `<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;
const CLOSE_ICON = '\u2715';
const SEND_ICON = `<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`;

const GREETING = 'Hallo! Ich bin Sarah. Kann ich Ihnen helfen?';
const OPENING_MESSAGE = 'Hallo! Ich bin Sarah, Ihre persönliche Beraterin bei LIPPE Lift. \u{1F60A} Wie kann ich Ihnen heute helfen?';

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

  constructor(apiUrl: string, options: { greeting?: string; delay?: number } = {}) {
    this.apiUrl = apiUrl;
    this.history = new ChatHistory();
    this.greetingDelay = options.delay || 3000;

    this.container = document.createElement('div');
    this.container.className = 'sarah-widget';
    document.body.appendChild(this.container);

    injectStyles();
    this.renderBubble();
    this.renderPanel();

    if (this.history.getMessages().length === 0) {
      setTimeout(() => this.showGreeting(), this.greetingDelay);
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
    this.greetingEl.textContent = `\u{1F44B} ${GREETING}`;
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
        this.addBotMessage(OPENING_MESSAGE);
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
        },
        onAction: () => {},
        onError: (error) => {
          if (typingEl.parentNode) typingEl.remove();
          this.addBotMessage(error);
        },
      },
      this.history.getSessionId(),
      text,
      this.history.getMessages().slice(0, -1),
    );

    this.isStreaming = false;
    this.sendBtn!.disabled = false;
    this.inputEl!.focus();
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
  const greeting = script.getAttribute('data-greeting') || undefined;

  new SarahWidget(apiUrl, { greeting, delay });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export { SarahWidget };
