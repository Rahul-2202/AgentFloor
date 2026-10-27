"use client";

import { AnimatePresence, animate, motion, useMotionValue, type AnimationPlaybackControls } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { BrandIcon } from "@/components/brands";
import { portrait } from "./three/portrait";
import type { Look } from "./look";
import { findPath } from "./path";
import { spot, TILE, type CastMember } from "./layout";
import { useBody } from "./three/bodies";
import { RISE } from "./camera";
import { usePin } from "./floor";
import { seatFacing } from "./three/Person";
import type { AgentScene, AgentStatus, Bubble, Pt } from "./types";

const WALK_SPEED = 3.4; // tiles per second

/** How tall the 3D figures stand (units): tags sit just above. */
export const FIG_H = 2.8;

/** Head-and-shoulders picture of the 3D figure, used in tags, cards and lists. */
export function Portrait({ look, size = 32, className, bg, chief = false, round = false }: { look: Look; size?: number; className?: string; bg?: string; chief?: boolean; round?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(portrait(look, chief));
  }, [look, chief]);
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: round ? "50%" : size * 0.3,
        background: bg ?? "#f1ede6",
        overflow: "hidden",
        position: "relative",
        flexShrink: 0,
      }}
    >
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" width={size} height={size} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} draggable={false} />
      )}
    </div>
  );
}

/** A tag's colour per agent: their sweater, deepened so white text reads on it. */
export function tagColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const sat = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return `hsl(${Math.round(h * 60 + 360) % 360} ${Math.round(Math.max(0.28, Math.min(0.6, sat)) * 100)}% ${l < 0.2 ? 22 : 33}%)`;
}

function RuntimeBadge({ runtime }: { runtime?: string }) {
  if (!runtime) return null;
  const name = /claude/i.test(runtime) ? "Claude" : /codex/i.test(runtime) ? "Codex" : runtime;
  return (
    <span className="grid h-[14px] w-[14px] place-items-center rounded-[4px] bg-white" title={runtime}>
      <BrandIcon name={name} size={name === "Codex" ? 14 : 10} />
    </span>
  );
}

const STATUS: Record<AgentStatus, { color: string; label: string }> = {
  idle: { color: "#a19d96", label: "Idle" },
  working: { color: "#3f9b5f", label: "Working" },
  blocked: { color: "#d99a2b", label: "Blocked" },
  meeting: { color: "#7b6cd9", label: "In a meeting" },
  away: { color: "#c7c3bc", label: "Away" },
  thinking: { color: "#3b7be8", label: "Thinking" },
};

function StatusDot({ status }: { status?: AgentStatus }) {
  const st = STATUS[status ?? "idle"];
  const live = status === "working" || status === "thinking";
  return (
    <span className="relative grid h-[8px] w-[8px] place-items-center">
      {live && <span className="absolute inset-0 rounded-full" style={{ background: st.color, animation: "pulse-ring 1.8s ease-out infinite" }} />}
      <span className="relative h-[6px] w-[6px] rounded-full" style={{ background: st.color }} />
    </span>
  );
}

function BubbleView({ bubble }: { bubble: Bubble }) {
  const tone = bubble.tone ?? "default";
  const styles: Record<string, string> = {
    default: "bg-white text-ink border border-black/[0.06]",
    ceo: "bg-ink text-white",
    ada: "bg-[#fff4ec] text-ink border border-[#f3cfb6]",
    urgent: "bg-[#fdecea] text-[#9b2c24] border border-[#f3c3be]",
    quiet: "bg-white/90 text-muted border border-black/[0.06]",
  };
  return (
    <div
      className={`relative max-w-[210px] w-max rounded-[12px] px-2.5 py-1.5 text-[12px] leading-[1.35] font-medium shadow-[0_6px_18px_-6px_rgba(0,0,0,0.25)] ${styles[tone]}`}
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {bubble.text}
      <span
        className={`absolute left-1/2 -bottom-[4px] h-2 w-2 -translate-x-1/2 rotate-45 ${
          tone === "ceo" ? "bg-ink" : tone === "ada" ? "bg-[#fff4ec] border-r border-b border-[#f3cfb6]" : tone === "urgent" ? "bg-[#fdecea] border-r border-b border-[#f3c3be]" : "bg-white border-r border-b border-black/[0.06]"
        }`}
      />
    </div>
  );
}

export interface AgentHandlers {
  onClick?: () => void;
  onEnter?: () => void;
  onLeave?: () => void;
  /** Draw a soft ring under the agent (hovered or nearby). */
  highlight?: boolean;
}

export function Avatar({
  member,
  scene,
  labels,
  handlers,
}: {
  member: CastMember;
  scene: AgentScene;
  labels: boolean;
  handlers?: AgentHandlers;
}) {
  const target = spot(scene.at);
  const start = scene.from ? spot(scene.from) : target;
  const x = useMotionValue(start[0] * TILE);
  const y = useMotionValue(start[1] * TILE);
  const lifted = Boolean(scene.bubble || scene.emote);
  const [walking, setWalking] = useState(false);
  const ctl = useRef<AnimationPlaybackControls[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const first = useRef(true);
  const walkId = useRef(0);

  const tx = target[0];
  const ty = target[1];

  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (!scene.from) return;
    }
    ctl.current.forEach((c) => c.stop());
    if (timer.current) clearTimeout(timer.current);

    const from: Pt = [x.get() / TILE, y.get() / TILE];
    const to: Pt = [tx, ty];
    if (Math.abs(from[0] - to[0]) < 0.02 && Math.abs(from[1] - to[1]) < 0.02) {
      // Interrupted right at the target: make sure the walk cycle stops.
      timer.current = setTimeout(() => setWalking(false), 0);
      return;
    }
    if (scene.snap) {
      x.set(to[0] * TILE);
      y.set(to[1] * TILE);
      return;
    }
    const pts = findPath(from, to);
    const seg: number[] = [0];
    for (let i = 1; i < pts.length; i++) seg.push(seg[i - 1] + Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]));
    const total = seg[seg.length - 1] || 0.001;
    const duration = total / (WALK_SPEED * (scene.speed ?? 1));
    const times = seg.map((s) => s / total);
    const delay = scene.delay ?? 0;
    const opts = { duration, times, ease: "linear" as const, delay };
    ctl.current = [
      animate(x, pts.map((p) => p[0] * TILE), opts),
      animate(y, pts.map((p) => p[1] * TILE), opts),
    ];
    const token = ++walkId.current;
    timer.current = setTimeout(() => setWalking(true), delay * 1000);
    ctl.current[0].finished.then(() => {
      if (walkId.current === token) setWalking(false);
    });
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx, ty]);

  useEffect(() => () => ctl.current.forEach((c) => c.stop()), []);

  const feet = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const where = (): Pt => [x.get() / TILE, y.get() / TILE];
  usePin(feet, where, 0, 0);
  // Seated people's heads are lower: keep their tags just above them.
  const seated = !walking && seatFacing(typeof scene.at === "string" ? scene.at : undefined) !== null;
  usePin(head, where, seated ? FIG_H - 0.6 : FIG_H, lifted ? 2000 : 1);
  useBody({ id: member.id, look: member.look, x, y, walking, status: scene.status, at: typeof scene.at === "string" ? scene.at : undefined, highlight: handlers?.highlight });
  const bubble: Bubble | null = scene.bubble ? (typeof scene.bubble === "string" ? { text: scene.bubble } : scene.bubble) : null;
  const status = scene.status;

  return (
    <>
      <motion.div
        ref={feet}
        className="absolute left-0 top-0"
        data-agent={member.id}
        style={{ width: 0, height: 0 }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.35 } }}
        transition={{ duration: 0.5, delay: scene.delay ?? 0 }}
      >
        {/* the figure's outline on screen, for hovering and clicking */}
        <div
          className={`absolute ${handlers ? "cursor-pointer" : "pointer-events-none"}`}
          style={{ left: "calc(var(--u) * -0.5)", width: "calc(var(--u) * 1)", bottom: "calc(var(--u) * -0.15)", height: `calc(var(--u) * ${(FIG_H * RISE).toFixed(2)})` }}
          onPointerEnter={handlers?.onEnter}
          onPointerLeave={handlers?.onLeave}
          onClick={(e) => {
            if (!handlers) return;
            e.stopPropagation();
            handlers.onClick?.();
          }}
        />
      </motion.div>
      <motion.div
        ref={head}
        className="pointer-events-none absolute left-0 top-0"
        style={{ width: 0, height: 0 }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.35 } }}
        transition={{ duration: 0.5, delay: scene.delay ?? 0 }}
      >
        {/* Above the head */}
        <div style={{ width: 0, height: 0 }}>
          <div className="absolute bottom-[4px] left-0 flex -translate-x-1/2 flex-col items-center gap-1">
            <AnimatePresence mode="popLayout">
              {bubble && (
                <motion.div
                  key={bubble.text}
                  initial={{ opacity: 0, y: 6, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.96, transition: { duration: 0.2 } }}
                  transition={{ type: "spring", stiffness: 380, damping: 30, delay: (scene.delay ?? 0) + 0.05 }}
                  style={{ transformOrigin: "50% 100%" }}
                >
                  <BubbleView bubble={bubble} />
                </motion.div>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {scene.emote && !bubble && (
                <motion.div
                  key={scene.emote}
                  initial={{ opacity: 0, y: 6, scale: 0.6 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  transition={{ type: "spring", stiffness: 500, damping: 22 }}
                  className={`grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-[12px] font-bold shadow-md ${
                    scene.emote === "!" ? "bg-bad text-white" : scene.emote === "✓" ? "bg-ok text-white" : "bg-white text-ink"
                  }`}
                >
                  {scene.emote}
                </motion.div>
              )}
            </AnimatePresence>
            {labels ? (
              <div
                className="flex items-center gap-1 whitespace-nowrap rounded-full py-[2px] pl-[2px] pr-[5px] text-[10px] font-semibold text-white shadow-[0_2px_6px_rgba(0,0,0,0.22)]"
                style={{ background: member.id === "ada" ? "#e8743b" : member.human ? "#ffffff" : tagColor(member.look.shirt), color: member.human ? "var(--ink)" : "#fff" }}
              >
                <Portrait look={member.look} size={16} round bg="rgba(255,255,255,0.9)" chief={member.id === "ada"} />
                <span className="px-[1px]">{member.name}</span>
                <RuntimeBadge runtime={member.runtime} />
                <StatusDot status={status} />
              </div>
            ) : (
              status && status !== "idle" && <StatusDot status={status} />
            )}
          </div>
          <AnimatePresence>
            {scene.badge ? (
              <motion.div
                key="badge"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 25 }}
                className="absolute"
                style={{ left: 5, bottom: -9 }}
              >
                <div className="grid h-[16px] min-w-[16px] place-items-center rounded-full bg-bad px-1 text-[10px] font-bold text-white ring-2 ring-white">
                  {scene.badge}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </motion.div>
    </>
  );
}
