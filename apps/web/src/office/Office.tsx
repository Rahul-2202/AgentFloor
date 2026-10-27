"use client";

import { AnimatePresence, animate, motion, useMotionValue, useMotionValueEvent, useSpring, type MotionValue } from "motion/react";
import dynamic from "next/dynamic";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Avatar, type AgentHandlers } from "./Avatar";
import { CAST, ROOMS, TILE, WORLD, spot, type RoomDef } from "./layout";
import { Bodies, BodiesContext } from "./three/bodies";
import type { Camera, PropScene, RoomId, RoomState, Scene } from "./types";

// The office is drawn in 3D (three.js) under the 2D layer of tags, bubbles and cards.
const Stage = dynamic(() => import("./three/Stage"), { ssr: false });

const EASE_CAM = [0.65, 0, 0.35, 1] as const;

function resolveCamera(c: Scene["camera"]): Camera {
  if (!c) return { x: 0, y: 0, w: WORLD.w, h: WORLD.h };
  if (typeof c === "string") c = [c];
  if (Array.isArray(c)) {
    const rs = c.map((id) => ROOMS[id]);
    const x0 = Math.min(...rs.map((r) => r.x)) - 0.75;
    const y0 = Math.min(...rs.map((r) => r.y)) - 0.75;
    const x1 = Math.max(...rs.map((r) => r.x + r.w)) + 0.75;
    const y1 = Math.max(...rs.map((r) => r.y + r.h)) + 0.75;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  return c;
}

/* ------------------------------------------------------------------ rooms */

function RoomLabel({ r, state, count, locked, note }: { r: RoomDef; state: RoomState; count: number; locked: boolean; note?: string }) {
  if (state === "built")
    return (
      <div className="absolute" style={{ left: r.x * TILE + 5, top: r.y * TILE + 6 }}>
        <div className="counter" style={{ ["--origin" as string]: "0% 0%" }}>
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-white/95 py-[3px] pl-2 pr-2.5 text-[11px] font-semibold text-ink shadow-[0_2px_8px_-2px_rgba(0,0,0,0.15)]"
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: count ? "var(--green)" : "var(--faint)" }} />
            {r.name}
            {count > 0 && <span className="font-medium text-muted">· {count}</span>}
            {locked && (
              <svg width="10" height="10" viewBox="0 0 16 16" className="ml-0.5 text-ink-2">
                <path fill="currentColor" d="M4 7V5a4 4 0 1 1 8 0v2h1v8H3V7h1Zm2 0h4V5a2 2 0 1 0-4 0v2Z" />
              </svg>
            )}
          </motion.div>
          {note && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-1 w-max rounded-full bg-ink/80 px-2 py-[2px] text-[10px] font-medium text-white"
            >
              {note}
            </motion.div>
          )}
        </div>
      </div>
    );
  if (state === "ghost")
    return (
      <div className="absolute grid place-items-center" style={{ left: r.x * TILE, top: r.y * TILE, width: r.w * TILE, height: r.h * TILE }}>
        <div className="counter" style={{ ["--origin" as string]: "50% 50%" }}>
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="flex max-w-[190px] flex-col items-center gap-1 text-center"
          >
            <div className="flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11.5px] font-semibold text-ink shadow-[0_2px_10px_-2px_rgba(232,116,59,0.35)] ring-1 ring-[#f3cfb6]">
              <span className="text-accent">+</span> {r.name}
            </div>
            <div className="text-[10.5px] leading-snug font-medium text-[#a8623e]">{r.suggestion}</div>
          </motion.div>
        </div>
      </div>
    );
  return (
    <div className="absolute grid place-items-center" style={{ left: r.x * TILE, top: r.y * TILE, width: r.w * TILE, height: r.h * TILE }}>
      <div className="counter" style={{ ["--origin" as string]: "50% 50%" }}>
        <div className="font-mono text-[9.5px] font-medium tracking-[0.14em] text-black/30 uppercase">{r.name}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ props */

const PROP_ICON: Record<PropScene["kind"], string> = {
  ticket: "◆",
  doc: "▤",
  pr: "⑂",
  lock: "🔒",
  knock: "✋",
  note: "✎",
  calendar: "◷",
  check: "✓",
  memory: "◈",
};

const PROP_TONE: Record<string, string> = {
  default: "bg-white text-ink ring-black/[0.07]",
  ok: "bg-[#eaf6ee] text-[#24603a] ring-[#bfe2cb]",
  warn: "bg-[#fdf3e0] text-[#8a5a10] ring-[#f1d9a6]",
  bad: "bg-[#fdecea] text-[#9b2c24] ring-[#f3c3be]",
  violet: "bg-[#f1eefd] text-[#4a3fa8] ring-[#d8d1f7]",
};

function Prop({ p }: { p: PropScene }) {
  const [px, py] = spot(p.at);
  const x = useMotionValue(px * TILE);
  const y = useMotionValue(py * TILE);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const o = { type: "spring" as const, stiffness: 70, damping: 16, delay: p.delay ?? 0 };
    const a = animate(x, px * TILE, o);
    const b = animate(y, py * TILE, o);
    return () => {
      a.stop();
      b.stop();
    };
  }, [px, py, x, y, p.delay]);
  return (
    <motion.div
      className="absolute left-0 top-0"
      style={{ x, y, zIndex: 900 }}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.7, transition: { duration: 0.25 } }}
      transition={{ type: "spring", stiffness: 300, damping: 24, delay: p.delay ?? 0 }}
    >
      <div className="counter absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2" style={{ ["--origin" as string]: "50% 50%" }}>
        <div className={`flex items-center gap-1.5 whitespace-nowrap rounded-[10px] px-2 py-1 text-[11px] font-semibold shadow-[0_6px_16px_-6px_rgba(0,0,0,0.3)] ring-1 ${PROP_TONE[p.tone ?? "default"]}`}>
          <span className="text-[10px] opacity-70">{PROP_ICON[p.kind]}</span>
          <span>{p.label}</span>
          {p.sub && <span className="font-medium opacity-60">{p.sub}</span>}
        </div>
      </div>
    </motion.div>
  );
}

/* ----------------------------------------------------------------- office */

export interface Inset {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}

export interface Follow {
  /** World pixel position the camera keeps centred. */
  x: MotionValue<number>;
  y: MotionValue<number>;
  /** Screen pixels per world pixel. */
  zoom: number;
  /** Extra camera offset in world pixels (drag to look around). */
  panX?: MotionValue<number>;
  panY?: MotionValue<number>;
}

export function Office({
  scene,
  className,
  rounded = true,
  inset,
  follow,
  onFloorClick,
  agentHandlers,
  children,
}: {
  scene: Scene;
  className?: string;
  rounded?: boolean;
  inset?: Inset;
  /** Interactive mode: the camera follows a point instead of the scene camera. */
  follow?: Follow;
  onFloorClick?: (x: number, y: number) => void;
  agentHandlers?: (id: string) => AgentHandlers | undefined;
  /** Extra layers rendered inside the world (player, popovers…). */
  children?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const bodies = useMemo(() => new Bodies(), []);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const s = useMotionValue(1);
  const tx = useMotionValue(0);
  const ty = useMotionValue(0);
  const ready = useRef(false);

  const [near, setNear] = useState(false);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    // Only keep the world mounted while it is on (or close to) the screen.
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: "50% 0px 50% 0px" });
    io.observe(el);
    return () => {
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!near) ready.current = false;
  }, [near]);

  const cam = useMemo(() => resolveCamera(scene.camera), [scene.camera]);
  const camKey = `${cam.x}|${cam.y}|${cam.w}|${cam.h}|${cam.cover ? 1 : 0}|${cam.anchor ?? ""}`;

  const il = inset?.left ?? 0;
  const ir = inset?.right ?? 0;
  const it = inset?.top ?? 0;
  const ib = inset?.bottom ?? 0;

  useEffect(() => {
    if (!size || !size.w || !near || follow) return;
    const vw = Math.max(1, size.w - il - ir);
    const vh = Math.max(1, size.h - it - ib);
    const fit = cam.cover ? Math.max : Math.min;
    const S = fit(vw / (cam.w * TILE), vh / (cam.h * TILE));
    // Centre the camera inside the uncovered area, but never show past the
    // world's edge when the world is big enough to fill the frame.
    const place = (center: number, view: number, off: number, full: number, world: number, top = false) => {
      const scaled = world * S;
      if (scaled <= view) return top ? off : off + (view - scaled) / 2;
      const want = off + view / 2 - center * S;
      const lo = Math.min(0, full - scaled);
      const hi = off;
      return Math.min(hi, Math.max(lo, want));
    };
    const X = place((cam.x + cam.w / 2) * TILE, vw, il, size.w - ir, WORLD.w * TILE);
    const Y = place((cam.y + cam.h / 2) * TILE, vh, it, size.h - ib, WORLD.h * TILE, cam.anchor === "top");
    if (!ready.current) {
      ready.current = true;
      s.set(S);
      tx.set(X);
      ty.set(Y);
      world.current?.style.setProperty("--inv", String(1 / S));
      return;
    }
    const o = { duration: 1.25, ease: EASE_CAM };
    const a = [animate(s, S, o), animate(tx, X, o), animate(ty, Y, o)];
    return () => a.forEach((c) => c.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camKey, size?.w, size?.h, il, ir, it, ib, near]);

  useMotionValueEvent(s, "change", (v) => world.current?.style.setProperty("--inv", String(1 / v)));

  // Follow mode: keep a point centred, clamped to the world, with a soft spring.
  const dummy = useMotionValue(0);
  const fx = follow?.x ?? dummy;
  const fy = follow?.y ?? dummy;
  const px = follow?.panX ?? dummy;
  const py = follow?.panY ?? dummy;
  const followX = useMotionValue(0);
  const followY = useMotionValue(0);
  const springX = useSpring(followX, { stiffness: 140, damping: 26, mass: 0.9 });
  const springY = useSpring(followY, { stiffness: 140, damping: 26, mass: 0.9 });
  const zoom = follow?.zoom ?? 0;
  const recenter = useRef<(snap?: boolean) => void>(() => {});
  useLayoutEffect(() => {
    recenter.current = (snap = false) => {
    if (!follow || !size) return;
    const S = zoom;
    const clampAxis = (c: number, view: number, worldPx: number) => {
      const scaled = worldPx * S;
      if (scaled <= view) return (view - scaled) / 2;
      return Math.min(0, Math.max(view - scaled, view / 2 - c * S));
    };
    const X = clampAxis(fx.get() + px.get(), size.w, WORLD.w * TILE);
    const Y = clampAxis(fy.get() + py.get(), size.h, WORLD.h * TILE);
    followX.set(X);
    followY.set(Y);
    if (snap) {
      springX.jump(X);
      springY.jump(Y);
    }
    };
  });
  useMotionValueEvent(fx, "change", () => recenter.current());
  useMotionValueEvent(fy, "change", () => recenter.current());
  useMotionValueEvent(px, "change", () => recenter.current());
  useMotionValueEvent(py, "change", () => recenter.current());
  const followed = useRef(false);
  useLayoutEffect(() => {
    if (near) world.current?.style.setProperty("--inv", String(1 / s.get()));
  }, [near, s]);

  useEffect(() => {
    if (!follow || !size || !near) return;
    const first = !followed.current;
    followed.current = true;
    if (first) {
      s.set(zoom);
      world.current?.style.setProperty("--inv", String(1 / zoom));
    } else {
      const a = animate(s, zoom, { duration: 0.5, ease: [0.22, 1, 0.36, 1] });
      recenter.current();
      return () => a.stop();
    }
    recenter.current(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, size?.w, size?.h, !!follow, near]);

  const onClickWorld = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onFloorClick || !world.current) return;
    const r = world.current.getBoundingClientRect();
    onFloorClick(((e.clientX - r.left) / r.width) * WORLD.w, ((e.clientY - r.top) / r.height) * WORLD.h);
  };

  const roomState = (id: RoomId): RoomState => scene.rooms[id] ?? "hidden";
  const agents = Object.entries(scene.agents).filter(([, a]) => a);
  const counts: Partial<Record<RoomId, number>> = {};
  agents.forEach(([id]) => {
    const m = CAST[id];
    if (m && m.room !== "ceo" && !m.human) counts[m.room] = (counts[m.room] ?? 0) + 1;
  });

  const view = useMemo(() => ({ s, x: follow ? springX : tx, y: follow ? springY : ty }), [s, follow, springX, springY, tx, ty]);

  return (
    <BodiesContext.Provider value={bodies}>
    <div ref={box} className={`relative h-full w-full overflow-hidden ${rounded ? "rounded-[inherit]" : ""} ${className ?? ""}`} style={{ background: "#e9e3d8" }}>
      {near && size && <Stage view={view} rooms={scene.rooms} board={scene.board} store={bodies} />}
      {near && (
      <motion.div
        ref={world}
        className="px-world absolute left-0 top-0"
        style={{
          width: WORLD.w * TILE,
          height: WORLD.h * TILE,
          x: follow ? springX : tx,
          y: follow ? springY : ty,
          scale: s,
          transformOrigin: "0 0",
          opacity: size ? 1 : 0,
          // Following someone (the office app): the floor is grabbed to look around, so no click cursor.
          cursor: onFloorClick && !follow ? "pointer" : undefined,
        }}
        onClick={onClickWorld}
      >
        <AnimatePresence>
          {agents.map(([id, a]) => {
            const m = CAST[id];
            if (!m || !a) return null;
            return <Avatar key={id} member={m} scene={a} labels={scene.labels ?? true} handlers={agentHandlers?.(id)} />;
          })}
        </AnimatePresence>

        <AnimatePresence>
          {Object.entries(scene.props ?? {}).map(([id, p]) => (p ? <Prop key={id} p={p} /> : null))}
        </AnimatePresence>

        {children}

        {/* room labels float above everything */}
        <div className="absolute inset-0" style={{ zIndex: 1000, pointerEvents: "none" }}>
          {Object.values(ROOMS).map((r) =>
            roomState(r.id) === "hidden" ? null : (
              <RoomLabel
                key={`${r.id}-${roomState(r.id)}`}
                r={r}
                state={roomState(r.id)}
                count={counts[r.id] ?? 0}
                locked={scene.locked?.includes(r.id) ?? false}
                note={scene.roomNotes?.[r.id]}
              />
            ),
          )}
        </div>
      </motion.div>
      )}
    </div>
    </BodiesContext.Provider>
  );
}
