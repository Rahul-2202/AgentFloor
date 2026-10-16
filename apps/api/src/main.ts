import { loadEnv } from "@agentfloor/shared/env";
import { buildApp } from "./app.ts";
import { makeVerifier } from "./auth.ts";
import { loadConfig } from "./config.ts";
import { OfficeHub } from "./link/hub.ts";
import { supabaseLinkStore } from "./link/store.ts";
import { serviceClient, supabaseOfficeStore } from "./offices.ts";

loadEnv();
let config;
try {
  config = loadConfig();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const db = serviceClient(config.supabaseUrl, config.supabaseSecretKey);
const app = await buildApp({
  verify: makeVerifier(config),
  offices: supabaseOfficeStore(db),
  hub: new OfficeHub(supabaseLinkStore(db), (msg) => console.log(msg)),
  webOrigins: config.webOrigins,
  logger: true,
});
await app.listen({ port: config.port, host: config.host });

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => void app.close().then(() => process.exit(0)));
}
