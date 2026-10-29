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
type Who = { login: string | null; name: string | null; avatar: string | null; email: string | null };

/** Signed in, but not invited yet: who they are, that the admins know, and that this page will let them in by itself. */
function Waiting({ who, checking, onCheckAgain, onSignOut }: { who?: Who; checking?: boolean; onCheckAgain?: () => void; onSignOut: () => void }) {
  const handle = who?.login ? `@${who.login}` : (who?.email ?? "your account");
  return (
    <div className="rounded-[22px] bg-white p-4 shadow-[0_12px_32px_-20px_rgba(0,0,0,0.35)] ring-1 ring-black/[0.06]">
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          {who?.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={who.avatar} alt="" className="h-11 w-11 rounded-full bg-[#f2f0ec] ring-2 ring-white" />
          ) : (
            <span className="grid h-11 w-11 place-items-center rounded-full bg-[#f2f0ec] text-[16px] font-bold text-muted">{(who?.name ?? who?.login ?? "?")[0]!.toUpperCase()}</span>
          )}
          <span className="absolute -bottom-0.5 -right-0.5 grid h-[18px] w-[18px] place-items-center rounded-full bg-[#f4b740] text-[10px] ring-2 ring-white">⏳</span>
        </div>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-ink">{who?.name ?? who?.login ?? "Signed in"}</p>
          <p className="flex items-center gap-1.5 truncate text-[12.5px] text-faint">
            <BrandIcon name="GitHub" size={12} mono />
            {handle}
          </p>
        </div>
      </div>

      <div className="mt-3.5 rounded-[14px] bg-[#fdf6e7] px-3.5 py-3">
        <p className="flex items-center gap-2 text-[13.5px] font-semibold text-[#7a5410]">
          <span className="h-2 w-2 rounded-full bg-[#e0a21f]" style={{ animation: "led 1.4s steps(2) infinite" }} />
          You&apos;re on the waiting list
        </p>
        <p className="mt-1 text-[13px] leading-snug text-[#6b5a3a]">
          AgentFloor is invite-only for now, and the admins can see you asked. As soon as they let you in, this page opens your office. No need to sign in again.
        </p>
      </div>

      <div className="mt-3.5 flex items-center justify-between gap-3">
        <button
          onClick={onCheckAgain}
          disabled={checking}
          className="flex h-10 items-center gap-2 rounded-full bg-ink px-4 text-[13.5px] font-semibold text-white transition hover:bg-black disabled:opacity-60"
        >
          {checking ? "Checking…" : "Check again"}
        </button>
        <button onClick={onSignOut} className="text-[12.5px] font-semibold text-muted underline-offset-2 hover:text-ink hover:underline">
          Use another account
        </button>
      </div>
    </div>
  );
}

/** The office's own first frame (same floor colour), with the logo if it takes a moment. */
export function Splash() {
  return (
    <div className="fixed inset-0 grid place-items-center bg-[#e9e3d8]">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4, duration: 0.4 }} className="flex flex-col items-center gap-3">
        <LogoMark size={36} />
        <span className="flex items-center gap-2 text-[13px] text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" style={{ animation: "led 1.2s steps(2) infinite" }} />
          Opening your office…
        </span>
      </motion.div>
    </div>
  );
}

export function SignIn({
  state,
  error,
  who,
  checking,
  onSignIn,
  onSignOut,
  onCheckAgain,
}: {
  state: "signed-out" | "not-allowed" | "error";
  error?: string;
  who?: Who;
  checking?: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  onCheckAgain?: () => void;
}) {
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
              {state === "not-allowed" && (
                <motion.div key="waiting" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <Waiting who={who} checking={checking} onCheckAgain={onCheckAgain} onSignOut={onSignOut} />
                </motion.div>
              )}
              {state === "error" && (
                <motion.div key="blocked" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-[18px] bg-white p-4 ring-1 ring-black/[0.06]">
                  <p className="text-[14px] leading-snug text-ink-2">Couldn&apos;t open your office: {error}</p>
                  <button onClick={onSignOut} className="mt-3 text-[13px] font-semibold text-muted underline-offset-2 hover:text-ink hover:underline">
                    Sign out
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
            {state !== "not-allowed" && <p className="mt-4 text-[12px] leading-relaxed text-faint">Invite-only for now. Your agents run on your own Claude plan; you&apos;ll connect it in a minute.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
