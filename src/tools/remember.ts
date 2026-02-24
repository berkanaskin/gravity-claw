import type { ToolDefinition } from "../agent.js";
import type { MemorySystem } from "../memory/index.js";

export function createRememberTool(memory: MemorySystem): ToolDefinition {
  return {
    name: "remember",
    description:
      "Store a piece of information in long-term memory. Use this when the user tells you something important about themselves, their preferences, or asks you to remember something. Always store the core fact, not the full conversation.",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The fact or information to remember (concise, factual)",
        },
        category: {
          type: "string",
          description:
            "Category for the memory: 'preference', 'fact', 'note', or 'general'",
        },
      },
      required: ["content"],
    },
    execute: async (input: Record<string, unknown>) => {
      const content = input.content as string;
      const category = (input.category as string) || "general";

      const id = await memory.remember(content, category);
      return JSON.stringify({
        success: true,
        id,
        message: `Stored memory: "${content}" [${category}]`,
        totalMemories: memory.count(),
      });
    },
  };
}
