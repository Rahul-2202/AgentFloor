/** Fixed lists the office screens use (labels, templates). The office's data lives in the store. */
import { PERMISSIONS } from "@agentfloor/shared/governance";
import type { PermKey } from "./types";

export const PERM_LABEL = Object.fromEntries(PERMISSIONS.map((p) => [p.id, p.label])) as Record<PermKey, string>;
export const PERM_COVERS = Object.fromEntries(PERMISSIONS.map((p) => [p.id, p.covers])) as Record<PermKey, string>;

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

/** How the office talks (the protocol every agent follows). */
export const NORMS = [
  { t: "Messages queue, they don't interrupt", d: "Read at the next break point: a finished step, a commit, the next task." },
  { t: "Three urgency levels", d: "Normal, urgent, stop. Only a head, Ada or you can send a stop." },
  { t: "Questions go direct, work goes through the head", d: "Anyone can ask anyone. New work for a room goes through its head." },
  { t: "You can reach anyone, the head is copied", d: "So instructions never silently conflict." },
  { t: "No answer means escalation", d: "Unanswered questions go to the asker's head, then your inbox." },
];

/** Starting points for a new room; Ada fills in the rest. */
export const ROOM_TEMPLATES = [
  { name: "Development", head: "Product manager", members: ["Frontend developer", "Backend developer"], purpose: "Build and ship the product" },
  { name: "Quality", head: "QA lead", members: ["Tester"], purpose: "Test every change before it merges" },
  { name: "Platform", head: "DevOps lead", members: ["Infrastructure engineer"], purpose: "CI, deploys and infrastructure" },
  { name: "Docs", head: "Docs lead", members: ["Technical writer"], purpose: "Docs, READMEs and changelogs" },
];

/** Roles to hire into a room. */
export const ROLE_TEMPLATES = ["Frontend developer", "Backend developer", "Tester", "DevOps engineer", "Technical writer", "Designer"];
