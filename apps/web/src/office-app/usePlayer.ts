"use client";

import { useMotionValue } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { TILE } from "@/office/layout";
import { findPath, isWalkable } from "@/office/path";
import type { Pt } from "@/office/types";

const SPEED = 4.6; // tiles per second
const R = 0.28; // body half-width in tiles

const KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  w: [0, -1],
  s: [0, 1],
  a: [-1, 0],
  d: [1, 0],
  W: [0, -1],
  S: [0, 1],
  A: [-1, 0],
  D: [1, 0],
};

function free(x: number, y: number) {
  return isWalkable(x - R, y) && isWalkable(x + R, y) && isWalkable(x, y);
}

/** Nearest walkable point to a target, searching outward in rings. */
export function nearestFree(x: number, y: number): Pt {
  if (free(x, y)) return [x, y];
  for (let r = 0.5; r <= 4; r += 0.5)
    for (let a = 0; a < 16; a++) {
      const px = x + Math.cos((a / 16) * Math.PI * 2) * r;
      const py = y + Math.sin((a / 16) * Math.PI * 2) * r;
      if (free(px, py)) return [px, py];
    }
  return [x, y];
}

export function usePlayer(start: Pt, blocked: () => boolean) {
  const x = useMotionValue(start[0] * TILE);
  const y = useMotionValue(start[1] * TILE);
  const [walking, setWalking] = useState(false);
  const [target, setTarget] = useState<Pt | null>(null);
  const keys = useRef(new Set<string>());
  const path = useRef<Pt[]>([]);
  const arrive = useRef<(() => void) | null>(null);
  const walkingRef = useRef(false);

  const setW = (v: boolean) => {
    if (walkingRef.current !== v) {
      walkingRef.current = v;
      setWalking(v);
    }
  };

  const goTo = useCallback(
    (tx: number, ty: number, onArrive?: () => void) => {
      const to = nearestFree(tx, ty);
      const from: Pt = [x.get() / TILE, y.get() / TILE];
      path.current = findPath(from, to).slice(1);
      arrive.current = onArrive ?? null;
      setTarget(to);
    },
    [x, y],
  );

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (!(e.key in KEYS) || blocked()) return;
      e.preventDefault();
      keys.current.add(e.key);
      path.current = [];
      arrive.current = null;
      setTarget(null);
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key);
    const blur = () => keys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [blocked]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      let cx = x.get() / TILE;
      let cy = y.get() / TILE;
      let moving = false;

      if (keys.current.size) {
        let dx = 0;
        let dy = 0;
        keys.current.forEach((k) => {
          dx += KEYS[k]?.[0] ?? 0;
          dy += KEYS[k]?.[1] ?? 0;
        });
        const len = Math.hypot(dx, dy) || 1;
        const step = SPEED * dt;
        const nx = cx + (dx / len) * step;
        const ny = cy + (dy / len) * step;
        if (dx && free(nx, cy)) {
          cx = nx;
          moving = true;
        }
        if (dy && free(cx, ny)) {
          cy = ny;
          moving = true;
        }
      } else if (path.current.length) {
        let budget = SPEED * dt;
        while (budget > 0 && path.current.length) {
          const [tx, ty] = path.current[0];
          const d = Math.hypot(tx - cx, ty - cy);
          if (d <= budget) {
            cx = tx;
            cy = ty;
            budget -= d;
            path.current.shift();
          } else {
            cx += ((tx - cx) / d) * budget;
            cy += ((ty - cy) / d) * budget;
            budget = 0;
          }
        }
        moving = true;
        if (!path.current.length) {
          setTarget(null);
          const cb = arrive.current;
          arrive.current = null;
          if (cb) setTimeout(cb, 60);
        }
      }

      if (moving) {
        x.set(cx * TILE);
        y.set(cy * TILE);
      }
      setW(moving);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pos = useCallback((): Pt => [x.get() / TILE, y.get() / TILE], [x, y]);

  /** Teleport (used when you switch who you're playing). */
  const jump = useCallback(
    (tx: number, ty: number) => {
      path.current = [];
      arrive.current = null;
      keys.current.clear();
      setTarget(null);
      x.set(tx * TILE);
      y.set(ty * TILE);
    },
    [x, y],
  );

  return { x, y, walking, target, goTo, pos, jump };
}
