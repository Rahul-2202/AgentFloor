"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { MotionValue } from "motion/react";
import { useLayoutEffect, useMemo } from "react";
import { DirectionalLight, NeutralToneMapping, Object3D, VSMShadowMap } from "three";
import { FURNITURE, inLayout, WORLD } from "../layout";
import type { Board, RoomId, RoomState } from "../types";
import { useBodyList, type Bodies } from "./bodies";
import { Building } from "./Building";
import { Piece } from "./Furniture3D";
import { Person } from "./Person";
import { viewMatrix } from "./view";

export interface StageView {
  s: MotionValue<number>;
  x: MotionValue<number>;
  y: MotionValue<number>;
}

/** Locks the 3D camera to the 2D world's pan and zoom, every frame. */
function Camera({ view }: { view: StageView }) {
  const camera = useThree((s) => s.camera);
  useLayoutEffect(() => {
    camera.matrixAutoUpdate = false;
    camera.matrixWorldAutoUpdate = false;
    camera.position.set(0, 0, 0);
    camera.rotation.set(0, 0, 0);
    camera.matrixWorld.identity();
    camera.matrixWorldInverse.identity();
  }, [camera]);
  useFrame((st) => {
    viewMatrix(camera.projectionMatrix, { s: view.s.get(), x: view.x.get(), y: view.y.get() }, st.size.width, st.size.height);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }, -1);
  return null;
}

function Lights() {
  const sun = useMemo(() => {
    // High and from the front left: short, soft shadows that fall behind things, as in the renders.
    const l = new DirectionalLight("#fff3e2", 2.1);
    l.position.set(WORLD.w / 2 - 12, 40, WORLD.h / 2 + 9);
    l.castShadow = true;
    l.shadow.mapSize.set(2048, 2048);
    const c = l.shadow.camera;
    c.left = -34;
    c.right = 34;
    c.top = 30;
    c.bottom = -30;
    c.near = 1;
    c.far = 90;
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 0.02;
    l.shadow.radius = 9;
    l.shadow.blurSamples = 16;
    l.shadow.intensity = 0.55;
    return l;
  }, []);
  const target = useMemo(() => {
    const o = new Object3D();
    o.position.set(WORLD.w / 2, 0, WORLD.h / 2);
    return o;
  }, []);
  useLayoutEffect(() => {
    sun.target = target;
  }, [sun, target]);
  return (
    <>
      <hemisphereLight args={["#fffaf2", "#d9c3a5", 1.55]} />
      <ambientLight intensity={0.25} color="#ffffff" />
      <primitive object={sun} />
      <primitive object={target} />
      {/* a soft fill from the viewer's side, so walls and faces aren't grey */}
      <directionalLight color="#fff8f0" intensity={0.85} position={[WORLD.w / 2 + 6, 14, WORLD.h + 30]} />
    </>
  );
}

function People({ store }: { store: Bodies }) {
  const list = useBodyList(store);
  return (
    <>
      {list.map((b) => (
        <Person key={b.id} id={b.id} store={store} />
      ))}
    </>
  );
}

export default function Stage({ view, rooms, board, store }: { view: StageView; rooms: Partial<Record<RoomId, RoomState>>; board?: Board; store: Bodies }) {
  const pieces = FURNITURE.filter(inLayout);
  return (
    <Canvas
      className="!absolute inset-0"
      style={{ pointerEvents: "none" }}
      camera={{ manual: true }}
      dpr={[1, 1.75]}
      shadows={{ type: VSMShadowMap }}
      gl={{ antialias: true, alpha: true, toneMapping: NeutralToneMapping, toneMappingExposure: 1.05 }}
      frameloop="always"
    >
      <Camera view={view} />
      <Lights />
      <Building rooms={rooms} />
      {pieces.map((f, i) => (
        <Piece key={f.id} f={f} index={i} board={f.kind === "board" ? board : undefined} state={f.room === "hall" ? "built" : (rooms[f.room] ?? "hidden")} />
      ))}
      <People store={store} />
    </Canvas>
  );
}
