export const COLORS = {
  lippeBlau: '#006AAB',
  lippeHellblau: '#B7CCE7',
  tiefblau: '#1C2740',
  warmOrange: '#E58434',
  softApricot: '#FFD9A0',
  lightCream: '#FFF2E2',
  white: '#FFFFFF',
} as const;

export const DIMENSIONS = {
  bubble: 62,
  panelWidth: 360,
  panelHeight: 480,
  avatarHeader: 40,
  avatarMessage: 28,
  sendButton: 36,
  inputRadius: 24,
} as const;

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Instrument+Sans:wght@400;500;600&display=swap');

.sarah-widget {
  font-family: 'Instrument Sans', sans-serif;
  position: fixed;
  bottom: 0;
  right: 0;
  z-index: 99999;
}

/* Bubble */
.sarah-bubble {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: ${DIMENSIONS.bubble}px;
  height: ${DIMENSIONS.bubble}px;
  border-radius: 50%;
  background: ${COLORS.lippeBlau};
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(0, 106, 171, 0.35);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  z-index: 100000;
}
.sarah-bubble:hover {
  transform: scale(1.08);
  box-shadow: 0 6px 20px rgba(0, 106, 171, 0.45);
}
.sarah-bubble svg {
  width: 28px;
  height: 28px;
  fill: none;
  stroke: ${COLORS.white};
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* Greeting tooltip */
.sarah-greeting {
  position: fixed;
  bottom: 96px;
  right: 24px;
  background: ${COLORS.white};
  color: ${COLORS.tiefblau};
  padding: 12px 18px;
  border-radius: 16px 16px 4px 16px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  font-size: 14px;
  max-width: 260px;
  cursor: pointer;
  animation: sarahFadeIn 0.4s ease;
  z-index: 100000;
}

/* Panel */
.sarah-panel {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: ${DIMENSIONS.panelWidth}px;
  height: ${DIMENSIONS.panelHeight}px;
  background: ${COLORS.lightCream};
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
  flex-direction: column;
  overflow: hidden;
  animation: sarahSlideUp 0.3s ease;
  z-index: 100000;
}

/* Header */
.sarah-header {
  background: ${COLORS.lippeBlau};
  display: flex;
  align-items: center;
  padding: 14px 16px;
  gap: 10px;
}

.sarah-avatar {
  width: ${DIMENSIONS.avatarHeader}px;
  height: ${DIMENSIONS.avatarHeader}px;
  border-radius: 50%;
  background: ${COLORS.lippeHellblau};
  color: ${COLORS.lippeBlau};
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  font-size: 16px;
  flex-shrink: 0;
}

.sarah-header-text {
  flex: 1;
}
.sarah-header-text h3 {
  margin: 0;
  color: ${COLORS.white};
  font-family: 'Outfit', sans-serif;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.2;
}
.sarah-header-text span {
  color: ${COLORS.lippeHellblau};
  font-size: 12px;
}

.sarah-close {
  color: ${COLORS.white};
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  margin-left: auto;
  padding: 4px 8px;
  opacity: 0.8;
  transition: opacity 0.2s;
}
.sarah-close:hover {
  opacity: 1;
}

/* Messages area */
.sarah-messages {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
  background: ${COLORS.lightCream};
}

/* Message row */
.sarah-msg {
  display: flex;
  flex-direction: row;
  gap: 8px;
  margin-bottom: 16px;
  align-items: flex-end;
}
.sarah-msg.user {
  justify-content: flex-end;
}

.sarah-msg-avatar {
  width: ${DIMENSIONS.avatarMessage}px;
  height: ${DIMENSIONS.avatarMessage}px;
  border-radius: 50%;
  background: ${COLORS.lippeHellblau};
  color: ${COLORS.lippeBlau};
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Outfit', sans-serif;
  font-weight: 700;
  font-size: 12px;
  flex-shrink: 0;
}

/* Bubbles */
.sarah-msg.bot .sarah-msg-bubble {
  background: ${COLORS.white};
  color: ${COLORS.tiefblau};
  border-radius: 4px 14px 14px 14px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}
.sarah-msg.bot .sarah-msg-bubble--assistant {
  position: relative;
  padding-bottom: 30px;
}
.sarah-msg.user .sarah-msg-bubble {
  background: ${COLORS.lippeBlau};
  color: ${COLORS.white};
  border-radius: 14px 4px 14px 14px;
}
.sarah-msg-bubble {
  padding: 10px 14px;
  font-size: 13.5px;
  line-height: 1.5;
  max-width: 240px;
  word-wrap: break-word;
}

.sarah-msg-content {
  max-height: 170px;
  overflow-y: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
  padding-right: 2px;
}
.sarah-msg-content::-webkit-scrollbar {
  display: none;
}
.sarah-msg-content p {
  margin: 0;
}
.sarah-msg-content p + p,
.sarah-msg-content ul + p,
.sarah-msg-content ol + p,
.sarah-msg-content p + ul,
.sarah-msg-content p + ol,
.sarah-msg-content ul + ul,
.sarah-msg-content ol + ol,
.sarah-msg-content .sarah-md-heading + p,
.sarah-msg-content .sarah-md-heading + ul,
.sarah-msg-content .sarah-md-heading + ol {
  margin-top: 0.6em;
}
.sarah-msg-content ul,
.sarah-msg-content ol {
  margin: 0;
  padding-left: 1.2em;
}
.sarah-msg-content li + li {
  margin-top: 0.25em;
}
.sarah-msg-content strong {
  font-weight: 700;
}
.sarah-msg-content em {
  font-style: italic;
}
.sarah-msg-content code {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
  font-size: 0.92em;
  background: rgba(28, 39, 64, 0.08);
  padding: 0.1em 0.35em;
  border-radius: 4px;
}
.sarah-msg-content a {
  color: ${COLORS.lippeBlau};
  text-decoration: underline;
  text-underline-offset: 2px;
}
.sarah-msg.user .sarah-msg-bubble a {
  color: ${COLORS.white};
}
.sarah-msg-content .sarah-md-heading {
  font-family: 'Outfit', sans-serif;
  font-weight: 600;
  line-height: 1.25;
}
.sarah-msg-content .sarah-md-heading-1 {
  font-size: 1.12em;
}
.sarah-msg-content .sarah-md-heading-2 {
  font-size: 1.05em;
}
.sarah-msg-content .sarah-md-heading-3 {
  font-size: 1em;
}

.sarah-msg-continue {
  position: absolute;
  left: 50%;
  bottom: 6px;
  transform: translateX(-50%);
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 999px;
  background: rgba(0, 106, 171, 0.9);
  color: ${COLORS.white};
  display: none;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  font-size: 16px;
  line-height: 1;
}
.sarah-msg-continue:hover {
  background: ${COLORS.lippeBlau};
}

/* Quick actions */
.sarah-quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-left: 36px;
  margin-bottom: 16px;
}

.sarah-quick-btn {
  background: ${COLORS.white};
  border: 1.5px solid ${COLORS.lippeHellblau};
  border-radius: 999px;
  color: ${COLORS.lippeBlau};
  font-size: 12.5px;
  padding: 6px 14px;
  cursor: pointer;
  font-family: 'Instrument Sans', sans-serif;
  transition: background 0.2s, border-color 0.2s;
}
.sarah-quick-btn:hover {
  background: ${COLORS.lightCream};
  border-color: ${COLORS.lippeBlau};
}

/* Input area */
.sarah-input-area {
  padding: 12px 16px;
  border-top: 1px solid ${COLORS.lippeHellblau};
  display: flex;
  align-items: center;
  gap: 8px;
  background: ${COLORS.white};
}

.sarah-input {
  flex: 1;
  border: 1.5px solid ${COLORS.lippeHellblau};
  border-radius: ${DIMENSIONS.inputRadius}px;
  padding: 8px 16px;
  font-size: 13px;
  font-family: 'Instrument Sans', sans-serif;
  outline: none;
  transition: border-color 0.2s;
}
.sarah-input:focus {
  border-color: ${COLORS.lippeBlau};
}
.sarah-input::placeholder {
  color: #999;
}

.sarah-send {
  width: ${DIMENSIONS.sendButton}px;
  height: ${DIMENSIONS.sendButton}px;
  border-radius: 50%;
  background: ${COLORS.warmOrange};
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s, opacity 0.2s;
  flex-shrink: 0;
}
.sarah-send:hover {
  background: #d0742a;
}
.sarah-send:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.sarah-send svg {
  width: 18px;
  height: 18px;
  fill: ${COLORS.white};
}

/* Typing indicator */
.sarah-typing {
  display: flex;
  gap: 4px;
  padding: 10px 14px;
  align-items: center;
}
.sarah-typing span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${COLORS.lippeHellblau};
  animation: sarahBounce 1.4s infinite ease-in-out both;
}
.sarah-typing span:nth-child(1) { animation-delay: 0s; }
.sarah-typing span:nth-child(2) { animation-delay: 0.16s; }
.sarah-typing span:nth-child(3) { animation-delay: 0.32s; }

/* Animations */
@keyframes sarahFadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes sarahSlideUp {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes sarahBounce {
  0%, 80%, 100% { transform: scale(0); }
  40% { transform: scale(1); }
}
`;

let injected = false;

export function injectStyles(): void {
  if (injected) return;
  injected = true;

  const style = document.createElement('style');
  style.setAttribute('data-sarah-widget', '');
  style.textContent = CSS;
  document.head.appendChild(style);
}
