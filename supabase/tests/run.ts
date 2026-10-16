// Runs supabase/tests/rls.sql against the linked project through the
// Supabase Management API. The SQL rolls itself back; success is "rls ok".
import { readFileSync } from "node:fs";

process.loadEnvFile(new URL("../../.env", import.meta.url));
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = new URL(process.env.SUPABASE_URL ?? "").hostname.split(".")[0];
if (!token || !ref) throw new Error("SUPABASE_ACCESS_TOKEN and SUPABASE_URL must be set in .env");

const query = readFileSync(new URL("rls.sql", import.meta.url), "utf8");
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ query }),
});
const text = await res.text();
if (text.includes("rls ok")) {
  console.log("row-level security: ok");
} else {
  console.error("row-level security check failed:", text);
  process.exit(1);
}
