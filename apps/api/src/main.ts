import { loadEnv } from "@agentfloor/shared/env";
import { buildApp } from "./app.ts";
import { makeVerifier } from "./auth.ts";
import { loadConfig } from "./config.ts";
import { OfficeHub } from "./link/hub.ts";
import { supabaseLinkStore } from "./link/store.ts";
import { daytonaCloud } from "./machines/cloud.ts";
import { OfficeMachines, supabaseMachineStore } from "./machines/lifecycle.ts";
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
const link = supabaseLinkStore(db);
const hub = new OfficeHub(link, (msg) => console.log(msg));
const machines = config.daytona
  ? new OfficeMachines({
      cloud: daytonaCloud(config.daytona.apiKey),
      machines: supabaseMachineStore(db),
      link,
      connectedSince: (id) => hub.connectedSince(id),
      snapshot: config.daytona.snapshot,
      kind: config.daytona.kind,
      appDir: config.daytona.kind === "vm" ? "~/agentfloor" : "/opt/agentfloor",
      linkUrl: config.daytona.linkUrl,
      claudeSecret: config.daytona.claudeSecret,
      log: (msg) => console.log(msg),
    })
  : null;
if (machines) hub.onActivity = (id) => void machines.activity(id).catch((err) => console.error(`keep-awake: ${err.message}`));
const app = await buildApp({
  verify: makeVerifier(config),
  offices: supabaseOfficeStore(db),
  hub,
  machines,
  webOrigins: config.webOrigins,
  logger: true,
});
await app.listen({ port: config.port, host: config.host });

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => void app.close().then(() => process.exit(0)));
}
