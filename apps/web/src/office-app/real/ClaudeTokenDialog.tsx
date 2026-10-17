"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { useSim } from "@/sim/store";
import { Face } from "../bits";

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <span className="flex items-center gap-2 rounded-[10px] bg-[#16151a] px-3 py-2 font-mono text-[12.5px] text-white">
      <span className="flex-1 select-all">{text}</span>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }}
        className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold hover:bg-white/20"
      >
        {done ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

/**
 * Asks the CEO for their own Claude login (`claude setup-token`): the office's
 * agents and Ada run on it. Can't be skipped while there's none; offered again
 * if Claude stops accepting it.
 */
export function ClaudeTokenDialog() {
  const { s, act } = useSim();
  const [token, setToken] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const c = s.claude;
  const missing = !!c?.required && !c.set;
  const invalid = !!c?.required && c.set && c.status === "invalid";
  const open = !!c?.required && (missing || s.askClaude || (invalid && !dismissed));
  const close = missing
    ? undefined
    : () => {
        act.askClaude(false);
        setDismissed(true);
      };

  const save = async () => {
    if (!token.trim() || busy) return;
    setBusy(true);
    setErr("");
    const problem = await act.setClaude(token);
    setBusy(false);
    if (problem) setErr(problem);
    else {
      setToken("");
      act.toast("Your Claude token is saved. Your office runs on your Claude plan.");
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[95] grid place-items-center overflow-y-auto bg-black/30 p-4 backdrop-blur-[3px]">
          <motion.div
            initial={{ y: 14, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            className="w-full max-w-[520px] rounded-[24px] bg-white p-6 shadow-[var(--shadow-float)] ring-1 ring-black/[0.08]"
          >
            <div className="flex items-start gap-3">
              <Face id="ada" size={40} />
              <div className="min-w-0 flex-1">
                <div className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{invalid ? "Your Claude token stopped working" : "Connect your Claude account"}</div>
                <div className="mt-0.5 text-[13px] leading-snug text-muted">
                  {invalid
                    ? "Claude didn't accept it any more (it may have expired or been revoked). Make a new one the same way."
                    : "Your agents and I run on your own Claude plan (Pro, Max or Team). It takes a minute: make a token, paste it here."}
                </div>
              </div>
              {close && (
                <button onClick={close} className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-black/5" aria-label="Later">
                  ✕
                </button>
              )}
            </div>

            <ol className="mt-5 flex flex-col gap-3.5 text-[13.5px] text-ink-2">
              <li className="flex gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink text-[12px] font-bold text-white">1</span>
                <div className="min-w-0 flex-1">
                  Open a terminal and run:
                  <div className="mt-1.5">
                    <Copy text="claude setup-token" />
                  </div>
                  <div className="mt-1.5 text-[12px] text-muted">
                    No Claude Code yet? Install it first: <span className="font-mono">npm install -g @anthropic-ai/claude-code</span>. Or, in Claude Code, ask: <i>&quot;Run claude setup-token for me&quot;</i>.
                  </div>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink text-[12px] font-bold text-white">2</span>
                <div>It opens your browser: sign in with the Claude account on your plan and approve.</div>
              </li>
              <li className="flex gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink text-[12px] font-bold text-white">3</span>
                <div className="min-w-0 flex-1">
                  Copy the token it prints (it starts with <span className="font-mono">sk-ant-oat01-</span>) and paste it here:
                  <form
                    className="mt-2 flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void save();
                    }}
                  >
                    <input
                      autoFocus
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder="sk-ant-oat01-…"
                      className="h-11 min-w-0 flex-1 rounded-full bg-[#f6f5f2] px-4 font-mono text-[13px] outline-none ring-1 ring-black/[0.08] focus:ring-black/25"
                    />
                    <button disabled={!token.trim() || busy} className="h-11 rounded-full bg-ink px-5 text-[13.5px] font-semibold text-white disabled:opacity-40">
                      {busy ? "Checking…" : "Save"}
                    </button>
                  </form>
                  {err && <div className="mt-2 rounded-[10px] bg-[#fdecea] px-3 py-2 text-[12.5px] text-[#9b2c24]">{err}</div>}
                </div>
              </li>
            </ol>

            <div className="mt-5 rounded-[14px] bg-[#f6f5f2] px-3.5 py-3 text-[12px] leading-relaxed text-muted">
              The token is checked with Anthropic, then kept encrypted. It&apos;s never shown again or sent to your browser, and your agents can&apos;t read it: their requests to Claude get it added on the way out. Agents&apos; work counts toward your plan&apos;s usage limits. Replace it any time in Rules &amp; settings → Integrations.
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** The office's Claude login in Rules & settings. */
export function ClaudeCard() {
  const { s, act } = useSim();
  const c = s.claude;
  if (!c?.required) return null;
  return (
    <div className="rounded-[16px] bg-white p-3.5 ring-1 ring-black/[0.06]">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-[#fbe9de] text-[15px] text-[#c2541d]">✻</span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-ink">Claude</div>
          <div className={`truncate text-[12px] ${c.status === "invalid" ? "text-bad" : "text-muted"}`}>
            {!c.set
              ? "No token yet: your office can't run without one"
              : c.status === "invalid"
                ? "Claude stopped accepting your token. Add a new one."
                : `Your token ····${c.last4}${c.setAt ? ` · added ${new Date(c.setAt).toLocaleDateString()}` : ""}`}
          </div>
        </div>
        <button onClick={() => act.askClaude(true)} className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ${!c.set || c.status === "invalid" ? "bg-ink text-white" : "ring-1 ring-black/[0.1] hover:bg-[#f6f5f2]"}`}>
          {c.set ? "Replace" : "Add token"}
        </button>
      </div>
    </div>
  );
}
