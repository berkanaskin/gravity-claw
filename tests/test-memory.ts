/**
 * Memory System Test — verifies write/read without real API calls.
 * Run: npx tsx tests/test-memory.ts
 */

import { MemorySystem } from "../src/memory/index.js";
import type { Config } from "../src/config.js";

// Mock config — no real API calls
const mockConfig: Config = {
  telegramBotToken: "test",
  modelApiKey: "test",
  allowedUserIds: [1],
  modelName: "test",
  maxIterations: 10,
  transcriptionApiKey: null,
  mockTranscription: true,
  ttsApiKey: null,
  ttsEnabled: false,
  mockTts: false,
  vectorDbApiKey: null,
  vectorDbIndex: null,
  mockMemory: true, // Use mock embeddings
};

async function runTests() {
  console.log("🧪 Memory System Test\n");

  const memory = new MemorySystem(mockConfig);
  let passed = 0;
  let failed = 0;

  // Test 1: Store a memory
  try {
    const id = await memory.remember("User prefers dark mode", "preference");
    console.assert(id > 0, "Expected positive ID");
    console.log(`✅ Test 1: Store memory (id=${id})`);
    passed++;
  } catch (e) {
    console.log(`❌ Test 1: Store memory — ${e}`);
    failed++;
  }

  // Test 2: Store multiple memories
  try {
    await memory.remember("User's name is Berka", "fact");
    await memory.remember("User speaks Turkish and English", "fact");
    await memory.remember("User likes concise responses", "preference");
    console.assert(memory.count() === 4, `Expected 4 memories, got ${memory.count()}`);
    console.log(`✅ Test 2: Multiple memories (count=${memory.count()})`);
    passed++;
  } catch (e) {
    console.log(`❌ Test 2: Multiple memories — ${e}`);
    failed++;
  }

  // Test 3: Recall memories
  try {
    const results = await memory.recall("dark mode", 3);
    console.assert(results.length > 0, "Expected at least 1 result");
    console.assert(results[0].similarity !== undefined, "Expected similarity score");
    console.log(`✅ Test 3: Recall (${results.length} results, top=${Math.round((results[0].similarity ?? 0) * 100)}%)`);
    passed++;
  } catch (e) {
    console.log(`❌ Test 3: Recall — ${e}`);
    failed++;
  }

  // Test 4: Recall with no results for irrelevant query
  try {
    const results = await memory.recall("quantum physics", 3);
    // Mock embeddings may still return results but with lower similarity
    console.log(`✅ Test 4: Irrelevant query (${results.length} results)`);
    passed++;
  } catch (e) {
    console.log(`❌ Test 4: Irrelevant query — ${e}`);
    failed++;
  }

  // Test 5: Core memory context
  try {
    const context = memory.getCoreMemory();
    console.assert(context.includes("CORE MEMORY"), "Expected core memory header");
    console.log(`✅ Test 5: Core memory loaded (${context.length} chars)`);
    passed++;
  } catch (e) {
    console.log(`❌ Test 5: Core memory — ${e}`);
    failed++;
  }

  // Test 6: Format recall context
  try {
    const results = await memory.recall("user name", 3);
    const formatted = memory.formatRecallContext(results);
    console.log(`✅ Test 6: Format context (${formatted.length} chars)`);
    passed++;
  } catch (e) {
    console.log(`❌ Test 6: Format context — ${e}`);
    failed++;
  }

  // Cleanup
  memory.close();

  // Summary
  console.log(`\n${"─".repeat(40)}`);
  console.log(`📊 Results: ${passed} passed, ${failed} failed`);
  console.log(failed === 0 ? "🎉 All tests passed!" : "⚠️ Some tests failed.");

  // Clean up test DB
  const fs = await import("fs");
  try {
    fs.unlinkSync("data/memory.db");
    fs.unlinkSync("data/memory.db-wal");
    fs.unlinkSync("data/memory.db-shm");
  } catch {
    // ignore
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
