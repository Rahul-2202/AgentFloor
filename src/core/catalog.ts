/**
 * The runtimes an agent can run on, with their models and effort levels. The
 * console builds its pickers from this, and the office validates changes
 * against it.
 */
export interface RuntimeInfo {
  label: string;
  models: { id: string; label: string }[];
  /** Effort levels the runtime accepts; empty if it has no effort setting. */
  efforts: string[];
  defaultModel: string;
  defaultEffort: string | null;
  /** Shown under the picker: what it needs and what it can't do yet. */
  note: string;
}

export const CATALOG: Record<string, RuntimeInfo> = {
  "claude-code": {
    label: "Claude Code",
    models: [
      { id: "haiku", label: "Claude Haiku" },
      { id: "sonnet", label: "Claude Sonnet" },
      { id: "opus", label: "Claude Opus" },
    ],
    efforts: ["low", "medium", "high"],
    defaultModel: "haiku",
    defaultEffort: "low",
    note: "Uses your Claude login. Questions reach it mid-task.",
  },
  junie: {
    label: "Junie",
    models: [
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite" },
      { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
      { id: "gemini-flash", label: "Gemini Flash (latest)" },
      { id: "gemini-pro", label: "Gemini Pro (latest)" },
    ],
    efforts: ["low", "medium", "high"],
    defaultModel: "gemini-3.5-flash-lite",
    defaultEffort: "low",
    note: "Uses GEMINI_API_KEY from .env. The free quota is small. Questions reach it when its turn ends.",
  },
  antigravity: {
    label: "Antigravity",
    models: [
      { id: "gemini-3.8-flash-low", label: "Gemini 3.8 Flash (Low)" },
      { id: "gemini-3.8-flash-medium", label: "Gemini 3.8 Flash (Medium)" },
      { id: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (Thinking)" },
      { id: "claude-opus-4-6-thinking", label: "Claude Opus 4.6 (Thinking)" },
      { id: "gpt-oss-120b-medium", label: "GPT-OSS 120B (Medium)" },
    ],
    efforts: ["low", "medium", "high"],
    defaultModel: "gemini-3.8-flash-low",
    defaultEffort: "low",
    note: "Uses your Google sign-in (agy). Questions reach it when its turn ends.",
  },
  scripted: {
    label: "Scripted (test)",
    models: [{ id: "script", label: "Follows its script" }],
    efforts: [],
    defaultModel: "script",
    defaultEffort: null,
    note: "No model: follows a script, for testing the office for free.",
  },
};

export const DEFAULT_RUNTIME = "claude-code";
