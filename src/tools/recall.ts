import type { ToolDefinition } from "../agent.js";
import type { MemorySystem } from "../memory/index.js";

export function createRecallTool(memory: MemorySystem): ToolDefinition {
  return {
    name: "recall",
    description:
      "Search long-term memory for relevant information. Use this when you need to remember past conversations, user preferences, or stored facts. Returns the most relevant matches ranked by similarity.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query — describe what you're looking for",
        },
        topK: {
          type: "number",
          description: "Maximum number of results to return (default: 5)",
        },
      },
      required: ["query"],
    },
    execute: async (input: Record<string, unknown>) => {
      const query = input.query as string;
      const topK = (input.topK as number) || 5;

      const results = await memory.recall(query, topK);

      if (results.length === 0) {
        return JSON.stringify({
          success: true,
          results: [],
          message: "No relevant memories found.",
        });
      }

      return JSON.stringify({
        success: true,
        results: results.map((m) => ({
          content: m.content,
          category: m.category,
          timestamp: m.timestamp,
          similarity: Math.round((m.similarity ?? 0) * 100) + "%",
        })),
        message: `Found ${results.length} relevant memory(ies)`,
      });
    },
  };
}
