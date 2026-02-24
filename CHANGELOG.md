# Changelog

All notable changes to Gravity Claw are documented here.

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
- SSH reverse tunnel for VPS connectivity

#### Security Model
- **Safe (auto):** Screenshots and read operations — no approval needed
- **Single approval:** Navigation, clicks, typing — requires user confirmation
- **Site memory:** Once a domain is approved, it's remembered permanently
- **Double approval:** Program installation — requires two-step confirmation
- **Audit logging:** All browser/desktop actions logged to audit files

#### New Files
- `pc-bridge/server.ts` — WebSocket command server
- `pc-bridge/browser.ts` — Playwright browser automation
- `pc-bridge/desktop.ts` — PowerShell desktop control
- `src/tools/browser-control.ts` — Bot-side browser tools (6)
- `src/tools/desktop-control.ts` — Bot-side desktop tools (6)
- `src/tools/site-memory.ts` — Approved site persistence

---

### 🧠 Anti-Hallucination System

- **Fixed corrupted system prompt** — Merged duplicate SYSTEM_PROMPT_BASE declarations
- **Added critical anti-fabrication rule** — Agent must never invent tool results
- **Dynamic MCP sections** — System prompt only includes capabilities for tools actually connected
- **MCP-aware scheduler** — Proactive checks and daily summaries skip when tools unavailable
- **New `hasToolMatching()` method** — Agent can check tool availability at runtime

---

### 🔧 Code Quality Improvements

- Refactored `media-handler.ts` — Extracted `isSupportedMime()`, `isTextMime()`, `sendSplitReply()` helpers to reduce cognitive complexity
- Modernized imports — `node:fs` and `node:path` prefix usage
- Array access — `.at(-1)` instead of `[length - 1]`
- Cleaned markdown formatting in `soul.md`
- Added `ws` and `@types/ws` dependencies

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
