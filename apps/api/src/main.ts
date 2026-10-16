import { fileURLToPath } from "node:url";
import { loadEnv } from "@agentfloor/shared/env";
import { agentSdkBrain } from "./ada/brain.ts";
import { supabaseOfficeData } from "./ada/data.ts";
import { buildApp } from "./app.ts";
import { makeVerifier } from "./auth.ts";
import { supabaseBudgetStore } from "./budgets.ts";
import { loadConfig } from "./config.ts";
import { GitHubApp } from "./github/app.ts";
import { supabaseGitHubStore } from "./github/service.ts";
import { supabaseConversationSource } from "./memory/office.ts";
import { supabaseMemoryStore } from "./memory/store.ts";
import { supabaseLinkStore } from "./link/store.ts";
import { daytonaCloud } from "./machines/cloud.ts";
import { daemonBundle } from "./machines/code.ts";
import { supabaseMachineStore } from "./machines/lifecycle.ts";
import { serviceClient, supabaseOfficeStore } from "./offices.ts";
import { supabaseProjectionStore } from "./projection/writer.ts";
import { createServices } from "./services.ts";
import { supabaseSetupStore } from "./setup/store.ts";

loadEnv();
let config;
try {
  config = loadConfig();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const db = serviceClient(config.supabaseUrl, config.supabaseSecretKey);
const verify = makeVerifier(config);
const log = (msg: string) => console.log(msg);
const s = createServices({
  verify,
  log,
  stores: {
    offices: supabaseOfficeStore(db),
    link: supabaseLinkStore(db),
    setups: supabaseSetupStore(db),
    projections: supabaseProjectionStore(db),
    budgets: supabaseBudgetStore(db),
    machines: supabaseMachineStore(db),
    github: supabaseGitHubStore(db),
    memory: supabaseMemoryStore(db),
    conversations: supabaseConversationSource(db),
    data: supabaseOfficeData(db),
  },
  ada: config.ada ? { brain: agentSdkBrain({ token: config.ada.token, model: config.ada.model, effort: config.ada.effort }) } : null,
  github: config.github ? { app: new GitHubApp(config.github) } : null,
  machine: config.daytona
    ? {
        cloud: daytonaCloud(config.daytona.apiKey),
        snapshot: config.daytona.snapshot,
        kind: config.daytona.kind,
        appDir: config.daytona.kind === "vm" ? "~/agentfloor" : "/opt/agentfloor",
        linkUrl: config.daytona.linkUrl,
        claudeSecret: config.daytona.claudeSecret,
        // The daemon code from this deploy (same repo): office machines are brought up to it on start.
        code: daemonBundle(fileURLToPath(new URL("../../..", import.meta.url))),
        log,
      }
    : null,
});

const app = await buildApp({
  verify,
  offices: s.stores.offices,
  hub: s.hub,
  machines: s.machines,
  setup: s.setup,
  budgets: s.budgets,
  spend: s.stores.budgets,
  watchers: s.watchers,
  github: s.github,
  ada: s.ada,
  meetings: s.meetings,
  memory: s.memory,
  inboxItem: async (officeId, id) => {
    const { data } = await db.from("inbox_items").select("id, from, kind").eq("office_id", officeId).eq("id", id).maybeSingle();
    return data;
  },
  audit: async (officeId, actor, action, target, detail) => {
    if (officeId) await db.from("audit_log").insert({ office_id: officeId, actor, action, target, detail });
  },
  officeForRepo: async (fullName) => {
    const { data } = await db.from("integrations").select("office_id").eq("provider", "github").eq("config->>repo", fullName).limit(1).maybeSingle();
    return data?.office_id ?? null;
  },
  resolveOwnInbox: async (officeId, id) => {
    const { error } = await db.from("inbox_items").update({ state: "resolved", resolved_at: new Date().toISOString() }).eq("office_id", officeId).eq("id", id);
    if (error) throw new Error(error.message);
  },
  webOrigins: config.webOrigins,
  logger: true,
});
await app.listen({ port: config.port, host: config.host });

// Every 10 minutes: budgets (a new day releases agents held yesterday), and the morning briefing.
const briefed = new Map<string, string>();
const budgetTimer = setInterval(() => {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  for (const id of s.hub.connectedOffices()) {
    void s.budgets.check(id).catch((err) => log(`budgets: ${err.message}`));
    if (s.ada && config.ada && now.getUTCHours() === config.ada.briefingHourUtc && briefed.get(id) !== day) {
      briefed.set(id, day);
      void s.ada.briefing(id, now).catch((err) => log(`briefing: ${err.message}`));
    }
  }
}, 10 * 60_000);

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    clearInterval(budgetTimer);
    void app.close().then(() => process.exit(0));
  });
}
