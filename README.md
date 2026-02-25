# 🧠 CENTO — Personal AI Orchestrator

> *Formerly Gravity Claw — now an intelligent multi-model AI orchestrator.*

**CENTO** is a personal AI orchestrator that runs as a Telegram bot. It coordinates multiple AI models (Gemini, GPT-5.2, Claude), controls your browser and desktop remotely, and integrates with Google Workspace and Notion — all through simple Telegram messages.

---

## ✨ What Makes CENTO Different

- **Multi-Model Orchestration** — Routes tasks to the optimal AI model (Gemini for speed, GPT-5.2 for accuracy, Claude for code quality)
- **Remote PC Control** — Control Chrome, scrape websites, and automate your desktop from anywhere via Telegram
- **Anti-Bot Web Scraping** — Scrapling integration bypasses Cloudflare, Akamai, and other protections
- **Free Claude Access** — Delegates complex coding tasks to Claude Opus/Sonnet through Antigravity IDE automation
- **3-Tier Security** — Auto-approve safe ops, single approval for actions, double approval for destructive operations
- **Zero Fabrication** — Agent never invents tool results; always uses actual API responses

---

## 🧩 Features

### 🤖 AI Orchestration (CENTO Core)
- **GPT-5.2** Cascading Protocol — task decomposition → execution → validation
- **5 Agent Roles:** orchestrator, coder, reviewer, researcher, scraper
- **Ralph Loop** — 10-minute health monitor for stuck tasks
- **Model Routing:** Gemini (fast) → GPT-5.2 (accurate) → Claude (code quality)

### 🌐 Browser & Desktop Control
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

### 🕷️ Web Scraping (Scrapling + Playwright)
| Tool | Action | Anti-Bot |
|------|--------|----------|
| `web_scrape` | Read any web page content | ✅ Scrapling |
| `web_extract` | Extract structured data with CSS selectors | ✅ Scrapling |

- **Scrapling** handles Cloudflare, Akamai, and other anti-bot protections
- **Playwright fallback** for simple pages or if Scrapling isn't installed
- Prerequisite: `pip install scrapling` on the local PC

### 🚀 Antigravity IDE Automation
| Tool | Action |
|------|--------|
| `antigravity_prompt` | Send coding tasks to Claude Opus/Sonnet |
| `antigravity_state` | Check IDE connection status |

- Automates the Antigravity IDE via **Chrome DevTools Protocol**
- Sends prompts → polls for Claude's response → returns result
- **Free** — uses dedicated Antigravity subscription, no API costs

### 🔌 MCP Integrations
- **Google Calendar** — read/write events, free time search
- **Gmail** — search, read, draft, send (with approval)
- **Google Drive** — search and download files
- **Notion** — database CRUD, page management, block operations

### 📸 Media & Vision
- Send photos → Gemini Vision analyzes and describes
- Documents (PDF, CSV, JSON) → content analysis
- Send images via Telegram (URL, file, base64)

### 🎤 Voice I/O
- Voice input → transcribed via Gemini → AI responds
- Voice output → "sesli yanıtla" for spoken response (Google Cloud TTS)

### 🧠 Long-Term Memory
- **Core Memory** — stable user preferences
- **Vector Store** — SQLite + Gemini embeddings for semantic search
- Auto-recall: relevant memories retrieved per message

### ⏰ Automated Scheduling
| Schedule | Task |
|----------|------|
| 08:00 daily | ☀️ Morning Briefing |
| Hourly (07-23) | 🔔 Calendar Reminders |
| 21:00 daily | 📊 Daily Summary |
| Every 10 min | 🔄 Ralph Loop (health check) |

---

## 🏗️ Architecture

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────────┐
│   Telegram       │────▶│   VPS (CENTO Bot)     │────▶│   PC Bridge          │
│   (User)         │◀────│   Gemini + GPT-5.2    │◀────│   (Your PC)          │
└─────────────────┘     │   + CENTO Orchestrator │     │   Chrome CDP         │
                        │   + MCP Tools          │     │   Playwright         │
                        │   + Memory System      │     │   Scrapling (Python) │
                        └──────────────────────┘     │   Desktop (PowerShell)│
                              │                       │   Antigravity IDE    │
                              ▼                       └─────────────────────┘
                        Tailscale VPN ─────────── Peer-to-Peer (encrypted)
```

### Security Model

```
┌──────────────────────────────────────────────────────┐
│ LEVEL 0 — Auto-approve (safe, read-only):            │
│  • Screenshots, page reading, web search             │
│  • Memory recall, web scraping                       │
├──────────────────────────────────────────────────────┤
│ LEVEL 1 — Single approval:                           │
│  • Navigation, clicking, typing                      │
│  • Calendar events, Notion operations                │
├──────────────────────────────────────────────────────┤
│ LEVEL 2 — Double approval:                           │
│  • Email sending, program install                    │
│  • File deletion, login credentials                  │
└──────────────────────────────────────────────────────┘
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
pip install scrapling   # optional: for anti-bot scraping
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

### 3. Connect VPS ↔ PC (Tailscale VPN)

```bash
# Install Tailscale on both machines:
# VPS:  curl -fsSL https://tailscale.com/install.sh | sh && tailscale up
# PC:   Download from https://tailscale.com/download
# Both machines auto-connect — no SSH tunnels needed!
```

---

## 🔑 Environment Variables

### Bot (.env)

| Key | Source | Required |
|-----|--------|----------|
| `TELEGRAM_BOT_TOKEN` | [@BotFather](https://t.me/BotFather) | ✅ |
| `MODEL_API_KEY` | [AI Studio](https://aistudio.google.com) | ✅ |
| `TELEGRAM_ALLOWLIST_USER_ID` | [@userinfobot](https://t.me/userinfobot) | ✅ |
| `OPENAI_API_KEY` | [OpenAI Platform](https://platform.openai.com) | For CENTO |
| `ORCHESTRATOR_MODEL` | `gpt-5.2` | For CENTO |
| `ORCHESTRATOR_ENABLED` | `true` | For CENTO |
| `ENABLE_PC_BRIDGE` | `true` | For PC tools |
| `PC_BRIDGE_URL` | `ws://berkan:3847/ws` (Tailscale) | For PC tools |
| `PC_BRIDGE_TOKEN` | Shared auth token | Optional |
| `TTS_API_KEY` | Google Cloud TTS | Optional |

### PC Bridge (.env)

| Key | Default | Description |
|-----|---------|-------------|
| `CDP_PORT` | `9222` | Chrome DevTools Protocol port |
| `BRIDGE_PORT` | `3847` | WebSocket server port |
| `BRIDGE_AUTH_TOKEN` | `gravity-claw-bridge-2026` | Auth token |

---

## 📁 Project Structure

```
gravity-claw/
├── src/
│   ├── index.ts                  # Entry point
│   ├── config.ts                 # Environment config
│   ├── bot.ts                    # Telegram bot setup
│   ├── agent.ts                  # Gemini agent loop + system prompt
│   ├── orchestrator.ts           # CENTO multi-model orchestrator
│   ├── scheduler.ts              # Cron jobs (briefing, health, summary)
│   ├── approval.ts               # User approval flow
│   ├── prompts/
│   │   └── soul.ts               # CENTO mega-prompt system (identity, capabilities, rules)
│   ├── handlers/
│   │   ├── text-handler.ts       # Text message handler
│   │   ├── voice-handler.ts      # Voice transcription
│   │   └── media-handler.ts      # Photo/document analysis
│   ├── memory/
│   │   ├── index.ts              # Memory system coordinator
│   │   ├── core-memory.ts        # Stable preferences
│   │   ├── vector-store.ts       # SQLite + embeddings
│   │   ├── embedder.ts           # Gemini embedding API
│   │   └── log.ts                # Memory audit trail
│   ├── tools/
│   │   ├── index.ts              # Tool registry (40+ tools)
│   │   ├── browser-control.ts    # Chrome browser tools (6)
│   │   ├── desktop-control.ts    # Desktop automation tools (6)
│   │   ├── antigravity-control.ts # Antigravity IDE tools (2)
│   │   ├── scraper-control.ts    # Web scraping tools (2)
│   │   ├── send-image.ts         # Telegram image sending
│   │   ├── site-memory.ts        # Approved site persistence
│   │   ├── pc-control.ts         # Local PC commands
│   │   ├── web-search.ts         # Web search
│   │   ├── remember.ts           # Store memories
│   │   ├── recall.ts             # Search memories
│   │   └── get-current-time.ts
│   ├── transcription/            # Voice-to-text
│   └── tts/                      # Text-to-speech
├── pc-bridge/
│   ├── server.ts                 # WebSocket command server
│   ├── browser.ts                # Playwright Chrome control
│   ├── desktop.ts                # PowerShell desktop control
│   ├── antigravity.ts            # Antigravity IDE automation (CDP)
│   ├── scraper.ts                # Scrapling + Playwright web scraping
│   ├── start-bridge.bat          # Auto-start script
│   └── start-tunnel.bat          # SSH tunnel auto-reconnect
├── memory/
│   ├── soul.md                   # Communication style guide
│   └── core_memory.md            # User preferences (gitignored)
└── .env.example
```

---

## 🛠️ Tool Inventory (40+)

| Category | Count | Tools |
|----------|:-----:|-------|
| Core | 5 | time, remember, recall, web_search, send_image |
| Browser | 6 | open, screenshot, click, type, read, scroll |
| Desktop | 6 | screenshot, click, type, hotkey, focus, install |
| Antigravity | 2 | prompt, state |
| Scraper | 2 | web_scrape, web_extract |
| MCP | ~20+ | Calendar, Gmail, Drive, Notion |

---

## 📜 License

MIT

---

Built with ❤️ by [berkanaskin](https://github.com/berkanaskin)
