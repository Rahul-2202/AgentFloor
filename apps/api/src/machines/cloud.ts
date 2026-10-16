import { Daytona } from "@daytona/sdk";

/** The parts of a sandbox provider the office lifecycle uses (Daytona in production, a fake in tests). */
export interface Cloud {
  create(opts: {
    snapshot: string;
    labels: Record<string, string>;
    env: Record<string, string>;
    /** env var name → name of a provider secret (the VM only ever sees a placeholder). */
    secrets: Record<string, string>;
    /** VMs pause when idle (memory kept); containers stop. */
    kind: "vm" | "container";
    idleMinutes: number;
  }): Promise<{ id: string }>;
  state(id: string): Promise<string>;
  start(id: string): Promise<void>;
  pause(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  /** Counts as activity, so the VM doesn't auto-pause. */
  touch(id: string): Promise<void>;
  /** Runs a command in the background (survives this call), in a named session. */
  runInBackground(id: string, session: string, command: string): Promise<void>;
  exec(id: string, command: string): Promise<{ exitCode: number; output: string }>;
  /** A real terminal in the machine (for "take over"). */
  openTerminal(id: string, o: { cwd: string; cols: number; rows: number; onData: (text: string) => void; onExit: () => void }): Promise<Terminal>;
}

export interface Terminal {
  input(data: string): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
  close(): Promise<void>;
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
          ...(o.kind === "vm" ? { autoPauseInterval: o.idleMinutes } : { autoStopInterval: o.idleMinutes }),
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
    async stop(id) {
      await (await get(id)).stop(120);
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
    async openTerminal(id, o) {
      const sandbox = await get(id);
      const decoder = new TextDecoder();
      // Daytona wants an absolute folder: "~" means the machine user's home.
      const home = (await sandbox.getUserHomeDir()) ?? "/root";
      const pty = await sandbox.process.createPty({
        id: `takeover-${Date.now()}`,
        cwd: o.cwd.replace(/^~(?=\/|$)/, home),
        cols: o.cols,
        rows: o.rows,
        onData: (bytes) => o.onData(decoder.decode(bytes, { stream: true })),
      } as Parameters<typeof sandbox.process.createPty>[0]);
      await pty.waitForConnection();
      void pty.wait().then(o.onExit, o.onExit);
      return {
        input: (d) => pty.sendInput(d),
        resize: async (c, r) => void (await pty.resize(c, r)),
        close: async () => {
          await pty.kill().catch(() => {});
          await pty.disconnect().catch(() => {});
        },
      };
    },
    async exec(id, command) {
      const res = await (await get(id)).process.executeCommand(command, undefined, undefined, 120);
      return { exitCode: res.exitCode, output: res.result };
    },
  };
}
