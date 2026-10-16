"use client";

import { useSim } from "@/sim/store";
import { Bar, Btn, Face, Section, StateChip, Window } from "../bits";
import { useUI } from "../ui";
import { nameOf, ROOM_LABEL } from "../who";

export function TaskWindow({ id }: { id: string }) {
  const { s, act } = useSim();
  const ui = useUI();
  const t = s.tasks.find((x) => x.id === id);
  if (!t) return null;
  const outs = s.outputs.filter((o) => o.taskId === t.id);
  const row = s.data.tasks.find((x) => x.id === t.id);
  const sub = row?.parent_id ? s.tasks.find((x) => x.id === row.parent_id) : undefined;
  const children = s.data.tasks.filter((x) => x.parent_id === t.id);
  return (
    <Window
      width={600}
      onClose={ui.closeWin}
      icon={<Face id={t.owner} size={32} />}
      title={t.title}
      sub={`${nameOf(t.owner)} · ${ROOM_LABEL[t.room] ?? t.room} · from ${t.source === "you" ? "you" : t.source === "ada" ? "Ada" : nameOf(row?.created_by ?? "")}`}
      footer={
        <div className="flex items-center justify-between gap-2 border-t border-black/[0.06] px-4 py-3">
          <StateChip state={t.state} />
          <div className="flex gap-2">
            <Btn onClick={() => ui.openWin({ kind: "chat", id: t.owner, mode: "queue" })}>Message {nameOf(t.owner)}</Btn>
            {t.state !== "done" && (
              <Btn onClick={() => void act.message(t.owner, `Quick update on “${t.title}”? Where is it, and is anything in the way?`, "normal")}>Ask for an update</Btn>
            )}
          </div>
        </div>
      }
    >
      <div className="flex max-h-[min(560px,62vh)] flex-col gap-4 overflow-y-auto p-4">
        <div className="rounded-[16px] bg-[#f6f5f2] p-3.5">
          <div className="flex items-center justify-between text-[12.5px] text-muted">
            <span>{t.step ?? "Not started"}</span>
            <span className="font-semibold text-ink">{t.progress}%</span>
          </div>
          <div className="mt-2">
            <Bar value={t.progress} color={t.state === "question" || t.state === "blocked" ? "#d99a2b" : "#3f9b5f"} />
          </div>
          {t.dod && (
            <div className="mt-3 text-[12.5px] text-ink-2">
              <span className="font-semibold text-ink">Done means: </span>
              {t.dod}
            </div>
          )}
        </div>

        {row?.details && (
          <Section title="Brief">
            <div className="whitespace-pre-wrap text-[13px] leading-[1.5] text-ink-2">{row.details}</div>
          </Section>
        )}
        {sub && (
          <button onClick={() => ui.openWin({ kind: "task", id: sub.id })} className="self-start text-[12.5px] font-semibold text-ink hover:underline">
            Part of: {sub.title} →
          </button>
        )}
        {t.blocker && (
          <div className="rounded-[16px] bg-[#fdf3e0] p-3.5 text-[13px] text-[#8a5a10] ring-1 ring-[#f1d9a6]">
            <b>Blocked:</b> {t.blocker}
          </div>
        )}

        {children.length > 0 && (
          <Section title="Handed out">
            <div className="flex flex-col gap-1.5">
              {children.map((c) => (
                <button key={c.id} onClick={() => ui.openWin({ kind: "task", id: c.id })} className="flex items-center gap-2 rounded-[12px] bg-white px-3 py-2 text-left text-[13px] ring-1 ring-black/[0.06] hover:bg-[#fbfaf8]">
                  <Face id={c.owner_id} size={20} />
                  <span className="min-w-0 flex-1 truncate font-semibold text-ink">{c.title}</span>
                  <span className="text-[11.5px] text-muted">{c.status}</span>
                </button>
              ))}
            </div>
          </Section>
        )}
        {t.subtasks && t.subtasks.length > 0 && (
          <Section title="Checklist">
            <div className="flex flex-col gap-1.5">
              {t.subtasks.map((x) => (
                <div key={x.title} className="flex items-center gap-2 text-[13px] text-ink-2">
                  <span className={`grid h-4 w-4 place-items-center rounded-[5px] text-[10px] font-bold text-white ${x.done ? "bg-ok" : "bg-black/15"}`}>{x.done ? "✓" : ""}</span>
                  <span className={x.done ? "text-muted line-through decoration-black/20" : ""}>{x.title}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {outs.length > 0 && (
          <Section title="Outputs">
            <div className="flex flex-col gap-1.5">
              {outs.map((o) => (
                <button key={o.id} onClick={() => ui.openWin({ kind: "output", id: o.id })} className="flex items-center justify-between rounded-[12px] bg-white px-3 py-2 text-left text-[13px] ring-1 ring-black/[0.06] hover:bg-[#fbfaf8]">
                  <span className="font-semibold text-ink">{o.title}</span>
                  <span className="text-[11.5px] text-muted">{o.status}</span>
                </button>
              ))}
            </div>
          </Section>
        )}

        <Section title="Timeline">
          <div className="flex flex-col gap-2.5 border-l-2 border-black/[0.06] pl-3.5">
            {!t.updates.length && <div className="text-[12.5px] text-muted">Updates show here as {nameOf(t.owner)} works.</div>}
            {[...t.updates].reverse().map((u, i) => (
              <div key={i} className="relative">
                <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-white ring-2 ring-black/15" />
                <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
                  <Face id={u.who} size={16} /> {nameOf(u.who)} · {u.t}
                </div>
                <div className="text-[13px] text-ink-2">{u.text}</div>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </Window>
  );
}
