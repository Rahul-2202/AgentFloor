"use client";

import { Fragment } from "react";
import { useUI } from "../ui";

// Things like work/MASTER_PRODUCT_DOC.md or src/app.ts in an agent's message.
const FILE = /((?:[\w.-]+\/)*[\w-][\w.-]*\.(?:md|txt|json|ya?ml|csv|ts|tsx|js|jsx|py|sh|toml|html|css|sql))(?=$|[\s),.;:!?'"`\]])/g;

/** A message's text with the files it mentions opening in the Files window (from that agent's folder). */
export function Linked({ text, who }: { text: string; who: string }) {
  const ui = useUI();
  const isAgent = who !== "you" && who !== "ceo" && who !== "ada" && who !== "office";
  if (!isAgent) return <>{text}</>;
  const parts: (string | { file: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(FILE)) {
    const at = m.index ?? 0;
    if (at > 0 && /[\w/@:]/.test(text[at - 1]!)) continue; // part of a URL or a longer word
    parts.push(text.slice(last, at), { file: m[1]! });
    last = at + m[1]!.length;
  }
  parts.push(text.slice(last));
  return (
    <>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <Fragment key={i}>{p}</Fragment>
        ) : (
          <button
            key={i}
            onClick={(e) => {
              e.stopPropagation();
              ui.openWin({ kind: "files", id: who, tab: p.file });
            }}
            className="rounded-[4px] bg-[#f1eefd] px-1 font-mono text-[0.92em] text-[#4a3fa8] hover:underline"
            title={`Open ${p.file}`}
          >
            {p.file}
          </button>
        ),
      )}
    </>
  );
}
