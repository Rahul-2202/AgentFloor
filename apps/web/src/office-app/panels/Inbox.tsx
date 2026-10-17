"use client";

import { useState } from "react";
import { adaBriefing } from "@/lib/api";
import { PERM_LABEL } from "@/sim/catalog";
import { useSim } from "@/sim/store";
import type { InboxItem, PermKey } from "@/sim/types";
import { Btn, Empty, Face, Section } from "../bits";
import { MergeBox } from "../real/MergeBox";
import { useUI } from "../ui";
import { nameOf } from "../who";
import { Linked } from "../real/Linked";

const KIND: Record<InboxItem["kind"], { l: string; c: string }> = {
  question: { l: "Question", c: "bg-[#fdecea] text-[#9b2c24]" },
  approval: { l: "Approve", c: "bg-[#fdf3e0] text-[#8a5a10]" },
  meeting: { l: "Meeting", c: "bg-[#f1eefd] text-[#4a3fa8]" },
  escalation: { l: "Escalation", c: "bg-[#fdecea] text-[#9b2c24]" },
  permission: { l: "Permission", c: "bg-[#fdf3e0] text-[#8a5a10]" },
  fyi: { l: "FYI", c: "bg-[#f0efed] text-muted" },
};

type Act =
  | { type: "merge"; pr: number }
  | { type: "permission"; agent: string; permission: string; detail: string; firstUse: boolean }
  | { type: "permission_request"; agent: string; permission: string; why: string }
  | { type: "meeting"; topic: string; why: string; attendees: string[] };

function Item({ i }: { i: InboxItem }) {
  const { act } = useSim();
  const ui = useUI();
  const [answer, setAnswer] = useState("");
  const [more, setMore] = useState(false);
  const a = i.action as Act | null | undefined;
  const answerable = i.threadId && !a && (i.kind === "question" || i.kind === "escalation");

  return (
    <div className={`rounded-[16px] bg-white p-3.5 ring-1 ${i.priority === "high" ? "ring-[#f3c3be]" : "ring-black/[0.06]"}`}>
      <div className="flex items-start gap-2.5">
        <Face id={i.from} size={30} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={`rounded-full px-1.5 py-[1px] text-[10px] font-bold uppercase tracking-wide ${KIND[i.kind].c}`}>{KIND[i.kind].l}</span>
            {i.priority === "high" && <span className="text-[10.5px] font-bold uppercase text-[#9b2c24]">High</span>}
            <span className="ml-auto text-[11px] text-faint">
              {nameOf(i.from)} · {i.at}
            </span>
          </div>
          <div className="mt-1 text-[13.5px] font-semibold leading-snug text-ink">{i.title}</div>
          {i.note && (
            <div className="mt-1 inline-flex items-start gap-1 rounded-[10px] bg-[#fff4ec] px-2 py-1 text-[11.5px] leading-snug text-[#8a4a24]">
              <b className="font-semibold">Ada:</b> {i.note}
            </div>
          )}
          {i.body && (
            <div className={`mt-1 whitespace-pre-wrap text-[12px] text-muted ${more ? "" : "line-clamp-3"}`} onClick={() => setMore((v) => !v)}>
              <Linked text={i.body} who={i.from} />
            </div>
          )}
        </div>
      </div>

      {!i.resolved && (
        <div className="mt-2.5 flex flex-col gap-2 pl-10">
          {a?.type === "merge" && <MergeBox pr={a.pr} inboxId={i.id} compact />}

          {a?.type === "permission" && (
            <div className="flex flex-wrap gap-1.5">
              <Btn tone="dark" className="!py-1 !text-[12px]" onClick={() => void act.permission(i.id, true)}>
                {a.firstUse ? "Allow from now on" : "Allow once"}
              </Btn>
              <Btn className="!py-1 !text-[12px]" onClick={() => void act.permission(i.id, false)}>
                Refuse
              </Btn>
            </div>
          )}

          {a?.type === "permission_request" && (
            <div className="flex flex-wrap gap-1.5">
              <Btn
                tone="dark"
                className="!py-1 !text-[12px]"
                onClick={() => {
                  void act.change([{ op: "set_permission", scope: "agent", id: a.agent, permission: a.permission, level: "free" }], `Let ${nameOf(a.agent)} ${(PERM_LABEL[a.permission as PermKey] ?? a.permission).toLowerCase()}`);
                  void act.resolve(i.id);
                }}
              >
                Grant…
              </Btn>
              <Btn className="!py-1 !text-[12px]" onClick={() => void act.resolve(i.id)}>
                Not now
              </Btn>
            </div>
          )}

          {a?.type === "meeting" && (
            <div className="flex flex-wrap gap-1.5">
              <Btn
                tone="dark"
                className="!py-1 !text-[12px]"
                onClick={() => {
                  void act.meeting({ title: a.topic, attendees: a.attendees, agenda: [a.why] });
                  void act.resolve(i.id);
                }}
              >
                Book it
              </Btn>
              {i.threadId && (
                <Btn
                  className="!py-1 !text-[12px]"
                  onClick={() => {
                    void act.reply(i.threadId!, "Let's handle this async: write it up in this thread and I'll answer here.", true);
                    void act.resolve(i.id);
                  }}
                >
                  Downgrade to async
                </Btn>
              )}
              <Btn tone="ghost" className="!py-1 !text-[12px]" onClick={() => void act.resolve(i.id)}>
                Decline
              </Btn>
            </div>
          )}

          {answerable && (
            <div className="flex gap-1.5">
              <input
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && answer.trim()) {
                    void act.reply(i.threadId!, answer.trim(), true);
                    void act.resolve(i.id);
                    setAnswer("");
                  }
                }}
                placeholder="Your answer"
                className="min-w-0 flex-1 rounded-full bg-[#f6f5f2] px-3 py-1.5 text-[12.5px] outline-none ring-1 ring-black/[0.06] focus:ring-black/20"
              />
              <Btn
                tone="dark"
                className="!py-1 !text-[12px]"
                onClick={() => {
                  if (!answer.trim()) return;
                  void act.reply(i.threadId!, answer.trim(), true);
                  void act.resolve(i.id);
                  setAnswer("");
                }}
              >
                Answer
              </Btn>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            {i.threadId && (
              <Btn tone="ghost" className="!py-1 !text-[12px]" onClick={() => ui.openPanel("conversations", i.threadId!)}>
                Open thread
              </Btn>
            )}
            {a?.type !== "permission" && (
              <Btn tone="ghost" className="!py-1 !text-[12px]" onClick={() => void act.resolve(i.id)}>
                {i.kind === "fyi" ? "Mark read" : "Mark done"}
              </Btn>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function InboxPanel({ initial }: { initial?: string }) {
  const { s, act } = useSim();
  const [showDone, setShowDone] = useState(false);
  const [asking, setAsking] = useState(false);
  const open = s.inbox.filter((i) => !i.resolved);
  const high = open.filter((i) => i.priority === "high" && !i.batched);
  const meetings = open.filter((i) => i.kind === "meeting" && i.priority !== "high");
  const rest = open.filter((i) => i.priority !== "high" && !i.batched && i.kind !== "meeting");
  const batched = open.filter((i) => i.batched && i.kind !== "meeting");
  const done = s.inbox.filter((i) => i.resolved);
  const order = initial === "meeting" ? ["meetings", "high", "rest"] : ["high", "meetings", "rest"];
  const groups: Record<string, [string, InboxItem[]]> = { high: ["Needs you first", high], meetings: ["Meeting requests", meetings], rest: ["Approvals, questions and reviews", rest] };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2.5 rounded-[16px] bg-[#fff4ec] p-3 ring-1 ring-[#f3cfb6]">
        <Face id="ada" size={30} />
        <div className="flex-1 text-[12.5px] leading-snug text-[#8a4a24]">
          {!open.length
            ? "You're all caught up. I'll ping you if anything needs you."
            : `I've sorted ${open.length - batched.length} item${open.length - batched.length === 1 ? "" : "s"} by what needs you first.${batched.length ? ` ${batched.length} FYI${batched.length === 1 ? " is" : "s are"} batched at the bottom.` : ""}`}
        </div>
        <Btn
          className="!py-1 !text-[11.5px]"
          onClick={() => {
            setAsking(true);
            adaBriefing().then(
              () => act.toast("Your briefing is in the inbox."),
              (e) => act.toast((e as Error).message),
            ).finally(() => setAsking(false));
          }}
        >
          {asking ? "Writing…" : "Briefing"}
        </Btn>
      </div>
      {order.map((k) => {
        const [title, items] = groups[k];
        return items.length ? (
          <Section key={k} title={`${title} · ${items.length}`}>
            <div className="flex flex-col gap-2">
              {items.map((i) => (
                <Item key={i.id} i={i} />
              ))}
            </div>
          </Section>
        ) : null;
      })}
      {batched.length > 0 && (
        <Section title={`FYI, batched · ${batched.length}`}>
          <div className="flex flex-col gap-2">
            {batched.map((i) => (
              <Item key={i.id} i={i} />
            ))}
          </div>
        </Section>
      )}
      {!open.length && <Empty>Nothing needs you right now.</Empty>}
      {done.length > 0 && (
        <button onClick={() => setShowDone((v) => !v)} className="self-start text-[12.5px] font-semibold text-muted hover:text-ink">
          {showDone ? "Hide" : "Show"} {done.length} resolved
        </button>
      )}
      {showDone && (
        <div className="flex flex-col gap-2 opacity-60">
          {done.map((i) => (
            <Item key={i.id} i={i} />
          ))}
        </div>
      )}
    </div>
  );
}
