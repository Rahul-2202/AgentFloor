"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Mesh } from "three";
import { TILE } from "../layout";
import type { Bodies } from "./bodies";
import { buildFigure, HIP } from "./figure";
import { clay } from "./materials";
import { torus } from "./shapes";

const SEAT_HIP = 0.62;

/** Which way a seat faces (radians about y; 0 = toward the viewer), or null when it isn't a seat. */
export function seatFacing(at: string | undefined): number | null {
  if (!at) return null;
  if (at.startsWith("seat:")) return 0;
  if (/^mt:t\d/.test(at)) return 0;
  if (/^mt:b\d/.test(at)) return Math.PI;
  if (at === "mt:head") return -Math.PI / 2;
  if (at === "mt:foot") return Math.PI / 2;
  return null;
}

const angleTo = (from: number, to: number) => {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/** One person on the floor, posed every frame from where the 2D layer has them. */
export function Person({ id, store }: { id: string; store: Bodies }) {
  const b = store.get(id);
  const look = b?.look;
  const rig = useMemo(() => (look ? buildFigure(look, id === "ada") : null), [look, id]);
  const ring = useMemo(() => {
    const m = new Mesh(torus(0.5, 0.04), clay("#e8743b", { emissive: "#e8743b", opacity: 0.85 }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.03;
    m.visible = false;
    return m;
  }, []);
  useEffect(() => {
    rig?.root.add(ring);
    return () => void rig?.root.remove(ring);
  }, [rig, ring]);
  const st = useRef({ px: NaN, pz: NaN, face: 0, phase: 0, moving: 0, still: 0, sit: 0, born: -1 });

  useFrame((state, dt) => {
    const body = store.get(id);
    if (!body || !rig) return;
    const s = st.current;
    const t = state.clock.elapsedTime;
    if (s.born < 0) s.born = t;
    const x = body.x.get() / TILE;
    const z = body.y.get() / TILE;
    const dx = Number.isNaN(s.px) ? 0 : x - s.px;
    const dz = Number.isNaN(s.pz) ? 0 : z - s.pz;
    s.px = x;
    s.pz = z;
    const dist = Math.hypot(dx, dz);
    const moving = body.walking || dist > 0.002;
    s.moving += ((moving ? 1 : 0) - s.moving) * Math.min(1, dt * 10);
    s.still = moving ? 0 : s.still + dt;

    const seat = seatFacing(body.at);
    const sitting = !moving && seat !== null && s.still > 0.15;
    s.sit += ((sitting ? 1 : 0) - s.sit) * Math.min(1, dt * 8);

    // Face where they're going; seated, face the desk or the table; standing still a while, turn to the viewer.
    let want = s.face;
    if (dist > 0.004) want = Math.atan2(dx, dz);
    else if (seat !== null && sitting) want = seat;
    else if (s.still > 1.2) want = 0;
    s.face += angleTo(s.face, want) * Math.min(1, dt * (moving ? 14 : 5));

    rig.root.position.set(x, 0, z);
    const pop = Math.min(1, (t - s.born) / 0.35);
    rig.root.scale.setScalar(pop < 1 ? 0.6 + 0.4 * (1 - Math.pow(1 - pop, 3)) : 1);
    rig.body.rotation.y = s.face;

    // Walk cycle.
    if (moving) s.phase += Math.max(dist, dt * 2.2) * 5.2;
    const w = s.moving * (1 - s.sit);
    const sw = Math.sin(s.phase);
    const sit = s.sit;
    rig.hips.position.y = HIP + (SEAT_HIP - HIP) * sit + Math.abs(Math.cos(s.phase)) * 0.045 * w + Math.sin(t * 2.1) * 0.006 * (1 - w);
    // Seated: slide back onto the chair so the knees go under the desk.
    rig.hips.position.z = -0.3 * sit;
    rig.thighL.rotation.x = sw * 0.55 * w - (Math.PI / 2) * sit;
    rig.thighR.rotation.x = -sw * 0.55 * w - (Math.PI / 2) * sit;
    rig.shinL.rotation.x = Math.max(0, -sw) * 0.7 * w + (Math.PI / 2) * sit;
    rig.shinR.rotation.x = Math.max(0, sw) * 0.7 * w + (Math.PI / 2) * sit;

    // Arms: swing when walking, type when working at a desk, rest otherwise.
    const typing = sit > 0.5 && body.status === "working" && body.at?.startsWith("seat:") ? 1 : 0;
    rig.armL.rotation.x = -sw * 0.45 * w - typing * (1.15 + Math.sin(t * 15) * 0.07) - sit * 0.35 * (1 - typing);
    rig.armR.rotation.x = sw * 0.45 * w - typing * (1.15 + Math.sin(t * 15 + 1.7) * 0.07) - sit * 0.35 * (1 - typing);
    rig.torso.rotation.x = 0.06 * w + typing * 0.08;
    rig.torso.scale.y = 1 + Math.sin(t * 2.1) * 0.012 * (1 - w);
    // Heads tip up toward the viewer, as in the renders, so faces read from above.
    const thinking = body.status === "thinking" ? 1 : 0;
    rig.head.rotation.z = Math.sin(t * 1.3) * 0.12 * thinking;
    rig.head.rotation.x = -0.34 + 0.12 * typing + Math.sin(t * 0.9 + id.length) * 0.03;
    ring.visible = !!body.highlight;
  });

  if (!rig) return null;
  return <primitive object={rig.root} />;
}
