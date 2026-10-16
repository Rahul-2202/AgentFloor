import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default("0.0.0.0"),
  SUPABASE_URL: z.url(),
  /** Server-only key; bypasses row-level security. Never sent to browsers or office VMs. */
  SUPABASE_SECRET_KEY: z.string().min(1),
  /** Origins allowed to call the API from a browser, comma-separated. */
  WEB_ORIGINS: z.string().default("http://localhost:3000"),
});

export interface Config {
  port: number;
  host: string;
  supabaseUrl: string;
  supabaseSecretKey: string;
  jwksUrl: string;
  issuer: string;
  webOrigins: string[];
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
  };
}
