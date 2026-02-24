# 🦀 Gravity Claw

**Personal AI agent that lives in Telegram.** Built from scratch with a security-first, fully-understood architecture — no black boxes.

Gravity Claw is your smart AI assistant powered by Gemini 3.1 Pro. It can manage your calendar, draft emails, search the web, control your browser, and even operate your desktop — all through simple Telegram messages, with explicit approval for every sensitive action.

---

## ✨ Features

### 💬 Conversational AI
- Powered by **Gemini 3.1 Pro** with agentic tool loop (up to 10 iterations)
- Responds in your language (Turkish/English auto-detect)
- Personality-driven via editable Soul file

### 🧠 Long-Term Memory
- **Core Memory** — stable user preferences, loaded at startup
- **Vector Store** — SQLite with Gemini embeddings for semantic search
- Auto-recall: relevant memories retrieved per message (top-3)
- Memory commands: `/remember`, `/recall`

### 🖥️ Browser & Desktop Control (v0.3)
Control your Chrome browser and Windows desktop via Telegram:

| Tool | Action | Approval |
|------|--------|----------|
| `browser_open` | Navigate to URL | One-time per domain |
| `browser_screenshot` | Capture page | Auto |
| `browser_click` | Click elements | Required |
| `browser_type` | Type into fields | Required |
| `browser_read` | Read page content | Auto |
| `browser_scroll` | Scroll page | Auto |
| `desktop_screenshot` | Capture screen | Auto |
| `desktop_click` | Click coordinates | Required |
| `desktop_type` | Type text | Required |
| `desktop_hotkey` | Keyboard shortcuts | Required |
| `desktop_app_focus` | Focus window | Required |
| `desktop_install` | Install via winget | Double approval |

### 🔌 MCP Integrations
- **Google Calendar** — read/write events, free time search
- **Gmail** — search, read, draft, send (with approval)
- **Google Drive** — search and download files
- **Notion** — search, read, create, update pages

### 🎤 Voice I/O
- **Voice Input** — send voice message → transcribed via Gemini → AI responds
- **Voice Output** — say "sesli yanıtla" to get a spoken response (Google Cloud TTS)

### 📸 Vision
- Send a photo → Gemini Vision analyzes and describes it
- Send a document (PDF, CSV, JSON, etc.) → content analysis

### 🔍 Web Search
- Real-time web search for news, weather, prices, etc.

### 🖥️ PC Control
- Execute commands, open files/apps, list directories
- Security: blocked patterns, danger classification, audit logging

---

## 🏗️ Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Telegram       │────▶│   VPS (Bot)       │────▶│   PC Bridge      │
│   (User)         │◀────│   Gemini 3.1 Pro  │◀────│   (Your PC)      │
└─────────────────┘     │   + MCP Tools     │     │   Chrome CDP     │
                        │   + Memory        │     │   PowerShell     │
                        └──────────────────┘     └──────────────────┘
                              │                         │
                              ▼                         ▼
                        SSH Reverse Tunnel ──────── localhost:3847
```

---

## 🚀 Quick Start

### 1. Bot Setup (VPS)

```bash
git clone https://github.com/berkanaskin/gravity-claw.git
cd gravity-claw
npm install
cp .env.example .env   # edit with your keys
npm run dev
```

### 2. PC Bridge Setup (Your PC)

```bash
cd pc-bridge
npm install
npx playwright install chromium
cp .env.example .env
npx tsc
```

Start Chrome with CDP:
```bash
chrome.exe --remote-debugging-port=9222
```

Start the bridge:
```bash
node dist/server.js
```

### 3. Connect VPS ↔ PC (SSH Tunnel)

```bash
# From your PC:
gcloud compute ssh YOUR_VM -- -R 3847:localhost:3847 -N
```

---

## 🔑 Environment Variables

### Bot (.env)

| Key | Source | Required |
|-----|--------|----------|
| `TELEGRAM_BOT_TOKEN` | [@BotFather](https://t.me/BotFather) | ✅ |
| `MODEL_API_KEY` | [AI Studio](https://aistudio.google.com) | ✅ |
| `TELEGRAM_ALLOWLIST_USER_ID` | [@userinfobot](https://t.me/userinfobot) | ✅ |
| `ENABLE_PC_BRIDGE` | `true` to enable browser/desktop tools | Optional |
| `PC_BRIDGE_URL` | WebSocket URL (default: `ws://localhost:3847/ws`) | Optional |
| `PC_BRIDGE_TOKEN` | Shared auth token | Optional |
| `TTS_API_KEY` | Google Cloud TTS | Optional |

### PC Bridge (.env)

| Key | Default | Description |
|-----|---------|-------------|
| `CDP_PORT` | `9222` | Chrome DevTools Protocol port |
| `BRIDGE_PORT` | `3847` | WebSocket server port |
| `BRIDGE_AUTH_TOKEN` | `gravity-claw-bridge-2026` | Auth token |

---

## 🔒 Security

- ✅ No web server on bot — long-polling only
- ✅ User ID whitelist — only you can talk to your bot
- ✅ All sensitive actions require explicit Telegram approval
- ✅ Site approval memory — approved once, remembered forever
- ✅ Double approval for destructive operations (install, delete)
- ✅ Audit logging — every browser/desktop action is logged
- ✅ Secrets never logged or committed
- ✅ Agent loop capped at 10 iterations
- ✅ Anti-hallucination rules — never fabricates tool results

---

## 📁 Project Structure

```
gravity-claw/
├── src/
│   ├── index.ts              # Entry point
│   ├── config.ts             # Environment config
│   ├── bot.ts                # Telegram bot setup
│   ├── agent.ts              # Gemini agent loop + system prompt
│   ├── scheduler.ts          # Proactive checks (cron)
│   ├── approval.ts           # User approval flow
│   ├── handlers/
│   │   ├── text-handler.ts   # Text message handler
│   │   ├── voice-handler.ts  # Voice transcription
│   │   └── media-handler.ts  # Photo/document analysis
│   ├── memory/
│   │   ├── index.ts          # Memory system coordinator
│   │   ├── core-memory.ts    # Stable preferences
│   │   ├── vector-store.ts   # SQLite + embeddings
│   │   ├── embedder.ts       # Gemini embedding API
│   │   └── log.ts            # Memory audit trail
│   ├── tools/
│   │   ├── index.ts          # Tool registry
│   │   ├── browser-control.ts # Chrome browser tools
│   │   ├── desktop-control.ts # Desktop automation tools
│   │   ├── site-memory.ts    # Approved site persistence
│   │   ├── pc-control.ts     # Local PC commands
│   │   ├── web-search.ts     # Web search
│   │   ├── remember.ts       # Store memories
│   │   ├── recall.ts         # Search memories
│   │   └── get-current-time.ts
│   ├── transcription/        # Voice-to-text
│   └── tts/                  # Text-to-speech
├── pc-bridge/
│   ├── server.ts             # WebSocket command server
│   ├── browser.ts            # Playwright Chrome control
│   ├── desktop.ts            # PowerShell desktop control
│   ├── start-bridge.bat      # Auto-start script
│   └── start-tunnel.bat      # SSH tunnel auto-reconnect
├── memory/
│   ├── soul.md               # Communication style guide
│   └── core_memory.md        # User preferences (gitignored)
└── .env.example
```

---

## 📜 License

MIT

---

Built with ❤️ by [berkanaskin](https://github.com/berkanaskin)
