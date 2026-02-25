import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Config } from "../config.js";

// ── Transcriber Interface ────────────────────────────────────

export interface Transcriber {
  transcribe(audioBuffer: Buffer, mimeType: string): Promise<string>;
}

// ── Gemini Transcriber ───────────────────────────────────────
// Uses Gemini's native multimodal audio understanding.
// No extra API key needed — uses the same MODEL_API_KEY.

export class GeminiTranscriber implements Transcriber {
  private readonly genAI: GoogleGenerativeAI;
  private readonly modelName: string;

  constructor(config: Config) {
    const apiKey = config.transcriptionApiKey || config.modelApiKey;
    this.genAI = new GoogleGenerativeAI(apiKey);
    // Always use a Gemini model for transcription — independent of main model
    // This allows GPT-5.2 as main brain while Gemini handles audio transcription
    this.modelName = "gemini-2.5-flash";
    console.log(`   🎤 Transcription model: ${this.modelName} (Gemini)`);
  }

  async transcribe(audioBuffer: Buffer, mimeType: string): Promise<string> {
    const model = this.genAI.getGenerativeModel({ model: this.modelName });

    const audioPart = {
      inlineData: {
        data: audioBuffer.toString("base64"),
        mimeType,
      },
    };

    const result = await model.generateContent([
      {
        text: "Transcribe this audio message exactly as spoken. Return ONLY the transcription text, nothing else. If the audio is unclear or empty, respond with '[inaudible]'.",
      },
      audioPart,
    ]);

    const response = result.response;
    const text = response.text().trim();

    if (!text) {
      throw new Error("Transcription returned empty result");
    }

    return text;
  }
}

// ── Mock Transcriber ─────────────────────────────────────────
// For local testing without API calls.

export class MockTranscriber implements Transcriber {
  async transcribe(_audioBuffer: Buffer, _mimeType: string): Promise<string> {
    console.log("   🧪 [MOCK] Transcription — returning test text");
    return "This is a mock transcription for testing purposes.";
  }
}

// ── Factory ──────────────────────────────────────────────────

export function createTranscriber(config: Config): Transcriber {
  if (config.mockTranscription) {
    console.log("   🧪 Transcription mode: MOCK (no API calls)");
    return new MockTranscriber();
  }
  return new GeminiTranscriber(config);
}
