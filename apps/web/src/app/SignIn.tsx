"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { BrandIcon } from "@/components/brands";
import { LogoMark } from "@/components/Logo";
import { CAST } from "@/office/layout";
import { Office } from "@/office/Office";
import type { Scene } from "@/office/types";
import { DEMO_CAST } from "@/office-app/who";

/* ------------------------------------------------------------------ story */

const BLUEPRINT = { dev: "blueprint", marketing: "blueprint", meeting: "blueprint", sales: "blueprint", legal: "blueprint", finance: "blueprint" } as const;
const DEV = ["pm", "fe", "be", "ops", "qa"];
const MKT = ["strat", "cr1", "cr2", "editor"];
const walkIn = (ids: string[], first = 0.1) => Object.fromEntries(ids.map((id, i) => [id, { from: "ceo:outside", at: `seat:${id}`, delay: first + i * 0.5, speed: 1.3 }]));
const working = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { at: `seat:${id}`, status: "working" as const }]));

/** The office building itself, on a loop: what AgentFloor is, without a word of copy. */
const STORY: { scene: Scene; ms: number }[] = [
  {
    ms: 3600,
    scene: {
      rooms: { ceo: "built", ...BLUEPRINT },
      camera: ["ceo", "dev"],
      agents: { you: { at: "seat:you" }, ada: { at: "ada:home", bubble: { text: "Hi, I'm Ada. What are we building?", tone: "ada" } } },
    },
  },
  {
    ms: 3200,
    scene: {
      rooms: { ceo: "built", ...BLUEPRINT, dev: "ghost" },
      camera: ["ceo", "dev"],
      agents: { you: { at: "seat:you", bubble: { text: "A booking app. Live in six weeks.", tone: "ceo" } }, ada: { at: "ada:home", status: "thinking" } },
    },
  },
  {
    ms: 4600,
    scene: {
      rooms: { ceo: "built", ...BLUEPRINT, dev: "built" },
      camera: ["ceo", "dev"],
      board: { todo: 0, doing: 0, done: 0 },
      agents: { you: { at: "seat:you" }, ada: { at: "ada:home", bubble: { text: "Your dev team is on its way.", tone: "ada" } }, ...walkIn(DEV), pm: { ...walkIn(["pm"]).pm, bubble: "Hi! I'll lead the room." } },
    },
  },
  {
    ms: 3600,
    scene: {
      rooms: { ceo: "built", ...BLUEPRINT, dev: "built" },
      camera: "dev",
      locked: ["dev"],
      board: { todo: 5, doing: 2, done: 0 },
      agents: { you: { at: "seat:you" }, ada: { at: "ada:home" }, ...working(DEV), pm: { at: "seat:pm", status: "working", bubble: "Sprint 1: seven tickets. Go!" } },
    },
  },
  {
    ms: 4800,
    scene: {
      rooms: { ceo: "built", dev: "built", meeting: "built", marketing: "built", sales: "ghost", legal: "ghost", finance: "ghost" },
      locked: ["dev"],
      board: { todo: 4, doing: 3, done: 1 },
      agents: { you: { at: "seat:you" }, ada: { at: "ada:home" }, ...working(DEV), ...walkIn(MKT, 0.3), strat: { ...walkIn(["strat"], 0.3).strat, bubble: "Launch plan by Friday." } },
    },
  },
  {
    ms: 4400,
    scene: {
      rooms: { ceo: "built", dev: "built", meeting: "built", marketing: "built", sales: "ghost", legal: "ghost", finance: "ghost" },
      locked: ["dev"],
      board: { todo: 3, doing: 3, done: 2 },
      agents: {
        you: { at: "seat:you" },
        ada: { at: "ada:home", bubble: { text: "One PR needs you.", tone: "ada" } },
        ...working(DEV),
        ...working(MKT),
        be: { at: "seat:be", status: "working", badge: 1, bubble: "PR #12 is ready for review." },
      },
    },
  },
];

const castStory = () => {
  for (const id of [...DEV, ...MKT]) if (DEMO_CAST[id]) CAST[id] ??= DEMO_CAST[id]!;
};
castStory();

function useStory() {
  const [i, setI] = useState(0);
  useEffect(() => {
    castStory(); // back after signing out (the office keeps only real agents)
    const t = setTimeout(() => setI((v) => (v + 1) % STORY.length), STORY[i]!.ms);
    return () => clearTimeout(t);
  }, [i]);
  return STORY[i]!.scene;
}

/* ------------------------------------------------------------------- page */

function Point({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] bg-[#f2f0ec] text-[14px] text-ink-2">{icon}</span>
      <span className="pt-[3px] text-[13.5px] leading-snug text-ink-2">{children}</span>
    </li>
  );
}

/** Signing in, over the office building itself. */
export function SignIn({ state, error, onSignIn, onSignOut }: { state: "loading" | "signed-out" | "not-allowed" | "error"; error?: string; onSignIn: () => void; onSignOut: () => void }) {
  const scene = useStory();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#e9e3d8]">
      <div className="absolute inset-x-0 top-0 h-[46vh] lg:inset-y-0 lg:left-[480px] lg:h-auto">{ready && <Office scene={scene} rounded={false} />}</div>

      <div className="absolute inset-x-3 bottom-3 top-[calc(46vh-24px)] z-10 flex flex-col overflow-y-auto rounded-[28px] bg-[#f7f6f3] shadow-[var(--shadow-float)] ring-1 ring-black/[0.06] lg:inset-y-3 lg:left-3 lg:right-auto lg:top-3 lg:w-[464px]">
        <div className="flex min-h-full flex-col justify-between gap-8 p-7 lg:p-9">
          <div className="flex items-center gap-2.5">
            <LogoMark size={30} />
            <span className="font-display text-[17px] font-semibold tracking-[-0.01em] text-ink">AgentFloor</span>
          </div>

          <div>
            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="font-display text-[38px] font-semibold leading-[1.02] tracking-[-0.04em] text-ink lg:text-[46px]"
            >
              Your company,
              <br />
              run by AI agents.
            </motion.h1>
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15, duration: 0.6 }} className="mt-4 text-[15px] leading-relaxed text-muted">
              Hire agents into rooms, hand them work, and watch them build it in a pixel office. Ada runs the place. You decide what ships.
            </motion.p>

            <ul className="mt-6 flex flex-col gap-3">
              <Point icon="⑂">Agents work on your GitHub repo, each on its own branch, and open pull requests.</Point>
              <Point icon="◷">Ada books meetings with the heads, writes the minutes and tracks the actions.</Point>
              <Point icon="🔒">Nothing merges without you. Rules you lock stay locked.</Point>
            </ul>
          </div>

          <div>
            <AnimatePresence mode="wait">
              {state === "loading" && (
                <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex h-[52px] items-center gap-2 text-[14px] text-muted">
                  <span className="h-2 w-2 rounded-full bg-accent" style={{ animation: "led 1.2s steps(2) infinite" }} />
                  Opening your office…
                </motion.div>
              )}
              {state === "signed-out" && (
                <motion.div key="out" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <button
                    onClick={onSignIn}
                    className="flex h-[52px] w-full items-center justify-center gap-2.5 rounded-full bg-ink text-[15px] font-semibold text-white shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] transition hover:bg-black"
                  >
                    <BrandIcon name="GitHub" size={18} mono />
                    Sign in with GitHub
                  </button>
                  {error && <p className="mt-3 rounded-[12px] bg-[#fdecea] px-3.5 py-2.5 text-[13px] text-[#9b2c24]">{error}</p>}
                </motion.div>
              )}
              {(state === "not-allowed" || state === "error") && (
                <motion.div key="blocked" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-[18px] bg-white p-4 ring-1 ring-black/[0.06]">
                  <p className="text-[14px] leading-snug text-ink-2">{state === "error" ? `Couldn't open your office: ${error}` : error}</p>
                  <button onClick={onSignOut} className="mt-3 text-[13px] font-semibold text-muted underline-offset-2 hover:text-ink hover:underline">
                    Sign out
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
            <p className="mt-4 text-[12px] leading-relaxed text-faint">Invite-only for now. Your agents run on your own Claude plan; you&apos;ll connect it in a minute.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
