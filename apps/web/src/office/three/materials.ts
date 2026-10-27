import { CanvasTexture, Color, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, type Texture } from "three";

/**
 * Soft clay: matte, slightly warm. One material per colour (and opacity),
 * shared by every mesh that uses it.
 */
const cache = new Map<string, MeshStandardMaterial>();

export function clay(color: string, o: { opacity?: number; rough?: number; emissive?: string; map?: Texture } = {}): MeshStandardMaterial {
  const opacity = o.opacity ?? 1;
  const key = `${color}|${opacity}|${o.rough ?? ""}|${o.emissive ?? ""}|${o.map?.uuid ?? ""}`;
  let m = cache.get(key);
  if (!m) {
    m = new MeshStandardMaterial({
      color: new Color(color),
      roughness: o.rough ?? 0.82,
      metalness: 0,
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity >= 1,
      map: o.map ?? null,
    });
    if (o.emissive) {
      m.emissive = new Color(o.emissive);
      m.emissiveIntensity = 1.2;
    }
    cache.set(key, m);
  }
  return m;
}

/** Glass for windows and the meeting room. */
export const glass = (tint = "#cfe3f1", opacity = 0.35) => clay(tint, { opacity, rough: 0.15 });

/** Darkens or lightens a hex colour (k < 1 darker). */
export function shade(hex: string, k: number): string {
  const c = new Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l * k)));
  return `#${c.getHexString()}`;
}

/* --------------------------------------------------------------- textures */

const textures = new Map<string, CanvasTexture>();

function canvasTexture(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat: [number, number]) {
  let t = textures.get(key);
  if (t) return t;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(...repeat);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  textures.set(key, t);
  return t;
}

/** Light oak planks, one texture tile = 4 × 4 floor tiles. */
export function planks(base = "#e4c9a4", line = "#d3b38a", key = "oak") {
  return canvasTexture(
    `planks-${key}`,
    512,
    512,
    (g) => {
      g.fillStyle = base;
      g.fillRect(0, 0, 512, 512);
      const rows = 8;
      const rh = 512 / rows;
      for (let r = 0; r < rows; r++) {
        // Slight tone per board.
        for (let x = 0; x < 512; ) {
          const len = 140 + ((r * 97 + x * 13) % 180);
          const v = ((r * 31 + x * 7) % 9) / 9;
          g.fillStyle = `rgba(${v > 0.5 ? "255,255,255" : "120,80,40"},${0.035 + (v % 0.3) * 0.08})`;
          g.fillRect(x, r * rh, len, rh);
          g.fillStyle = line;
          g.fillRect(x, r * rh, 2, rh);
          x += len;
        }
        g.fillStyle = line;
        g.fillRect(0, r * rh, 512, 2);
      }
      // Fine grain.
      g.globalAlpha = 0.05;
      for (let i = 0; i < 900; i++) {
        g.fillStyle = i % 2 ? "#8a6036" : "#ffffff";
        g.fillRect((i * 151) % 512, (i * 89) % 512, 18 + (i % 30), 1);
      }
      g.globalAlpha = 1;
    },
    [1, 1],
  );
}

/** A soft carpet: flat colour with a faint weave. */
export function carpet(base: string) {
  return canvasTexture(
    `carpet-${base}`,
    128,
    128,
    (g) => {
      g.fillStyle = base;
      g.fillRect(0, 0, 128, 128);
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
      for (let i = 0; i < 1400; i++) {
        const x = Math.floor(rnd() * 128);
        const y = Math.floor(rnd() * 128);
        g.fillStyle = i % 3 ? "rgba(0,0,0,0.035)" : "rgba(255,255,255,0.06)";
        g.fillRect(x, y, 1, 1);
      }
    },
    [1, 1],
  );
}

/** Herringbone parquet (the meeting room). */
export function herring(base: string, line: string) {
  return canvasTexture(
    `herring-${base}`,
    256,
    256,
    (g) => {
      g.fillStyle = base;
      g.fillRect(0, 0, 256, 256);
      g.strokeStyle = line;
      g.lineWidth = 2;
      const s = 32;
      for (let y = -s; y < 256 + s; y += s) {
        for (let x = -2 * s; x < 256 + 2 * s; x += 2 * s) {
          const off = (y / s) % 2 ? s : 0;
          g.strokeRect(x + off, y, 2 * s, s / 2);
          g.fillStyle = `rgba(255,255,255,${((x + y) % 5) * 0.012})`;
          g.fillRect(x + off, y, 2 * s, s / 2);
        }
      }
    },
    [1, 1],
  );
}
