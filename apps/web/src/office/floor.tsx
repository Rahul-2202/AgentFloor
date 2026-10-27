"use client";

import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from "react";
import { project, type Cam } from "./camera";
import type { Pt } from "./types";

/**
 * The 2D layer over the 3D office: name tags, bubbles, cards and markers. Each
 * one is pinned to a point on the floor (and a height); every frame the office
 * projects those points through the camera and moves the elements there.
 */
type Where = () => Pt;
interface Pin {
  el: HTMLElement;
  where: Where;
  h: number;
  /** Stack by depth (nearer on top), plus this. */
  z?: number;
}

export class FloorLayer {
  private readonly pins = new Set<Pin>();
  cam: Cam | null = null;

  pin(p: Pin) {
    this.pins.add(p);
    if (this.cam) this.place(this.cam, p);
    return () => void this.pins.delete(p);
  }

  /** Moves everything to where the camera now shows it. */
  update(cam: Cam) {
    this.cam = cam;
    for (const p of this.pins) this.place(cam, p);
  }

  private place(cam: Cam, p: Pin) {
    const [x, z] = p.where();
    const s = project(cam, x, z, p.h);
    p.el.style.transform = `translate3d(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px, 0)`;
    // Pixels per unit here: tags and hit areas size themselves with it.
    p.el.style.setProperty("--u", `${s.scale.toFixed(2)}px`);
    if (p.z !== undefined) p.el.style.zIndex = String(Math.round(1000 - s.depth * 4) + p.z);
  }
}

export const FloorContext = createContext<FloorLayer | null>(null);

/** Pins an element to a floor point (tiles) at height h (units). */
export function usePin(ref: React.RefObject<HTMLElement | null>, where: Pt | Where, h = 0, z?: number) {
  const layer = useContext(FloorContext);
  const get = useRef<Where>(() => [0, 0]);
  get.current = typeof where === "function" ? where : () => where;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!layer || !el) return;
    return layer.pin({ el, where: () => get.current(), h, z });
  }, [layer, ref, h, z]);
}

/** Children placed at a floor point; they position themselves around (0, 0). */
export function OnFloor({ at, h = 0, z, className, children }: { at: Pt | Where; h?: number; z?: number; className?: string; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  usePin(ref, at, h, z);
  return (
    <div ref={ref} className={`absolute left-0 top-0 ${className ?? ""}`} style={{ width: 0, height: 0, willChange: "transform" }}>
      {children}
    </div>
  );
}
