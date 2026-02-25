import "dotenv/config";

export interface Config {
  telegramBotToken: string;
  modelApiKey: string;
  allowedUserIds: number[];
  modelName: string;
  fallbackModel: string;
  maxIterations: number;
  // Voice input
  transcriptionApiKey: string | null;
  mockTranscription: boolean;
  // Voice output (TTS)
  ttsApiKey: string | null;
  ttsEnabled: boolean;
  mockTts: boolean;
  // Memory
  vectorDbApiKey: string | null;
  vectorDbIndex: string | null;
  mockMemory: boolean;
  // MCP
  enableMcp: boolean;
  notionApiKey: string | null;
  // PC Bridge
  enablePcBridge: boolean;
  pcBridgeUrl: string;
  pcBridgeToken: string;
  // CENTO Orchestrator
  orchestratorEnabled: boolean;
  orchestratorModel: string;
  openaiApiKey: string | null;
  // OpenAI API base URL (set to https://api.openai.com/v1 when using GPT models)
  modelApiBase: string | null;
  // Heartbeat
  heartbeatEnabled: boolean;
  heartbeatCron: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`❌ Missing required environment variable: ${name}`);
    console.error(`   → Copy .env.example to .env and fill in your values.`);
    process.exit(1);
  }
  return value;
}

export function loadConfig(): Config {
  const ttsApiKey = process.env["TTS_API_KEY"] || null;

  const config: Config = {
    telegramBotToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    modelApiKey: requireEnv("MODEL_API_KEY"),
    allowedUserIds: requireEnv("TELEGRAM_ALLOWLIST_USER_ID")
      .split(",")
      .map((id) => {
        const parsed = parseInt(id.trim(), 10);
        if (isNaN(parsed)) {
          console.error(`❌ Invalid user ID in TELEGRAM_ALLOWLIST_USER_ID: "${id}"`);
          process.exit(1);
        }
        return parsed;
      }),
    modelName: process.env["MODEL_NAME"] || "gemini-2.5-pro",
    fallbackModel: process.env["FALLBACK_MODEL"] || "gemini-2.5-flash",
    maxIterations: parseInt(process.env["MAX_ITERATIONS"] || "10", 10),
    // Voice input
    transcriptionApiKey: process.env["TRANSCRIPTION_API_KEY"] || null,
    mockTranscription: process.env["MOCK_TRANSCRIPTION"] === "true",
    // Voice output
    ttsApiKey,
    ttsEnabled: !!ttsApiKey || process.env["MOCK_TTS"] === "true",
    mockTts: process.env["MOCK_TTS"] === "true",
    // Memory
    vectorDbApiKey: process.env["VECTOR_DB_API_KEY"] || null,
    vectorDbIndex: process.env["VECTOR_DB_INDEX"] || null,
    mockMemory: process.env["MOCK_MEMORY"] === "true",
    // MCP
    enableMcp: process.env["ENABLE_MCP"] !== "false",
    notionApiKey: process.env["NOTION_API_KEY"] || null,
    // PC Bridge
    enablePcBridge: process.env["ENABLE_PC_BRIDGE"] === "true",
    pcBridgeUrl: process.env["PC_BRIDGE_URL"] || "ws://berkan:3847/ws",
    pcBridgeToken: process.env["PC_BRIDGE_TOKEN"] || "gravity-claw-bridge-2026",
    // CENTO Orchestrator
    orchestratorEnabled: process.env["ORCHESTRATOR_ENABLED"] === "true",
    orchestratorModel: process.env["ORCHESTRATOR_MODEL"] || "gpt-5.2",
    openaiApiKey: process.env["OPENAI_API_KEY"] || null,
    modelApiBase: process.env["MODEL_API_BASE"] || null,
    // Heartbeat
    heartbeatEnabled: process.env["HEARTBEAT_ENABLED"] !== "false",
    heartbeatCron: process.env["HEARTBEAT_CRON"] || "0 8 * * *",
  };

  if (config.allowedUserIds.length === 0) {
    console.error("❌ TELEGRAM_ALLOWLIST_USER_ID must contain at least one user ID.");
    process.exit(1);
  }

  // NEVER log secrets — only confirm features
  console.log("✅ Config loaded:");
  console.log(`   Model: ${config.modelName}${config.modelApiBase ? ` (${config.modelApiBase})` : " (Gemini)"}`);
  console.log(`   OpenAI Key: ${config.openaiApiKey ? "✅ set" : "⬚ not set"}`);
  console.log(`   Allowed users: ${config.allowedUserIds.length} user(s)`);
  console.log(`   Max iterations: ${config.maxIterations}`);

  // Voice input
  if (config.mockTranscription) {
    console.log("   Voice input: ✅ enabled (MOCK)");
  } else {
    console.log("   Voice input: ✅ enabled (Gemini native)");
  }

  // TTS
  if (config.mockTts) {
    console.log("   Voice output: ✅ enabled (MOCK)");
  } else if (config.ttsEnabled) {
    console.log("   Voice output: ✅ enabled (Google Cloud TTS)");
  } else {
    console.log("   Voice output: ⬚ disabled (set TTS_API_KEY to enable)");
  }

  // Memory
  if (config.mockMemory) {
    console.log("   Memory: ✅ enabled (MOCK embeddings)");
  } else {
    console.log("   Memory: ✅ enabled (Gemini embeddings + SQLite)");
  }

  // MCP
  if (config.enableMcp) {
    console.log("   MCP: ✅ enabled");
  } else {
    console.log("   MCP: ⬚ disabled (set ENABLE_MCP=true to enable)");
  }

  // PC Bridge
  if (config.enablePcBridge) {
    console.log(`   PC Bridge: ✅ enabled (${config.pcBridgeUrl})`);
  } else {
    console.log("   PC Bridge: ⬚ disabled (set ENABLE_PC_BRIDGE=true)");
  }

  // CENTO Orchestrator
  if (config.orchestratorEnabled) {
    console.log(`   CENTO: ✅ enabled (${config.orchestratorModel})`);
  } else {
    console.log("   CENTO: ⬚ disabled (set ORCHESTRATOR_ENABLED=true)");
  }

  // Heartbeat
  if (config.heartbeatEnabled) {
    console.log(`   Heartbeat: ✅ enabled (${config.heartbeatCron})`);
  } else {
    console.log("   Heartbeat: ⬚ disabled (set HEARTBEAT_ENABLED=true)");
  }

  return config;
}
