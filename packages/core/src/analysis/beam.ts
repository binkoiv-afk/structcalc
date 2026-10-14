// Неразрезная балка (теория Эйлера–Бернулли), метод конечных элементов.
// Единицы: Н, мм. Нагрузки вниз — положительные. Изгибающий момент:
// «+» — растянуты нижние волокна. Прогиб: «+» — вниз.

export type SupportType = "pin" | "fixed" | "free";

export type BeamLoad =
  | { type: "udl"; q: number; from?: number; to?: number }
  | { type: "point"; P: number; x: number }
  | { type: "moment"; M: number; x: number };

export interface BeamModel {
  /** длины пролетов, мм (консоль — тоже пролет со свободным концом) */
  spans: number[];
  /** опоры в узлах между пролетами: spans.length + 1 */
  supports: SupportType[];
  EI: number;
  loads: BeamLoad[];
}

export interface BeamResult {
  x: number[];
  M: number[];
  V: number[];
  /** прогиб, мм, «+» вниз */
  w: number[];
  reactions: { x: number; R: number; M: number }[];
  Mmax: number;
  Mmin: number;
  Vabs: number;
  /** по пролетам: максимальный прогиб и расчетная длина для предела (для консоли 2L) */
  spanDeflections: { span: number; L: number; Lref: number; w: number; x: number }[];
}

/** Решение СЛАУ с ленточной симметричной положительно определенной матрицей
 *  (полуширина ленты bw) методом Гаусса без выбора ведущего элемента. */
function solveBanded(A: number[][], b: number[], bw = 4): number[] {
  const n = b.length;
  const M = A.map((r) => [...r]);
  const y = [...b];
  for (let c = 0; c < n; c++) {
    if (Math.abs(M[c][c]) < 1e-9 * (Math.abs(A[c][c]) + 1)) throw new Error("Система геометрически изменяема (недостаточно опор)");
    const rmax = Math.min(n - 1, c + bw);
    for (let r = c + 1; r <= rmax; r++) {
      const fct = M[r][c] / M[c][c];
      if (fct === 0) continue;
      for (let k = c; k <= rmax; k++) M[r][k] -= fct * M[c][k];
      y[r] -= fct * y[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = y[r];
    for (let k = r + 1; k <= Math.min(n - 1, r + bw); k++) sum -= M[r][k] * x[k];
    x[r] = sum / M[r][r];
  }
  return x;
}

export function analyzeBeam(model: BeamModel, divisions = 240): BeamResult {
  const { spans, supports, EI, loads } = model;
  if (supports.length !== spans.length + 1) throw new Error("supports.length must be spans.length + 1");
  const supportX: number[] = [0];
  for (const L of spans) supportX.push(supportX[supportX.length - 1] + L);
  const Ltot = supportX[supportX.length - 1];

  // ключевые точки сетки
  const keys = new Set<number>(supportX);
  for (const l of loads) {
    if (l.type === "udl") { keys.add(clamp(l.from ?? 0, 0, Ltot)); keys.add(clamp(l.to ?? Ltot, 0, Ltot)); }
    else keys.add(clamp(l.x, 0, Ltot));
  }
  const sorted = [...keys].sort((a, b) => a - b);
  const h = Ltot / divisions;
  const xs: number[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i];
    if (b - a < 1e-9) continue;
    const n = Math.max(1, Math.ceil((b - a) / h));
    for (let k = 1; k <= n; k++) xs.push(a + ((b - a) * k) / n);
  }
  const nn = xs.length, nd = 2 * nn;
  const K = Array.from({ length: nd }, () => new Array(nd).fill(0));
  const F = new Array(nd).fill(0);
  const elemQ: number[] = [];
  const idx = (x: number) => xs.findIndex((v) => Math.abs(v - x) < 1e-6);

  for (let e = 0; e < nn - 1; e++) {
    const L = xs[e + 1] - xs[e];
    const xm = (xs[e] + xs[e + 1]) / 2;
    let q = 0;
    for (const l of loads) if (l.type === "udl" && xm >= (l.from ?? 0) && xm <= (l.to ?? Ltot)) q += l.q;
    elemQ.push(q);
    const k = elemK(EI, L);
    const d = [2 * e, 2 * e + 1, 2 * e + 2, 2 * e + 3];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) K[d[i]][d[j]] += k[i][j];
    const fe = elemF(q, L);
    for (let i = 0; i < 4; i++) F[d[i]] += fe[i];
  }
  for (const l of loads) {
    if (l.type === "point") F[2 * idx(clamp(l.x, 0, Ltot))] += -l.P;
    if (l.type === "moment") F[2 * idx(clamp(l.x, 0, Ltot)) + 1] += l.M;
  }
  const fixed = new Set<number>();
  supports.forEach((s, i) => {
    const n = idx(supportX[i]);
    if (s === "pin" || s === "fixed") fixed.add(2 * n);
    if (s === "fixed") fixed.add(2 * n + 1);
  });
  const free = [...Array(nd).keys()].filter((d) => !fixed.has(d));
  const Kff = free.map((i) => free.map((j) => K[i][j]));
  const uf = solveBanded(Kff, free.map((i) => F[i]));
  const u = new Array(nd).fill(0);
  free.forEach((d, k) => (u[d] = uf[k]));

  const reactions = supports.map((s, i) => {
    const n = idx(supportX[i]);
    const r = (d: number) => K[d].reduce((acc, kij, j) => acc + kij * u[j], 0) - F[d];
    return { x: supportX[i], R: s === "free" ? 0 : r(2 * n), M: s === "fixed" ? r(2 * n + 1) : 0 };
  });

  const X: number[] = [], M: number[] = [], V: number[] = [], W: number[] = [];
  for (let e = 0; e < nn - 1; e++) {
    const L = xs[e + 1] - xs[e];
    const ue = [u[2 * e], u[2 * e + 1], u[2 * e + 2], u[2 * e + 3]];
    const k = elemK(EI, L), fe = elemF(elemQ[e], L);
    const f = k.map((row, i) => row.reduce((a, kij, j) => a + kij * ue[j], 0) - fe[i]);
    const M1 = -f[1], M2 = f[3], V1 = f[0], V2 = -f[2];
    const q = elemQ[e];
    const Mmid = (M1 + M2) / 2 + (q * L * L) / 8;
    const wmid = -(0.5 * ue[0] + (L / 8) * ue[1] + 0.5 * ue[2] - (L / 8) * ue[3]);
    X.push(xs[e], xs[e] + L / 2, xs[e + 1]);
    M.push(M1, Mmid, M2);
    V.push(V1, (V1 + V2) / 2, V2);
    W.push(-ue[0], wmid, -ue[2]);
  }

  const spanDeflections = spans.map((L, i) => {
    const a = supportX[i], b = supportX[i + 1];
    let w = 0, xw = a;
    X.forEach((x, k) => { if (x >= a - 1e-6 && x <= b + 1e-6 && Math.abs(W[k]) > Math.abs(w)) { w = W[k]; xw = x; } });
    // для консоли — прогиб относительно опоры, для пролета — относительно хорды опор
    const isCant = supports[i] === "free" || supports[i + 1] === "free";
    if (!isCant) {
      let best = 0;
      const wa = W[X.findIndex((x) => Math.abs(x - a) < 1e-6)] ?? 0;
      const wb = W[X.findIndex((x) => Math.abs(x - b) < 1e-6)] ?? 0;
      X.forEach((x, k) => {
        if (x >= a - 1e-6 && x <= b + 1e-6) {
          const rel = W[k] - (wa + ((wb - wa) * (x - a)) / L);
          if (Math.abs(rel) > Math.abs(best)) { best = rel; xw = x; }
        }
      });
      w = best;
    }
    return { span: i, L, Lref: isCant ? 2 * L : L, w, x: xw };
  });

  return {
    x: X, M, V, w: W, reactions,
    Mmax: Math.max(...M), Mmin: Math.min(...M), Vabs: Math.max(...V.map(Math.abs)),
    spanDeflections,
  };
}

function elemK(EI: number, L: number): number[][] {
  const c = EI / L ** 3, L2 = L * L;
  return [
    [12 * c, 6 * L * c, -12 * c, 6 * L * c],
    [6 * L * c, 4 * L2 * c, -6 * L * c, 2 * L2 * c],
    [-12 * c, -6 * L * c, 12 * c, -6 * L * c],
    [6 * L * c, 2 * L2 * c, -6 * L * c, 4 * L2 * c],
  ];
}

function elemF(q: number, L: number): number[] {
  // q вниз → эквивалентные узловые силы вниз
  return [(-q * L) / 2, (-q * L * L) / 12, (-q * L) / 2, (q * L * L) / 12];
}

function clamp(v: number, a: number, b: number) {
  return Math.min(b, Math.max(a, v));
}
