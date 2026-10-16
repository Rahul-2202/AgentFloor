import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Loads the nearest .env from the current directory upward (the repo root holds it in the monorepo). */
export function loadEnv(from = process.cwd()): string | null {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const file = join(dir, ".env");
    if (existsSync(file)) {
      process.loadEnvFile(file);
      return file;
    }
    if (dirname(dir) === dir) return null;
  }
}
