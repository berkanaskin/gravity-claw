import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { Config } from "../config.js";

// ── Synthesizer Interface ────────────────────────────────────

export interface Synthesizer {
  synthesize(text: string): Promise<SynthResult>;
}

export interface SynthResult {
  /** Path to the temporary audio file */
  filePath: string;
  /** Cleanup function — call after sending to Telegram */
  cleanup: () => void;
}

// ── Google Cloud TTS Synthesizer ─────────────────────────────

export class GoogleTTSSynthesizer implements Synthesizer {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async synthesize(text: string): Promise<SynthResult> {
    // Truncate to TTS limit (5000 chars max for Google Cloud TTS)
    const truncated = text.length > 5000 ? text.substring(0, 4997) + "..." : text;

    const response = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { text: truncated },
          voice: {
            languageCode: "tr-TR",
            name: "tr-TR-Wavenet-B",
            ssmlGender: "MALE",
          },
          audioConfig: {
            audioEncoding: "OGG_OPUS",
            sampleRateHertz: 48000,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Google TTS API error (${response.status}): ${errorBody}`);
    }

    const data = (await response.json()) as { audioContent: string };

    if (!data.audioContent) {
      throw new Error("Google TTS returned no audio content");
    }

    // Write to temp file
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `claw-tts-${Date.now()}.ogg`);
    const audioBuffer = Buffer.from(data.audioContent, "base64");
    fs.writeFileSync(tempFile, audioBuffer);

    console.log(`   🔊 TTS generated: ${(audioBuffer.length / 1024).toFixed(1)} KB`);

    return {
      filePath: tempFile,
      cleanup: () => {
        try {
          if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
          }
        } catch {
          // Best-effort cleanup
        }
      },
    };
  }
}

// ── Mock Synthesizer ─────────────────────────────────────────

export class MockSynthesizer implements Synthesizer {
  async synthesize(_text: string): Promise<SynthResult> {
    console.log("   🧪 [MOCK] TTS — generating silent OGG");

    // Create a minimal valid OGG file (silent)
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `claw-tts-mock-${Date.now()}.ogg`);

    // Write a tiny silent audio placeholder
    const silentOgg = Buffer.alloc(256, 0);
    fs.writeFileSync(tempFile, silentOgg);

    return {
      filePath: tempFile,
      cleanup: () => {
        try {
          if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
          }
        } catch {
          // Best-effort cleanup
        }
      },
    };
  }
}

// ── Factory ──────────────────────────────────────────────────

export function createSynthesizer(config: Config): Synthesizer | null {
  if (!config.ttsEnabled) {
    return null;
  }

  if (config.mockTts) {
    console.log("   🧪 TTS mode: MOCK (no API calls)");
    return new MockSynthesizer();
  }

  if (!config.ttsApiKey) {
    console.warn("   ⚠️ TTS enabled but TTS_API_KEY not set — TTS disabled");
    return null;
  }

  return new GoogleTTSSynthesizer(config.ttsApiKey);
}
