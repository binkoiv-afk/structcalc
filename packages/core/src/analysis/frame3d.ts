// Просторова стрижнева система (МСЕ, лінійна статика, 6 ступенів вільності у вузлі).
// Елемент — стрижень Ейлера–Бернуллі; шарніри на кінцях — статичною конденсацією.
// Одиниці: Н, мм, МПа. Глобальна вісь Z — вгору.
// Локальні осі стрижня: x — від вузла i до j; z — «вгору» (проєкція глобальної Z, для вертикальних — глобальної X),
// y = z × x; кут β повертає y, z навколо x. I_y — момент інерції відносно локальної y (згин у площині xz, сильна вісь).
// Внутрішні зусилля в перерізі: N > 0 — розтяг; M_y > 0 — розтягнуті волокна +z; M_z > 0 — розтягнуті волокна −y.

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
  /** власна вага стрижнів з коефіцієнтом (1 — повна) */
  selfWeight?: number;
}

export interface FrameModel { nodes: FrameNode[]; members: FrameMember[] }

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

export function solveFrame(model: FrameModel, cases: LoadCase[], stations = 41): Record<string, FrameResult> {
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
    const { k } = condense(kFull, new Array(12).fill(0), rel);
    prep.set(m.id, { L, R, k, rel, kFull });
  }
  // глобальна матриця
  const K = Array.from({ length: nd }, () => new Float64Array(nd));
  const T12 = (R: [Vec3, Vec3, Vec3]) => {
    const T = Array.from({ length: 12 }, () => new Array(12).fill(0));
    for (let b = 0; b < 4; b++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) T[b * 3 + r][b * 3 + c] = R[r][c];
    return T;
  };
  const dofsOf = (m: FrameMember) => { const a = idx.get(m.i)! * 6, b = idx.get(m.j)! * 6; return [0, 1, 2, 3, 4, 5].map((q) => a + q).concat([0, 1, 2, 3, 4, 5].map((q) => b + q)); };
  for (const m of model.members) {
    const P = prep.get(m.id)!, T = T12(P.R), d = dofsOf(m);
    // Kg = Tᵀ k T
    const kT = P.k.map((row) => T[0].map((_, c) => row.reduce((s, v, q) => s + v * T[q][c], 0)));
    for (let r = 0; r < 12; r++) for (let c = 0; c < 12; c++) {
      let s = 0;
      for (let q = 0; q < 12; q++) s += T[q][r] * kT[q][c];
      K[d[r]][d[c]] += s;
    }
  }
  // закріплення і пружини
  const fixed = new Array(nd).fill(false);
  model.nodes.forEach((n, k) => DOFS.forEach((dn, q) => {
    const v = n.fix?.[dn];
    if (v === true) fixed[k * 6 + q] = true;
    else if (typeof v === "number" && v > 0) K[k * 6 + q][k * 6 + q] += v;
  }));
  // повороти вузлів, де всі стрижні шарнірні, — крихітна пружина, щоб матриця не була виродженою
  let kmax = 0;
  for (let q = 0; q < nd; q++) kmax = Math.max(kmax, K[q][q]);
  const diag0 = Array.from({ length: nd }, (_, q) => K[q][q]);
  for (let k = 0; k < model.nodes.length; k++) for (let q = 3; q < 6; q++) K[k * 6 + q][k * 6 + q] += kmax * 1e-12 + 1e-6;
  const free = [...Array(nd).keys()].filter((q) => !fixed[q]);
  const nf = free.length;
  // Холецький для вільних ступенів
  const Lm = Array.from({ length: nf }, () => new Float64Array(nf));
  for (let r = 0; r < nf; r++) {
    for (let c = 0; c <= r; c++) {
      let s = K[free[r]][free[c]];
      for (let q = 0; q < c; q++) s -= Lm[r][q] * Lm[c][q];
      if (r === c) {
        const ref = Math.max(diag0[free[r]], kmax * 1e-12);
        if (s <= ref * 1e-9 && free[r] % 6 < 3) {
          const n = model.nodes[Math.floor(free[r] / 6)];
          throw new Error(`mechanism:${n.id}:${DOFS[free[r] % 6]}`);
        }
        Lm[r][r] = Math.sqrt(Math.max(s, 1e-30));
      } else Lm[r][c] = s / Lm[c][c];
    }
  }
  const solveVec = (F: Float64Array) => {
    const y = new Float64Array(nf);
    for (let r = 0; r < nf; r++) { let s = F[free[r]]; for (let q = 0; q < r; q++) s -= Lm[r][q] * y[q]; y[r] = s / Lm[r][r]; }
    const x = new Float64Array(nf);
    for (let r = nf - 1; r >= 0; r--) { let s = y[r]; for (let q = r + 1; q < nf; q++) s -= Lm[q][r] * x[q]; x[r] = s / Lm[r][r]; }
    return x;
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
  for (const m of Object.keys(first.members)) {
    const f0 = first.members[m];
    // станції можуть відрізнятися між загруженнями (точкові сили) — зводимо до спільних станцій інтерполяцією
    const X = [...new Set(ids.flatMap((k) => res[k].members[m].x).concat(f0.x))].sort((a, b) => a - b);
    const at = (mf: MemberForces, key: "N" | "Vy" | "Vz" | "T" | "My" | "Mz", x: number) => interp(mf.x, mf[key], x);
    const keys = ["N", "Vy", "Vz", "T", "My", "Mz"] as const;
    const mf: MemberForces = { x: X, N: [], Vy: [], Vz: [], T: [], My: [], Mz: [], endI: lin((r) => r.members[m].endI), endJ: lin((r) => r.members[m].endJ), disp: [] };
    for (const key of keys) mf[key] = X.map((x) => ids.reduce((s, k) => s + factors[k] * at(res[k].members[m], key, x), 0));
    mf.disp = X.map((x) => [0, 1, 2].map((c) => ids.reduce((s, k) => {
      const r = res[k].members[m];
      return s + factors[k] * interp(r.x, r.disp.map((d) => d[c]), x);
    }, 0)) as Vec3);
    out.members[m] = mf;
  }
  return out;
}

function interp(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) {
    const d = xs[i] - xs[i - 1];
    return d < 1e-9 ? ys[i] : ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / d;
  }
  return ys[ys.length - 1];
}
