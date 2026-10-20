// Просторова стрижнева система (МСЕ, лінійна статика, 6 ступенів вільності у вузлі).
// Елемент — стрижень Ейлера–Бернуллі; шарніри на кінцях — статичною конденсацією.
// Одиниці: Н, мм, МПа. Глобальна вісь Z — вгору.
// Локальні осі стрижня: x — від вузла i до j; z — «вгору» (проєкція глобальної Z, для вертикальних — глобальної X),
// y = z × x; кут β повертає y, z навколо x. I_y — момент інерції відносно локальної y (згин у площині xz, сильна вісь).
// Внутрішні зусилля в перерізі: N > 0 — розтяг; M_y > 0 — розтягнуті волокна +z; M_z > 0 — розтягнуті волокна −y.

import { shellForces, ShellElement, ShellForces, ShellLoad, shellLoadVector, shellPrepare, ShellPrepared } from "./shell";

export type Vec3 = [number, number, number];

export interface FrameNode {
  id: string;
  x: number; y: number; z: number;
  /** закріплення: ux, uy, uz, rx, ry, rz — true (жорстко) або жорсткість пружини (Н/мм, Н·мм/рад) */
  fix?: Partial<Record<Dof, boolean | number>>;
}
export type Dof = "ux" | "uy" | "uz" | "rx" | "ry" | "rz";
export const DOFS: Dof[] = ["ux", "uy", "uz", "rx", "ry", "rz"];

export interface FrameSection { A: number; Iy: number; Iz: number; It: number }

/** Звільнення на кінці стрижня: моменти (шарнір) і/або поздовжня сила */
export interface EndRelease { my?: boolean; mz?: boolean; mx?: boolean; n?: boolean }

export interface FrameMember {
  id: string;
  i: string; j: string;
  sec: FrameSection;
  E: number; G: number;
  /** густина, кг/м³ — для власної ваги */
  rho?: number;
  /** кут повороту перерізу навколо осі стрижня, град */
  beta?: number;
  rel?: { i?: EndRelease; j?: EndRelease };
}

/** Навантаження на стрижень: dir — глобальний (gx, gy, gz) або локальний (lx, ly, lz) напрямок;
 *  розподілене w1→w2 (Н/мм) на ділянці [a, b] (мм від вузла i) або зосереджене P у точці a */
export type MemberLoad =
  | { member: string; kind: "dist"; dir: LoadDir; w1: number; w2?: number; a?: number; b?: number }
  | { member: string; kind: "point"; dir: LoadDir; P: number; a: number };
export type LoadDir = "gx" | "gy" | "gz" | "lx" | "ly" | "lz";

export interface LoadCase {
  id: string;
  /** вузлові сили [Fx, Fy, Fz, Mx, My, Mz], Н і Н·мм */
  nodal?: { node: string; F: number[] }[];
  members?: MemberLoad[];
  /** тиск на елементи оболонки */
  shellLoads?: ShellLoad[];
  /** власна вага стрижнів і оболонок з коефіцієнтом (1 — повна) */
  selfWeight?: number;
}

export interface FrameModel { nodes: FrameNode[]; members: FrameMember[]; shells?: ShellElement[] }

export interface MemberForces {
  /** станції вздовж стрижня, мм */
  x: number[];
  N: number[]; Vy: number[]; Vz: number[]; T: number[]; My: number[]; Mz: number[];
  /** зусилля, що діють з боку вузлів на кінці стрижня (локальні осі): [Fx,Fy,Fz,Mx,My,Mz] */
  endI: number[]; endJ: number[];
  /** переміщення станцій у глобальних осях, мм */
  disp: Vec3[];
}

export interface FrameResult {
  /** переміщення вузлів [ux, uy, uz, rx, ry, rz] */
  u: Record<string, number[]>;
  /** реакції в закріплених вузлах (глобальні), Н і Н·мм */
  reactions: Record<string, number[]>;
  members: Record<string, MemberForces>;
  shells?: Record<string, ShellForces>;
}

export const G_ACC = 9.81e-3; // Н/кг на мм… 1 кг·9.81 м/с² = 9.81 Н; густина в кг/мм³ дає Н/мм³

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };

/** Локальні осі стрижня: рядки — x, y, z у глобальних координатах */
export function memberAxes(pi: Vec3, pj: Vec3, beta = 0): [Vec3, Vec3, Vec3] {
  const x = norm(sub(pj, pi));
  const ref: Vec3 = Math.abs(x[2]) > 0.999 ? [1, 0, 0] : [0, 0, 1];
  const d = dot(ref, x);
  let z = norm([ref[0] - d * x[0], ref[1] - d * x[1], ref[2] - d * x[2]]);
  let y = cross(z, x);
  if (beta) {
    const c = Math.cos((beta * Math.PI) / 180), s = Math.sin((beta * Math.PI) / 180);
    const y2: Vec3 = [c * y[0] + s * z[0], c * y[1] + s * z[1], c * y[2] + s * z[2]];
    const z2: Vec3 = [-s * y[0] + c * z[0], -s * y[1] + c * z[1], -s * y[2] + c * z[2]];
    y = y2; z = z2;
  }
  return [x, y, z];
}

/** Локальна матриця жорсткості 12×12 */
function kLocal(m: FrameMember, L: number): number[][] {
  const { A, Iy, Iz, It } = m.sec, E = m.E, G = m.G;
  const k = Array.from({ length: 12 }, () => new Array(12).fill(0));
  const set = (a: number, b: number, v: number) => { k[a][b] += v; if (a !== b) k[b][a] += v; };
  const ea = (E * A) / L, gj = (G * It) / L;
  set(0, 0, ea); set(6, 6, ea); set(0, 6, -ea);
  set(3, 3, gj); set(9, 9, gj); set(3, 9, -gj);
  // площина xy: v (1, 7), θz (5, 11), EI_z
  const z12 = (12 * E * Iz) / L ** 3, z6 = (6 * E * Iz) / L ** 2, z4 = (4 * E * Iz) / L, z2 = (2 * E * Iz) / L;
  set(1, 1, z12); set(1, 5, z6); set(1, 7, -z12); set(1, 11, z6);
  set(5, 5, z4); set(5, 7, -z6); set(5, 11, z2);
  set(7, 7, z12); set(7, 11, -z6); set(11, 11, z4);
  // площина xz: w (2, 8), θy (4, 10), EI_y; θy = −dw/dx
  const y12 = (12 * E * Iy) / L ** 3, y6 = (6 * E * Iy) / L ** 2, y4 = (4 * E * Iy) / L, y2 = (2 * E * Iy) / L;
  set(2, 2, y12); set(2, 4, -y6); set(2, 8, -y12); set(2, 10, -y6);
  set(4, 4, y4); set(4, 8, y6); set(4, 10, y2);
  set(8, 8, y12); set(8, 10, y6); set(10, 10, y4);
  return k;
}

/** Геометрична матриця жорсткості 12×12 (узгоджена, кубічні форми) при поздовжній силі N (розтяг > 0).
 *  Кручення не враховано: крутильна і згинально-крутильна форми — перевірка стрижня, не системи. */
function kgLocal(L: number, N: number): number[][] {
  const k = Array.from({ length: 12 }, () => new Array(12).fill(0));
  if (!N) return k;
  const set = (a: number, b: number, v: number) => { k[a][b] += v; if (a !== b) k[b][a] += v; };
  const c = N / (30 * L);
  set(1, 1, 36 * c); set(1, 5, 3 * L * c); set(1, 7, -36 * c); set(1, 11, 3 * L * c);
  set(5, 5, 4 * L * L * c); set(5, 7, -3 * L * c); set(5, 11, -L * L * c);
  set(7, 7, 36 * c); set(7, 11, -3 * L * c); set(11, 11, 4 * L * L * c);
  // площина xz, θy = −dw/dx
  set(2, 2, 36 * c); set(2, 4, -3 * L * c); set(2, 8, -36 * c); set(2, 10, -3 * L * c);
  set(4, 4, 4 * L * L * c); set(4, 8, 3 * L * c); set(4, 10, -L * L * c);
  set(8, 8, 36 * c); set(8, 10, 3 * L * c); set(10, 10, 4 * L * L * c);
  return k;
}

/** Лінеаризована конденсація геометричної матриці при звільненнях: Aᵀ·G·A, A = [I; −Krr⁻¹·Krc] */
function condenseG(k: number[][], g: number[][], rel: number[]): number[][] {
  if (!rel.length) return g;
  const A: number[][] = Array.from({ length: 12 }, (_, r) => Array.from({ length: 12 }, (_, c) => (r === c && !rel.includes(r) ? 1 : 0)));
  const cc = [...Array(12).keys()].filter((q) => !rel.includes(q));
  const X = solveSmall(rel.map((r) => rel.map((q) => k[r][q])), rel.map((r) => cc.map((q) => -k[r][q])));
  rel.forEach((r, ir) => cc.forEach((c, ic) => (A[r][c] = X[ir][ic])));
  const GA = g.map((row) => A[0].map((_, c) => row.reduce((s, v, q) => s + v * A[q][c], 0)));
  return Array.from({ length: 12 }, (_, r) => Array.from({ length: 12 }, (_, c) => (rel.includes(r) || rel.includes(c) ? 0 : A.reduce((s, row, q) => s + row[r] * GA[q][c], 0))));
}

/** Еквівалентні вузлові сили від навантаження p(s) (локальний вектор, Н/мм) на [a, b] — узгоджені (Ерміт) */
function eqLoads(L: number, a: number, b: number, p: (s: number) => Vec3): number[] {
  const f = new Array(12).fill(0);
  if (b <= a) return f;
  // 3 точки Гаусса — точно для лінійного навантаження і кубічних функцій форми; ділимо на 4 відрізки для запасу
  const gp = [-Math.sqrt(3 / 5), 0, Math.sqrt(3 / 5)], gw = [5 / 9, 8 / 9, 5 / 9];
  const nseg = 4;
  for (let q = 0; q < nseg; q++) {
    const s0 = a + ((b - a) * q) / nseg, s1 = a + ((b - a) * (q + 1)) / nseg, h = (s1 - s0) / 2;
    for (let g = 0; g < 3; g++) {
      const s = s0 + h * (1 + gp[g]), w = gw[g] * h, xi = s / L;
      const [px, py, pz] = p(s);
      const N1 = 1 - 3 * xi * xi + 2 * xi ** 3, N2 = L * (xi - 2 * xi * xi + xi ** 3), N3 = 3 * xi * xi - 2 * xi ** 3, N4 = L * (-xi * xi + xi ** 3);
      f[0] += w * px * (1 - xi); f[6] += w * px * xi;
      f[1] += w * py * N1; f[5] += w * py * N2; f[7] += w * py * N3; f[11] += w * py * N4;
      f[2] += w * pz * N1; f[4] -= w * pz * N2; f[8] += w * pz * N3; f[10] -= w * pz * N4;
    }
  }
  return f;
}
function eqPoint(L: number, a: number, P: Vec3): number[] {
  const f = new Array(12).fill(0), xi = a / L;
  const N1 = 1 - 3 * xi * xi + 2 * xi ** 3, N2 = L * (xi - 2 * xi * xi + xi ** 3), N3 = 3 * xi * xi - 2 * xi ** 3, N4 = L * (-xi * xi + xi ** 3);
  f[0] = P[0] * (1 - xi); f[6] = P[0] * xi;
  f[1] = P[1] * N1; f[5] = P[1] * N2; f[7] = P[1] * N3; f[11] = P[1] * N4;
  f[2] = P[2] * N1; f[4] = -P[2] * N2; f[8] = P[2] * N3; f[10] = -P[2] * N4;
  return f;
}

/** Розв'язок малої щільної системи (Гаусс з вибором головного елемента) */
function solveSmall(A: number[][], B: number[][]): number[][] {
  const n = A.length, m = B[0]?.length ?? 0;
  const a = A.map((r, i) => [...r, ...B[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    if (Math.abs(d) < 1e-30) throw new Error("release-mechanism");
    for (let r = 0; r < n; r++) if (r !== c) {
      const k = a[r][c] / d;
      if (k) for (let q = c; q < n + m; q++) a[r][q] -= k * a[c][q];
    }
  }
  return a.map((r, i) => r.slice(n).map((v) => v / a[i][i]));
}

interface Prepared {
  L: number; R: [Vec3, Vec3, Vec3];
  k: number[][]; // локальна, після конденсації
  rel: number[]; // звільнені локальні ступені
  kFull: number[][]; // до конденсації
}

function releasedDofs(m: FrameMember): number[] {
  const r: number[] = [];
  const add = (e: EndRelease | undefined, o: number) => {
    if (!e) return;
    if (e.n) r.push(o + 0);
    if (e.mx) r.push(o + 3);
    if (e.my) r.push(o + 4);
    if (e.mz) r.push(o + 5);
  };
  add(m.rel?.i, 0); add(m.rel?.j, 6);
  return r;
}

/** Конденсація: K* = Kcc − Kcr Krr⁻¹ Krc; F* = Fc − Kcr Krr⁻¹ Fr (у повному розмірі з нулями у звільнених) */
function condense(k: number[][], f: number[], rel: number[]): { k: number[][]; f: number[] } {
  if (!rel.length) return { k, f };
  const c = [...Array(12).keys()].filter((q) => !rel.includes(q));
  const Krr = rel.map((r) => rel.map((s) => k[r][s]));
  const Krc = rel.map((r) => c.map((s) => k[r][s]));
  const X = solveSmall(Krr, Krc.map((row, q) => [...row, f[rel[q]]]));
  const k2 = Array.from({ length: 12 }, () => new Array(12).fill(0));
  const f2 = new Array(12).fill(0);
  c.forEach((a, ia) => {
    f2[a] = f[a] - rel.reduce((s, r, ir) => s + k[a][r] * X[ir][c.length], 0);
    c.forEach((b, ib) => { k2[a][b] = k[a][b] - rel.reduce((s, r, ir) => s + k[a][r] * X[ir][ib], 0); });
  });
  return { k: k2, f: f2 };
}

const toLocal = (R: [Vec3, Vec3, Vec3], v: Vec3): Vec3 => [dot(R[0], v), dot(R[1], v), dot(R[2], v)];
const toGlobal = (R: [Vec3, Vec3, Vec3], v: Vec3): Vec3 => [
  R[0][0] * v[0] + R[1][0] * v[1] + R[2][0] * v[2],
  R[0][1] * v[0] + R[1][1] * v[1] + R[2][1] * v[2],
  R[0][2] * v[0] + R[1][2] * v[1] + R[2][2] * v[2],
];

/** Навантаження на стрижень у вигляді функцій локального вектора та зосереджених сил */
function memberLoadFns(m: FrameMember, P: Prepared, lc: LoadCase) {
  const dist: { a: number; b: number; p: (s: number) => Vec3 }[] = [];
  const pts: { a: number; P: Vec3 }[] = [];
  const dirVec = (d: LoadDir): Vec3 => {
    const g: Record<string, Vec3> = { gx: [1, 0, 0], gy: [0, 1, 0], gz: [0, 0, 1] };
    if (d in g) return toLocal(P.R, g[d]);
    return d === "lx" ? [1, 0, 0] : d === "ly" ? [0, 1, 0] : [0, 0, 1];
  };
  for (const l of lc.members ?? []) {
    if (l.member !== m.id) continue;
    const v = dirVec(l.dir);
    if (l.kind === "point") { pts.push({ a: Math.max(0, Math.min(P.L, l.a)), P: [v[0] * l.P, v[1] * l.P, v[2] * l.P] }); continue; }
    const a = Math.max(0, l.a ?? 0), b = Math.min(P.L, l.b ?? P.L), w1 = l.w1, w2 = l.w2 ?? l.w1;
    if (b <= a) continue;
    dist.push({ a, b, p: (s) => { const w = w1 + ((w2 - w1) * (s - a)) / (b - a); return [v[0] * w, v[1] * w, v[2] * w]; } });
  }
  if (lc.selfWeight && m.rho) {
    const w = -m.sec.A * m.rho * 1e-9 * 9.81 * lc.selfWeight; // Н/мм
    const v = toLocal(P.R, [0, 0, 1]);
    dist.push({ a: 0, b: P.L, p: () => [v[0] * w, v[1] * w, v[2] * w] });
  }
  return { dist, pts };
}

/** Збірка і розклад матриці жорсткості (спільне для статики і власних коливань) */
/** N — поздовжні сили в стрижнях (розтяг > 0) для розрахунку за деформованою схемою: K + K_σ(N) */
function buildFrame(model: FrameModel, N?: Map<string, number>) {
  const idx = new Map(model.nodes.map((n, k) => [n.id, k]));
  const nd = model.nodes.length * 6;
  const pos = (id: string): Vec3 => { const n = model.nodes[idx.get(id)!]; return [n.x, n.y, n.z]; };
  for (const m of model.members) {
    if (!idx.has(m.i) || !idx.has(m.j)) throw new Error(`member ${m.id}: unknown node`);
  }
  const prep = new Map<string, Prepared>();
  for (const m of model.members) {
    const pi = pos(m.i), pj = pos(m.j), L = Math.hypot(...sub(pj, pi));
    if (L < 1e-6) throw new Error(`zero-length:${m.id}`);
    const R = memberAxes(pi, pj, m.beta);
    const kFull = kLocal(m, L), rel = releasedDofs(m);
    const n = N?.get(m.id);
    if (n) { const g = kgLocal(L, n); for (let a = 0; a < 12; a++) for (let b = 0; b < 12; b++) kFull[a][b] += g[a][b]; }
    const { k } = condense(kFull, new Array(12).fill(0), rel);
    prep.set(m.id, { L, R, k, rel, kFull });
  }
  const shells = model.shells ?? [];
  const sprep = new Map<string, ShellPrepared>();
  for (const e of shells) {
    if (e.nodes.some((n) => !idx.has(n))) throw new Error(`shell ${e.id}: unknown node`);
    sprep.set(e.id, shellPrepare(e, e.nodes.map(pos)));
  }
  const T12 = (R: [Vec3, Vec3, Vec3]) => {
    const T = Array.from({ length: 12 }, () => new Array(12).fill(0));
    for (let b = 0; b < 4; b++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) T[b * 3 + r][b * 3 + c] = R[r][c];
    return T;
  };
  const dofsOfNodes = (ids: string[]) => ids.flatMap((id) => { const a = idx.get(id)! * 6; return [a, a + 1, a + 2, a + 3, a + 4, a + 5]; });
  const dofsOf = (m: FrameMember) => dofsOfNodes([m.i, m.j]);
  const elems: { d: number[]; K: number[][] }[] = [];
  for (const m of model.members) {
    const P = prep.get(m.id)!, T = T12(P.R);
    // Kg = Tᵀ k T
    const kT = P.k.map((row) => T[0].map((_, c) => row.reduce((s, v, q) => s + v * T[q][c], 0)));
    const Kg = Array.from({ length: 12 }, (_, r) => Array.from({ length: 12 }, (_, c) => { let s = 0; for (let q = 0; q < 12; q++) s += T[q][r] * kT[q][c]; return s; }));
    elems.push({ d: dofsOf(m), K: Kg });
  }
  for (const e of shells) elems.push({ d: dofsOfNodes(e.nodes), K: sprep.get(e.id)!.K });
  // закріплення і пружини
  const fixed = new Array(nd).fill(false);
  const spring = new Float64Array(nd);
  model.nodes.forEach((n, k) => DOFS.forEach((dn, q) => {
    const v = n.fix?.[dn];
    if (v === true) fixed[k * 6 + q] = true;
    else if (typeof v === "number" && v > 0) spring[k * 6 + q] = v;
  }));
  const diag0 = new Float64Array(nd);
  for (const el of elems) el.d.forEach((g, r) => (diag0[g] += el.K[r][r]));
  for (let q = 0; q < nd; q++) diag0[q] += spring[q];
  let kmax = 0;
  for (let q = 0; q < nd; q++) kmax = Math.max(kmax, diag0[q]);
  // нумерація рівнянь: зворотний Катхілл–Маккі за вузлами — вузька стрічка для профільного розкладу
  const nn = model.nodes.length;
  const adj: Set<number>[] = Array.from({ length: nn }, () => new Set());
  for (const el of elems) {
    const ns = [...new Set(el.d.map((g) => Math.floor(g / 6)))];
    for (const a of ns) for (const b of ns) if (a !== b) adj[a].add(b);
  }
  const order: number[] = [], seen = new Array(nn).fill(false);
  const byDeg = [...Array(nn).keys()].sort((a, b) => adj[a].size - adj[b].size);
  for (const s0 of byDeg) {
    if (seen[s0]) continue;
    seen[s0] = true;
    const queue = [s0];
    for (let h = 0; h < queue.length; h++) {
      const v = queue[h];
      order.push(v);
      for (const w of [...adj[v]].sort((a, b) => adj[a].size - adj[b].size)) if (!seen[w]) { seen[w] = true; queue.push(w); }
    }
  }
  order.reverse();
  const eq = new Int32Array(nd).fill(-1), free: number[] = [];
  for (const k of order) for (let q = 0; q < 6; q++) if (!fixed[k * 6 + q]) { eq[k * 6 + q] = free.length; free.push(k * 6 + q); }
  const nf = free.length;
  // профіль: перший ненульовий стовпець кожного рядка
  const first = new Int32Array(nf);
  for (let r = 0; r < nf; r++) first[r] = r;
  for (const el of elems) {
    let mn = Infinity;
    for (const g of el.d) if (eq[g] >= 0 && eq[g] < mn) mn = eq[g];
    for (const g of el.d) if (eq[g] >= 0 && first[eq[g]] > mn) first[eq[g]] = mn;
  }
  const ptr = new Int32Array(nf + 1);
  for (let r = 0; r < nf; r++) ptr[r + 1] = ptr[r] + (r - first[r] + 1);
  const A = new Float64Array(ptr[nf]);
  const at = (r: number, c: number) => ptr[r] + c - first[r];
  for (const el of elems) {
    const n = el.d.length;
    for (let i = 0; i < n; i++) {
      const r = eq[el.d[i]];
      if (r < 0) continue;
      for (let j = 0; j < n; j++) {
        const c = eq[el.d[j]];
        if (c < 0 || c > r) continue;
        A[at(r, c)] += el.K[i][j];
      }
    }
  }
  for (let r = 0; r < nf; r++) {
    const g = free[r];
    A[at(r, r)] += spring[g];
    // повороти вузлів, де всі стрижні шарнірні, — крихітна пружина, щоб матриця не була виродженою
    if (g % 6 >= 3) A[at(r, r)] += kmax * 1e-12 + 1e-6;
  }
  const kdiag = new Float64Array(nf);
  for (let r = 0; r < nf; r++) kdiag[r] = A[at(r, r)];
  // профільний розклад Холецького (на місці)
  for (let r = 0; r < nf; r++) {
    const fr = first[r], pr = ptr[r] - fr;
    for (let c = fr; c <= r; c++) {
      const fc = first[c], pc = ptr[c] - fc;
      let s = A[pr + c];
      for (let q = Math.max(fr, fc); q < c; q++) s -= A[pr + q] * A[pc + q];
      if (c === r) {
        const ref = Math.max(diag0[free[r]], kmax * 1e-12);
        if (s <= ref * 1e-9 && free[r] % 6 < 3) {
          const n = model.nodes[Math.floor(free[r] / 6)];
          throw new Error(`mechanism:${n.id}:${DOFS[free[r] % 6]}`);
        }
        A[pr + r] = Math.sqrt(Math.max(s, 1e-30));
      } else A[pr + c] = s / A[pc + c];
    }
  }
  const solveVec = (F: Float64Array) => {
    const y = new Float64Array(nf);
    for (let r = 0; r < nf; r++) {
      const fr = first[r], pr = ptr[r] - fr;
      let s = F[free[r]];
      for (let q = fr; q < r; q++) s -= A[pr + q] * y[q];
      y[r] = s / A[pr + r];
    }
    // зворотний хід за стовпцями профілю
    for (let r = nf - 1; r >= 0; r--) {
      const fr = first[r], pr = ptr[r] - fr;
      y[r] /= A[pr + r];
      const xr = y[r];
      for (let q = fr; q < r; q++) y[q] -= A[pr + q] * xr;
    }
    return y;
  };
  // перевірка на механізм: одинична сила в кожному вільному переміщенні — механізм дає «нескінченні» переміщення
  {
    const Fp = new Float64Array(nd);
    free.forEach((g) => { if (g % 6 < 3) Fp[g] = 1 + (g % 7) * 0.1; });
    const xp = solveVec(Fp);
    let worst = -1, wv = 0;
    free.forEach((g, r) => { if (g % 6 < 3 && Math.abs(xp[r]) > wv) { wv = Math.abs(xp[r]); worst = g; } });
    if (worst >= 0 && wv > 1e4) throw new Error(`mechanism:${model.nodes[Math.floor(worst / 6)].id}:${DOFS[worst % 6]}`);
  }
  /** розв'язок для вектора у нумерації рівнянь (довжина nf) */
  const solveEq = (b: Float64Array) => { const F = new Float64Array(nd); free.forEach((g, r) => (F[g] = b[r])); return solveVec(F); };
  return { idx, nd, pos, prep, shells, sprep, dofsOf, dofsOfNodes, free, eq, nf, kdiag, solveVec, solveEq };
}

export function solveFrame(model: FrameModel, cases: LoadCase[], stations = 41, N?: Map<string, number>): Record<string, FrameResult> {
  const { idx, nd, prep, shells, sprep, dofsOf, dofsOfNodes, free, solveVec } = buildFrame(model, N);
  const out: Record<string, FrameResult> = {};
  for (const lc of cases) {
    const F = new Float64Array(nd);
    for (const nl of lc.nodal ?? []) { const k = idx.get(nl.node); if (k === undefined) continue; for (let q = 0; q < 6; q++) F[k * 6 + q] += nl.F[q] ?? 0; }
    const memEq = new Map<string, { fFull: number[]; loads: ReturnType<typeof memberLoadFns> }>();
    for (const m of model.members) {
      const P = prep.get(m.id)!, loads = memberLoadFns(m, P, lc);
      const fFull = new Array(12).fill(0);
      for (const dl of loads.dist) eqLoads(P.L, dl.a, dl.b, dl.p).forEach((v, q) => (fFull[q] += v));
      for (const pl of loads.pts) eqPoint(P.L, pl.a, pl.P).forEach((v, q) => (fFull[q] += v));
      memEq.set(m.id, { fFull, loads });
      const { f } = condense(P.kFull, fFull, P.rel);
      const d = dofsOf(m);
      for (let b = 0; b < 4; b++) {
        const g = toGlobal(P.R, [f[b * 3], f[b * 3 + 1], f[b * 3 + 2]]);
        for (let r = 0; r < 3; r++) F[d[b * 3 + r]] += g[r];
      }
    }
    const sLoad = new Map<string, number[]>();
    for (const e of shells) {
      const ls = (lc.shellLoads ?? []).filter((l) => l.shell === e.id);
      if (!ls.length && !(lc.selfWeight && e.rho)) continue;
      const f = shellLoadVector(e, sprep.get(e.id)!, ls, lc.selfWeight ?? 0);
      sLoad.set(e.id, f);
      dofsOfNodes(e.nodes).forEach((g, q) => (F[g] += f[q]));
    }
    const x = solveVec(F);
    const U = new Float64Array(nd);
    free.forEach((g, r) => (U[g] = x[r]));
    const res: FrameResult = { u: {}, reactions: {}, members: {} };
    model.nodes.forEach((n, k) => (res.u[n.id] = Array.from(U.slice(k * 6, k * 6 + 6))));
    // зусилля в стрижнях
    const nodeSum = new Map<string, number[]>();
    for (const m of model.members) {
      const P = prep.get(m.id)!, { fFull, loads } = memEq.get(m.id)!, d = dofsOf(m);
      const ul = new Array(12).fill(0);
      for (let b = 0; b < 4; b++) {
        const l = toLocal(P.R, [U[d[b * 3]], U[d[b * 3 + 1]], U[d[b * 3 + 2]]]);
        ul[b * 3] = l[0]; ul[b * 3 + 1] = l[1]; ul[b * 3 + 2] = l[2];
      }
      // відновлення звільнених ступенів: u_r = Krr⁻¹ (F_r − Krc u_c)
      if (P.rel.length) {
        const c = [...Array(12).keys()].filter((q) => !P.rel.includes(q));
        const Krr = P.rel.map((r) => P.rel.map((s) => P.kFull[r][s]));
        const rhs = P.rel.map((r) => [fFull[r] - c.reduce((s, q) => s + P.kFull[r][q] * ul[q], 0)]);
        const ur = solveSmall(Krr, rhs);
        P.rel.forEach((r, q) => (ul[r] = ur[q][0]));
      }
      const fe = P.kFull.map((row, r) => row.reduce((s, v, q) => s + v * ul[q], 0) - fFull[r]);
      for (const r of P.rel) fe[r] = 0;
      // зусилля від вузлів на стрижень у глобальних — для реакцій
      for (const [nid, o] of [[m.i, 0], [m.j, 6]] as [string, number][]) {
        const fg = toGlobal(P.R, [fe[o], fe[o + 1], fe[o + 2]]), mg = toGlobal(P.R, [fe[o + 3], fe[o + 4], fe[o + 5]]);
        const s = nodeSum.get(nid) ?? [0, 0, 0, 0, 0, 0];
        for (let q = 0; q < 3; q++) { s[q] += fg[q]; s[q + 3] += mg[q]; }
        nodeSum.set(nid, s);
      }
      // епюри: рівновага відрізка [0, x]
      const xs = new Set<number>();
      for (let q = 0; q < stations; q++) xs.add((P.L * q) / (stations - 1));
      for (const pl of loads.pts) { xs.add(Math.max(0, pl.a - 1e-6)); xs.add(Math.min(P.L, pl.a + 1e-6)); }
      const X = [...xs].sort((a, b) => a - b);
      const mf: MemberForces = { x: X, N: [], Vy: [], Vz: [], T: [], My: [], Mz: [], endI: fe.slice(0, 6), endJ: fe.slice(6), disp: [] };
      const gp = [-Math.sqrt(3 / 5), 0, Math.sqrt(3 / 5)], gw = [5 / 9, 8 / 9, 5 / 9];
      for (const xx of X) {
        const Fs: Vec3 = [fe[0], fe[1], fe[2]];
        const Ms: Vec3 = [fe[3], fe[4] + xx * fe[2], fe[5] - xx * fe[1]];
        for (const dl of loads.dist) {
          const a = dl.a, b = Math.min(dl.b, xx);
          if (b <= a) continue;
          const nseg = 4;
          for (let q = 0; q < nseg; q++) {
            const s0 = a + ((b - a) * q) / nseg, h = (b - a) / nseg / 2;
            for (let g = 0; g < 3; g++) {
              const s = s0 + h * (1 + gp[g]), w = gw[g] * h, p = dl.p(s);
              Fs[0] += w * p[0]; Fs[1] += w * p[1]; Fs[2] += w * p[2];
              Ms[1] += -(s - xx) * p[2] * w; Ms[2] += (s - xx) * p[1] * w;
            }
          }
        }
        for (const pl of loads.pts) if (pl.a < xx) {
          Fs[0] += pl.P[0]; Fs[1] += pl.P[1]; Fs[2] += pl.P[2];
          Ms[1] += -(pl.a - xx) * pl.P[2]; Ms[2] += (pl.a - xx) * pl.P[1];
        }
        // деформована схема: момент сили N на зміщенні осі відносно вузла i (P-Δ і P-δ), форма — кубічна за переміщеннями кінців;
        // кінцеві сили з K_σ врівноважені саме в деформованому положенні
        if (N?.get(m.id)) {
          const e = xx / P.L, h1 = 1 - 3 * e * e + 2 * e ** 3, h2 = P.L * (e - 2 * e * e + e ** 3), h3 = 3 * e * e - 2 * e ** 3, h4 = P.L * (e ** 3 - e * e);
          const dv = (h1 - 1) * ul[1] + h2 * ul[5] + h3 * ul[7] + h4 * ul[11];
          const dw = (h1 - 1) * ul[2] - h2 * ul[4] + h3 * ul[8] - h4 * ul[10];
          Ms[2] += dv * fe[0]; Ms[1] -= dw * fe[0];
        }
        // внутрішні зусилля = −(сума на лівій частині); N > 0 — розтяг
        mf.N.push(-Fs[0]); mf.Vy.push(-Fs[1]); mf.Vz.push(-Fs[2]); mf.T.push(-Ms[0]); mf.My.push(-Ms[1]); mf.Mz.push(-Ms[2]);
      }
      // прогини: двічі інтегруємо кривину v'' = M_z/EI_z, w'' = −M_y/EI_y з переміщеннями кінців (точно для епюри M)
      const integ = (k: number[], a0: number, a1: number) => {
        const I1 = [0], I2 = [0];
        for (let q = 1; q < X.length; q++) {
          const h = X[q] - X[q - 1];
          I1.push(I1[q - 1] + (h * (k[q] + k[q - 1])) / 2);
          I2.push(I2[q - 1] + h * I1[q - 1] + (h * h * (2 * k[q - 1] + k[q])) / 6);
        }
        const c = (a1 - a0 - I2[I2.length - 1]) / P.L;
        return X.map((x, q) => a0 + c * x + I2[q]);
      };
      const vy = integ(mf.Mz.map((v) => v / (m.E * m.sec.Iz)), ul[1], ul[7]);
      const wz = integ(mf.My.map((v) => -v / (m.E * m.sec.Iy)), ul[2], ul[8]);
      mf.disp = X.map((x, q) => toGlobal(P.R, [ul[0] + ((ul[6] - ul[0]) * x) / P.L, vy[q], wz[q]]));
      // сила N у вузлі i: зусилля на стрижень fe[0] — стискає, якщо > 0
      res.members[m.id] = mf;
    }
    if (shells.length) {
      res.shells = {};
      for (const e of shells) {
        const d = dofsOfNodes(e.nodes), ug = d.map((g) => U[g]);
        const sf = shellForces(e, sprep.get(e.id)!, ug, sLoad.get(e.id) ?? new Array(24).fill(0));
        res.shells[e.id] = sf;
        e.nodes.forEach((nid, k) => {
          const s = nodeSum.get(nid) ?? [0, 0, 0, 0, 0, 0];
          for (let q = 0; q < 6; q++) s[q] += sf.nodal[k * 6 + q];
          nodeSum.set(nid, s);
        });
      }
    }
    model.nodes.forEach((n) => {
      if (!n.fix || !Object.values(n.fix).some((v) => v)) return;
      const s = nodeSum.get(n.id) ?? [0, 0, 0, 0, 0, 0];
      const Pn = (lc.nodal ?? []).filter((q) => q.node === n.id).reduce((a, q) => a.map((v, k) => v + (q.F[k] ?? 0)), [0, 0, 0, 0, 0, 0]);
      // пружина теж «реакція»
      const r = s.map((v, q) => v - Pn[q]);
      res.reactions[n.id] = r.map((v, q) => {
        const f = n.fix?.[DOFS[q]];
        return f ? v : 0;
      });
    });
    out[lc.id] = res;
  }
  return out;
}

/** Лінійна комбінація результатів загружень */
export function combineFrame(res: Record<string, FrameResult>, factors: Record<string, number>): FrameResult {
  const ids = Object.keys(factors).filter((k) => factors[k] && res[k]);
  const first = res[Object.keys(res)[0]];
  const lin = (get: (r: FrameResult) => number[]) => {
    const base = get(first).map(() => 0);
    for (const k of ids) get(res[k]).forEach((v, q) => (base[q] += factors[k] * v));
    return base;
  };
  const out: FrameResult = { u: {}, reactions: {}, members: {} };
  for (const n of Object.keys(first.u)) out.u[n] = lin((r) => r.u[n]);
  for (const n of Object.keys(first.reactions)) out.reactions[n] = lin((r) => r.reactions[n]);
  if (first.shells) {
    out.shells = {};
    for (const e of Object.keys(first.shells)) {
      const g = (k: string) => res[k].shells![e];
      const lin1 = (pick: (r: ShellForces) => number[]) => { const b = pick(first.shells![e]).map(() => 0); for (const k of ids) pick(g(k)).forEach((v, q) => (b[q] += factors[k] * v)); return b; };
      const c = lin1((r) => r.c), nodal = lin1((r) => r.nodal);
      const gp = [0, 1, 2, 3].map((q) => lin1((r) => r.gp[q])), corner = [0, 1, 2, 3].map((q) => lin1((r) => r.corner[q]));
      // svm залежить від товщини і нелінійний — рахується окремо (shellVonMises)
      out.shells[e] = { c, gp, corner, nodal, svm: NaN };
    }
  }
  for (const m of Object.keys(first.members)) {
    const f0 = first.members[m];
    // станції можуть відрізнятися між загруженнями (точкові сили) — зводимо до спільних станцій інтерполяцією
    const X = [...new Set(ids.flatMap((k) => res[k].members[m].x).concat(f0.x))].sort((a, b) => a - b);
    const keys = ["N", "Vy", "Vz", "T", "My", "Mz"] as const;
    const mf: MemberForces = { x: X, N: [], Vy: [], Vz: [], T: [], My: [], Mz: [], endI: lin((r) => r.members[m].endI), endJ: lin((r) => r.members[m].endJ), disp: [] };
    for (const key of keys) mf[key] = X.map(() => 0);
    const disp = X.map(() => [0, 0, 0]);
    for (const k of ids) {
      const r = res[k].members[m], fk = factors[k];
      const same = r.x.length === X.length && r.x.every((v, q) => v === X[q]);
      const on = (ys: number[]) => (same ? ys : interpSorted(r.x, ys, X));
      for (const key of keys) { const v = on(r[key]); for (let q = 0; q < X.length; q++) mf[key][q] += fk * v[q]; }
      for (let c = 0; c < 3; c++) { const v = on(r.disp.map((d) => d[c])); for (let q = 0; q < X.length; q++) disp[q][c] += fk * v[q]; }
    }
    mf.disp = disp as Vec3[];
    out.members[m] = mf;
  }
  return out;
}

/** Інтерполяція на зростаючу множину точок X (один прохід) */
function interpSorted(xs: number[], ys: number[], X: number[]): number[] {
  const out: number[] = [];
  let i = 1;
  for (const x of X) {
    if (x <= xs[0]) { out.push(ys[0]); continue; }
    while (i < xs.length - 1 && xs[i] < x) i++;
    if (x >= xs[xs.length - 1]) { out.push(ys[ys.length - 1]); continue; }
    const d = xs[i] - xs[i - 1];
    out.push(d < 1e-9 ? ys[i] : ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / d);
  }
  return out;
}

export function interp(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) {
    const d = xs[i] - xs[i - 1];
    return d < 1e-9 ? ys[i] : ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / d;
  }
  return ys[ys.length - 1];
}

/** Вектор вузлових сил загруження (глобальні, по 6 на вузол) — еквівалентні сили від навантажень на стрижні й оболонки */
function loadVector(model: FrameModel, B: ReturnType<typeof buildFrame>, lc: LoadCase): Float64Array {
  const F = new Float64Array(B.nd);
  for (const nl of lc.nodal ?? []) { const k = B.idx.get(nl.node); if (k === undefined) continue; for (let q = 0; q < 6; q++) F[k * 6 + q] += nl.F[q] ?? 0; }
  for (const m of model.members) {
    const P = B.prep.get(m.id)!, loads = memberLoadFns(m, P, lc);
    const fFull = new Array(12).fill(0);
    for (const dl of loads.dist) eqLoads(P.L, dl.a, dl.b, dl.p).forEach((v, q) => (fFull[q] += v));
    for (const pl of loads.pts) eqPoint(P.L, pl.a, pl.P).forEach((v, q) => (fFull[q] += v));
    const { f } = condense(P.kFull, fFull, P.rel), d = B.dofsOf(m);
    for (let b = 0; b < 4; b++) { const g = toGlobal(P.R, [f[b * 3], f[b * 3 + 1], f[b * 3 + 2]]); for (let r = 0; r < 3; r++) F[d[b * 3 + r]] += g[r]; }
  }
  for (const e of B.shells) {
    const ls = (lc.shellLoads ?? []).filter((l) => l.shell === e.id);
    if (!ls.length && !(lc.selfWeight && e.rho)) continue;
    const f = shellLoadVector(e, B.sprep.get(e.id)!, ls, lc.selfWeight ?? 0);
    B.dofsOfNodes(e.nodes).forEach((g, q) => (F[g] += f[q]));
  }
  return F;
}

export interface FrameMode {
  /** період, с; кругова частота, рад/с */
  T: number; omega: number;
  /** форма, нормована за масою (φᵀMφ = 1): переміщення вузлів [ux, uy, uz, rx, ry, rz] */
  phi: Record<string, number[]>;
  /** коефіцієнти участі Γ = φᵀ·M·r (x, y, z) і частки ефективної маси Γ²/ΣM */
  gamma: Vec3; meff: Vec3;
}
export interface ModalResult {
  modes: FrameMode[];
  /** зосереджені маси вузлів, т (Н·с²/мм) */
  mass: Record<string, number>;
  /** сумарна маса вільних вузлів за напрямками, т */
  Mtot: Vec3;
}
export const G_MM = 9810; // мм/с²

/** Власні коливання: маси — з вертикальних (−Z) сил загружень з коефіцієнтами; ітерації в підпросторі */
export function frameModes(model: FrameModel, mass: { lc: LoadCase; c: number }[], nModes = 12): ModalResult {
  const B = buildFrame(model);
  const { nf, free, nd } = B;
  const mv = new Float64Array(nd);
  for (const { lc, c } of mass) {
    if (!c) continue;
    const F = loadVector(model, B, lc);
    for (let k = 0; k < model.nodes.length; k++) { const w = -F[k * 6 + 2] * c; if (w > 0) for (let q = 0; q < 3; q++) mv[k * 6 + q] += w / G_MM; }
  }
  const m = new Float64Array(nf);
  free.forEach((g, r) => (m[r] = mv[g]));
  const massNode: Record<string, number> = {};
  model.nodes.forEach((n, k) => { if (mv[k * 6]) massNode[n.id] = mv[k * 6]; });
  const Mtot: Vec3 = [0, 0, 0];
  free.forEach((g, r) => { if (g % 6 < 3) Mtot[g % 6] += m[r]; });
  const mdofs = [...Array(nf).keys()].filter((r) => m[r] > 0);
  const q = Math.min(nModes, mdofs.length);
  if (!q) return { modes: [], mass: massNode, Mtot };
  const p = Math.min(mdofs.length, Math.max(2 * q, q + 8));
  // початкові вектори: розподіл мас за напрямками, далі — ступені з найбільшим m/k
  let X: Float64Array[] = [];
  for (let d = 0; d < 3; d++) { const v = new Float64Array(nf); let any = false; free.forEach((g, r) => { if (g % 6 === d && m[r]) { v[r] = m[r]; any = true; } }); if (any) X.push(v); }
  const byRatio = [...mdofs].sort((a, b) => m[b] / B.kdiag[b] - m[a] / B.kdiag[a]);
  for (const r of byRatio) { if (X.length >= p) break; const v = new Float64Array(nf); v[r] = 1; X.push(v); }
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) - 0.5;
  let lam: number[] = [], V: number[][] = [];
  for (let it = 0; it < 80; it++) {
    // Xb = K⁻¹ M X; Y = M X (= K Xb)
    let Y = X.map((x) => { const y = new Float64Array(nf); for (const r of mdofs) y[r] = m[r] * x[r]; return y; });
    let Xb = Y.map((y) => B.solveEq(y));
    // M-ортонормування (Грам–Шмідт), ті самі дії над Y
    const keepX: Float64Array[] = [], keepY: Float64Array[] = [];
    for (let j = 0; j < Xb.length; j++) {
      const x = Xb[j], y = Y[j];
      for (let pass = 0; pass < 2; pass++) for (let k = 0; k < keepX.length; k++) {
        let s = 0; for (const r of mdofs) s += keepX[k][r] * m[r] * x[r];
        for (let r = 0; r < nf; r++) { x[r] -= s * keepX[k][r]; y[r] -= s * keepY[k][r]; }
      }
      let nrm = 0; for (const r of mdofs) nrm += m[r] * x[r] * x[r];
      nrm = Math.sqrt(nrm);
      if (!(nrm > 1e-14)) continue;
      for (let r = 0; r < nf; r++) { x[r] /= nrm; y[r] /= nrm; }
      keepX.push(x); keepY.push(y);
    }
    Xb = keepX; Y = keepY;
    const n = Xb.length;
    const Kr = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => { let s = 0; for (let r = 0; r < nf; r++) s += Xb[a][r] * Y[b][r]; return s; }));
    for (let a = 0; a < n; a++) for (let b = 0; b < a; b++) { const v = (Kr[a][b] + Kr[b][a]) / 2; Kr[a][b] = Kr[b][a] = v; }
    // власні значення Kr — це 1/λ відносно K⁻¹M; тут Kr = Xbᵀ K Xb, тож λ = ω²
    const { values, vectors } = jacobiEig(Kr);
    const ord = values.map((v, k) => k).sort((a, b) => values[a] - values[b]);
    const lamNew = ord.map((k) => values[k]);
    V = ord.map((k) => vectors.map((row) => row[k]));
    X = V.map((v) => { const x = new Float64Array(nf); v.forEach((c, k) => { if (c) for (let r = 0; r < nf; r++) x[r] += c * Xb[k][r]; }); return x; });
    // доповнення до p векторів (якщо щось відкинуто)
    while (X.length < Math.min(p, mdofs.length)) { const v = new Float64Array(nf); for (const r of mdofs) v[r] = rnd(); X.push(v); }
    const conv = lam.length >= q && lamNew.slice(0, q).every((l, k) => Math.abs(l - lam[k]) <= 1e-7 * Math.abs(l) + 1e-12);
    lam = lamNew;
    if (conv) break;
  }
  const modes: FrameMode[] = [];
  for (let k = 0; k < q && k < lam.length; k++) {
    const x = X[k], om = Math.sqrt(Math.max(lam[k], 1e-12));
    // нормування за масою (після останньої ітерації X — комбінації M-ортонормованих векторів)
    let nrm = 0; for (const r of mdofs) nrm += m[r] * x[r] * x[r];
    nrm = Math.sqrt(nrm) || 1;
    const full = new Float64Array(nd);
    free.forEach((g, r) => (full[g] = x[r] / nrm));
    const gamma: Vec3 = [0, 0, 0];
    for (let g = 0; g < nd; g++) if (g % 6 < 3) gamma[g % 6] += mv[g] * full[g];
    // знак: найбільша складова участі додатна
    const big = [0, 1, 2].reduce((a, b) => (Math.abs(gamma[b]) > Math.abs(gamma[a]) ? b : a), 0), sg = gamma[big] < 0 ? -1 : 1;
    const phi: Record<string, number[]> = {};
    model.nodes.forEach((n, j) => (phi[n.id] = Array.from(full.slice(j * 6, j * 6 + 6), (v) => v * sg)));
    modes.push({ T: (2 * Math.PI) / om, omega: om, phi, gamma: gamma.map((g) => g * sg) as Vec3, meff: gamma.map((g, d) => (Mtot[d] ? (g * g) / Mtot[d] : 0)) as Vec3 });
  }
  return { modes, mass: massNode, Mtot };
}

/** Власні значення симетричної матриці (метод Якобі) */
function jacobiEig(A0: number[][]) {
  const n = A0.length, A = A0.map((r) => [...r]), Vv: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0, tot = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const v = A[i][j] * A[i][j]; if (i !== j) off += v; tot += v; }
    if (off <= 1e-24 * tot) break;
    for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < n; k++) { const vkp = Vv[k][p], vkq = Vv[k][q]; Vv[k][p] = c * vkp - s * vkq; Vv[k][q] = s * vkp + c * vkq; }
    }
  }
  return { values: A.map((r, i) => r[i]), vectors: Vv };
}


// ---------------------------------------------------------------------------------------------
// Поділ стрижнів на частини: вузли на стрижнях, навантаження частин, збирання зусиль назад

export type SplitMap = Map<string, { id: string; x0: number; L: number }[]>;

/** Навантаження стрижнів → навантаження їхніх частин */
export function splitMemberLoads(ls: MemberLoad[], split: SplitMap, Lof: (id: string) => number): MemberLoad[] {
  const out: MemberLoad[] = [];
  for (const l of ls) {
    const parts = split.get(l.member);
    if (!parts) { out.push(l); continue; }
    if (l.kind === "point") {
      const p = parts.find((q) => l.a >= q.x0 - 1e-9 && l.a <= q.x0 + q.L + 1e-9) ?? parts[parts.length - 1];
      out.push({ ...l, member: p.id, a: l.a - p.x0 });
      continue;
    }
    const a = l.a ?? 0, b = l.b ?? Lof(l.member), w2 = l.w2 ?? l.w1;
    const w = (x: number) => (b > a ? l.w1 + ((w2 - l.w1) * (x - a)) / (b - a) : l.w1);
    for (const p of parts) {
      const lo = Math.max(a, p.x0), hi = Math.min(b, p.x0 + p.L);
      if (hi <= lo) continue;
      out.push({ ...l, member: p.id, a: lo - p.x0, b: hi - p.x0, w1: w(lo), w2: w(hi) });
    }
  }
  return out;
}

/** Зусилля частин стрижня → зусилля всього стрижня */
export function mergeMemberParts(r: FrameResult, split: SplitMap) {
  for (const [mid, parts] of split) {
    const fs = parts.map((p) => r.members[p.id]);
    if (fs.some((f) => !f)) continue;
    const mf: MemberForces = { x: [], N: [], Vy: [], Vz: [], T: [], My: [], Mz: [], endI: fs[0].endI, endJ: fs[fs.length - 1].endJ, disp: [] };
    fs.forEach((f, k) => {
      f.x.forEach((x, q) => {
        mf.x.push(parts[k].x0 + x);
        for (const key of ["N", "Vy", "Vz", "T", "My", "Mz"] as const) mf[key].push(f[key][q]);
        mf.disp.push(f.disp[q]);
      });
      delete r.members[parts[k].id];
    });
    r.members[mid] = mf;
  }
}

/** Поділ стрижнів довших за h на рівні частини (до maxSeg) — для P-δ і форм втрати стійкості всередині стрижня */
export function refineFrame(model: FrameModel, cases: LoadCase[], h = 1000, maxSeg = 4) {
  const pos = new Map(model.nodes.map((n) => [n.id, [n.x, n.y, n.z] as Vec3]));
  const nodes: FrameNode[] = [...model.nodes], members: FrameMember[] = [], split: SplitMap = new Map(), extra = new Set<string>();
  const len = new Map<string, number>();
  for (const m of model.members) {
    const pi = pos.get(m.i)!, pj = pos.get(m.j)!, L = Math.hypot(...sub(pj, pi));
    len.set(m.id, L);
    const n = Math.min(maxSeg, Math.ceil(L / h - 0.01));
    if (n <= 1) { members.push(m); continue; }
    const ids = [m.i];
    for (let k = 1; k < n; k++) {
      const id = `${m.id}~${k}`, t = k / n;
      nodes.push({ id, x: pi[0] + (pj[0] - pi[0]) * t, y: pi[1] + (pj[1] - pi[1]) * t, z: pi[2] + (pj[2] - pi[2]) * t });
      extra.add(id); ids.push(id);
    }
    ids.push(m.j);
    const parts: { id: string; x0: number; L: number }[] = [];
    for (let k = 0; k < n; k++) {
      const id = `${m.id}~p${k}`;
      members.push({ ...m, id, i: ids[k], j: ids[k + 1], rel: { i: k === 0 ? m.rel?.i : undefined, j: k === n - 1 ? m.rel?.j : undefined } });
      parts.push({ id, x0: (L * k) / n, L: L / n });
    }
    split.set(m.id, parts);
  }
  const Lof = (id: string) => len.get(id) ?? 0;
  const cs = cases.map((c) => ({ ...c, members: c.members ? splitMemberLoads(c.members, split, Lof) : undefined }));
  const merge = (r: FrameResult) => { mergeMemberParts(r, split); for (const id of extra) { delete r.u[id]; delete r.reactions[id]; } return r; };
  return { model: { ...model, nodes, members }, cases: cs, split, extra, merge };
}

// ---------------------------------------------------------------------------------------------
// Розрахунок за деформованою схемою (P-Δ, P-δ) і пружна стійкість (коефіцієнт α_cr)

/** Поздовжня сила стрижня (розтяг > 0) — середнє по довжині */
const axialOf = (mf: MemberForces) => (mf.N[0] + mf.N[mf.N.length - 1]) / 2;
export const axialForces = (r: FrameResult) => new Map(Object.entries(r.members).map(([id, mf]) => [id, axialOf(mf)]));

export interface SecondOrderResult {
  res: FrameResult; iters: number; converged: boolean;
  /** початкове відхилення від вертикалі φ і напрям (одиничний у плані) еквівалентних горизонтальних сил */
  phi: number; dir: [number, number];
}

/** Деформована схема: K(N)·u = F з ітераціями за N, з еквівалентними горизонтальними силами φ·V від початкового нахилу */
/** Еквівалентні горизонтальні сили від початкового нахилу: H = φ·V у вузлах з вертикальним навантаженням,
 *  у напрямку горизонтального зміщення від цього ж навантаження (first) */
export function imperfectionCases(model: FrameModel, lcs: LoadCase[], phi: number, firsts: FrameResult[], B0?: ReturnType<typeof buildFrame>): { cases: LoadCase[]; dirs: [number, number][] } {
  const B = B0 ?? buildFrame(model);
  const dirs: [number, number][] = [];
  const cases = lcs.map((lc, q) => {
    const F = loadVector(model, B, lc), first = firsts[q];
    let dx = 0, dy = 0;
    model.nodes.forEach((n, k) => { const w = Math.max(0, -F[k * 6 + 2]); const u = first?.u[n.id]; if (u) { dx += w * u[0]; dy += w * u[1]; } });
    const l = Math.hypot(dx, dy), dir: [number, number] = l > 1e-9 ? [dx / l, dy / l] : [1, 0];
    dirs.push(dir);
    const nodal = [...(lc.nodal ?? [])];
    if (phi) model.nodes.forEach((n, k) => {
      const V = -F[k * 6 + 2];
      if (V > 0 && !(n.fix?.ux && n.fix?.uy)) nodal.push({ node: n.id, F: [phi * V * dir[0], phi * V * dir[1], 0, 0, 0, 0] });
    });
    return { ...lc, nodal };
  });
  return { cases, dirs };
}

/** Деформована схема: K(N)·u = F з ітераціями за N, з еквівалентними горизонтальними силами φ·V від початкового нахилу */
export function frameSecondOrder(model0: FrameModel, lc0: LoadCase, opt: { phi?: number; tol?: number; refine?: boolean } = {}): SecondOrderResult {
  const R = opt.refine === false ? null : refineFrame(model0, [lc0]);
  const model = R?.model ?? model0, lc = R?.cases[0] ?? lc0;
  const B = buildFrame(model);
  const first = solveFrame(model, [lc])[lc.id];
  const phi = opt.phi ?? 0;
  const { cases: [lc2], dirs: [dir] } = imperfectionCases(model, [lc], phi, [first], B);
  let N = axialForces(first), res = first, iters = 0, converged = false;
  const tol = opt.tol ?? 2e-3;
  for (; iters < 15; ) {
    iters++;
    try { res = solveFrame(model, [lc2], 41, N)[lc2.id]; }
    catch (e) { if (String((e as Error).message).startsWith("mechanism")) throw new Error("instability"); throw e; }
    const Nn = axialForces(res);
    let d = 0, mx = 1;
    for (const [id, v] of Nn) { d = Math.max(d, Math.abs(v - (N.get(id) ?? 0))); mx = Math.max(mx, Math.abs(v)); }
    N = Nn;
    if (d <= tol * mx) { converged = true; break; }
  }
  return { res: R ? R.merge(res) : res, iters, converged, phi, dir };
}

export interface BucklingMode {
  /** коефіцієнт критичного навантаження: N_cr = α_cr · N */
  alpha: number;
  /** форма (переміщення вузлів), нормована до max |u| = 1 */
  phi: Record<string, number[]>;
  /** форма вздовж стрижнів: точки x (мм від вузла i) і переміщення */
  members: Record<string, { x: number[]; d: Vec3[] }>;
}

/** Пружна стійкість: (K + α·K_σ(N))·φ = 0 — найменші додатні α для кожного набору сил; ітерації в підпросторі.
 *  Оболонки (пластини) дають жорсткість, але не втрачають стійкість самі. */
export function frameBuckling(model0: FrameModel, Ns0: Map<string, number>[], nModes = 1): BucklingMode[][] {
  const Rf = refineFrame(model0, []), model = Rf.model;
  // частини стрижня — з тією ж силою, що й стрижень
  const Ns = Ns0.map((N) => { const M = new Map(N); for (const [mid, parts] of Rf.split) { const v = N.get(mid); if (v !== undefined) for (const p of parts) M.set(p.id, v); } return M; });
  const B = buildFrame(model);
  const { nf, free, nd, eq } = B;
  const mats = model.members.map((m) => {
    const P = B.prep.get(m.id)!, k1 = condenseG(P.kFull, kgLocal(P.L, 1), P.rel), R = P.R;
    // Tᵀ·kg·T — з одиничною силою, масштабується N
    const T = Array.from({ length: 12 }, () => new Array(12).fill(0));
    for (let b = 0; b < 4; b++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) T[b * 3 + r][b * 3 + c] = R[r][c];
    const kT = k1.map((row) => T[0].map((_, c) => row.reduce((s, v, q) => s + v * T[q][c], 0)));
    const G = Array.from({ length: 12 }, (_, r) => Array.from({ length: 12 }, (_, c) => { let s = 0; for (let q = 0; q < 12; q++) s += T[q][r] * kT[q][c]; return s; }));
    return { id: m.id, d: B.dofsOf(m).map((g) => eq[g]), G };
  });
  let warm: Float64Array[] = [];
  return Ns.map((N) => {
    const act = mats.filter((x) => N.get(x.id));
    if (!act.some((x) => (N.get(x.id) ?? 0) < 0)) return [];
    // B·x = −K_σ(N)·x у нумерації рівнянь
    const Bmul = (x: Float64Array) => {
      const y = new Float64Array(nf);
      for (const e of act) {
        const n = -(N.get(e.id) ?? 0);
        for (let a = 0; a < 12; a++) { const ra = e.d[a]; if (ra < 0) continue; let s = 0; for (let b = 0; b < 12; b++) { const rb = e.d[b]; if (rb >= 0) s += e.G[a][b] * x[rb]; } y[ra] += n * s; }
      }
      return y;
    };
    const q = Math.min(nModes, nf), p = Math.min(nf, Math.max(2 * q, q + 6));
    let seed = 777;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) - 0.5;
    // початкові вектори: горизонтальні зміщення X і Y, далі випадкові
    // попереднє сполучення — гарне наближення (схожий розподіл сил), інакше горизонтальні зміщення X, Y і випадкові
    let X: Float64Array[] = warm.length ? warm.map((x) => Float64Array.from(x)) : [];
    if (!X.length) for (let d0 = 0; d0 < 2; d0++) { const v = new Float64Array(nf); free.forEach((g, r) => { if (g % 6 === d0) v[r] = 1; }); X.push(v); }
    while (X.length < p) { const v = new Float64Array(nf); for (let r = 0; r < nf; r++) v[r] = rnd(); X.push(v); }
    let mu: number[] = [];
    for (let it = 0; it < 60; it++) {
      let Y = X.map(Bmul);
      let Xb = Y.map((y) => B.solveEq(y));
      // K-ортонормування: K·Xb = Y
      const kx: Float64Array[] = [], ky: Float64Array[] = [];
      for (let j = 0; j < Xb.length; j++) {
        const x = Xb[j], y = Y[j];
        for (let pass = 0; pass < 2; pass++) for (let k = 0; k < kx.length; k++) {
          let s = 0; for (let r = 0; r < nf; r++) s += kx[k][r] * y[r];
          for (let r = 0; r < nf; r++) { x[r] -= s * kx[k][r]; y[r] -= s * ky[k][r]; }
        }
        let nr = 0; for (let r = 0; r < nf; r++) nr += x[r] * y[r];
        if (!(nr > 1e-30)) continue;
        nr = Math.sqrt(nr);
        for (let r = 0; r < nf; r++) { x[r] /= nr; y[r] /= nr; }
        kx.push(x); ky.push(y);
      }
      Xb = kx; Y = ky;
      const BX = Xb.map(Bmul), n = Xb.length;
      const Br = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => { let s = 0; for (let r = 0; r < nf; r++) s += Xb[a][r] * BX[b][r]; return s; }));
      for (let a = 0; a < n; a++) for (let b = 0; b < a; b++) { const v = (Br[a][b] + Br[b][a]) / 2; Br[a][b] = Br[b][a] = v; }
      const { values, vectors } = jacobiEig(Br);
      const ord = values.map((_, k) => k).sort((a, b) => values[b] - values[a]);
      const muNew = ord.map((k) => values[k]);
      X = ord.map((k) => { const x = new Float64Array(nf); for (let j = 0; j < n; j++) { const c = vectors[j][k]; if (c) for (let r = 0; r < nf; r++) x[r] += c * Xb[j][r]; } return x; });
      while (X.length < p) { const v = new Float64Array(nf); for (let r = 0; r < nf; r++) v[r] = rnd(); X.push(v); }
      const conv = mu.length >= q && muNew.slice(0, q).every((l, k) => Math.abs(l - mu[k]) <= 1e-5 * Math.abs(l) + 1e-14);
      mu = muNew;
      if (conv) break;
    }
    warm = X.slice(0, p);
    const out: BucklingMode[] = [];
    for (let k = 0; k < q && k < mu.length; k++) {
      if (!(mu[k] > 1e-12)) break;
      const full = new Float64Array(nd);
      free.forEach((g, r) => (full[g] = X[k][r]));
      let mx = 0, sg = 1;
      for (let g = 0; g < nd; g++) if (g % 6 < 3 && Math.abs(full[g]) > mx) { mx = Math.abs(full[g]); sg = full[g] < 0 ? -1 : 1; }
      const phi: Record<string, number[]> = {};
      model.nodes.forEach((nn, j) => (phi[nn.id] = Array.from(full.slice(j * 6, j * 6 + 6), (v) => (v * sg) / (mx || 1))));
      // форма вздовж стрижнів — за вузлами частин
      const members: Record<string, { x: number[]; d: Vec3[] }> = {};
      for (const m of model0.members) {
        const parts = Rf.split.get(m.id), ids = parts ? [m.i, ...parts.slice(1).map((_, q) => `${m.id}~${q + 1}`), m.j] : [m.i, m.j];
        const L = parts ? parts.reduce((a, p) => a + p.L, 0) : B.prep.get(m.id)!.L;
        members[m.id] = { x: ids.map((_, q) => (L * q) / (ids.length - 1)), d: ids.map((id) => phi[id].slice(0, 3) as Vec3) };
      }
      for (const id of Rf.extra) delete phi[id];
      out.push({ alpha: 1 / mu[k], phi, members });
    }
    return out;
  });
}
