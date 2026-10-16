import { readFileSync } from "node:fs";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default("0.0.0.0"),
  SUPABASE_URL: z.url(),
  /** Server-only key; bypasses row-level security. Never sent to browsers or office VMs. */
  SUPABASE_SECRET_KEY: z.string().min(1),
  /** Origins allowed to call the API from a browser, comma-separated. */
  WEB_ORIGINS: z.string().default("http://localhost:3000"),
  /** Office VMs (Daytona). Without a key, offices can't be started (everything else works). */
  DAYTONA_API_KEY: z.string().optional(),
  OFFICE_SNAPSHOT: z.string().default("agentfloor-office"),
  /** "container" until Daytona enables Linux VMs for the organization. */
  OFFICE_SANDBOX_KIND: z.enum(["container", "vm"]).default("container"),
  /** Daytona secret with the Claude credential, limited to api.anthropic.com. */
  DAYTONA_CLAUDE_SECRET: z.string().default("agentfloor-claude-token"),
  /** How office VMs reach this API's office link. Railway gives RAILWAY_PUBLIC_DOMAIN. */
  LINK_URL: z.string().optional(),
  RAILWAY_PUBLIC_DOMAIN: z.string().optional(),
  /** The GitHub App (agents' repo access). Without it, GitHub features are off. */
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_SLUG: z.string().optional(),
  /** The app's private key: the PEM itself (Railway), or a path to the .pem file (local). */
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY_PATH: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  /** Ada runs on the company's Claude login (claude setup-token). Without it, Ada is off. */
  AGENTFLOOR_CLAUDE_TOKEN: z.string().optional(),
  ADA_MODEL: z.string().default("haiku"),
  ADA_EFFORT: z.enum(["low", "medium", "high"]).default("low"),
  /** Hour of the day (UTC) for Ada's daily briefing. */
  BRIEFING_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(7),
});

export interface Config {
  port: number;
  host: string;
  supabaseUrl: string;
  supabaseSecretKey: string;
  jwksUrl: string;
  issuer: string;
  webOrigins: string[];
  daytona: { apiKey: string; snapshot: string; kind: "container" | "vm"; claudeSecret: string; linkUrl: string } | null;
  github: { appId: string; slug: string; privateKey: string; webhookSecret: string } | null;
  ada: { token: string; model: string; effort: "low" | "medium" | "high"; briefingHourUtc: number } | null;
}

/** Reads and checks the environment; throws one error naming every missing or bad variable. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Bad configuration:\n${problems.join("\n")}`);
  }
  const e = parsed.data;
  const base = e.SUPABASE_URL.replace(/\/$/, "");
  return {
    port: e.PORT,
    host: e.HOST,
    supabaseUrl: base,
    supabaseSecretKey: e.SUPABASE_SECRET_KEY,
    jwksUrl: `${base}/auth/v1/.well-known/jwks.json`,
    issuer: `${base}/auth/v1`,
    webOrigins: e.WEB_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean),
    daytona: daytonaConfig(e),
    github: githubConfig(e),
    ada: e.AGENTFLOOR_CLAUDE_TOKEN ? { token: e.AGENTFLOOR_CLAUDE_TOKEN, model: e.ADA_MODEL, effort: e.ADA_EFFORT, briefingHourUtc: e.BRIEFING_HOUR_UTC } : null,
  };
}

function daytonaConfig(e: z.infer<typeof schema>): Config["daytona"] {
  if (!e.DAYTONA_API_KEY) return null;
  const linkUrl = e.LINK_URL ?? (e.RAILWAY_PUBLIC_DOMAIN ? `wss://${e.RAILWAY_PUBLIC_DOMAIN}/office-link` : null);
  // Without an address the machines can reach (local development), office machines stay off.
  if (!linkUrl) return null;
  return { apiKey: e.DAYTONA_API_KEY, snapshot: e.OFFICE_SNAPSHOT, kind: e.OFFICE_SANDBOX_KIND, claudeSecret: e.DAYTONA_CLAUDE_SECRET, linkUrl };
}

function githubConfig(e: z.infer<typeof schema>): Config["github"] {
  const key = e.GITHUB_APP_PRIVATE_KEY ?? (e.GITHUB_APP_PRIVATE_KEY_PATH ? readFileSync(e.GITHUB_APP_PRIVATE_KEY_PATH, "utf8") : undefined);
  const parts = { GITHUB_APP_ID: e.GITHUB_APP_ID, GITHUB_APP_SLUG: e.GITHUB_APP_SLUG, "GITHUB_APP_PRIVATE_KEY(_PATH)": key, GITHUB_WEBHOOK_SECRET: e.GITHUB_WEBHOOK_SECRET };
  const missing = Object.entries(parts).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length === 4) return null;
  if (missing.length) throw new Error(`Bad configuration:\n  GitHub App needs ${missing.join(", ")}`);
  return { appId: e.GITHUB_APP_ID!, slug: e.GITHUB_APP_SLUG!, privateKey: key!, webhookSecret: e.GITHUB_WEBHOOK_SECRET! };
}
