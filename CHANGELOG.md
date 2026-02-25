# Changelog

All notable changes to CENTO (formerly Gravity Claw) are documented here.

## [0.5.0] — 2026-02-25

### 🧠 CENTO Mega-Prompt System (Soul)

**New: Comprehensive AI personality and behavior system**

- `src/prompts/soul.ts` — CENTO's identity, capabilities, decision framework
- **Turkish-first personality** with technical English terms preserved
- **3-Tier Security Framework:**
  - Level 0 (Auto): screenshots, reading, web scraping
  - Level 1 (Single approval): clicks, typing, calendar events
  - Level 2 (Double approval): emails, installs, credentials
- **Model Routing Logic:** Gemini (speed) → GPT-5.2 (accuracy) → Claude (code quality)
- **Scenario Prompts:** morning briefing, code review, research, health check
- **Response Templates:** short answers, research results, task reports, error handling
- Agent.ts refactored: inline system prompt replaced with `buildCentoSystemPrompt()`
- Scheduler: morning briefing at 08:00 using `SCENARIO_PROMPTS.morningBriefing`

---

## [0.4.0] — 2026-02-25

### 🚀 Antigravity IDE Automation + Scrapling Web Scraping

**New: Claude Opus/Sonnet delegation + Anti-bot web scraping**

#### Antigravity IDE Automation (2 tools)
- `antigravity_prompt` — Send complex coding tasks to Claude via Antigravity IDE
- `antigravity_state` — Check IDE connection status
- PC Bridge: `antigravity.ts` — CDP automation (connect → send prompt → poll response)
- Supports **any Claude model** available in user's Antigravity subscription
- **Free** — no API costs, uses existing subscription

#### Web Scraping with Scrapling (2 tools)
- `web_scrape` — Read any web page, including anti-bot protected sites
- `web_extract` — Extract structured data (lists, tables, links) via CSS selectors
- PC Bridge: `scraper.ts` — Python Scrapling library wrapper + Playwright fallback
- Handles **Cloudflare, Akamai, PerimeterX** and other anti-bot protections
- Prerequisite: `pip install scrapling` on local PC

#### Telegram Image Sending
- `send_image` — Send photos via Telegram (URL, file path, or base64)
- Supports captions and all Telegram photo formats

#### Notion Full Permissions
- `create-a-database` — Create Notion databases programmatically
- `update-a-database` — Modify database properties
- `retrieve-a-database` — Get database schema and info
- `delete-a-block` / `update-a-block` — Full block-level CRUD

#### New Files
- `pc-bridge/antigravity.ts` — Antigravity IDE CDP automation
- `pc-bridge/scraper.ts` — Scrapling + Playwright web scraping
- `src/tools/antigravity-control.ts` — Bot-side Antigravity tools (2)
- `src/tools/scraper-control.ts` — Bot-side scraping tools (2)
- `src/tools/send-image.ts` — Telegram image sending tool
- `src/prompts/soul.ts` — CENTO mega-prompt system

---

## [0.3.5] — 2026-02-25

### 🌐 CENTO Orchestrator + Tailscale VPN

**New: Multi-model AI orchestration engine**

#### CENTO Orchestrator (`orchestrator.ts`)
- **GPT-5.2** Cascading Protocol — task decomposition, execution, validation
- **5 Agent Roles:** orchestrator (GPT-5.2), coder (Claude), reviewer (Gemini Pro), researcher (Gemini Flash), scraper (Scrapling)
- **Validation Gate** — automated quality validation of sub-task outputs
- **Ralph Loop** — 10-minute health monitor detecting stuck tasks with retry/escalation
- Task queue with priority levels (critical, high, normal, low)

#### Tailscale VPN (replaces SSH tunnels)
- Peer-to-peer encrypted connection: `berkan ↔ gravity-vps`
- `PC_BRIDGE_URL` changed to `ws://berkan:3847/ws`
- Zero-config networking — no port forwarding, no SSH tunnel scripts
- 74ms direct latency (Tailscale MagicDNS)

#### Architecture Change
- **Before:** VPS → SSH Reverse Tunnel → PC Bridge
- **After:** VPS → Tailscale VPN → PC Bridge (peer-to-peer)

---

## [0.3.0] — 2026-02-24

### 🖥️ Computer Vision & Desktop Control (PC Bridge)

**New: Full browser and desktop control via Telegram**

Agent Claw can now control your Chrome browser and Windows desktop through a local PC Bridge server. All actions require explicit user approval via Telegram.

#### Browser Control (6 tools)
- `browser_open` — Navigate to any URL (site approval remembered after first use)
- `browser_screenshot` — Capture current page screenshot (safe, auto)
- `browser_click` — Click page elements by CSS selector or text (needs approval)
- `browser_type` — Type text into input fields (needs approval)
- `browser_read` — Read current page title, URL, and visible text (safe, auto)
- `browser_scroll` — Scroll page up/down (safe, auto)

#### Desktop Control (6 tools)
- `desktop_screenshot` — Capture full desktop screenshot (safe, auto)
- `desktop_click` — Click at screen coordinates (needs approval)
- `desktop_type` — Type text via keyboard simulation (needs approval)
- `desktop_hotkey` — Send keyboard shortcuts like Ctrl+C (needs approval)
- `desktop_app_focus` — Focus/bring a window to front (needs approval)
- `desktop_install` — Install programs via winget (double approval required)

#### PC Bridge Server
- WebSocket-based local server running on user's PC
- Connects to Chrome via CDP (Chrome DevTools Protocol)
- Desktop actions via PowerShell commands
- Token-based authentication
- Auto-start via Windows Startup folder

#### Security Model
- **Safe (auto):** Screenshots and read operations — no approval needed
- **Single approval:** Navigation, clicks, typing — requires user confirmation
- **Site memory:** Once a domain is approved, it's remembered permanently
- **Double approval:** Program installation — requires two-step confirmation
- **Audit logging:** All browser/desktop actions logged to audit files

---

### 🧠 Anti-Hallucination System

- **Fixed corrupted system prompt** — Merged duplicate SYSTEM_PROMPT_BASE declarations
- **Added critical anti-fabrication rule** — Agent must never invent tool results
- **Dynamic MCP sections** — System prompt only includes capabilities for tools actually connected
- **MCP-aware scheduler** — Proactive checks and daily summaries skip when tools unavailable
- **New `hasToolMatching()` method** — Agent can check tool availability at runtime

---

## [0.2.0] — 2026-02-10

### Features
- PC control tools (`pc_execute`, `pc_open`, `pc_list_files`, `pc_system_info`)
- Photo and document analysis via Gemini Vision
- Voice input (transcription) and voice output (TTS)
- Web search integration
- MCP integration (Google Calendar, Gmail, Drive, Notion)
- Proactive scheduling (daily summaries, periodic checks)
- Email approval workflow (draft → confirm → send)

---

## [0.1.0] — 2026-01-28

### Initial Release
- Telegram bot with Gemini 3.1 Pro
- Long-term memory system (SQLite + embeddings)
- Core memory file (user-editable preferences)
- Soul file (communication style guide)
- Tool loop with function calling
- User ID whitelist security
