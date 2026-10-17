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
import { LinearClient } from "./linear/client.ts";
import { supabaseLinearStore, supabaseTaskSource } from "./linear/service.ts";
import { backupMemory, supabaseAccess, supabaseAdminData, supabaseErrorLog } from "./ops/ops.ts";
import { ClaudeTokens, supabaseClaudeTokens, verifyWithAnthropic } from "./claude/tokens.ts";
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
const errors = supabaseErrorLog(db, (m) => console.log(m));
// Logged problems are tracked too (with the office, when the line names one).
const log = (msg: string) => {
  console.log(msg);
  if (/error|fail|refused|couldn't|can't|timed out|projecting|no unique/i.test(msg)) {
    errors.record("api", msg, { officeId: /office ([0-9a-f]{8}-[0-9a-f-]{27})/.exec(msg)?.[1] ?? null });
  }
};
process.on("unhandledRejection", (err) => {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error("unhandled rejection:", e);
  errors.record("api", `unhandled rejection: ${e.message}`, { stack: e.stack });
});
process.on("uncaughtException", (err) => {
  console.error("uncaught exception:", err);
  errors.record("api", `crash: ${err.message}`, { stack: err.stack });
  setTimeout(() => process.exit(1), 500); // let the record go out; Railway restarts the service
});
// Each office's own Claude login; its machine gets it as a Daytona secret limited to api.anthropic.com.
const cloud = config.daytona ? daytonaCloud(config.daytona.apiKey) : null;
const claude = new ClaudeTokens(supabaseClaudeTokens(db), {
  syncSecret: cloud?.setSecret ? (name, token) => cloud.setSecret!(name, token, ["api.anthropic.com"]) : null,
  verify: verifyWithAnthropic,
  log,
});
const access = supabaseAccess(db);
const admin = supabaseAdminData(db);
const s = createServices({
  verify,
  log,
  errors,
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
    linear: supabaseLinearStore(db),
    tasks: supabaseTaskSource(db),
    audit: async (officeId, actor, action, target, detail) => {
      await db.from("audit_log").insert({ office_id: officeId, actor, action, target, detail });
    },
  },
  linear: config.linear ? { client: new LinearClient({ apiKey: config.linear.apiKey }), publicUrl: config.publicUrl, secret: config.supabaseSecretKey } : null,
  ada: config.ada ? { brain: agentSdkBrain({ model: config.ada.model, effort: config.ada.effort }) } : null,
  claude,
  github: config.github ? { app: new GitHubApp(config.github) } : null,
  machine: config.daytona
    ? {
        cloud: cloud!,
        snapshot: config.daytona.snapshot,
        kind: config.daytona.kind,
        appDir: config.daytona.kind === "vm" ? "~/agentfloor" : "/opt/agentfloor",
        linkUrl: config.daytona.linkUrl,
        claudeSecret: (officeId: string) => claude.secretFor(officeId),
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
  linear: s.linear,
  claude,
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
  access,
  errors,
  admin,
  backup: () => backupMemory(db, admin),
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

// Every 5 minutes: machines that stopped on their own (idle) are marked so, which closes their run.
const machineTimer = setInterval(async () => {
  if (!s.machines) return;
  const { data } = await db.from("offices").select("id").in("sandbox_state", ["started", "starting"]);
  for (const o of data ?? []) void s.machines.refresh(o.id).catch((err) => log(`office ${o.id}: checking the machine failed: ${err.message}`));
}, 5 * 60_000);

// Nightly at 03:00 UTC: each office's memory to the backups bucket (30 days kept).
let backedUp = "";
const backupTimer = setInterval(() => {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  if (now.getUTCHours() !== 3 || backedUp === day) return;
  backedUp = day;
  void backupMemory(db, admin, now).then(
    (r) => console.log(`backed up memory for ${r.offices} offices`),
    (err) => log(`memory backup failed: ${err.message}`),
  );
}, 10 * 60_000);

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    clearInterval(machineTimer);
    clearInterval(backupTimer);
    clearInterval(budgetTimer);
    void app.close().then(() => process.exit(0));
  });
}
