import * as path from "path";
import type { Config } from "../config.js";
import { createEmbedder, type Embedder } from "./embedder.js";
import { VectorStore, type MemoryEntry } from "./vector-store.js";
import { getCoreMemoryContext } from "./core-memory.js";
import { appendMemoryLog } from "./memory-log.js";

export type { MemoryEntry } from "./vector-store.js";

// ── Memory System ────────────────────────────────────────────
// Wires together: embedder + vector store + core memory + log.

export class MemorySystem {
  private readonly vectorStore: VectorStore;
  private readonly coreMemoryContext: string;

  constructor(config: Config) {
    const embedder = createEmbedder(config);
    const dbPath = path.join("data", "memory.db");
    this.vectorStore = new VectorStore(dbPath, embedder);
    this.coreMemoryContext = getCoreMemoryContext();

    console.log(`   💾 Memory DB: ${dbPath} (${this.vectorStore.count()} memories)`);
  }

  /**
   * Store a new memory.
   */
  async remember(content: string, category: string = "general"): Promise<number> {
    const id = await this.vectorStore.store(content, category);
    appendMemoryLog("Stored", content);
    return id;
  }

  /**
   * Recall relevant memories by semantic similarity.
   */
  async recall(query: string, topK: number = 5): Promise<MemoryEntry[]> {
    const results = await this.vectorStore.recall(query, topK);
    if (results.length > 0) {
      appendMemoryLog("Recalled", `query="${query}" → ${results.length} result(s)`);
    }
    return results;
  }

  /**
   * Get core memory context for the system prompt.
   */
  getCoreMemory(): string {
    return this.coreMemoryContext;
  }

  /**
   * Format recalled memories as context for the agent.
   */
  formatRecallContext(memories: MemoryEntry[]): string {
    if (memories.length === 0) return "";

    const lines = memories
      .filter((m) => (m.similarity ?? 0) > 0.3) // Only include relevant matches
      .map(
        (m, i) =>
          `${i + 1}. [${m.category}] ${m.content} (${(m.similarity! * 100).toFixed(0)}% match)`
      );

    if (lines.length === 0) return "";

    return `\n\n--- RECALLED MEMORIES ---\n${lines.join("\n")}\n--- END MEMORIES ---`;
  }

  /**
   * Get total stored memory count.
   */
  count(): number {
    return this.vectorStore.count();
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.vectorStore.close();
  }
}
