/**
 * The office link: one WebSocket that each office daemon opens to the Control
 * API (the daemon dials out, so the office VM needs no public port).
 *
 *   daemon → api  hello   {token}                  first message; the office token proves which office
 *   api → daemon  welcome {lastSeq}                the highest event seq the API has stored
 *   daemon → api  events  {events}                 every event after lastSeq, then new ones as they happen
 *   api → daemon  ack     {seq}                    stored up to seq
 *   api → daemon  call    {id, name, args}         a CEO call (the daemon's office tools)
 *   daemon → api  result  {id, ok, result | error}
 *   api → daemon  config  {config, version}        the office's setup (rooms, agents, policy); Supabase owns it
 *   api → daemon  brief   {agent, text}            an agent's memory brief
 *   daemon → api  config_applied {version, ok, error?}
 *   daemon → api  live    {event}                  not stored: live session output, "thinking"
 *   daemon → api  request {id, name, args}         the office needs the API (a git token, a PR opened)
 *   api → daemon  response {id, ok, result | error}
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { OfficeConfig, OfficeEvent } from "./types.ts";

export const LINK_PATH = "/office-link";

/** Close codes the API uses; the daemon stops retrying on a bad token. */
export const CLOSE_BAD_TOKEN = 4401;
export const CLOSE_REPLACED = 4409;

export type DaemonMessage =
  | { t: "hello"; token: string; version: string }
  | { t: "events"; events: OfficeEvent[] }
  | { t: "result"; id: string; ok: true; result: unknown }
  | { t: "result"; id: string; ok: false; error: { code: string; message: string } }
  | { t: "config_applied"; version: number; ok: boolean; error?: string }
  | { t: "live"; event: OfficeEvent }
  | { t: "request"; id: string; name: string; args: unknown }
  /** Something went wrong in the office (tracked by the API with the office's id). */
  | { t: "log"; level: "error" | "warn"; message: string };

export type ApiMessage =
  | { t: "welcome"; officeId: string; lastSeq: number }
  | { t: "ack"; seq: number }
  | { t: "call"; id: string; name: string; args: unknown }
  | { t: "config"; config: OfficeConfig; version: number }
  /** An agent's memory brief (written into its memory file before each turn). */
  | { t: "brief"; agent: string; text: string }
  | { t: "response"; id: string; ok: true; result: unknown }
  | { t: "response"; id: string; ok: false; error: { code: string; message: string } };

/**
 * Office tokens look like `afo_<office id>_<secret>`. Only a hash of the
 * secret is stored (in Supabase); the token itself lives in the office VM.
 */
export function newOfficeToken(officeId: string): { token: string; hash: string } {
  const secret = randomBytes(32).toString("base64url");
  return { token: `afo_${officeId}_${secret}`, hash: hashSecret(secret) };
}

export function parseOfficeToken(token: string): { officeId: string; secret: string } | null {
  const m = /^afo_([0-9a-f-]{36})_([A-Za-z0-9_-]{20,})$/.exec(token);
  return m ? { officeId: m[1], secret: m[2] } : null;
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Constant-time check of a token's secret against a stored hash. */
export function secretMatches(secret: string, hash: string): boolean {
  const a = Buffer.from(hashSecret(secret), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
