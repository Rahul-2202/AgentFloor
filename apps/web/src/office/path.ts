import { BLOCK, FURNITURE, ROOMS, WORLD, inLayout, layoutMode } from "./layout";
import type { Pt } from "./types";

// Walk grid at half-tile resolution.
const R = 2;
const GW = WORLD.w * R;
const GH = WORLD.h * R;

const grids: { site?: Uint8Array; app?: Uint8Array } = {};
const getGrid = () => {
  const k = layoutMode.app ? "app" : "site";
  return (grids[k] ??= buildGrid());
};

function buildGrid() {
  const g = new Uint8Array(GW * GH);
  const block = (x: number, y: number, w: number, h: number) => {
    const x0 = Math.floor(x * R);
    const y0 = Math.floor(y * R);
    const x1 = Math.ceil((x + w) * R);
    const y1 = Math.ceil((y + h) * R);
    for (let yy = Math.max(0, y0); yy < Math.min(GH, y1); yy++)
      for (let xx = Math.max(0, x0); xx < Math.min(GW, x1); xx++) g[yy * GW + xx] = 1;
  };
  const clear = (x: number, y: number, w: number, h: number) => {
    for (let yy = Math.floor(y * R); yy < Math.ceil((y + h) * R); yy++)
      for (let xx = Math.floor(x * R); xx < Math.ceil((x + w) * R); xx++)
        if (yy >= 0 && yy < GH && xx >= 0 && xx < GW) g[yy * GW + xx] = 0;
  };

  // World edge
  block(0, 0, WORLD.w, 0.5);
  block(0, WORLD.h - 0.5, WORLD.w, 0.5);
  block(0, 0, 0.5, WORLD.h);
  block(WORLD.w - 0.5, 0, 0.5, WORLD.h);

  for (const r of Object.values(ROOMS)) {
    block(r.x, r.y, r.w, 2.5); // top wall face
    block(r.x - 0.5, r.y, 1, r.h + 0.5); // left
    block(r.x + r.w - 0.5, r.y, 1, r.h + 0.5); // right
    block(r.x - 0.5, r.y + r.h - 0.5, r.w + 1, 1); // bottom
    const dx = r.x + r.door.at;
    if (r.door.side === "bottom") clear(dx, r.y + r.h - 0.5, r.door.w, 1);
    else clear(dx, r.y, r.door.w, 2.5);
  }

  for (const f of FURNITURE) {
    if (!inLayout(f)) continue;
    const b = BLOCK[f.kind];
    if (b) block(f.x + b[0], f.y + b[1], b[2], b[3]);
  }
  return g;
}

const key = (x: number, y: number) => y * GW + x;

/** True when a feet position (in tiles) is free to stand on. */
export function isWalkable(x: number, y: number) {
  const grid = getGrid();
  const cx = Math.floor(x * R);
  const cy = Math.floor(y * R);
  if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) return false;
  return !grid[key(cx, cy)];
}

export function findPath(from: Pt, to: Pt): Pt[] {
  const g = getGrid();
  const sx = Math.min(GW - 1, Math.max(0, Math.floor(from[0] * R)));
  const sy = Math.min(GH - 1, Math.max(0, Math.floor(from[1] * R)));
  const tx = Math.min(GW - 1, Math.max(0, Math.floor(to[0] * R)));
  const ty = Math.min(GH - 1, Math.max(0, Math.floor(to[1] * R)));
  if (sx === tx && sy === ty) return [from, to];

  const start = key(sx, sy);
  const goal = key(tx, ty);
  const N = GW * GH;
  const gs = new Float32Array(N).fill(1e9);
  const came = new Int32Array(N).fill(-1);
  const dir = new Int8Array(N).fill(-1);
  const closed = new Uint8Array(N);
  // Binary heap of [f, node]
  const heapF: number[] = [];
  const heapN: number[] = [];
  const push = (f: number, n: number) => {
    let i = heapF.length;
    heapF.push(f);
    heapN.push(n);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapF[p] <= heapF[i]) break;
      [heapF[p], heapF[i]] = [heapF[i], heapF[p]];
      [heapN[p], heapN[i]] = [heapN[i], heapN[p]];
      i = p;
    }
  };
  const pop = () => {
    const n = heapN[0];
    const lf = heapF.pop()!;
    const ln = heapN.pop()!;
    if (heapF.length) {
      heapF[0] = lf;
      heapN[0] = ln;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heapF.length && heapF[l] < heapF[m]) m = l;
        if (r < heapF.length && heapF[r] < heapF[m]) m = r;
        if (m === i) break;
        [heapF[m], heapF[i]] = [heapF[i], heapF[m]];
        [heapN[m], heapN[i]] = [heapN[i], heapN[m]];
        i = m;
      }
    }
    return n;
  };
  const D = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  gs[start] = 0;
  push(Math.abs(sx - tx) + Math.abs(sy - ty), start);

  let found = false;
  while (heapF.length) {
    const cur = pop();
    if (closed[cur]) continue;
    if (cur === goal) {
      found = true;
      break;
    }
    closed[cur] = 1;
    const cx = cur % GW;
    const cy = (cur - cx) / GW;
    for (let d = 0; d < 4; d++) {
      const nx = cx + D[d][0];
      const ny = cy + D[d][1];
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const nk = key(nx, ny);
      if (closed[nk]) continue;
      if (g[nk] && nk !== goal) continue;
      const turn = dir[cur] !== -1 && dir[cur] !== d ? 0.6 : 0;
      const ng = gs[cur] + 1 + turn;
      if (ng < gs[nk]) {
        came[nk] = cur;
        gs[nk] = ng;
        dir[nk] = d;
        push(ng + Math.abs(nx - tx) + Math.abs(ny - ty), nk);
      }
    }
  }

  if (!found) return [from, [to[0], from[1]], to];

  const cells: Pt[] = [];
  let c = goal;
  while (c !== -1) {
    const cx = c % GW;
    cells.unshift([(cx + 0.5) / R, ((c - cx) / GW + 0.5) / R]);
    c = c === start ? -1 : came[c];
  }
  cells[0] = from;
  cells[cells.length - 1] = to;

  // Keep the walk on the grid: insert corners for any diagonal hops, then
  // drop collinear points.
  const pts: Pt[] = [cells[0]];
  for (let i = 1; i < cells.length; i++) {
    const p = pts[pts.length - 1];
    const q = cells[i];
    if (Math.abs(p[0] - q[0]) > 0.01 && Math.abs(p[1] - q[1]) > 0.01) pts.push([q[0], p[1]]);
    pts.push(q);
  }
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const c2 = pts[i + 1];
    const col = (Math.abs(a[0] - b[0]) < 0.01 && Math.abs(b[0] - c2[0]) < 0.01) || (Math.abs(a[1] - b[1]) < 0.01 && Math.abs(b[1] - c2[1]) < 0.01);
    if (!col) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
