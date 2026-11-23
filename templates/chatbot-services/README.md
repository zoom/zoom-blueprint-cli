# Zoom Chat Research Assistant (Claude) — Node.js Sample App

A working sample application for building a Zoom Chat bot using Node.js and Express. The bot demonstrates two complete flows: an **AI Research Assistant** powered by the Anthropic Claude API, and an **Employee Appreciation** multi-step form flow.

---

## What This Bot Does

- Responds to messages and button interactions in Zoom Chat
- Routes all responses as **threaded replies** within the originating conversation
- Sends **interactive cards** with buttons and multi-field forms
- Maintains **per-user session state** across a multi-step flow
- Integrates with the **Anthropic Claude API** for AI-generated responses
- Supports both **direct messages** and **channel conversations**

### Services

| Service | Trigger | Description |
|---------|---------|-------------|
| **Research Assistant** | Click button or type `menu` | Ask a question, draft a professional response |
| **Employee Appreciation** | Click button or type `menu` | Multi-step form to recognize a teammate |

### Text Commands

| Command | What it does |
|---------|-------------|
| `menu`, `help`, `start`, `services` | Show the main service menu |
| `cancel`, `stop`, `quit`, `exit` | Stop the current flow |

---

## Before you start

Use Node.js 22.23.5 (verified), npm, and a Zoom account with permission to create or install development apps. Run `zoom login` to authorize CLI Marketplace operations with public PKCE. The app uses its own General App credentials.

Upstash Redis is optional locally. Without it, state resets when the server restarts. Claude research replies are optional locally and use ANTHROPIC_API_KEY and ANTHROPIC_MODEL. Production requires a real Anthropic key and durable storage.

## 1. Create a project

```bash
zoom create --name chat-demo --template chat-ai-assistant
cd apps/chat-demo
npm install
```

The CLI creates .env from .env.example and fills the created app's credentials. Keep this file when resuming setup.

For a local scaffold, add --no-create --yes to the create command and use zoom dev --no-sync. To connect an existing General App later, run zoom app link --app-id YOUR_APP_ID. Add that app's Client ID and Client Secret to .env.

## 2. Configure and start

Set NGROK_AUTHTOKEN in the CLI root .env, then run zoom dev. Alternatively, use an existing public HTTPS endpoint that routes to port 4000.

```bash
zoom dev
# Or, with your existing endpoint
zoom dev --url https://your-dev-host.example
```

The CLI prints direct links to your app's Surface and Access pages when prompting for Bot JID and Secret token. Copy each field from the Development view. The token is masked during entry. Each accepted value is saved immediately. Press Enter to defer a field and rerun zoom configure or zoom dev to resume.

Review and accept the Marketplace URL sync. Keep zoom dev running while testing. Running npm run dev alone starts the server without configuring a tunnel or syncing URLs.

## 3. Authorize and test in Zoom

Open the app-specific Marketplace link printed by the CLI. In Development, open Local Test, complete any listed requirements, and click Add app now.

Open the bot in Zoom Chat and send menu. Confirm that the service menu appears. With ANTHROPIC_API_KEY blank, research displays setup guidance. Set the key and restart to test Claude replies.

## Resume or troubleshoot

- Run zoom doctor to inspect local configuration and available Marketplace checks.
- Restart zoom dev and accept the URL sync when the tunnel hostname changes.
- Use zoom app diff --url https://your-dev-host.example to inspect remote differences.
- These checks do not verify a signed webhook or a bot reply. Confirm those through a real Zoom Chat interaction.
- See [the bundled manifest](0-app-manifest/README.md) for the canonical app configuration.

---

<details>
<summary><strong>How It Works</strong></summary>

### Webhook Event Flow

Every interaction starts with Zoom sending a POST request to `/webhooks`. The webhook handler verifies the request signature, then routes the event by type:

```
Zoom sends webhook → POST /webhooks
  │
  ├── Timestamp checked (±5 min) + signature verified (HMAC-SHA256, constant-time)
  │
  └── Switch on event type:
        bot_notification          → user typed a message (direct message)
        interactive_message_actions → user clicked a button
        chat_message.submit       → user submitted a form
        team_chat.app_invited     → bot added to a channel
        team_chat.app_mention     → bot @mentioned in a channel (intent detection → routes)
        chat_message.replied      → user replied in a channel thread (continues active flows)
        chat_message.sent         → message posted in a channel (continues active flows only)
        bot_installed             → bot installed by a user
        endpoint.url_validation   → Zoom verifying the webhook URL
```

### Threading

All bot responses are sent as **threaded replies** within the conversation where the interaction started. The `replyMainMessageId` from each incoming event is passed through the entire handler chain and set as `reply_to` in the Zoom API request.

For multi-step flows, the thread root is stored in session state at the start of the flow so that later steps (like form submission) can thread correctly even when the event type changes.

### Research Assistant Flow

```
User: "menu"  →  Bot sends service menu card
User clicks "Research Assistant"  →  Bot sends research sub-menu
User clicks "Ask a Question"  →  Bot: "What question would you like to research?"
User types question  →  Claude API streams response  →  Bot sends answer (threaded)
```

Conversation history is maintained per user (last 20 messages) so Claude has context for follow-up questions.

### Employee Appreciation Flow

```
User clicks "Employee Appreciation"
  → Bot: "Who would you like to appreciate? Enter their full name."

User types name
  → Bot: "Enter the employee's email address."

User types email
  → Bot sends multi-field form card (What was done / Why it mattered / Who it helped)

User fills form and clicks Submit
  → chat_message.submit event fires
  → Bot sends confirmation card with colored fields (threaded)
```

> **Note on form field values:** The submitted field values arrive in the `chat_message.submit` event's `submit_items`. See `src/handlers/submit-handler.js`.
</details>



## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `ZOOM_CLIENT_ID` | Yes | OAuth app Client ID |
| `ZOOM_CLIENT_SECRET` | Yes | OAuth app Client Secret |
| `ZOOM_ACCOUNT_ID` | Yes | Zoom Account ID |
| `ZOOM_BOT_JID` | Yes | Bot's Zoom JID (from Chat Subscription) |
| `ZOOM_BOT_NAME` | No | Bot display name (e.g. `Zoom Service Chatbot`). Used to strip the bot's `@mention` from channel messages so user input parses correctly |
| `ZOOM_VERIFICATION_TOKEN` | Yes | Webhook signature verification token |
| `ZOOM_REDIRECT_URI` | Yes | OAuth callback URL (must match Marketplace setting) |
| `WEBVIEW_URL` | No | Public URL of the Zoom App webview for the "Open App" button (default: origin of `ZOOM_REDIRECT_URI` + `/webview`) |
| `ANTHROPIC_API_KEY` | For Claude replies and production | Leave blank to test the Zoom integration locally without AI replies. Add a key and restart to enable them. |
| `ANTHROPIC_MODEL` | No | Claude model to use (default: `claude-sonnet-4-6`) |
| `UPSTASH_REDIS_REST_URL` | For persistent storage | Upstash Redis REST URL (backs state, form drafts, history, token cache) |
| `UPSTASH_REDIS_REST_TOKEN` | For persistent storage | Upstash Redis REST token |
| `NODE_ENV` | No | Set to `production` in deployment — hides internal error details and enables secure cookies |
| `PORT` | No | Server port (default: `4000`) |
| `SESSION_SECRET` | Yes in prod | Session cookie secret. Required when `NODE_ENV=production` (dev falls back to a placeholder) |
| `FRONTEND_ORIGIN` | No | CORS allowed origin (default: `http://localhost:3000`) |


---

## Need Help?

- [Zoom Developer Forum](https://devforum.zoom.us)
- [Zoom Chat API Reference](https://marketplace.zoom.us/docs/zoom-apps/introduction/)
- [Anthropic API Reference](https://docs.anthropic.com)

This sample uses Anthropic for research replies, configured with ANTHROPIC_API_KEY and ANTHROPIC_MODEL. It does not offer an OpenAI implementation.


## Development defaults and production deployment

Without Upstash Redis, the sample uses in-memory storage for conversation state, drafts, history, and cached bot tokens. State disappears on restart and is not shared across instances. Express sessions use MemoryStore; they also disappear on restart and are not suitable for production scaling.

Signed webhooks are acknowledged before asynchronous handlers finish. A process crash can lose accepted work; production needs a durable queue, retries, and idempotency. Missing AI configuration disables Claude replies without blocking local Zoom setup.

Use `.env` for local development only. In deployments, inject credentials, provider keys, webhook secrets, and session secrets from a managed secrets service. Configure durable state/session storage, HTTPS cookies, access controls for application routes, request limits, and content-safe logging before exposing this sample to production traffic.

## Zoom for Government

Create and configure the app in the Government Marketplace and confirm product availability for your account. In the generated project set:

```dotenv
ZOOM_API_BASE_URL=https://api.zoomgov.com/v2
ZOOM_OAUTH_BASE_URL=https://zoomgov.com
```

Use `zoom create --no-create`, configure the Government app manually, and run `zoom dev --no-sync`. These runtime overrides do not enable Government provisioning in the CLI. AI-provider availability and data-handling requirements need separate review; this sample has not been live verified in Government.
