import { Daytona } from "@daytona/sdk";

/** The parts of a sandbox provider the office lifecycle uses (Daytona in production, a fake in tests). */
export interface Cloud {
  create(opts: {
    snapshot: string;
    labels: Record<string, string>;
    env: Record<string, string>;
    /** env var name → name of a provider secret (the VM only ever sees a placeholder). */
    secrets: Record<string, string>;
    autoPauseMinutes: number;
  }): Promise<{ id: string }>;
  state(id: string): Promise<string>;
  start(id: string): Promise<void>;
  pause(id: string): Promise<void>;
  /** Counts as activity, so the VM doesn't auto-pause. */
  touch(id: string): Promise<void>;
  /** Runs a command in the background (survives this call), in a named session. */
  runInBackground(id: string, session: string, command: string): Promise<void>;
  exec(id: string, command: string): Promise<{ exitCode: number; output: string }>;
}

export function daytonaCloud(apiKey: string): Cloud {
  const daytona = new Daytona({ apiKey });
  const get = (id: string) => daytona.get(id);
  return {
    async create(o) {
      const sandbox = await daytona.create(
        {
          snapshot: o.snapshot,
          labels: o.labels,
          envVars: o.env,
          secrets: o.secrets,
          public: false,
          autoPauseInterval: o.autoPauseMinutes,
        },
        { timeout: 300 },
      );
      return { id: sandbox.id };
    },
    async state(id) {
      return (await get(id)).state ?? "unknown";
    },
    async start(id) {
      await (await get(id)).start(300);
    },
    async pause(id) {
      await (await get(id)).pause(120);
    },
    async touch(id) {
      await (await get(id)).refreshActivity();
    },
    async runInBackground(id, session, command) {
      const sandbox = await get(id);
      await sandbox.process.deleteSession(session).catch(() => {});
      await sandbox.process.createSession(session);
      await sandbox.process.executeSessionCommand(session, { command, runAsync: true });
    },
    async exec(id, command) {
      const res = await (await get(id)).process.executeCommand(command, undefined, undefined, 120);
      return { exitCode: res.exitCode, output: res.result };
    },
  };
}
