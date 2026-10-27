import { DirectionalLight, HemisphereLight, NeutralToneMapping, OrthographicCamera, Scene, WebGLRenderer } from "three";
import type { Look } from "../look";
import { buildFigure } from "./figure";

/**
 * Head-and-shoulders pictures of the clay figures, for name tags, cards and
 * lists: rendered once per look with one small offscreen renderer, then kept.
 */
const SIZE = 160;
let studio: { renderer: WebGLRenderer; scene: Scene; camera: OrthographicCamera } | null = null;
const done = new Map<string, string>();

function open() {
  if (studio) return studio;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(SIZE, SIZE, false);
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1.08;
  const scene = new Scene();
  scene.add(new HemisphereLight("#fffaf2", "#d9c3a5", 1.9));
  const key = new DirectionalLight("#fff3e2", 1.6);
  key.position.set(-2, 4, 5);
  scene.add(key);
  const camera = new OrthographicCamera(-0.58, 0.58, 0.58, -0.58, 0.1, 20);
  camera.position.set(0, 2.6, 5);
  camera.lookAt(0, 2.12, 0);
  studio = { renderer, scene, camera };
  return studio;
}

export function portrait(look: Look, chief = false): string | null {
  if (typeof document === "undefined") return null;
  const key = `${chief ? 1 : 0}${JSON.stringify(look)}`;
  const hit = done.get(key);
  if (hit) return hit;
  try {
    const s = open();
    const fig = buildFigure(look, chief);
    fig.head.rotation.x = -0.12;
    fig.armL.rotation.x = fig.armR.rotation.x = -0.05;
    s.scene.add(fig.root);
    s.renderer.render(s.scene, s.camera);
    const url = s.renderer.domElement.toDataURL("image/png");
    s.scene.remove(fig.root);
    done.set(key, url);
    return url;
  } catch {
    return null;
  }
}
