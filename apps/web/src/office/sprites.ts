// Pixel sprites are authored as character maps and turned into one SVG path
// per colour, with an automatic 1px outline, so they stay crisp at any zoom.

export type PixelMap = string[];
export type Palette = Record<string, string>;
export type PathRun = { fill: string; d: string };

export const OUTLINE = "#2b2522";

export function outlined(map: PixelMap): PixelMap {
  const h = map.length;
  const w = Math.max(...map.map((r) => r.length));
  const filled = (x: number, y: number) =>
    y >= 0 && y < h && x >= 0 && x < w && (map[y][x] ?? ".") !== ".";
  const out: string[] = [];
  for (let y = -1; y <= h; y++) {
    let row = "";
    for (let x = -1; x <= w; x++) {
      if (filled(x, y)) row += map[y][x];
      else if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) row += "o";
      else row += ".";
    }
    out.push(row);
  }
  return out;
}

export function toPaths(map: PixelMap, palette: Palette, only?: string[]): PathRun[] {
  const byColor = new Map<string, string>();
  map.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x];
      if (c === "." || (only && !only.includes(c))) {
        x++;
        continue;
      }
      let run = 1;
      while (row[x + run] === c) run++;
      const fill = palette[c];
      if (fill) byColor.set(fill, (byColor.get(fill) ?? "") + `M${x} ${y}h${run}v1h-${run}z`);
      x += run;
    }
  });
  return [...byColor.entries()].map(([fill, d]) => ({ fill, d }));
}

/* ---------------------------------------------------------------- people */

export type HairStyle = "short" | "long" | "bun" | "curly" | "cap" | "buzz" | "pony" | "bob";

export interface Look {
  skin: string;
  hair: string;
  style: HairStyle;
  shirt: string;
  accent?: string;
  pants: string;
  shoes?: string;
  glasses?: boolean;
  cap?: string;
  prop?: "tablet" | "mug" | null;
}

// 12 x 17 base body. Row 0 is reserved for buns and caps.
const BASE: PixelMap = [
  "............",
  "...HHHHHH...",
  "..HHHHHHHH..",
  ".HHHHHHHHHH.",
  ".HHHHHHHHHH.",
  ".HSSSSSSSSH.",
  ".SSESSSSESS.",
  ".SCSSSSSSCS.",
  "..SSSSSSSS..",
  "...SSSSSS...",
  "..TTTAATTT..",
  ".TTTTTTTTTT.",
  ".TTTTTTTTTT.",
  ".STTTTTTTTS.",
  "..PPPPPPPP..",
  "..PPP..PPP..",
  "..KKK..KKK..",
];

const LEGS: Record<0 | 1 | 2, [string, string]> = {
  0: ["..PPP..PPP..", "..KKK..KKK.."],
  1: ["..PPP...PP..", ".KKK....KK.."],
  2: ["..PP...PPP..", "..KK....KKK."],
};

function set(rows: string[][], y: number, x: number, c: string) {
  if (rows[y] && x >= 0 && x < rows[y].length) rows[y][x] = c;
}

export function personMap(look: Look, frame: 0 | 1 | 2 = 0): PixelMap {
  const rows = BASE.map((r) => r.split(""));
  rows[15] = LEGS[frame][0].split("");
  rows[16] = LEGS[frame][1].split("");

  switch (look.style) {
    case "long":
      for (let y = 5; y <= 11; y++) {
        set(rows, y, 1, "H");
        set(rows, y, 10, "H");
      }
      set(rows, 12, 1, "H");
      set(rows, 12, 10, "H");
      break;
    case "bob":
      for (let y = 5; y <= 8; y++) {
        set(rows, y, 1, "H");
        set(rows, y, 10, "H");
      }
      set(rows, 8, 0, ".");
      break;
    case "bun":
      set(rows, 0, 5, "H");
      set(rows, 0, 6, "H");
      set(rows, 1, 4, "H");
      set(rows, 1, 7, "H");
      break;
    case "curly":
      "..HHHHHHHH..".split("").forEach((c, x) => set(rows, 0, x, c === "H" ? "H" : rows[0][x]));
      for (let y = 1; y <= 4; y++) {
        set(rows, y, 0, "H");
        set(rows, y, 11, "H");
      }
      for (let x = 1; x <= 10; x++) set(rows, 1, x, "H");
      set(rows, 5, 0, "H");
      set(rows, 5, 11, "H");
      break;
    case "cap":
      for (let x = 3; x <= 8; x++) set(rows, 0, x, "Q");
      for (let x = 2; x <= 9; x++) set(rows, 1, x, "Q");
      for (let x = 1; x <= 10; x++) set(rows, 2, x, "Q");
      for (let x = 1; x <= 10; x++) set(rows, 3, x, "q");
      set(rows, 3, 11, "q");
      break;
    case "buzz":
      for (let x = 1; x <= 10; x++) set(rows, 4, x, x === 1 || x === 10 ? "H" : "S");
      break;
    case "pony":
      for (let y = 3; y <= 8; y++) set(rows, y, 11, "H");
      break;
    default:
      break;
  }

  if (look.glasses) {
    set(rows, 6, 2, "G");
    set(rows, 6, 4, "G");
    set(rows, 6, 5, "G");
    set(rows, 6, 6, "G");
    set(rows, 6, 7, "G");
    set(rows, 6, 9, "G");
  }

  if (look.prop === "tablet") {
    set(rows, 12, 10, "B");
    set(rows, 12, 11, "B");
    set(rows, 13, 10, "B");
    set(rows, 13, 11, "B");
    set(rows, 11, 11, "B");
  }
  if (look.prop === "mug") {
    set(rows, 12, 11, "W");
    set(rows, 13, 11, "W");
  }

  return rows.map((r) => r.join(""));
}

export function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export function personPalette(look: Look): Palette {
  return {
    o: OUTLINE,
    H: look.hair,
    S: look.skin,
    E: "#231d1a",
    C: shade(look.skin, -18),
    T: look.shirt,
    A: look.accent ?? shade(look.shirt, 28),
    P: look.pants,
    K: look.shoes ?? "#3a3330",
    G: "#2b2522",
    Q: look.cap ?? "#3b6fd1",
    q: shade(look.cap ?? "#3b6fd1", -30),
    B: "#4a4f57",
    W: "#f4f1ea",
  };
}

export interface PersonSprite {
  w: number;
  h: number;
  frames: [PathRun[], PathRun[], PathRun[]];
  eyes: PathRun[];
}

const cache = new Map<string, PersonSprite>();

export function personSprite(look: Look): PersonSprite {
  const key = JSON.stringify(look);
  const hit = cache.get(key);
  if (hit) return hit;
  const pal = personPalette(look);
  const frames = ([0, 1, 2] as const).map((f) => {
    const m = outlined(personMap(look, f));
    // Eyes are drawn as their own layer (so they can blink); the base layer
    // paints skin underneath them.
    return toPaths(
      m.map((r) => r.replace(/E/g, "S")),
      pal,
    );
  }) as [PathRun[], PathRun[], PathRun[]];
  const eyes = toPaths(outlined(personMap(look, 0)), pal, ["E"]);
  const m0 = outlined(personMap(look, 0));
  const sprite = { w: m0[0].length, h: m0.length, frames, eyes };
  cache.set(key, sprite);
  return sprite;
}
