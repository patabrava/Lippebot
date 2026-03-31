# Sarah — Code Map

## Project Structure

```
lippebot/
├── Knowledge_Base_LippeLift.txt    # Knowledge base (existing)
├── docs/
│   └── assets/
│       ├── architecture-diagram.png
│       ├── widget-mockup.png
│       └── code-map.md              # This file
│
├── backend/                         # Node.js + TypeScript + Hono
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example                 # GEMINI_API_KEY, PIPEDRIVE_API_KEY, SMTP config
│   ├── src/
│   │   ├── index.ts                 # Hono server entry point, CORS, routes
│   │   ├── routes/
│   │   │   ├── chat.ts              # POST /api/chat — main conversation endpoint (SSE streaming)
│   │   │   ├── health.ts            # GET /api/health — health check
│   │   │   └── webhook.ts           # POST /api/webhook — optional Pipedrive webhooks
│   │   ├── services/
│   │   │   ├── gemini.ts            # Gemini API client, system prompt, knowledge base injection
│   │   │   ├── conversation.ts      # Conversation state manager, mode detection (berater/anfrage/service)
│   │   │   ├── pipedrive.ts         # Pipedrive API client — create leads, deals, activities
│   │   │   └── email.ts             # Nodemailer — send notifications to LippeLift team
│   │   ├── prompts/
│   │   │   └── system-prompt.ts     # German system prompt with brand tonality, knowledge base, mode instructions
│   │   ├── types/
│   │   │   └── index.ts             # TypeScript types — ChatMessage, Lead, ServiceRequest, ConversationState
│   │   └── config/
│   │       └── index.ts             # Environment config loader
│   └── tests/
│       ├── chat.test.ts             # Conversation flow tests
│       ├── pipedrive.test.ts        # Pipedrive integration tests
│       └── mode-detection.test.ts   # Mode switching logic tests
│
├── widget/                          # Frontend chat widget
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── sarah-widget.ts          # Main entry — creates floating bubble + chat panel
│   │   ├── ui/
│   │   │   ├── bubble.ts            # Floating button component (bottom-right)
│   │   │   ├── chat-panel.ts        # Chat window — header, messages, input
│   │   │   ├── message.ts           # Message bubble rendering (bot/user)
│   │   │   └── quick-actions.ts     # Quick action buttons (Berater, Anfrage, Service)
│   │   ├── api/
│   │   │   └── client.ts            # SSE client — connects to backend, handles streaming
│   │   ├── storage/
│   │   │   └── history.ts           # localStorage manager — save/load chat history (7-day TTL)
│   │   └── styles/
│   │       └── theme.ts             # LippeLift brand colors, typography, CSS-in-JS
│   ├── dist/
│   │   └── sarah-widget.min.js      # Production bundle (single file, ~30KB)
│   └── tests/
│       └── widget.test.ts           # Widget rendering tests
│
└── deploy/
    ├── Dockerfile                   # Backend container
    ├── docker-compose.yml           # Backend + optional reverse proxy
    └── nginx.conf                   # Reverse proxy config (serves widget + proxies API)
```

## Data Flow

```
User types message
  → widget/src/api/client.ts sends POST /api/chat (SSE)
    → backend/src/routes/chat.ts receives message + conversation history
      → backend/src/services/conversation.ts detects mode (berater/anfrage/service)
      → backend/src/services/gemini.ts calls Gemini API with:
          - System prompt (German, brand tonality)
          - Knowledge base content
          - Conversation history
          - Mode-specific instructions
      → Gemini streams response back via SSE
      → If lead/service data collected:
          → backend/src/services/pipedrive.ts creates lead/activity
          → backend/src/services/email.ts sends notification
  → widget/src/ui/chat-panel.ts renders streamed response
  → widget/src/storage/history.ts saves to localStorage
```

## Key Integration Points

| Integration    | File                              | Method                        |
|----------------|-----------------------------------|-------------------------------|
| Gemini API     | backend/src/services/gemini.ts    | @google/generative-ai SDK     |
| Pipedrive      | backend/src/services/pipedrive.ts | REST API (fetch)              |
| Email          | backend/src/services/email.ts     | Nodemailer + SMTP             |
| Webflow        | widget/dist/sarah-widget.min.js   | Script tag in Webflow footer  |

## Brand Colors (from Knowledge Base)

| Color          | Hex      | Usage                        |
|----------------|----------|------------------------------|
| LIPPE Blau     | #006AAB  | Header, primary actions, bubble |
| LIPPE Hellblau | #B7CCE7  | Avatar, accent, borders      |
| Tiefblau       | #1C2740  | Text, Service-Modus header   |
| Warm Orange    | #E58434  | Send button, CTA accents     |
| Soft Apricot   | #FFD9A0  | Highlights                   |
| Light Cream    | #FFF2E2  | Chat background              |
