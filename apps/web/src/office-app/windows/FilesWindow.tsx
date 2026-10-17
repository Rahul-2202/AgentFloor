"use client";

import { useCallback, useEffect, useState } from "react";
import { officeCall } from "@/lib/api";
import { useSim } from "@/sim/store";
import { Btn, Empty, Face, Window } from "../bits";
import { useUI } from "../ui";
import { nameOf } from "../who";

interface Entry {
  path: string;
  size: number;
  modifiedAt: number;
}
interface FileView extends Entry {
  text: string;
  truncated: boolean;
}

const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(ms).toLocaleDateString();
};
const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`);

/** What an agent has written in its working folder (read-only). */
export function FilesWindow({ id }: { id: string }) {
  const { s } = useSim();
  const ui = useUI();
  const agents = s.setup?.agents ?? [];
  const [agent, setAgent] = useState(id || agents[0]?.id || "");
  const [files, setFiles] = useState<Entry[] | null>(null);
  const [open, setOpen] = useState<FileView | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    if (!agent) return setFiles([]);
    setErr("");
    officeCall<Entry[]>("agent_files", { agent }).then(setFiles, (e) => {
      setFiles([]);
      setErr((e as Error).message);
    });
  }, [agent]);
  useEffect(() => {
    setFiles(null);
    setOpen(null);
    load();
  }, [load]);

  const read = (path: string) => {
    setErr("");
    officeCall<FileView>("agent_file", { agent, path }).then(setOpen, (e) => setErr((e as Error).message));
  };

  const asleep = s.machine !== "started";

  return (
    <Window
      width={880}
      onClose={ui.closeWin}
      icon={<Face id={agent} size={32} />}
      title={`${nameOf(agent)} · files`}
      sub={s.data.agents.length && s.setup ? "What this agent has written in its working folder. Read-only." : ""}
      footer={
        <div className="flex items-center justify-between gap-2 border-t border-black/[0.06] px-4 py-2.5">
          <select value={agent} onChange={(e) => setAgent(e.target.value)} className="rounded-full bg-[#f2f0ec] px-3 py-1.5 text-[12.5px] font-semibold outline-none">
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <Btn className="!py-1 !text-[12px]" onClick={load}>
            Refresh
          </Btn>
        </div>
      }
    >
      <div className="grid h-[min(560px,64vh)] grid-cols-[260px_1fr]">
        <div className="overflow-y-auto border-r border-black/[0.06] p-2" data-scroll>
          {files === null && <div className="p-2 text-[12.5px] text-faint">Loading…</div>}
          {files?.length === 0 && !err && <Empty>No files yet.</Empty>}
          {files?.map((f) => (
            <button
              key={f.path}
              onClick={() => read(f.path)}
              className={`block w-full rounded-[10px] px-2.5 py-1.5 text-left hover:bg-[#f6f5f2] ${open?.path === f.path ? "bg-[#f2f0ec]" : ""}`}
            >
              <div className="truncate font-mono text-[12px] font-semibold text-ink" title={f.path}>
                {f.path}
              </div>
              <div className="text-[11px] text-faint">
                {kb(f.size)} · {ago(f.modifiedAt)}
              </div>
            </button>
          ))}
        </div>
        <div className="min-w-0 overflow-y-auto p-4" data-scroll>
          {err && <div className="mb-3 rounded-[12px] bg-[#fdecea] px-3 py-2 text-[12.5px] text-[#9b2c24]">{asleep ? "The office computer is asleep: start it to read agents' files." : err}</div>}
          {open ? (
            <>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="truncate font-mono text-[12.5px] font-semibold text-ink">{open.path}</span>
                <span className="shrink-0 text-[11.5px] text-faint">
                  {kb(open.size)} · {ago(open.modifiedAt)}
                </span>
              </div>
              <pre className={`whitespace-pre-wrap break-words rounded-[12px] bg-[#fbfaf8] p-3.5 text-[12.5px] leading-[1.55] text-ink-2 ring-1 ring-black/[0.05] ${/\.(md|txt)$/i.test(open.path) ? "font-sans" : "font-mono"}`}>{open.text}</pre>
              {open.truncated && <div className="mt-2 text-[11.5px] text-faint">Showing the first 256 KB.</div>}
            </>
          ) : (
            !err && <div className="grid h-full place-items-center text-[13px] text-faint">Pick a file to read it.</div>
          )}
        </div>
      </div>
    </Window>
  );
}
