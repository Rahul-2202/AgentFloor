"use client";

import type { MotionValue } from "motion/react";
import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import type { Look } from "../look";
import type { AgentStatus } from "../types";

/**
 * Everyone standing on the floor, for the 3D scene. The 2D layer still moves
 * people (paths, walking, timing); it registers each one here and the scene
 * reads their position every frame, so the two can never disagree.
 */
export interface Body {
  id: string;
  look: Look;
  /** Feet position in plan pixels (tile × TILE), as the 2D layer animates it. */
  x: MotionValue<number>;
  y: MotionValue<number>;
  walking: boolean;
  status?: AgentStatus;
  /** The named spot they're at or headed for (seats make them sit). */
  at?: string;
  highlight?: boolean;
}

export class Bodies {
  private readonly map = new Map<string, Body>();
  private list: Body[] = [];
  private readonly subs = new Set<() => void>();

  put(b: Body) {
    const prev = this.map.get(b.id);
    this.map.set(b.id, b);
    const same =
      prev &&
      prev.look === b.look &&
      prev.x === b.x &&
      prev.y === b.y &&
      prev.walking === b.walking &&
      prev.status === b.status &&
      prev.at === b.at &&
      prev.highlight === b.highlight;
    if (!same) this.changed();
  }

  drop(id: string) {
    if (this.map.delete(id)) this.changed();
  }

  get(id: string): Body | undefined {
    return this.map.get(id);
  }

  readonly subscribe = (f: () => void) => {
    this.subs.add(f);
    return () => void this.subs.delete(f);
  };
  readonly snapshot = () => this.list;

  private changed() {
    this.list = [...this.map.values()];
    this.subs.forEach((f) => f());
  }
}

export const BodiesContext = createContext<Bodies | null>(null);

export function useBodyList(store: Bodies): Body[] {
  return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
}

/** Puts someone on the 3D floor while this component is mounted. */
export function useBody(b: Body | null) {
  const store = useContext(BodiesContext);
  useEffect(() => {
    if (store && b) store.put(b);
  });
  const id = b?.id;
  useEffect(() => {
    if (!store || !id) return;
    return () => store.drop(id);
  }, [store, id]);
}
