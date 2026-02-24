import type { ToolDefinition } from "../agent.js";

export const getCurrentTime: ToolDefinition = {
  name: "get_current_time",
  description:
    "Returns the current date and time. Use this when the user asks what time it is, what today's date is, or any time-related question.",
  parameters: {
    type: "object",
    properties: {
      timezone: {
        type: "string",
        description:
          'IANA timezone string (e.g. "Europe/Istanbul", "America/New_York"). Defaults to system timezone if not provided.',
      },
    },
    required: [],
  },
  execute: async (input: Record<string, unknown>): Promise<string> => {
    const tz = (input.timezone as string) || undefined;

    const now = new Date();

    const options: Intl.DateTimeFormatOptions = {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      ...(tz ? { timeZone: tz } : {}),
    };

    const formatted = new Intl.DateTimeFormat("en-US", options).format(now);
    const iso = now.toISOString();

    return JSON.stringify({
      iso,
      formatted,
      timezone: tz || Intl.DateTimeFormat().resolvedOptions().timeZone,
      unix: Math.floor(now.getTime() / 1000),
    });
  },
};
