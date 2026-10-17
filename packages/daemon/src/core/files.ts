/**
 * What agents write, for the CEO to read: the files in an agent's working
 * folder (its own folder, or its worktree of the office repo). Read-only, and
 * never outside that folder or into the office's own files (.agentfloor holds
 * the agent's credentials, .git is the repo's internals).
 */
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { OfficeError } from "./types.ts";

const SKIP = new Set([".agentfloor", ".git", "node_modules", ".next", "dist", "build", ".venv", "__pycache__", ".cache"]);
const MAX_FILES = 400;
const MAX_BYTES = 256 * 1024;

export interface FileEntry {
  path: string;
  size: number;
  modifiedAt: number;
}

/** The files in a folder, newest first (at most a few hundred). */
export function listFiles(root: string): FileEntry[] {
  const out: FileEntry[] = [];
  const walk = (dir: string, depth: number) => {
    if (out.length >= MAX_FILES || depth > 8) return;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (SKIP.has(name)) continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full, depth + 1);
      else if (st.isFile() && out.length < MAX_FILES) out.push({ path: relative(root, full).split(sep).join("/"), size: st.size, modifiedAt: st.mtimeMs });
    }
  };
  walk(root, 0);
  return out.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

/** One text file in the folder. */
export function readTextFile(root: string, path: string): { path: string; size: number; modifiedAt: number; text: string; truncated: boolean } {
  const base = realpathSync(root);
  let full: string;
  try {
    full = realpathSync(resolve(base, path));
  } catch {
    throw new OfficeError("not_found", `There's no file "${path}".`);
  }
  const rel = relative(base, full);
  if (!rel || rel.startsWith("..") || resolve(base, rel) !== full) throw new OfficeError("forbidden", "That file is outside the agent's folder.");
  if (rel.split(sep).some((part) => part === ".agentfloor" || part === ".git")) throw new OfficeError("forbidden", "That's one of the office's own files.");
  const st = statSync(full);
  if (!st.isFile()) throw new OfficeError("not_found", `"${path}" isn't a file.`);
  const buf = readFileSync(full).subarray(0, MAX_BYTES);
  if (buf.includes(0)) throw new OfficeError("binary", `"${path}" isn't a text file.`);
  return { path: rel.split(sep).join("/"), size: st.size, modifiedAt: st.mtimeMs, text: buf.toString("utf8"), truncated: st.size > MAX_BYTES };
}
