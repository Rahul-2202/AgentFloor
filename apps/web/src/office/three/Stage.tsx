"use client";

import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useLayoutEffect, useMemo } from "react";
import { ACESFilmicToneMapping, DirectionalLight, HalfFloatType, Object3D, PCFSoftShadowMap, PMREMGenerator, type PerspectiveCamera, WebGLRenderTarget } from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { eye, FOV, type Cam } from "../camera";
import { FURNITURE, inLayout, WORLD } from "../layout";
import type { Board, RoomId, RoomState } from "../types";
import { ASSETS } from "./assets";
import { useBodyList, type Bodies } from "./bodies";
import { Building } from "./Building";
import { Piece } from "./Furniture3D";
import { Person } from "./Person";

/** Keeps the 3D camera on the office camera (the same one the 2D layer uses). */
function CameraRig({ getCam }: { getCam: () => Cam | null }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  useFrame(() => {
    const c = getCam();
    if (!c) return;
    const [x, y, z] = eye(c);
    camera.fov = (FOV * 180) / Math.PI;
    camera.aspect = c.w / c.h;
    camera.near = Math.max(1, y * 0.4);
    camera.far = y * 4 + 200;
    camera.position.set(x, y, z);
    camera.lookAt(c.x, 0, c.z);
    camera.updateProjectionMatrix();
  }, -2);
  return null;
}

/** Daylight from the lighting map (a bright studio hall), for soft, even fill. */
function Daylight() {
  const hdr = useLoader(HDRLoader, `${ASSETS}/env/photo_studio_london_hall_1k.hdr`);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const pm = new PMREMGenerator(gl);
    const env = pm.fromEquirectangular(hdr).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.85;
    return () => {
      scene.environment = null;
      env.dispose();
      pm.dispose();
    };
  }, [hdr, gl, scene]);
  return null;
}

function Sun() {
  const sun = useMemo(() => {
    // From the windows at the back left, high: soft shadows falling forward and right, as in the renders.
    const l = new DirectionalLight("#fff1dc", 1.9);
    l.position.set(WORLD.w / 2 - 14, 42, WORLD.h / 2 - 16);
    l.castShadow = true;
    l.shadow.mapSize.set(4096, 2048);
    const c = l.shadow.camera;
    c.left = -WORLD.w / 2 - 6;
    c.right = WORLD.w / 2 + 6;
    c.top = WORLD.h / 2 + 10;
    c.bottom = -WORLD.h / 2 - 10;
    c.near = 1;
    c.far = 120;
    l.shadow.bias = -0.0003;
    l.shadow.normalBias = 0.025;
    l.shadow.radius = 4;
    l.shadow.intensity = 0.8;
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
      <primitive object={sun} />
      <primitive object={target} />
      <hemisphereLight args={["#fffaf2", "#d8c3a6", 0.35]} />
    </>
  );
}

/**
 * Ambient occlusion over the render: the soft darkening where things meet the
 * floor and each other that makes the renders read as real.
 */
function Look() {
  const { gl, scene, camera, size } = useThree();
  const composer = useMemo(() => {
    const rt = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
    const c = new EffectComposer(gl, rt);
    c.addPass(new RenderPass(scene, camera));
    const ao = new GTAOPass(scene, camera, 1, 1);
    ao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 12 });
    ao.blendIntensity = 0.85;
    c.addPass(ao);
    c.addPass(new OutputPass());
    return c;
  }, [gl, scene, camera]);
  useEffect(() => {
    composer.setPixelRatio(gl.getPixelRatio());
    composer.setSize(size.width, size.height);
  }, [composer, gl, size]);
  useEffect(() => () => composer.dispose(), [composer]);
  useFrame(() => composer.render(), 1);
  return null;
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

export default function Stage({ getCam, rooms, board, store }: { getCam: () => Cam | null; rooms: Partial<Record<RoomId, RoomState>>; board?: Board; store: Bodies }) {
  const pieces = FURNITURE.filter(inLayout);
  return (
    <Canvas
      className="!absolute inset-0"
      style={{ pointerEvents: "none" }}
      dpr={[1, 1.75]}
      shadows={{ type: PCFSoftShadowMap }}
      gl={{ antialias: false, alpha: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
      frameloop="always"
    >
      {/* the page's own background, so nothing flashes black while the office loads */}
      <color attach="background" args={["#ece6dc"]} />
      <CameraRig getCam={getCam} />
      <Sun />
      {/* everything appears together, once the floor, walls and lighting have loaded */}
      <Suspense fallback={null}>
        <Daylight />
        <Building rooms={rooms} />
        {pieces.map((f, i) => (
          <Piece key={f.id} f={f} index={i} board={f.kind === "board" ? board : undefined} state={f.room === "hall" ? "built" : (rooms[f.room] ?? "hidden")} />
        ))}
        <People store={store} />
      </Suspense>
      <Look />
    </Canvas>
  );
}
