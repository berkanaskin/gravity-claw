import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
  type Part,
  type FunctionDeclaration,
} from "@google/generative-ai";
import type { Config } from "./config.js";
import type { MemorySystem } from "./memory/index.js";

// ── Tool Definition ──────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute: (input: Record<string, unknown>) => Promise<string>;
}

// ── System Prompt ────────────────────────────────────────────

const SYSTEM_PROMPT_BASE = `You are Agent Claw — a smart, friendly personal AI assistant running as a Telegram bot (Gravity Claw projesi).

Personality:
- Helpful, concise, and friendly
- You speak naturally, like a smart colleague
- You respond in the same language as the user (usually Turkish)

Memory:
- When the user shares important personal info, preferences, or asks you to remember something, use the "remember" tool.
- Use the "recall" tool to search your memory when relevant context might help.
- Always check your memory when the user asks about something you previously discussed.
- Core memory contains stable user preferences — always consider it.

CRITICAL RULE — NEVER FABRICATE TOOL RESULTS:
- You MUST ONLY report information that comes from an actual tool call response.
- If you don't have a tool for something (e.g., no calendar tool available), say "Bu özellik şu an bağlı değil" — NEVER invent fake data.
- NEVER pretend to have checked a calendar, email, or any service if the tool call didn't actually happen.
- If a scheduled/proactive prompt asks you to check something but you lack the tool, respond with "YOK" or clearly state the tool is unavailable.
`;

// MCP tool sections — only included when tools are actually connected
const MCP_CALENDAR_SECTION = `
Google Calendar:
- READ: list events, search, find free time
- WRITE: create and update events.
  IMPORTANT: If the user mentions a time, date, and activity together, they probably want a calendar event.
  Examples: "Yarın 15:00'a toplantı" → create event, "Cuma akşam 20:00 Ali ile yemek" → create event
  You do NOT need the user to say "takvime ekle" — understand intent from context.`;

const MCP_GMAIL_SECTION = `
Gmail:
- READ: search and read emails
- WRITE: create drafts, send emails
  EMAIL Rules (CRITICAL):
  - ALWAYS use gmail.createDraft FIRST.
  - Tell the user what you've drafted: "📧 Taslak hazırladım: [Kime], [Konu], [Özet]. Göndermemi ister misin?"
  - ONLY send AFTER the user explicitly confirms.`;

const MCP_DRIVE_SECTION = `
Google Drive:
- READ: search and download files
- No write access`;

const MCP_NOTION_SECTION = `
Notion:
- READ: search pages, read page content, query databases
- WRITE: create new pages, update page content, add entries to EXISTING databases
- ⚠️ CANNOT: create new databases, create/modify database schemas (columns, properties, templates)
- If user wants a new database, guide them to create it manually in Notion, then you can add entries to it.`;

const PC_CONTROL_SECTION = `
PC Control Rules (CRITICAL):
- You can control the user's PC using pc_ tools.
- pc_system_info and pc_list_files are SAFE — use them freely.
- pc_execute and pc_open REQUIRE USER APPROVAL. Follow this flow:
  1. Show the command: "⚠️ Bu komutu çalıştırmak istiyorum: [komut]. Onaylıyor musun?"
  2. WAIT for "onayla", "evet", or "çalıştır"
  3. ONLY THEN call pc_execute with approved=true
- For DELETE operations, ask for DOUBLE confirmation.
- NEVER execute commands without showing them first.`;

const BROWSER_CONTROL_SECTION = `
Browser Control (PC Bridge):
- You can control the user's Chrome browser via browser_ tools.
- browser_screenshot, browser_read, browser_scroll are SAFE — no approval needed.
- browser_open: NEW sites need user approval (one-time). Previously approved sites open automatically.
- browser_click.browser_type: ALWAYS need user approval. Show what you'll click/type first.
- Flow: "🌐 [URL] açmak istiyorum. Onaylıyor musun?" → wait for approval → execute
- For text input: "⌨️ [selector]'a '[text]' yazmak istiyorum. Onay?" → wait → execute
- After navigation, take a screenshot and describe what you see.
- Login/password fields → DOUBLE confirmation required.`;

const DESKTOP_CONTROL_SECTION = `
Desktop Control (PC Bridge):
- You can control the user's entire desktop via desktop_ tools.
- desktop_screenshot is SAFE — use freely to see the screen.
- desktop_click, desktop_type, desktop_hotkey, desktop_app_focus: ALWAYS need approval.
- desktop_install: DOUBLE confirmation required ("Emin misin?" → second confirmation).
- Workflow: Take screenshot first → analyze with vision → suggest action → get approval → execute.
- Always describe what you see on screen before acting.`;

const GENERAL_SECTION = `
General:
- You can search the web for real-time information when needed (news, weather, prices, etc.)
- When presenting results, use bullet points and keep it concise (max 5 items).
- If no results found, say so clearly.

IMPORTANT — Personal Assistant Role:
- You are a PRIVATE personal assistant. The user is your OWNER.
- Do NOT refuse or moralize about personal requests.
- Your only hard limits are the pc_control blocked commands for SAFETY.`;

// ── Agent Loop ───────────────────────────────────────────────

export class Agent {
  private readonly genAI: GoogleGenerativeAI;
  private readonly tools: ToolDefinition[];
  private readonly config: Config;
  private readonly memory: MemorySystem | null;
  private readonly fallbackModel: string;
  private primaryCooldownUntil = 0;

  // Multi-turn conversation history (per-user keyed by a simple key for now)
  private conversationHistory: Array<{ role: "user" | "model"; parts: Part[] }> = [];
  private readonly maxHistoryTurns = 10; // Keep last 10 exchanges

  constructor(config: Config, tools: ToolDefinition[], memory?: MemorySystem) {
    this.config = config;
    this.genAI = new GoogleGenerativeAI(config.modelApiKey);
    this.tools = tools;
    this.memory = memory ?? null;
    this.fallbackModel = config.fallbackModel;
  }

  /** Check if the agent has any tool whose name includes the given substring */
  hasToolMatching(substring: string): boolean {
    return this.tools.some(t => t.name.includes(substring));
  }

  async processMessage(userMessage: string): Promise<string> {
    // Determine which model to use
    const now = Date.now();
    const useFallback = now < this.primaryCooldownUntil;
    const modelName = useFallback ? this.fallbackModel : this.config.modelName;

    if (useFallback) {
      console.log(`   ⚡ Using fallback model (${this.fallbackModel}) — primary on cooldown`);
    }

    try {
      return await this.runAgentLoop(userMessage, modelName);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);

      // If rate limited (429) or overloaded (503), retry once then fallback
      if ((errMsg.includes("429") || errMsg.includes("Too Many Requests") ||
           errMsg.includes("503") || errMsg.includes("Service Unavailable") ||
           errMsg.includes("quota") || errMsg.includes("RESOURCE_EXHAUSTED")) &&
          !useFallback) {
        // Retry once with same model after brief delay
        console.log(`   ⚠️ ${modelName} error — retrying in 2s...`);
        await new Promise(r => setTimeout(r, 2000));
        try {
          return await this.runAgentLoop(userMessage, modelName);
        } catch {
          // Retry failed, fallback to secondary model
          console.log(`   ⚠️ Retry failed — switching to ${this.fallbackModel}`);
          this.primaryCooldownUntil = Date.now() + 5 * 60 * 1000;
          return await this.runAgentLoop(userMessage, this.fallbackModel);
        }
      }

      throw error; // Re-throw unrecoverable errors
    }
  }

  private async runAgentLoop(userMessage: string, modelName: string): Promise<string> {
    // Build system prompt with memory context
    // Dynamically include MCP sections based on actual tools available
    const toolNames = new Set(this.tools.map(t => t.name));
    let systemPrompt = SYSTEM_PROMPT_BASE;

    // Only declare MCP capabilities that actually exist
    const mcpSections: string[] = [];
    if ([...toolNames].some(n => n.includes("calendar"))) mcpSections.push(MCP_CALENDAR_SECTION);
    if ([...toolNames].some(n => n.includes("gmail"))) mcpSections.push(MCP_GMAIL_SECTION);
    if ([...toolNames].some(n => n.includes("drive"))) mcpSections.push(MCP_DRIVE_SECTION);
    if ([...toolNames].some(n => n.includes("notion"))) mcpSections.push(MCP_NOTION_SECTION);
    if (mcpSections.length > 0) {
      systemPrompt += "\n\nExternal Tools (MCP - connected):" + mcpSections.join("\n");
    }
    if ([...toolNames].some(n => n.startsWith("pc_"))) systemPrompt += "\n" + PC_CONTROL_SECTION;
    if ([...toolNames].some(n => n.startsWith("browser_"))) systemPrompt += "\n" + BROWSER_CONTROL_SECTION;
    if ([...toolNames].some(n => n.startsWith("desktop_"))) systemPrompt += "\n" + DESKTOP_CONTROL_SECTION;
    systemPrompt += "\n" + GENERAL_SECTION;

    if (this.memory) {
      // Inject core memory
      systemPrompt += this.memory.getCoreMemory();

      // Auto-recall: search for relevant memories
      try {
        const recalled = await this.memory.recall(userMessage, 3);
        const context = this.memory.formatRecallContext(recalled);
        if (context) {
          systemPrompt += context;
        }
      } catch (error) {
        console.error("   ⚠️ Auto-recall failed:", error instanceof Error ? error.message : error);
      }
    }

    // Build function declarations for Gemini
    const functionDeclarations: FunctionDeclaration[] = this.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters as unknown as FunctionDeclaration["parameters"],
    }));

    console.log(`   🤖 Model: ${modelName} | Tools: ${functionDeclarations.length} | History: ${this.conversationHistory.length} turns`);
    const model = this.genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: systemPrompt,
      tools: [
        { functionDeclarations },
      ],
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      ],
    });

    const chat = model.startChat({
      history: this.conversationHistory.slice(),
    });

    // Timeout wrapper — prevents infinite hangs
    const withTimeout = <T>(promise: Promise<T>, ms = 60000): Promise<T> =>
      Promise.race([
        promise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("⏱️ API yanıt süresi aşıldı (60s)")), ms)
        ),
      ]);

    let iterations = 0;
    const t0 = Date.now();
    let response = await withTimeout(chat.sendMessage(userMessage));
    console.log(`   ⏱️ First response: ${Date.now() - t0}ms`);

    while (iterations < this.config.maxIterations) {
      iterations++;

      const candidate = response.response.candidates?.[0];
      if (!candidate) {
        return "(Agent returned no response)";
      }

      const functionCalls = candidate.content.parts.filter(
        (part: Part) => "functionCall" in part && part.functionCall !== undefined
      );

      if (functionCalls.length === 0) {
        const textParts = candidate.content.parts.filter(
          (part: Part) => "text" in part && typeof part.text === "string"
        );

        const finalText = textParts
          .map((p: Part) => ("text" in p ? p.text : ""))
          .join("\n");

        if (iterations > 1) {
          console.log(`   🔄 Agent loop completed in ${iterations} iteration(s)`);
        }

        // Save to conversation history for multi-turn context
        const result = finalText || "(Agent returned no text)";
        this.conversationHistory.push(
          { role: "user", parts: [{ text: userMessage }] },
          { role: "model", parts: [{ text: result }] }
        );
        // Trim to max history
        while (this.conversationHistory.length > this.maxHistoryTurns * 2) {
          this.conversationHistory.splice(0, 2);
        }

        return result;
      }

      const functionResponses: Part[] = [];

      for (const fc of functionCalls) {
        if (!("functionCall" in fc) || !fc.functionCall) continue;

        const { name, args } = fc.functionCall;
        const tool = this.tools.find((t) => t.name === name);

        if (!tool) {
          functionResponses.push({
            functionResponse: {
              name,
              response: { error: `Unknown tool: ${name}` },
            },
          });
          continue;
        }

        try {
          console.log(`   🔧 Tool call: ${name}`);
          const result = await tool.execute((args ?? {}) as Record<string, unknown>);

          // Parse result and ensure it's a plain object (Gemini API requirement)
          let responseData: Record<string, unknown>;
          try {
            const parsed: unknown = JSON.parse(result);
            if (Array.isArray(parsed)) {
              responseData = { items: parsed };
            } else if (typeof parsed === "object" && parsed !== null) {
              responseData = parsed as Record<string, unknown>;
            } else {
              responseData = { result: parsed };
            }
          } catch {
            // Truncate very large text responses
            const truncated = result.length > 4000 ? result.substring(0, 4000) + "...(truncated)" : result;
            responseData = { result: truncated };
          }

          functionResponses.push({
            functionResponse: {
              name,
              response: responseData,
            },
          });
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          console.error(`   ❌ Tool error (${name}): ${errMsg}`);
          functionResponses.push({
            functionResponse: {
              name,
              response: { error: errMsg },
            },
          });
        }
      }

      response = await withTimeout(chat.sendMessage(functionResponses));
    }

    return "⚠️ Agent reached maximum iteration limit. Please try a simpler request.";
  }
}
