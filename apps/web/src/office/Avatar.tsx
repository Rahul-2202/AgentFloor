"use client";

import { AnimatePresence, animate, motion, useMotionValue, useTransform, type AnimationPlaybackControls } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { personSprite, type Look } from "./sprites";
import { findPath } from "./path";
import { spot, TILE, type CastMember } from "./layout";
import type { AgentScene, AgentStatus, Bubble, Pt } from "./types";

const WALK_SPEED = 3.4; // tiles per second

export function PersonSvg({ look, frame = 0, className, eyes = true }: { look: Look; frame?: 0 | 1 | 2; className?: string; eyes?: boolean }) {
  const s = personSprite(look);
  return (
    <svg className={className} width={s.w} height={s.h} viewBox={`0 0 ${s.w} ${s.h}`} style={{ display: "block", shapeRendering: "crispEdges" }}>
      {s.frames[frame].map((p) => (
        <path key={p.fill} d={p.d} fill={p.fill} />
      ))}
      {eyes && (
        <g className="eyes">
          {s.eyes.map((p) => (
            <path key={p.fill} d={p.d} fill={p.fill} />
          ))}
        </g>
      )}
    </svg>
  );
}

/** Head-and-shoulders crop, used inside UI cards. */
export function Portrait({ look, size = 32, className, bg }: { look: Look; size?: number; className?: string; bg?: string }) {
  const s = personSprite(look);
  const crop = 12;
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        background: bg ?? "#f1ede6",
        overflow: "hidden",
        position: "relative",
        flexShrink: 0,
      }}
    >
      <svg
        viewBox={`0 0 ${s.w} ${crop}`}
        width={size * 0.8}
        height={(size * 0.8 * crop) / s.w}
        style={{ position: "absolute", left: "50%", bottom: 0, transform: "translateX(-50%)", shapeRendering: "crispEdges" }}
      >
        {s.frames[0].map((p) => (
          <path key={p.fill} d={p.d} fill={p.fill} />
        ))}
        {s.eyes.map((p) => (
          <path key={p.fill} d={p.d} fill={p.fill} />
        ))}
      </svg>
    </div>
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
  const z = useTransform(y, (v) => Math.round(v) + 2 + (lifted ? 2000 : 0));
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

  const s = personSprite(member.look);
  const bubble: Bubble | null = scene.bubble ? (typeof scene.bubble === "string" ? { text: scene.bubble } : scene.bubble) : null;
  const status = scene.status;

  return (
    <motion.div
      className="absolute left-0 top-0"
      data-agent={member.id}
      style={{ x, y, zIndex: z }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.35 } }}
      transition={{ duration: 0.5, delay: scene.delay ?? 0 }}
    >
      <div className={walking ? "walking" : "idle"} style={{ position: "absolute", left: -s.w / 2, top: -s.h, width: s.w, height: s.h }}>
        {handlers?.highlight && (
          <div
            className="absolute left-1/2 -translate-x-1/2 rounded-[50%]"
            style={{ width: 20, height: 7, bottom: -3.5, background: "rgba(232,116,59,0.35)", boxShadow: "0 0 0 1px rgba(232,116,59,0.8)" }}
          />
        )}
        <div className="absolute left-1/2 -translate-x-1/2 rounded-[50%] bg-black/15" style={{ width: 12, height: 3, bottom: -1 }} />
        {handlers && (
          <div
            className="absolute -inset-x-1 -bottom-1 -top-1 z-10 cursor-pointer"
            onPointerEnter={handlers.onEnter}
            onPointerLeave={handlers.onLeave}
            onClick={(e) => {
              e.stopPropagation();
              handlers.onClick?.();
            }}
          />
        )}
        <div className="body-bob absolute inset-0">
          {walking ? (
            <>
              <PersonSvg look={member.look} frame={1} className="frame-a absolute inset-0" />
              <PersonSvg look={member.look} frame={2} className="frame-b absolute inset-0" eyes={false} />
            </>
          ) : (
            <PersonSvg look={member.look} frame={0} className="absolute inset-0" />
          )}
        </div>

        {/* Above the head */}
        <div className="pointer-events-none absolute left-1/2 bottom-full" style={{ width: 0, height: 0 }}>
          <div className="counter absolute bottom-[3px] left-0 flex -translate-x-1/2 flex-col items-center gap-1" style={{ ["--origin" as string]: "50% 100%" }}>
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
            {labels && member.human ? (
              <div className="flex items-center gap-1 whitespace-nowrap rounded-full bg-[#2b4fb8] py-[1px] pl-1 pr-1.5 text-[10px] font-semibold text-white shadow-[0_1px_4px_rgba(0,0,0,0.18)]">
                <span className="h-[6px] w-[6px] rounded-full ring-1 ring-white/70" style={{ background: status === "away" ? "#c7c3bc" : status === "meeting" ? "#b9a8ff" : "#5fd08a" }} />
                {member.name}
                {member.real && <span className="rounded-full bg-[#ff5a4f] px-1 text-[7.5px] font-bold uppercase tracking-wide">Live</span>}
              </div>
            ) : labels ? (
              <div className="flex items-center gap-1 whitespace-nowrap rounded-full bg-white/90 py-[1px] pl-1 pr-1.5 text-[10px] font-semibold text-ink-2 shadow-[0_1px_4px_rgba(0,0,0,0.12)]">
                <StatusDot status={status} />
                {member.name}
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
                <div className="counter" style={{ ["--origin" as string]: "0% 100%" }}>
                  <div className="grid h-[16px] min-w-[16px] place-items-center rounded-full bg-bad px-1 text-[10px] font-bold text-white ring-2 ring-white">
                    {scene.badge}
                  </div>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
