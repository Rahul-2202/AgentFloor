"use client";

import { AnimatePresence, animate, motion, useMotionValue, useSpring, type MotionValue } from "motion/react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Avatar, type AgentHandlers } from "./Avatar";
import { FLOOR_DEPTH, unproject, type Cam } from "./camera";
import { FloorContext, FloorLayer, OnFloor } from "./floor";
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
      <OnFloor at={[r.x + 0.4, r.y + 2.4]} h={0}>
        <div className="absolute left-0 top-0">
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
      </OnFloor>
    );
  if (state === "ghost")
    return (
      <OnFloor at={[r.x + r.w / 2, r.y + r.h / 2]}>
        <div className="absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2">
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
            <div className="w-max max-w-[190px] text-[10.5px] leading-snug font-medium text-[#a8623e]">{r.suggestion}</div>
          </motion.div>
        </div>
      </OnFloor>
    );
  return (
    <OnFloor at={[r.x + r.w / 2, r.y + r.h / 2]}>
      <div className="absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap font-mono text-[9.5px] font-medium tracking-[0.14em] text-black/35 uppercase">{r.name}</div>
    </OnFloor>
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
    <OnFloor at={() => [x.get() / TILE, y.get() / TILE]} h={1.2} z={900}>
    <motion.div
      className="absolute left-0 top-0"
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.7, transition: { duration: 0.25 } }}
      transition={{ type: "spring", stiffness: 300, damping: 24, delay: p.delay ?? 0 }}
    >
      <div className="absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2">
        <div className={`flex items-center gap-1.5 whitespace-nowrap rounded-[10px] px-2 py-1 text-[11px] font-semibold shadow-[0_6px_16px_-6px_rgba(0,0,0,0.3)] ring-1 ${PROP_TONE[p.tone ?? "default"]}`}>
          <span className="text-[10px] opacity-70">{PROP_ICON[p.kind]}</span>
          <span>{p.label}</span>
          {p.sub && <span className="font-medium opacity-60">{p.sub}</span>}
        </div>
      </div>
    </motion.div>
    </OnFloor>
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

/** The back wall stands above the floor's top edge; leave room for it when fitting the view. */
const WALL_ROOM = 2.2;

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
  /** Extra layers pinned to the floor (player, popovers…). */
  children?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [near, setNear] = useState(false);
  const bodies = useMemo(() => new Bodies(), []);
  const layer = useMemo(() => new FloorLayer(), []);
  // The camera: the floor point at the centre of the view (tiles), and pixels per tile there.
  const camX = useMotionValue(WORLD.w / 2);
  const camZ = useMotionValue(WORLD.h / 2);
  const camS = useMotionValue(16);
  const ready = useRef(false);

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

  // Scene camera: fit the requested rectangle into the uncovered part of the view.
  useEffect(() => {
    if (!size || !size.w || !near || follow) return;
    const vw = Math.max(1, size.w - il - ir);
    const vh = Math.max(1, size.h - it - ib);
    const fit = cam.cover ? Math.max : Math.min;
    const S = fit(vw / cam.w, vh / (cam.h * FLOOR_DEPTH + (cam.y < 4 ? WALL_ROOM : 0.6)));
    const X = cam.x + cam.w / 2 - (il - ir) / 2 / S;
    let Z = cam.y + cam.h / 2 - (it - ib) / 2 / (S * FLOOR_DEPTH);
    if (cam.anchor === "top") Z = cam.y + (vh / 2 - it) / (S * FLOOR_DEPTH) - WALL_ROOM / FLOOR_DEPTH / 2;
    if (cam.y < 4) Z -= WALL_ROOM / FLOOR_DEPTH / 2;
    if (!ready.current) {
      ready.current = true;
      camS.set(S);
      camX.set(X);
      camZ.set(Z);
      return;
    }
    const o = { duration: 1.25, ease: EASE_CAM };
    const a = [animate(camS, S, o), animate(camX, X, o), animate(camZ, Z, o)];
    return () => a.forEach((c) => c.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camKey, size?.w, size?.h, il, ir, it, ib, near]);

  // Follow mode: keep a point centred, inside the building, with a soft spring.
  const dummy = useMotionValue(0);
  const fx = follow?.x ?? dummy;
  const fy = follow?.y ?? dummy;
  const px = follow?.panX ?? dummy;
  const py = follow?.panY ?? dummy;
  const springX = useSpring(camX, { stiffness: 140, damping: 26, mass: 0.9 });
  const springZ = useSpring(camZ, { stiffness: 140, damping: 26, mass: 0.9 });
  const zoom = follow?.zoom ?? 0;
  const followed = useRef(false);
  const recenter = useCallback(
    (snap = false) => {
      if (!follow || !size) return;
      const S = camS.get();
      const clamp = (c: number, half: number, lo: number, hi: number) => (hi - lo <= 2 * half ? (lo + hi) / 2 : Math.min(hi - half, Math.max(lo + half, c)));
      const X = clamp((fx.get() + px.get()) / TILE, size.w / 2 / S, -0.5, WORLD.w + 0.5);
      const Z = clamp((fy.get() + py.get()) / TILE, size.h / 2 / (S * FLOOR_DEPTH), -WALL_ROOM / FLOOR_DEPTH, WORLD.h + 0.8);
      camX.set(X);
      camZ.set(Z);
      if (snap) {
        springX.jump(X);
        springZ.jump(Z);
      }
    },
    [follow, size, camS, fx, fy, px, py, camX, camZ, springX, springZ],
  );
  useEffect(() => {
    if (!follow) return;
    const subs = [fx, fy, px, py].map((v) => v.on("change", () => recenter()));
    return () => subs.forEach((u) => u());
  }, [follow, fx, fy, px, py, recenter]);
  useEffect(() => {
    if (!follow || !size || !near) return;
    const first = !followed.current;
    followed.current = true;
    const S = zoom * TILE;
    if (first) {
      camS.set(S);
      recenter(true);
      return;
    }
    const a = animate(camS, S, { duration: 0.5, ease: [0.22, 1, 0.36, 1], onUpdate: () => recenter() });
    return () => a.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, size?.w, size?.h, !!follow, near]);

  /** The camera right now, for the 3D scene and the 2D layer alike. */
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const getCam = useCallback((): Cam | null => {
    const sz = sizeRef.current;
    if (!sz) return null;
    return { x: (follow ? springX : camX).get(), z: (follow ? springZ : camZ).get(), s: camS.get(), w: sz.w, h: sz.h };
  }, [follow, springX, springZ, camX, camZ, camS]);

  // Every frame, move the 2D layer to where the camera shows each pinned point.
  useEffect(() => {
    if (!near) return;
    let raf = 0;
    const tick = () => {
      const c = getCam();
      if (c) layer.update(c);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [near, getCam, layer]);

  const onClickWorld = (e: React.MouseEvent<HTMLDivElement>) => {
    const c = getCam();
    if (!onFloorClick || !c || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const [x, z] = unproject(c, e.clientX - r.left, e.clientY - r.top);
    onFloorClick(x, z);
  };

  const roomState = (id: RoomId): RoomState => scene.rooms[id] ?? "hidden";
  const agents = Object.entries(scene.agents).filter(([, a]) => a);
  const counts: Partial<Record<RoomId, number>> = {};
  agents.forEach(([id]) => {
    const m = CAST[id];
    if (m && m.room !== "ceo" && !m.human) counts[m.room] = (counts[m.room] ?? 0) + 1;
  });

  return (
    <BodiesContext.Provider value={bodies}>
      <FloorContext.Provider value={layer}>
        {/* isolate: tags and cards stack among themselves, never over the app's panels */}
        <div ref={box} className={`relative isolate h-full w-full overflow-hidden ${rounded ? "rounded-[inherit]" : ""} ${className ?? ""}`} style={{ background: "#ece6dc" }}>
          {near && size && <Stage getCam={getCam} rooms={scene.rooms} board={scene.board} store={bodies} />}
          {near && (
            <div
              className="px-world absolute inset-0"
              style={{ opacity: size ? 1 : 0, cursor: onFloorClick && !follow ? "pointer" : undefined }}
              onClick={onClickWorld}
            >
              <AnimatePresence>
                {agents.map(([id, a]) => {
                  const m = CAST[id];
                  if (!m || !a) return null;
                  return <Avatar key={id} member={m} scene={a} labels={scene.labels ?? true} handlers={agentHandlers?.(id)} />;
                })}
              </AnimatePresence>

              <AnimatePresence>{Object.entries(scene.props ?? {}).map(([id, p]) => (p ? <Prop key={id} p={p} /> : null))}</AnimatePresence>

              {children}

              <div className="pointer-events-none absolute inset-0" style={{ zIndex: 1500 }}>
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
            </div>
          )}
        </div>
      </FloorContext.Provider>
    </BodiesContext.Provider>
  );
}
