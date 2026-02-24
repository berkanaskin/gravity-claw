import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ToolDefinition } from "../agent.js";
import type { Config } from "../config.js";

// ── Web Search Tool ──────────────────────────────────────────
// Uses a SEPARATE Gemini call with Google Search grounding enabled.
// This works because the main agent model can't mix function calling
// with google_search in the same request.

export function createWebSearchTool(config: Config): ToolDefinition {
  return {
    name: "web_search",
    description:
      "Search the web for real-time information. Use this for current events, " +
      "news, weather, prices, sports scores, or anything that requires up-to-date data. " +
      "Returns a summary with sources.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query (e.g., 'Bitcoin price today', 'Istanbul weather')",
        },
      },
      required: ["query"],
    },
    execute: async (args) => {
      const query = args["query"] as string;
      console.log(`   🌐 Web search: "${query}"`);

      try {
        // Use a simpler model for search (faster, cheaper)
        const genAI = new GoogleGenerativeAI(config.modelApiKey);
        const searchModel = genAI.getGenerativeModel({
          model: "gemini-2.5-flash",
          tools: [{ google_search: {} } as any],
        });

        const result = await searchModel.generateContent(query);
        const response = result.response;
        const text = response.text();

        // Extract grounding metadata if available
        const metadata = (response as any).candidates?.[0]?.groundingMetadata;
        let sources = "";
        if (metadata?.groundingChunks) {
          const urls = metadata.groundingChunks
            .filter((c: any) => c.web?.uri)
            .map((c: any) => c.web.uri)
            .slice(0, 3);
          if (urls.length > 0) {
            sources = "\n\nKaynaklar:\n" + urls.map((u: string) => `• ${u}`).join("\n");
          }
        }

        return JSON.stringify({
          query,
          result: text + sources,
        });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(`   ❌ Web search failed: ${errMsg}`);
        return JSON.stringify({
          query,
          error: `Arama başarısız: ${errMsg}`,
        });
      }
    },
  };
}
