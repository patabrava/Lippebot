# Sarah — LippeLift Chatbot Design Spec

**Date:** 2026-03-31
**Status:** Draft
**Assets:** `docs/assets/architecture-diagram.png`, `docs/assets/widget-mockup.png`, `docs/assets/code-map.md`

---

## 1. Overview

Sarah is a German-speaking AI chatbot for LIPPE Lift GmbH, embedded as a floating widget on their Webflow website (lippelift.de). Sarah serves as a product advisor, lead capture tool, and service request router — all powered by the Gemini API and the company's knowledge base.

**Name:** Sarah
**Language:** German (all UI, prompts, and responses)
**Brand tonality:** Warm, trustworthy, non-pushy. "Verständlich, menschlich, mitfühlend." Never gives prices. Never diagnoses technical issues. Always hands off to a human for next steps.

---

## 2. Three Modes

Sarah operates in three modes, detected automatically from conversation context:

### 2.1 Berater-Modus (Advisor)
- Answers product questions about the 4 active lift models (T80 Plattform/VARIO PLUS, STL300/LEVEL, T80 Sitzlift/VARIO ONE, ST70/VIA)
- Explains subsidies (Pflegekassen-Zuschuss up to 4.000 EUR, KfW Programm 455)
- Describes the installation process (6 steps from consultation to maintenance)
- Recommends lift types based on the user's situation (stair type, mobility level, indoor/outdoor)
- Source: Knowledge Base (`Knowledge_Base_LippeLift.txt`)
- Does NOT communicate prices or make direct competitor comparisons

### 2.2 Anfrage-Modus (Lead Capture)
- Conversationally gathers the same data as the existing 5-step form:
  - Stair location: Innentreppe / Außentreppe
  - Stair type: Gerade / Kurvig
  - Building type: Einfamilienhaus / Mehrfamilienhaus
  - Lift type: Sitzlift / Rollstuhlgeeignet
  - Contact: Vorname, Nachname, Telefon, PLZ, Stadt, Erreichbarkeit
  - Optional: Straße, E-Mail, Nachricht, Newsletter opt-in
- Questions are woven naturally into conversation, not presented as a rigid wizard
- On completion: creates a lead in Pipedrive with all collected data
- Confirmation message: warmly tells the user a consultant will reach out within half a day

### 2.3 Service-Modus (Support Routing)
- For existing customers with maintenance, warranty, or operational questions
- Captures: customer name, contact info, description of the issue
- Does NOT diagnose or troubleshoot — only captures and routes
- On completion: creates a Pipedrive activity AND sends an email notification to the LippeLift service team
- Confirmation: reassures the user that someone will follow up promptly

### Mode Detection
Mode detection is handled entirely by the Gemini model via the system prompt. The backend does not parse messages for mode — it trusts the model's structured output. The system prompt instructs Gemini to:
- Detect mode from user intent and return it in the `done` SSE event
- Questions about products, subsidies, process → Berater
- User wants to request a consultation or quote → Anfrage
- User mentions an existing lift, problem, maintenance → Service
- Mode can shift mid-conversation (e.g., advisor → lead capture when user says "Das klingt gut, wie kann ich einen Termin vereinbaren?")
- Extract structured data (lead fields, service details) from the conversation and return it in the `done` event's `collectedData` field

---

## 3. Architecture

See `docs/assets/architecture-diagram.png` for the visual diagram.

### 3.1 Widget (Frontend)
- **Technology:** TypeScript, bundled to a single JS file (~30KB)
- **Embedding:** `<script>` tag in Webflow Project Settings > Custom Code > Footer
- **UI:** Floating bubble (bottom-right), expands to chat panel
- **Styling:** LippeLift brand colors (see section 7)
- **Streaming:** SSE (Server-Sent Events) for real-time response streaming
- **Persistence:** localStorage with 7-day TTL for chat history
- **Quick actions:** Three buttons on first message — "Welcher Lift passt zu mir?", "Förderung & Zuschüsse", "Service & Wartung"
- **Proactive greeting:** Tooltip appears after a delay — "Hallo! Ich bin Sarah. Kann ich Ihnen helfen?"

### 3.2 Backend API
- **Technology:** Node.js + TypeScript + Hono
- **Hosting:** User's VPS
- **Endpoints:**
  - `POST /api/chat` — Main conversation endpoint (SSE streaming)
  - `GET /api/health` — Health check
- **Services:**
  - `gemini.ts` — Gemini API client with system prompt and knowledge base injection
  - `conversation.ts` — Conversation state and mode detection
  - `pipedrive.ts` — Pipedrive REST API client (create leads, deals, activities)
  - `email.ts` — Nodemailer for notifications
- **Deployment:** Docker container with nginx reverse proxy

### 3.3 Gemini API
- **SDK:** `@google/generative-ai`
- **System prompt:** German-language prompt including:
  - Sarah's personality and brand tonality
  - Complete knowledge base content
  - Mode detection instructions
  - Data collection guidelines (what to ask, when)
  - Boundaries (no prices, no diagnostics, always hand off)
- **Streaming:** Enabled for real-time token delivery

### 3.4 Pipedrive Integration
- **API:** REST API with API key authentication
- **Status:** API key pending — implementation uses placeholder config
- **Lead creation (Anfrage-Modus):**
  - Person: firstName, lastName, phone, email
  - Deal: stairLocation, stairType, buildingType, liftType, availability, message
  - Pipeline/stage: configurable via environment variable
- **Activity creation (Service-Modus):**
  - Type: service request
  - Subject: issue summary
  - Note: full issue description from conversation
  - Associated person: customer name + contact

### 3.5 Email Notifications
- **Technology:** Nodemailer with SMTP
- **Triggers:**
  - New lead captured → email to sales team
  - Service request submitted → email to service team
- **Content:** Summary of collected data, conversation highlights

---

## 4. Conversation Design

### 4.1 Opening
```
Sarah: Hallo! Ich bin Sarah, Ihre persönliche Beraterin bei LIPPE Lift. 😊
       Wie kann ich Ihnen heute helfen?

       [Welcher Lift passt zu mir?] [Förderung & Zuschüsse] [Service & Wartung]
```

### 4.2 Advisor Flow (Example)
```
User: Welcher Lift passt zu mir?
Sarah: Gerne helfe ich Ihnen dabei! Zunächst eine kurze Frage:
       Befindet sich die Treppe im Innenbereich oder Außenbereich?
User: Innen, die Treppe ist kurvig
Sarah: Verstanden — eine kurvige Innentreppe. Und sitzt die betroffene Person
       im Rollstuhl oder kann sie noch gehen, hat aber Schwierigkeiten mit
       Treppen?
User: Sie kann noch gehen aber es wird immer schwieriger
Sarah: In diesem Fall empfehle ich den VARIO ONE (T80 Sitzlift). Er ist speziell
       für Personen gedacht, die noch laufen können, aber Treppen nicht mehr
       sicher bewältigen. [details from knowledge base]...
       Möchten Sie eine kostenlose Erstberatung vereinbaren?
```

### 4.3 Lead Capture Transition
When the user expresses interest in a consultation, Sarah naturally transitions to collecting contact data without feeling like a form.

### 4.4 Service Flow (Example)
```
User: Mein Treppenlift macht ein komisches Geräusch
Sarah: Das tut mir leid zu hören. Damit wir Ihnen schnell helfen können,
       brauche ich ein paar Informationen. Können Sie das Geräusch näher
       beschreiben? Wann tritt es auf?
User: Beim Hochfahren, ein Klacken
Sarah: Danke für die Beschreibung. Darf ich Ihren Namen und eine
       Telefonnummer haben, damit unser Service-Team sich bei Ihnen
       melden kann?
```

### 4.5 Boundaries
Sarah must NEVER:
- Give or estimate prices
- Compare directly with competitors (Hiro, Liftstar, Lifta, TKE)
- Mention discontinued products (LL12, Konstanz)
- Diagnose or troubleshoot technical issues
- Make promises about timelines or availability
- Be pushy or salesy

Sarah must ALWAYS:
- Respond in German
- Be warm, empathetic, and solution-oriented
- Hand off to a human for anything beyond information and data collection
- Mention that the Erstberatung is free and non-binding ("kostenlos & unverbindlich")

---

## 5. Data Model

### ChatMessage
```typescript
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}
```

### ConversationState
```typescript
interface ConversationState {
  sessionId: string;
  mode: 'berater' | 'anfrage' | 'service' | 'undetermined';
  messages: ChatMessage[];
  collectedData: Partial<LeadData & ServiceData>;
}
```

### LeadData (Anfrage-Modus)
```typescript
interface LeadData {
  stairLocation: 'innen' | 'aussen';
  stairType: 'gerade' | 'kurvig';
  buildingType: 'einfamilienhaus' | 'mehrfamilienhaus';
  liftType: 'sitzlift' | 'rollstuhlgeeignet';
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  street?: string;
  postalCode: string;
  city: string;
  availability: '08:00 - 12:00' | '12:00 - 16:00' | '16:00 - 20:00';
  message?: string;
  newsletter: 'Ja' | 'Nein';
}
```

### ServiceData (Service-Modus)
```typescript
interface ServiceData {
  customerName: string;
  phone: string;
  email?: string;
  issueDescription: string;
  liftModel?: string;
}
```

---

## 6. API Specification

### POST /api/chat
**Request:**
```json
{
  "sessionId": "uuid-v4",
  "message": "Welcher Lift passt zu mir?",
  "history": [
    { "role": "assistant", "content": "Hallo! Ich bin Sarah...", "timestamp": 1711843200 }
  ]
}
```

**Response:** SSE stream
```
data: {"type":"token","content":"Gerne"}
data: {"type":"token","content":" helfe"}
data: {"type":"token","content":" ich"}
...
data: {"type":"done","mode":"berater","collectedData":{}}
data: {"type":"action","action":"create_lead","data":{...}}
```

The `done` event includes the detected mode and any data collected during this exchange. The `action` event fires when a Pipedrive action was taken.

### GET /api/health
**Response:**
```json
{ "status": "ok", "version": "1.0.0" }
```

---

## 7. Visual Design

See `docs/assets/widget-mockup.png` for the mockup.

### Brand Colors
| Color          | Hex      | Usage                            |
|----------------|----------|----------------------------------|
| LIPPE Blau     | #006AAB  | Header, bubble, primary actions  |
| LIPPE Hellblau | #B7CCE7  | Avatar, borders, accent          |
| Tiefblau       | #1C2740  | Text color                       |
| Warm Orange    | #E58434  | Send button, CTA highlights      |
| Soft Apricot   | #FFD9A0  | Hover states, highlights         |
| Light Cream    | #FFF2E2  | Chat background                  |

### Typography
- Headers: Outfit (matches website)
- Body: Instrument Sans (matches website)
- Fallback: system-ui, sans-serif

### Widget Dimensions
- Bubble: 62px diameter
- Chat panel: 360px wide x 480px tall
- Border radius: 16px (panel), 50% (bubble)
- Shadow: 0 8px 32px rgba(0,0,0,0.15)

### Elements
- **Bubble:** LIPPE Blau background, white chat icon, pulsing shadow on first visit
- **Greeting tooltip:** White card above bubble, appears after 3-second delay on first visit
- **Header:** LIPPE Blau with Sarah avatar (letter "S" in Hellblau circle), name, subtitle "LIPPE Lift Assistentin"
- **Messages (bot):** White bubbles on Light Cream background, left-aligned with avatar
- **Messages (user):** LIPPE Blau bubbles, right-aligned
- **Quick actions:** Pill-shaped buttons with Hellblau border, LIPPE Blau text
- **Input:** Rounded input field with Hellblau border, Warm Orange send button
- **Close button:** White "X" in header

---

## 8. Webflow Integration Instructions

### Step-by-step integration:

1. **Build and deploy the backend** to your VPS (see deployment section)
2. **Build the widget** — produces `sarah-widget.min.js`
3. **Upload the widget JS** to your VPS or a CDN, note the URL (e.g., `https://api.lippelift.de/widget/sarah-widget.min.js`)
4. **In Webflow:**
   - Go to **Project Settings** (gear icon in the left panel)
   - Click **Custom Code** tab
   - In the **Footer Code** section, paste:
   ```html
   <script
     src="https://api.lippelift.de/widget/sarah-widget.min.js"
     data-api-url="https://api.lippelift.de"
     defer>
   </script>
   ```
   - Click **Save Changes**
   - **Publish** the site
5. Sarah will now appear as a floating bubble on every page

### Configuration via data attributes:
| Attribute       | Default                    | Description                    |
|-----------------|----------------------------|--------------------------------|
| `data-api-url`  | (required)                 | Backend API URL                |
| `data-position` | `bottom-right`             | Widget position                |
| `data-greeting` | `Hallo! Ich bin Sarah...`  | Custom greeting text           |
| `data-delay`    | `3000`                     | Greeting tooltip delay (ms)    |
| `data-color`    | `#006AAB`                  | Primary color override         |

### Removing the widget:
Delete the script tag from Webflow Custom Code and republish.

---

## 9. Project Structure

See `docs/assets/code-map.md` for the full file tree, data flow diagram, and integration point reference.

---

## 10. Environment Configuration

```env
# Gemini
GEMINI_API_KEY=your-gemini-api-key

# Pipedrive (pending)
PIPEDRIVE_API_KEY=your-pipedrive-api-key
PIPEDRIVE_PIPELINE_ID=1
PIPEDRIVE_STAGE_ID=1

# Email
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=sarah@lippelift.de
SMTP_PASS=your-smtp-password
NOTIFICATION_EMAIL_TO=info@lippelift.de
SERVICE_EMAIL_TO=service@lippelift.de

# Server
PORT=3000
CORS_ORIGIN=https://www.lippelift.de
NODE_ENV=production
```

---

## 11. Deployment

### Docker Compose
The backend runs as a Docker container behind nginx on the VPS:
- **nginx** reverse proxy: handles TLS, serves widget static file, proxies `/api/*` to the Node.js container
- **Node.js container:** runs the Hono server on port 3000

### CORS
Only allows requests from `https://www.lippelift.de` in production.

### Health monitoring
`GET /api/health` returns server status. Can be monitored via uptime checks.

---

## 12. Non-Functional Requirements

- **Response time:** First token within 1-2 seconds
- **Availability:** Widget should degrade gracefully if backend is down (show "Sarah ist gerade nicht erreichbar" message)
- **Security:** API key stored in environment variables, CORS restricted, no PII logged to stdout
- **Privacy:** No conversation content stored on the backend beyond the current session. localStorage is client-side only. Only collected lead/service data is sent to Pipedrive.
- **Bundle size:** Widget JS target < 30KB gzipped
- **Browser support:** Modern browsers (Chrome, Firefox, Safari, Edge — last 2 versions)
