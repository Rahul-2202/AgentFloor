"use client";

import { AnimatePresence, animate, motion, useMotionValue, useMotionValueEvent, useTransform } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PersonSvg } from "@/office/Avatar";
import { CAST, ROOMS, SPOTS, TILE, WORLD, spot } from "@/office/layout";
import { Office } from "@/office/Office";
import { personSprite } from "@/office/sprites";
import type { Pt, RoomId, Scene } from "@/office/types";
import { useSim, type SimState } from "@/sim/store";
import { AgentCard } from "./cards/AgentCard";
import { AdaCard } from "./cards/AdaCard";
import { HoverTag } from "./cards/HoverTag";
import { RoomBar } from "./RoomBar";
import { useUI } from "./ui";
import { nearestFree, usePlayer } from "./usePlayer";
import { roomAt } from "./who";

const NEAR = 1.9;

export function homeOf(id: string, s: Pick<SimState, "layout">) {
  return s.layout.homes[id] ?? "hall:mid";
}

function Player({ x, y, walking, who, bubble }: { x: ReturnType<typeof usePlayer>["x"]; y: ReturnType<typeof usePlayer>["y"]; walking: boolean; who: string; bubble?: string | null }) {
  const look = (CAST[who] ?? CAST.you).look;
  const sp = personSprite(look);
  const z = useTransform(y, (v) => Math.round(v) + 3);
  return (
    <motion.div className="pointer-events-none absolute left-0 top-0" style={{ x, y, zIndex: z }}>
      <div className={walking ? "walking" : "idle"} style={{ position: "absolute", left: -sp.w / 2, top: -sp.h, width: sp.w, height: sp.h }}>
        <div className="absolute left-1/2 -translate-x-1/2 rounded-[50%]" style={{ width: 18, height: 6, bottom: -3, background: "rgba(10,10,10,0.18)", boxShadow: "0 0 0 1px rgba(10,10,10,0.35)" }} />
        <div className="body-bob absolute inset-0">
          {walking ? (
            <>
              <PersonSvg look={look} frame={1} className="frame-a absolute inset-0" />
              <PersonSvg look={look} frame={2} className="frame-b absolute inset-0" eyes={false} />
            </>
          ) : (
            <PersonSvg look={look} frame={0} className="absolute inset-0" />
          )}
        </div>
        <div className="absolute bottom-full left-1/2" style={{ width: 0 }}>
          <div className="counter absolute bottom-[3px] left-0 flex -translate-x-1/2 flex-col items-center gap-1 whitespace-nowrap" style={{ ["--origin" as string]: "50% 100%" }}>
            <AnimatePresence>
              {bubble && (
                <motion.div key={bubble} initial={{ opacity: 0, y: 6, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="rounded-[12px] bg-white px-2.5 py-1 text-[11px] font-semibold text-ink shadow-md ring-1 ring-black/10">
                  {bubble}
                </motion.div>
              )}
            </AnimatePresence>
            <div data-tour="player" className="rounded-full bg-ink px-2 py-[2px] text-[10.5px] font-bold text-white shadow-md">
              You{who !== "you" ? <span className="font-semibold text-white/60"> · {CAST[who]?.name}</span> : null}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Pins a card to an agent. Measures fixed points at the agent's head and feet
 * (they never move when the card flips), prefers above, flips only when the
 * current side doesn't fit, and clamps the card inside the free screen area.
 */
function Anchor({ at, children, z = 3000, offset = 24 }: { at: Pt; children: React.ReactNode; z?: number; offset?: number }) {
  const head = useRef<HTMLDivElement>(null);
  const feet = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ below: false, dx: 0, dy: 0 });
  const cur = useRef(place);
  useEffect(() => {
    cur.current = place;
  }, [place]);

  useEffect(() => {
    const fit = () => {
      const h = head.current?.getBoundingClientRect();
      const f = feet.current?.getBoundingClientRect();
      const b = box.current?.getBoundingClientRect();
      if (!h || !f || !b) return;
      const TOP = 78;
      const BOT = window.innerHeight - 16;
      const fitsAbove = h.top - b.height >= TOP;
      const fitsBelow = f.top + b.height <= BOT;
      let below = cur.current.below;
      if (below ? !fitsBelow && fitsAbove : !fitsAbove && fitsBelow) below = !below;
      if (!fitsAbove && !fitsBelow) below = BOT - f.top > h.top - TOP;
      let dy = 0;
      if (below) {
        const bottom = f.top + b.height;
        if (bottom > BOT) dy = BOT - bottom;
        if (f.top + dy < TOP) dy = TOP - f.top;
      } else {
        const top = h.top - b.height;
        if (top < TOP) dy = TOP - top;
        if (h.top + dy > BOT) dy = BOT - h.top;
      }
      const left = h.left - b.width / 2;
      const dx = left < 12 ? 12 - left : left + b.width > window.innerWidth - 12 ? window.innerWidth - 12 - (left + b.width) : 0;
      const p = cur.current;
      if (p.below !== below || Math.abs(p.dx - dx) > 2 || Math.abs(p.dy - dy) > 2) setPlace({ below, dx, dy });
    };
    fit();
    const t = setInterval(fit, 120);
    return () => clearInterval(t);
  }, []);

  const x = at[0] * TILE;
  return (
    <>
      <div ref={head} className="pointer-events-none absolute" style={{ left: x, top: at[1] * TILE - offset, width: 0, height: 0 }} />
      <div ref={feet} className="pointer-events-none absolute" style={{ left: x, top: at[1] * TILE + 6, width: 0, height: 0 }} />
      <div className="absolute" style={{ left: x, top: place.below ? at[1] * TILE + 6 : at[1] * TILE - offset, zIndex: z, width: 0, height: 0 }}>
        <div
          ref={box}
          className={`counter absolute left-0 ${place.below ? "top-0" : "bottom-0"}`}
          style={{
            ["--origin" as string]: place.below ? "50% 0%" : "50% 100%",
            translate: `calc(-50% + ${place.dx}px * var(--inv, 1)) calc(${place.dy}px * var(--inv, 1))`,
            transition: "translate 0.2s ease",
          }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    </>
  );
}

export function World() {
  const { s, d } = useSim();
  const ui = useUI();

  // Zoom: starts with the whole office in view; +/−, pinch or ctrl+scroll zoom in to 4×.
  const fitZoom = useFitZoom();
  const [zoomPick, setZoom] = useState<number | null>(null);
  const zoom = clampZoom(zoomPick ?? fitZoom, fitZoom);
  const zoomBy = useCallback((k: number) => setZoom((z) => clampZoom((z ?? fitZoom) * k, fitZoom)), [fitZoom]);
  const player = usePlayer(SPOTS["ceo:visitor"], useCallback(() => false, []));
  const meId = s.me;
  const [near, setNear] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [room, setRoom] = useState<string | null>("ceo");
  const [summoned, setSummoned] = useState<string[]>([]);
  const cardBy = useRef<"near" | "click" | null>(null);
  const down = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const dragged = useRef(false);
  const panX = useMotionValue(0);
  const panY = useMotionValue(0);
  const [panned, setPanned] = useState(false);
  const [grabbing, setGrabbing] = useState(false);
  const recenterCam = useCallback(() => {
    const o = { type: "spring" as const, stiffness: 120, damping: 22 };
    animate(panX, 0, o);
    animate(panY, 0, o);
    setTimeout(() => setPanned(false), 0);
  }, [panX, panY]);

  // Walking with the keys brings the camera back to you. Walking somewhere you
  // clicked keeps the view where you were looking (that's where you're going).
  const clickWalk = useRef(false);
  useEffect(() => {
    if (!player.walking) {
      clickWalk.current = false;
      return;
    }
    if (!clickWalk.current && (panX.get() !== 0 || panY.get() !== 0)) recenterCam();
  }, [player.walking, panX, panY, recenterCam]);
  // A click on the floor walks there a moment later, unless a drag starts first
  // (trackpads with tap-to-click begin a drag with a tap, which is a click).
  const walkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Looks at another part of the office: the camera can reach every corner of the floor. */
  const panTo = useCallback(
    (nx: number, ny: number) => {
      const [wx, wy] = player.pos();
      panX.set(Math.max(-wx * TILE, Math.min(WORLD.w * TILE - wx * TILE, nx)));
      panY.set(Math.max(-wy * TILE, Math.min(WORLD.h * TILE - wy * TILE, ny)));
      setPanned(true);
    },
    [player, panX, panY],
  );
  // Trackpad: two-finger scroll looks around, pinch (ctrl+scroll) zooms.
  const root = useRef<HTMLDivElement>(null);
  const wheel = useRef({ zoom, panTo, zoomBy });
  useLayoutEffect(() => {
    wheel.current = { zoom, panTo, zoomBy };
  });
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Scrolling inside a card or panel scrolls that, not the office.
      if ((e.target as HTMLElement).closest(".counter, [data-scroll]")) return;
      e.preventDefault();
      const w = wheel.current;
      if (e.ctrlKey || e.metaKey) w.zoomBy(Math.exp(-e.deltaY * 0.01));
      else w.panTo(panX.get() + e.deltaX / w.zoom, panY.get() + e.deltaY / w.zoom);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [panX, panY]);

  const posOf = useCallback((id: string): Pt => spot(s.live[id]?.at ?? "ada:home"), [s.live]);

  // Let other parts of the app move the player and summon agents.
  const goToRef = useRef(player.goTo);
  const summonRef = useRef<(id: string) => void>(() => {});
  const sendBack = (id: string) => {
    d({ type: "live", id, patch: { at: undefined } });
    setSummoned((v) => v.filter((x) => x !== id));
    if (ui.card === id) ui.setCard(null);
  };
  useLayoutEffect(() => {
    goToRef.current = player.goTo;
    summonRef.current = (id: string) => {
    // They come to you: look back at yourself so their card opens on screen.
    recenterCam();
    const [px, py] = player.pos();
    const [ax] = posOf(id);
    const side = ax < px ? -1.3 : 1.3;
    const to = nearestFree(px + side, py);
    const from = posOf(id);
    d({ type: "live", id, patch: { at: to } });
    setSummoned((v) => (v.includes(id) ? v : [...v, id]));
    const secs = (Math.abs(from[0] - to[0]) + Math.abs(from[1] - to[1])) / 3.4 + 0.4;
    setTimeout(() => {
      cardBy.current = "click";
      ui.setCard(id);
    }, secs * 1000);
    };
  });
  useEffect(() => {
    ui.setWalkTo((x, y) => goToRef.current(x, y));
    ui.setSummon((id) => summonRef.current(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Proximity + current room
  const check = () => {
    const [px, py] = player.pos();
    let best: string | null = null;
    let bd = NEAR;
    Object.keys(s.live).forEach((id) => {
      if (id === meId) return;
      const [ax, ay] = posOf(id);
      const dd = Math.hypot(ax - px, ay - py);
      if (dd < bd) {
        bd = dd;
        best = id;
      }
    });
    setNear((v) => (v === best ? v : best));
    const r = roomAt(px, py);
    setRoom((v) => (v === r ? v : r));
    if (ui.here !== r) ui.setHere(r);
    // Agents you called over head back once you walk away.
    summoned.forEach((id) => {
      const [ax, ay] = posOf(id);
      if (Math.hypot(ax - px, ay - py) > 6) sendBack(id);
    });
  };
  useMotionValueEvent(player.x, "change", check);
  useMotionValueEvent(player.y, "change", check);

  // Walking up to someone opens their card; walking away closes it.
  useEffect(() => {
    if (player.walking) {
      if (cardBy.current === "near" && ui.card && ui.card !== near) {
        ui.setCard(null);
        cardBy.current = null;
      }
      return;
    }
    if (near && ui.card !== near && !ui.win) {
      cardBy.current = "near";
      ui.setCard(near);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, player.walking]);

  const closeRef = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    closeRef.current = () => {
      const id = ui.card;
      if (id && summoned.includes(id)) {
        d({ type: "live", id, patch: { at: undefined } });
        setSummoned((v) => v.filter((x) => x !== id));
      }
      ui.setCard(null);
    };
  });

  // E opens the nearest card, Esc closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if ((e.key === "e" || e.key === "E") && near) {
        cardBy.current = "click";
        ui.setCard(near);
      }
      if (e.key === "Escape" && !ui.win && !ui.panel) closeRef.current();
      if (e.key === "=" || e.key === "+") zoomBy(ZOOM_STEP);
      if (e.key === "-") zoomBy(1 / ZOOM_STEP);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [near, ui, zoomBy]);

  const openAgent = (id: string) => {
    const [ax, ay] = posOf(id);
    const [px, py] = player.pos();
    if (Math.hypot(ax - px, ay - py) <= 2.6) {
      cardBy.current = "click";
      ui.setCard(id);
      return;
    }
    clickWalk.current = true;
    player.goTo(ax, ay + 1.1, () => {
      cardBy.current = "click";
      ui.setCard(id);
    });
  };

  const scene: Scene = useMemo(() => {
    const agents = Object.fromEntries(
      Object.entries(s.live)
        .filter(([id]) => id !== s.me)
        .map(([id, l]) => [
        id,
        { at: l.at, status: l.paused ? "away" : l.status, bubble: l.bubble ?? null, emote: l.emote ?? null, badge: l.queued || null, speed: 1.15 },
      ]),
    );
    // The board in the first team room shows the office's work.
    const open = s.tasks;
    const slots = ["dev", "marketing", "sales", "legal", "finance"] as const;
    return {
      rooms: {
        ceo: "built",
        meeting: "built",
        ...Object.fromEntries(slots.map((k) => [k, s.rooms[k] ? "built" : "ghost"])),
      },
      agents,
      labels: true,
      board: {
        todo: open.filter((t) => t.state === "queued").length,
        doing: open.filter((t) => ["ongoing", "blocked", "question", "review"].includes(t.state)).length,
        done: open.filter((t) => t.state === "done").length,
      },
      // Merging always needs the CEO: every room with code shows the lock.
      locked: s.locked.find((l) => l.id === "merge")?.locked ? (Object.keys(s.rooms) as RoomId[]) : [],
    } as Scene;
  }, [s.live, s.tasks, s.locked, s.rooms, s.me]);

  const handlers = (id: string) => ({
    onClick: () => openAgent(id),
    onEnter: () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      setHover(id);
    },
    onLeave: () => {
      hoverTimer.current = setTimeout(() => setHover((h) => (h === id ? null : h)), 280);
    },
    highlight: id === near || id === hover || id === ui.card,
  });

  const cardId = ui.card;
  const hoverId = hover && hover !== cardId ? hover : null;

  const closeCard = () => {
    const id = ui.card;
    if (id && summoned.includes(id)) sendBack(id);
    else ui.setCard(null);
    cardBy.current = null;
  };

  return (
    <div
      ref={root}
      className="absolute inset-0 select-none"
      style={{ cursor: grabbing ? "grabbing" : "grab", touchAction: "none" }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        // A drag starting right after a tap: the tap was its start, not a walk.
        if (walkTimer.current) {
          clearTimeout(walkTimer.current);
          walkTimer.current = null;
        }
        down.current = { x: e.clientX, y: e.clientY, px: panX.get(), py: panY.get() };
        dragged.current = false;
      }}
      onPointerMove={(e) => {
        const st = down.current;
        if (!st) return;
        const dx = e.clientX - st.x;
        const dy = e.clientY - st.y;
        if (!dragged.current && Math.hypot(dx, dy) > 6) {
          dragged.current = true;
          setGrabbing(true);
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        }
        if (dragged.current) {
          // Screen pixels → world pixels.
          panTo(st.px - dx / zoom, st.py - dy / zoom);
        }
      }}
      onPointerUp={() => {
        down.current = null;
        setGrabbing(false);
      }}
      onPointerCancel={() => {
        down.current = null;
        setGrabbing(false);
      }}
    >
      <Office
        scene={scene}
        rounded={false}
        follow={{ x: player.x, y: player.y, zoom, panX, panY }}
        onFloorClick={(x, y) => {
          if (dragged.current) return;
          if (walkTimer.current) clearTimeout(walkTimer.current);
          walkTimer.current = setTimeout(() => {
            walkTimer.current = null;
            if (cardBy.current === "click") {
              ui.setCard(null);
              cardBy.current = null;
            }
            clickWalk.current = true;
            player.goTo(x, y);
          }, 250);
        }}
        agentHandlers={handlers}
      >
        <Player x={player.x} y={player.y} walking={player.walking} who={meId} bubble={null} />

        {player.target && (
          <div className="pointer-events-none absolute" style={{ left: player.target[0] * TILE, top: player.target[1] * TILE, zIndex: 5 }}>
            <span className="absolute -left-[6px] -top-[3px] h-[6px] w-[12px] rounded-[50%] ring-1 ring-accent" style={{ animation: "pulse-ring 1.2s ease-out infinite" }} />
          </div>
        )}

        <AnimatePresence>
          {hoverId && (
            <Anchor key={`h-${hoverId}`} at={posOf(hoverId)} z={2900} offset={30}>
              <div
                onPointerEnter={() => hoverTimer.current && clearTimeout(hoverTimer.current)}
                onPointerLeave={() => setHover(null)}
              >
                <HoverTag
                  id={hoverId}
                  far={Math.hypot(posOf(hoverId)[0] - player.pos()[0], posOf(hoverId)[1] - player.pos()[1]) > 2.6}
                  onCall={() => {
                    setHover(null);
                    summonRef.current(hoverId);
                  }}
                  onOpen={() => {
                    setHover(null);
                    openAgent(hoverId);
                  }}
                />
              </div>
            </Anchor>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {cardId && s.live[cardId] && (
            <Anchor key={`c-${cardId}`} at={posOf(cardId)} offset={30}>
              {cardId === "ada" ? (
                <AdaCard onClose={closeCard} />
              ) : (
                <AgentCard id={cardId} summoned={summoned.includes(cardId)} onSendBack={() => sendBack(cardId)} onClose={closeCard} />
              )}
            </Anchor>
          )}
        </AnimatePresence>
      </Office>

      <RoomBar room={room} />

      <Minimap
        px={player.x}
        py={player.y}
        live={Object.fromEntries(Object.entries(s.live).filter(([id]) => id !== meId))}
        built={["ceo", "meeting", ...Object.keys(s.rooms)]}
        hidden={!!cardId}
        onGo={(x, y) => player.goTo(x, y)}
      />

      <AnimatePresence>
        {panned && (
          <motion.button
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            onClick={recenterCam}
            className="absolute bottom-16 left-1/2 z-30 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-[12.5px] font-semibold text-white shadow-[var(--shadow-card)]"
          >
            ◎ Back to me
          </motion.button>
        )}
      </AnimatePresence>

      <div data-tour="zoom" className={`absolute bottom-4 left-4 z-30 flex flex-col overflow-hidden rounded-[14px] bg-white/90 shadow-[var(--shadow-card)] ring-1 ring-black/[0.06] backdrop-blur transition-opacity duration-200 md:left-[236px] ${cardId ? "pointer-events-none opacity-0" : ""}`}>
        <button onClick={() => zoomBy(ZOOM_STEP)} className="grid h-9 w-9 place-items-center text-[18px] font-semibold text-ink hover:bg-black/5" aria-label="Zoom in">
          +
        </button>
        <div className="h-px bg-black/[0.06]" />
        <button onClick={() => zoomBy(1 / ZOOM_STEP)} className="grid h-9 w-9 place-items-center text-[18px] font-semibold text-ink hover:bg-black/5" aria-label="Zoom out">
          −
        </button>
      </div>

      <div className={`pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-white/85 transition-opacity duration-300 ${cardId ? "opacity-0" : "opacity-100"} px-3.5 py-1.5 text-[12px] font-medium text-muted shadow-sm ring-1 ring-black/[0.05] backdrop-blur`}>
        <b className="text-ink-2">WASD / arrows</b> to walk · <b className="text-ink-2">click</b> to go · <b className="text-ink-2">drag or scroll</b> to look around · <b className="text-ink-2">pinch or +/−</b> to zoom · walk up to anyone or press <b className="text-ink-2">E</b> · hover to <b className="text-ink-2">call them</b>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- zoom */

const ZOOM_STEP = 1.25;
const ZOOM_MAX = 4;
const clampZoom = (z: number, fit: number) => Math.max(fit, Math.min(ZOOM_MAX, z));

/** The zoom that shows the whole office in the window (the most zoomed-out view). */
function useFitZoom() {
  const calc = () => Math.min(window.innerWidth / (WORLD.w * TILE), (window.innerHeight - 64) / (WORLD.h * TILE));
  const [fit, setFit] = useState(calc);
  useEffect(() => {
    const on = () => setFit(calc());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return fit;
}

/* ------------------------------------------------------------------ minimap */

function Minimap({ px, py, live, built, hidden, onGo }: { px: ReturnType<typeof usePlayer>["x"]; py: ReturnType<typeof usePlayer>["y"]; live: Record<string, { at: Pt | string; status: string }>; built: string[]; hidden?: boolean; onGo: (x: number, y: number) => void }) {
  const W = 200;
  const k = W / WORLD.w;
  const H = WORLD.h * k;
  const dotX = useTransform(px, (v) => (v / TILE) * k - 3);
  const dotY = useTransform(py, (v) => (v / TILE) * k - 3);
  const colors: Record<string, string> = Object.fromEntries(Object.values(ROOMS).filter((r) => built.includes(r.id)).map((r) => [r.id, r.floor]));
  return (
    <div data-tour="minimap" className={`absolute bottom-4 left-4 z-30 hidden rounded-[16px] bg-white/90 p-2 shadow-[var(--shadow-card)] ring-1 ring-black/[0.06] backdrop-blur transition-opacity duration-200 md:block ${hidden ? "pointer-events-none opacity-0" : ""}`}>
      <div
        className="relative cursor-pointer overflow-hidden rounded-[10px] bg-[#f0ebe2]"
        style={{ width: W, height: H }}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onGo((e.clientX - r.left) / k, (e.clientY - r.top) / k);
        }}
      >
        {Object.values(ROOMS).map((r) => (
          <div
            key={r.id}
            className="absolute rounded-[3px]"
            style={{
              left: r.x * k,
              top: r.y * k,
              width: r.w * k,
              height: r.h * k,
              background: colors[r.id] ?? "transparent",
              border: colors[r.id] ? "1px solid rgba(74,65,58,0.5)" : "1px dashed rgba(232,116,59,0.5)",
            }}
          />
        ))}
        {Object.entries(live).map(([id, l]) => {
          const [x, y] = spot(l.at);
          return (
            <span
              key={id}
              className="absolute h-[5px] w-[5px] rounded-full transition-all duration-700"
              style={{ left: x * k - 2.5, top: y * k - 2.5, background: l.status === "blocked" ? "#d99a2b" : id === "ada" ? "#e8743b" : "#3f9b5f" }}
            />
          );
        })}
        <motion.span className="absolute h-[7px] w-[7px] rounded-full bg-ink ring-2 ring-white" style={{ x: dotX, y: dotY }} />
      </div>
    </div>
  );
}
