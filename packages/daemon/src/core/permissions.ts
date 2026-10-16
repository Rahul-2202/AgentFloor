import { isAbsolute, relative, resolve } from "node:path";
import type { Permission } from "@agentfloor/shared/governance";

export interface Need {
  permission: Permission;
  detail: string;
}

/** Places an agent may touch besides its own folder. */
const SAFE_ROOTS = ["/tmp", "/dev/null", "/dev/stdout", "/dev/stderr", "/usr", "/bin", "/lib", "/proc/self", "/opt/agentfloor"];

const NETWORK = [
  /\b(curl|wget|ssh|scp|sftp|rsync|nc|ncat|telnet|ftp)\b/,
  /\b(npm|pnpm|yarn|bun)\s+(i|install|add|ci|update|upgrade|dlx|create)\b/,
  /\bnpx\s+(?!tsc\b|prettier\b|eslint\b|vitest\b|jest\b)/,
  /\b(pip3?|uv|poetry|gem|cargo|go)\s+(install|add|get)\b/,
  /\bgit\s+clone\b/,
  /\bhttps?:\/\//,
];

/**
 * What a tool call needs, judged from the call itself (Claude Code's tool name
 * and input). Conservative on purpose: a miss means an extra question to the
 * CEO, not a silent leak.
 */
export function classify(tool: string, input: Record<string, unknown>, roots: { workdir: string; home: string; cwd?: string }): Need[] {
  const needs: Need[] = [];
  const cwd = roots.cwd ?? roots.workdir;
  const outside = (p: string) => {
    if (!p) return false;
    const expanded = p.startsWith("~") ? p : resolve(cwd, p);
    if (expanded.startsWith("~")) return true;
    if (SAFE_ROOTS.some((r) => expanded === r || expanded.startsWith(`${r}/`))) return false;
    return ![roots.workdir, roots.home].some((root) => {
      const rel = relative(root, expanded);
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    });
  };

  if (tool === "Bash") {
    const cmd = String(input.command ?? "");
    if (/\bgit\b[^|;&]*\bpush\b/.test(cmd)) needs.push({ permission: "push", detail: `git push: ${cmd.slice(0, 200)}` });
    if (NETWORK.some((r) => r.test(cmd))) needs.push({ permission: "network", detail: `network: ${cmd.slice(0, 200)}` });
    const paths = [...cmd.matchAll(/(?:^|[\s=:'"(])((?:~|\.\.|\/)[^\s'";|&)<>]*)/g)].map((m) => m[1]!).filter((p) => !/^\/\//.test(p));
    const away = paths.find(outside);
    if (away) needs.push({ permission: "outside_worktree", detail: `outside your folder (${away}): ${cmd.slice(0, 200)}` });
  } else if (["Read", "Write", "Edit", "MultiEdit", "NotebookEdit"].includes(tool)) {
    const p = String(input.file_path ?? input.notebook_path ?? "");
    if (outside(p)) needs.push({ permission: "outside_worktree", detail: `${tool} ${p}` });
  } else if (tool === "Glob" || tool === "Grep") {
    const p = String(input.path ?? "");
    if (p && outside(p)) needs.push({ permission: "outside_worktree", detail: `${tool} in ${p}` });
  } else if (tool === "WebFetch" || tool === "WebSearch") {
    needs.push({ permission: "network", detail: `${tool} ${String(input.url ?? input.query ?? "").slice(0, 200)}` });
  }
  return needs;
}
