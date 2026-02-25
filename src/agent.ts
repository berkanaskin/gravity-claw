import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
  type Part,
  type FunctionDeclaration,
} from "@google/generative-ai";
import OpenAI from "openai";
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

import { buildCentoSystemPrompt } from "./prompts/soul.js";

// ── System Prompt ────────────────────────────────────────────

const SYSTEM_PROMPT_BASE = buildCentoSystemPrompt();

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
Notion (Tam Yetki):
- READ: search pages, read page content, query databases
- WRITE: create/update pages, add/modify blocks, add entries to databases
- DATABASE: create new databases, update database schemas (properties, columns)
- Use API-create-a-database to create new databases when the user asks.
- Use API-update-a-database to modify database properties/columns.`;

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

const ANTIGRAVITY_SECTION = `
Antigravity IDE (Claude Delegation):
- You can send complex coding tasks to Antigravity IDE which runs Claude Opus/Sonnet.
- Use antigravity_prompt for: code generation, refactoring, debugging, code reviews.
- This is FREE — it uses the user's Antigravity subscription.
- ⚠️ Requires: Antigravity IDE running on user's PC + PC Bridge connected.
- Use antigravity_state to check if IDE is available before sending prompts.
- For simple tasks, handle them yourself. Delegate only complex/large tasks.`;

const DESKTOP_CONTROL_SECTION = `
Desktop Control (PC Bridge):
- You can control the user's entire desktop via desktop_ tools.
- desktop_screenshot is SAFE — use freely to see the screen.
- desktop_click, desktop_type, desktop_hotkey, desktop_app_focus: ALWAYS need approval.
- desktop_install: DOUBLE confirmation required ("Emin misin?" → second confirmation).
- Workflow: Take screenshot first → analyze with vision → suggest action → get approval → execute.
- Always describe what you see on screen before acting.
- Install programs → DOUBLE approval required.`;

const WEB_SCRAPING_SECTION = `
Web Scraping (Scrapling + Playwright):
- web_scrape: Read any web page content, even anti-bot protected.
- web_extract: Extract structured data (lists, tables, links) using CSS selectors.
- Scrapling handles Cloudflare, Akamai, etc. Playwright is the fallback.
- No approval needed — read-only operations.
- Use for: research, product info, article reading, data collection.`;

const GENERAL_SECTION = `
General:
- You can search the web for real-time information when needed (news, weather, prices, etc.)
- When presenting results, use bullet points and keep it concise (max 5 items).
- If no results found, say so clearly.

IMPORTANT — Personal Assistant Role:
- You are a PRIVATE personal assistant. The user is your OWNER.
- Do NOT refuse or moralize about personal requests.
- Your only hard limits are the pc_control blocked commands for SAFETY.`;

// ── Helper: Is OpenAI Model? ─────────────────────────────────

function isOpenAIModel(config: Config): boolean {
  return !!(config.modelApiBase?.includes("openai.com")) ||
    config.modelName.startsWith("gpt-") ||
    config.modelName.startsWith("o1") ||
    config.modelName.startsWith("o3") ||
    config.modelName.startsWith("o4");
}

// ── Agent Loop ───────────────────────────────────────────────

export class Agent {
  private readonly genAI: GoogleGenerativeAI;
  private readonly openaiClient: OpenAI | null;
  private readonly tools: ToolDefinition[];
  private readonly config: Config;
  private readonly memory: MemorySystem | null;
  private readonly fallbackModel: string;
  private primaryCooldownUntil = 0;
  private readonly useOpenAI: boolean;

  // Multi-turn conversation history
  // Gemini format: { role: "user" | "model"; parts: Part[] }[]
  // OpenAI format: { role: "user" | "assistant" | "system"; content: string }[]
  private readonly conversationHistory: Array<{ role: "user" | "model"; parts: Part[] }> = [];
  private openaiHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
  private readonly maxHistoryTurns = 10;

  constructor(config: Config, tools: ToolDefinition[], memory?: MemorySystem) {
    this.config = config;
    this.tools = tools;
    this.memory = memory ?? null;
    this.fallbackModel = config.fallbackModel;
    this.useOpenAI = isOpenAIModel(config);

    // Always init Gemini (used for fallback + transcription/TTS helper)
    this.genAI = new GoogleGenerativeAI(config.modelApiKey);

    // Init OpenAI client if key available
    if (config.openaiApiKey) {
      this.openaiClient = new OpenAI({
        apiKey: config.openaiApiKey,
        baseURL: config.modelApiBase ?? undefined,
      });
    } else {
      this.openaiClient = null;
    }

    console.log(`   🤖 Agent backend: ${this.useOpenAI ? "OpenAI" : "Gemini"}`);
  }

  /** Check if the agent has any tool whose name includes the given substring */
  hasToolMatching(substring: string): boolean {
    return this.tools.some(t => t.name.includes(substring));
  }

  async processMessage(userMessage: string): Promise<string> {
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

      if ((errMsg.includes("429") || errMsg.includes("Too Many Requests") ||
           errMsg.includes("503") || errMsg.includes("Service Unavailable") ||
           errMsg.includes("quota") || errMsg.includes("RESOURCE_EXHAUSTED") ||
           errMsg.includes("rate_limit_exceeded")) &&
          !useFallback) {
        console.log(`   ⚠️ ${modelName} error — retrying in 2s...`);
        await new Promise(r => setTimeout(r, 2000));
        try {
          return await this.runAgentLoop(userMessage, modelName);
        } catch {
          console.log(`   ⚠️ Retry failed — switching to ${this.fallbackModel}`);
          this.primaryCooldownUntil = Date.now() + 5 * 60 * 1000;
          // Fallback is always Gemini — force Gemini loop
          return await this.runGeminiLoop(userMessage, this.fallbackModel);
        }
      }

      throw error;
    }
  }

  private async runAgentLoop(userMessage: string, modelName: string): Promise<string> {
    // If using OpenAI model AND client available — use OpenAI loop
    if (this.useOpenAI && this.openaiClient && !modelName.startsWith("gemini")) {
      return await this.runOpenAILoop(userMessage, modelName);
    }
    // Otherwise use Gemini loop
    return await this.runGeminiLoop(userMessage, modelName);
  }

  // ── Build Shared System Prompt ───────────────────────────────

  private buildSystemPrompt(): string {
    const toolNames = new Set(this.tools.map(t => t.name));
    let systemPrompt = SYSTEM_PROMPT_BASE;

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
    if ([...toolNames].some(n => n.startsWith("antigravity_"))) systemPrompt += "\n" + ANTIGRAVITY_SECTION;
    if ([...toolNames].some(n => n.startsWith("desktop_"))) systemPrompt += "\n" + DESKTOP_CONTROL_SECTION;
    if ([...toolNames].some(n => n.startsWith("web_scrape") || n.startsWith("web_extract"))) systemPrompt += "\n" + WEB_SCRAPING_SECTION;
    systemPrompt += "\n" + GENERAL_SECTION;

    return systemPrompt;
  }

  // ── OpenAI Agent Loop ─────────────────────────────────────────

  private async runOpenAILoop(userMessage: string, modelName: string): Promise<string> {
    const client = this.openaiClient!;

    // Build system prompt with memory
    let systemPrompt = this.buildSystemPrompt();

    if (this.memory) {
      systemPrompt += this.memory.getCoreMemory();
      try {
        const recalled = await this.memory.recall(userMessage, 3);
        const context = this.memory.formatRecallContext(recalled);
        if (context) systemPrompt += context;
      } catch (error) {
        console.error("   ⚠️ Auto-recall failed:", error instanceof Error ? error.message : error);
      }
    }

    // Build OpenAI tools format
    const openaiTools: OpenAI.Chat.ChatCompletionTool[] = this.tools.map(t => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    // Build messages: system + history + new message
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...this.openaiHistory,
      { role: "user", content: userMessage },
    ];

    console.log(`   🤖 OpenAI: ${modelName} | Tools: ${openaiTools.length} | History: ${this.openaiHistory.length} turns`);

    const withTimeout = <T>(promise: Promise<T>, ms = 120000): Promise<T> =>
      Promise.race([
        promise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("⏱️ API yanıt süresi aşıldı (120s)")), ms)
        ),
      ]);

    let iterations = 0;
    const t0 = Date.now();

    // Initial API call
    let chatResponse = await withTimeout(
      client.chat.completions.create({
        model: modelName,
        messages,
        tools: openaiTools,
        tool_choice: "auto",
      })
    );
    console.log(`   ⏱️ First response: ${Date.now() - t0}ms`);

    // Accumulate all messages for this turn (for multi-tool iterations)
    const turnMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [...messages];

    while (iterations < this.config.maxIterations) {
      iterations++;

      const choice = chatResponse.choices[0];
      if (!choice) return "(Agent returned no response)";

      const { finish_reason, message } = choice;

      // No more tool calls — return final text
      if (finish_reason === "stop" || !message.tool_calls || message.tool_calls.length === 0) {
        const result = message.content || "(Agent returned no text)";

        if (iterations > 1) {
          console.log(`   🔄 OpenAI loop completed in ${iterations} iteration(s)`);
        }

        // Save to OpenAI history
        this.openaiHistory.push(
          { role: "user", content: userMessage },
          { role: "assistant", content: result }
        );
        while (this.openaiHistory.length > this.maxHistoryTurns * 2) {
          this.openaiHistory.splice(0, 2);
        }

        return result;
      }

      // Process tool calls
      turnMessages.push(message);
      const toolResults: OpenAI.Chat.ChatCompletionToolMessageParam[] = [];

      for (const toolCall of message.tool_calls) {
        const toolCallId = toolCall.id;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fnCall = (toolCall as any).function as { name: string; arguments: string };
        const fnName = fnCall.name;
        const fnArgs = fnCall.arguments;
        const tool = this.tools.find(t => t.name === fnName);

        if (!tool) {
          toolResults.push({
            role: "tool",
            tool_call_id: toolCallId,
            content: JSON.stringify({ error: `Unknown tool: ${fnName}` }),
          });
          continue;
        }

        try {
          console.log(`   🔧 Tool call: ${fnName}`);
          const args = JSON.parse(fnArgs || "{}") as Record<string, unknown>;
          const result = await tool.execute(args);
          const truncated = result.length > 4000 ? result.substring(0, 4000) + "...(truncated)" : result;
          toolResults.push({
            role: "tool",
            tool_call_id: toolCallId,
            content: truncated,
          });
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          console.error(`   ❌ Tool error (${fnName}): ${errMsg}`);
          toolResults.push({
            role: "tool",
            tool_call_id: toolCallId,
            content: JSON.stringify({ error: errMsg }),
          });
        }
      }

      // Add tool results and get next response
      turnMessages.push(...toolResults);
      chatResponse = await withTimeout(
        client.chat.completions.create({
          model: modelName,
          messages: turnMessages,
          tools: openaiTools,
          tool_choice: "auto",
        })
      );
    }

    return "⚠️ Agent reached maximum iteration limit. Please try a simpler request.";
  }

  // ── Gemini Agent Loop ─────────────────────────────────────────

  private async runGeminiLoop(userMessage: string, modelName: string): Promise<string> {
    let systemPrompt = this.buildSystemPrompt();

    if (this.memory) {
      systemPrompt += this.memory.getCoreMemory();
      try {
        const recalled = await this.memory.recall(userMessage, 3);
        const context = this.memory.formatRecallContext(recalled);
        if (context) systemPrompt += context;
      } catch (error) {
        console.error("   ⚠️ Auto-recall failed:", error instanceof Error ? error.message : error);
      }
    }

    const functionDeclarations: FunctionDeclaration[] = this.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters as unknown as FunctionDeclaration["parameters"],
    }));

    console.log(`   🤖 Gemini: ${modelName} | Tools: ${functionDeclarations.length} | History: ${this.conversationHistory.length} turns`);
    const model = this.genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: systemPrompt,
      tools: [{ functionDeclarations }],
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      ],
    });

    const chat = model.startChat({ history: this.conversationHistory.slice() });

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
      if (!candidate) return "(Agent returned no response)";

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
          console.log(`   🔄 Gemini loop completed in ${iterations} iteration(s)`);
        }

        const result = finalText || "(Agent returned no text)";
        this.conversationHistory.push(
          { role: "user", parts: [{ text: userMessage }] },
          { role: "model", parts: [{ text: result }] }
        );
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
            functionResponse: { name, response: { error: `Unknown tool: ${name}` } },
          });
          continue;
        }

        try {
          console.log(`   🔧 Tool call: ${name}`);
          const result = await tool.execute((args ?? {}) as Record<string, unknown>);

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
            const truncated = result.length > 4000 ? result.substring(0, 4000) + "...(truncated)" : result;
            responseData = { result: truncated };
          }

          functionResponses.push({
            functionResponse: { name, response: responseData },
          });
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          console.error(`   ❌ Tool error (${name}): ${errMsg}`);
          functionResponses.push({
            functionResponse: { name, response: { error: errMsg } },
          });
        }
      }

      response = await withTimeout(chat.sendMessage(functionResponses));
    }

    return "⚠️ Agent reached maximum iteration limit. Please try a simpler request.";
  }
}
