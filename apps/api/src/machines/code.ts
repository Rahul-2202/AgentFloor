import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface CodeBundle {
  /** A hash of every file: machines running a different one get this code. */
  version: string;
  files: { path: string; content: Buffer }[];
}

const INCLUDE = ["package.json", "package-lock.json", "tsconfig.base.json", ".node-version", "packages/shared", "packages/daemon"];
const SKIP = new Set(["node_modules", "data", "test", ".DS_Store"]);

/**
 * The office daemon's code, as this API has it (the API is deployed from the
 * same repo). Office machines are brought up to it on start, so a release
 * reaches existing offices without rebuilding them.
 */
export function daemonBundle(root: string): CodeBundle {
  const files: { path: string; content: Buffer }[] = [];
  const walk = (p: string) => {
    if (!existsSync(p)) return;
    if (statSync(p).isDirectory()) {
      for (const name of readdirSync(p).sort()) if (!SKIP.has(name)) walk(join(p, name));
    } else files.push({ path: relative(root, p), content: readFileSync(p) });
  };
  for (const p of INCLUDE) walk(join(root, p));
  const hash = createHash("sha256");
  for (const f of files) hash.update(f.path).update("\0").update(f.content).update("\0");
  return { version: hash.digest("hex").slice(0, 16), files };
}
