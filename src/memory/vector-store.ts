import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import type { Embedder } from "./embedder.js";

// ── Types ────────────────────────────────────────────────────

export interface MemoryEntry {
  id: number;
  content: string;
  category: string;
  timestamp: string;
  similarity?: number;
}

// ── Vector Store ─────────────────────────────────────────────
// SQLite-backed vector storage with cosine similarity search.

export class VectorStore {
  private readonly db: Database.Database;
  private readonly embedder: Embedder;

  constructor(dbPath: string, embedder: Embedder) {
    // Ensure data directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.embedder = embedder;

    // Enable WAL mode for better concurrency
    this.db.pragma("journal_mode = WAL");

    // Create table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        embedding BLOB NOT NULL,
        category TEXT DEFAULT 'general',
        timestamp TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `);

    // Index for category filtering
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category)
    `);
  }

  /**
   * Store a memory with its embedding.
   */
  async store(content: string, category: string = "general"): Promise<number> {
    const embedding = await this.embedder.embed(content);
    const embeddingBlob = Buffer.from(new Float64Array(embedding).buffer);
    const timestamp = new Date().toISOString();

    const stmt = this.db.prepare(
      "INSERT INTO memories (content, embedding, category, timestamp) VALUES (?, ?, ?, ?)"
    );
    const result = stmt.run(content, embeddingBlob, category, timestamp);

    console.log(`   💾 Memory stored (id=${result.lastInsertRowid}, cat=${category})`);
    return result.lastInsertRowid as number;
  }

  /**
   * Recall memories by semantic similarity to a query.
   */
  async recall(query: string, topK: number = 5, category?: string): Promise<MemoryEntry[]> {
    const queryEmbedding = await this.embedder.embed(query);

    // Fetch all memories (or filtered by category)
    const stmt = category
      ? this.db.prepare("SELECT id, content, embedding, category, timestamp FROM memories WHERE category = ?")
      : this.db.prepare("SELECT id, content, embedding, category, timestamp FROM memories");

    const rows = category ? stmt.all(category) : stmt.all();

    // Compute cosine similarity for each
    const scored: MemoryEntry[] = (rows as Array<{
      id: number;
      content: string;
      embedding: Buffer;
      category: string;
      timestamp: string;
    }>).map((row) => {
      const storedEmbedding = Array.from(new Float64Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 8));
      const similarity = cosineSimilarity(queryEmbedding, storedEmbedding);
      return {
        id: row.id,
        content: row.content,
        category: row.category,
        timestamp: row.timestamp,
        similarity,
      };
    });

    // Sort by similarity descending, return top-k
    scored.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
    return scored.slice(0, topK);
  }

  /**
   * Get total memory count.
   */
  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM memories").get() as { count: number };
    return row.count;
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}

// ── Cosine Similarity ────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}
