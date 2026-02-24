import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Config } from "../config.js";

// ── Embedder Interface ───────────────────────────────────────

export interface Embedder {
  embed(text: string): Promise<number[]>;
  readonly dimensions: number;
}

// ── Gemini Embedder ──────────────────────────────────────────
// Uses Gemini's text-embedding-004 model (768 dimensions, free).

export class GeminiEmbedder implements Embedder {
  private readonly genAI: GoogleGenerativeAI;
  readonly dimensions = 768;

  constructor(config: Config) {
    this.genAI = new GoogleGenerativeAI(config.modelApiKey);
  }

  async embed(text: string): Promise<number[]> {
    const model = this.genAI.getGenerativeModel({ model: "gemini-embedding-001" });
    const result = await model.embedContent(text);
    return result.embedding.values;
  }
}

// ── Mock Embedder ────────────────────────────────────────────
// Returns deterministic pseudo-random vectors for testing.

export class MockEmbedder implements Embedder {
  readonly dimensions = 768;

  async embed(text: string): Promise<number[]> {
    // Generate a deterministic vector from the text hash
    const vector: number[] = [];
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash * 31 + text.charCodeAt(i)) & 0x7fffffff;
    }
    for (let i = 0; i < this.dimensions; i++) {
      hash = (hash * 1103515245 + 12345) & 0x7fffffff;
      vector.push((hash / 0x7fffffff) * 2 - 1);
    }
    // Normalize
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return vector.map((v) => v / norm);
  }
}

// ── Factory ──────────────────────────────────────────────────

export function createEmbedder(config: Config): Embedder {
  if (config.mockMemory) {
    console.log("   🧪 Embedder mode: MOCK (deterministic vectors)");
    return new MockEmbedder();
  }
  return new GeminiEmbedder(config);
}
