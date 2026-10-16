import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { OfficeError } from "./core/types.ts";

/** Where an agent's identity lives inside its working folder. */
export const IDENTITY_FILE = ".agentfloor/identity.json";

/** Calls the office daemon as one participant. */
export class OfficeClient {
  readonly url: string;
  private readonly token: string;

  constructor(url: string, token: string) {
    this.url = url.replace(/\/$/, "");
    this.token = token;
  }

  /**
   * From AGENTFLOOR_URL and AGENTFLOOR_TOKEN, which the office sets for every
   * agent it starts. Some CLIs don't pass their environment on to MCP servers or
   * shell tools, so it falls back to the identity file the office writes in each
   * agent's working folder (.agentfloor/identity.json), found from the current directory.
   */
  static fromEnv(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): OfficeClient {
    if (env.AGENTFLOOR_URL && env.AGENTFLOOR_TOKEN) return new OfficeClient(env.AGENTFLOOR_URL, env.AGENTFLOOR_TOKEN);
    for (let dir = resolve(cwd); ; dir = dirname(dir)) {
      const file = join(dir, IDENTITY_FILE);
      if (existsSync(file)) {
        const id = JSON.parse(readFileSync(file, "utf8")) as { url: string; token: string };
        return new OfficeClient(id.url, id.token);
      }
      if (dirname(dir) === dir) break;
    }
    throw new Error("No office identity: AGENTFLOOR_URL and AGENTFLOOR_TOKEN aren't set and there's no .agentfloor/identity.json here or above.");
  }

  async call<T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.url}/rpc/${name}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.token}` },
        body: JSON.stringify(args),
      });
    } catch (err) {
      throw new OfficeError("unreachable", `Can't reach the office at ${this.url}: ${(err as Error).message}`);
    }
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; error?: { code: string; message: string } };
    if (!body.ok) throw new OfficeError(body.error?.code ?? `http_${res.status}`, body.error?.message ?? `HTTP ${res.status}`);
    return body.result as T;
  }
}
