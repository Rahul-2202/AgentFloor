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
  /** Daytona secret with the Claude credential, limited to api.anthropic.com. */
  DAYTONA_CLAUDE_SECRET: z.string().default("agentfloor-claude-token"),
  /** How office VMs reach this API's office link. Railway gives RAILWAY_PUBLIC_DOMAIN. */
  LINK_URL: z.string().optional(),
  RAILWAY_PUBLIC_DOMAIN: z.string().optional(),
});

export interface Config {
  port: number;
  host: string;
  supabaseUrl: string;
  supabaseSecretKey: string;
  jwksUrl: string;
  issuer: string;
  webOrigins: string[];
  daytona: { apiKey: string; snapshot: string; claudeSecret: string; linkUrl: string } | null;
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
  };
}

function daytonaConfig(e: z.infer<typeof schema>): Config["daytona"] {
  if (!e.DAYTONA_API_KEY) return null;
  const linkUrl = e.LINK_URL ?? (e.RAILWAY_PUBLIC_DOMAIN ? `wss://${e.RAILWAY_PUBLIC_DOMAIN}/office-link` : null);
  if (!linkUrl) throw new Error("Bad configuration:\n  LINK_URL: needed with DAYTONA_API_KEY (how office VMs reach this API)");
  return { apiKey: e.DAYTONA_API_KEY, snapshot: e.OFFICE_SNAPSHOT, claudeSecret: e.DAYTONA_CLAUDE_SECRET, linkUrl };
}
