import { parseArgs } from "node:util";
import { CEO } from "../core/types.ts";
import { loadConfig } from "../core/config.ts";
import { startDaemon } from "./daemon.ts";
import { loadEnv } from "../env.ts";

loadEnv();

const { values } = parseArgs({
  options: {
    config: { type: "string", default: "config/office.json" },
    data: { type: "string", default: "data" },
    port: { type: "string", default: process.env.AGENTFLOOR_PORT ?? "4300" },
    host: { type: "string", default: "127.0.0.1" },
  },
});

const config = loadConfig(values.config!);
// In an office VM the Control API gives the daemon its link URL and office token.
const link = process.env.AGENTFLOOR_LINK_URL && process.env.AGENTFLOOR_OFFICE_TOKEN
  ? { url: process.env.AGENTFLOOR_LINK_URL, token: process.env.AGENTFLOOR_OFFICE_TOKEN }
  : undefined;
const running = await startDaemon({ config, dataDir: values.data!, port: Number(values.port), host: values.host, link });

const external = config.agents.filter((a) => !running.hosts.some((h) => h.agent.id === a.id));
console.log(`\n${config.name} is open.`);
console.log(`  Console: ${running.url}/`);
if (link) console.log(`  Link:    ${link.url}`);
console.log(`  Agents:  ${running.hosts.map((h) => `${h.agent.id} (${h.agent.runtime})`).join(", ") || "none started"}`);
if (external.length) {
  console.log(`  External (start their CLI yourself after: source ${values.data}/agents/<id>/env):`);
  for (const a of external) console.log(`    ${a.id} (${a.runtime})`);
}
console.log(`  CEO token for scripts: ${running.auth.tokenFor(CEO)}\n`);

const shutdown = async () => {
  await running.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
