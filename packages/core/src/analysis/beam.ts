// Неразрезная балка (теория Эйлера–Бернулли), метод конечных элементов.
// Единицы: Н, мм. Нагрузки вниз — положительные. Изгибающий момент:
// «+» — растянуты нижние волокна. Прогиб: «+» — вниз.

/** pin — шарнирно-неподвижная/подвижная; fixed — заделка; free — свободный конец;
 *  slide — скользящая заделка (поворот запрещен, перемещение свободно); spring — упругая опора (жесткость k). */
export type SupportType = "pin" | "fixed" | "free" | "slide" | "spring";

export type BeamLoad =
  /** распределенная: q — в начале участка, q2 — в конце (трапеция/треугольник); без q2 — равномерная */
  | { type: "udl"; q: number; q2?: number; from?: number; to?: number }
  | { type: "point"; P: number; x: number }
  | { type: "moment"; M: number; x: number };

export interface BeamModel {
  /** длины пролетов, мм (консоль — тоже пролет со свободным концом) */
  spans: number[];
  /** опоры в узлах между пролетами: spans.length + 1 */
  supports: SupportType[];
  EI: number;
  loads: BeamLoad[];
  /** жесткость упругих опор, Н/мм (по индексу опоры) */
  springs?: number[];
  /** дополнительные узлы сетки, мм — чтобы результаты разных загружений совпадали по сетке (суперпозиция) */
  extraKeys?: number[];
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

const BW = 3; // полуширина ленты: у балочного элемента 4 соседние степени свободы

/** Ленточная матрица: row[i][j − i + BW] для |j − i| ≤ BW. */
class Band {
  rows: Float64Array[];
  constructor(public n: number) { this.rows = Array.from({ length: n }, () => new Float64Array(2 * BW + 1)); }
  add(i: number, j: number, v: number) { this.rows[i][j - i + BW] += v; }
  get(i: number, j: number) { return Math.abs(j - i) > BW ? 0 : this.rows[i][j - i + BW]; }
  mulRow(i: number, u: ArrayLike<number>) {
    let s = 0;
    for (let j = Math.max(0, i - BW); j <= Math.min(this.n - 1, i + BW); j++) s += this.rows[i][j - i + BW] * u[j];
    return s;
  }
}

/** Решение ленточной СЛАУ методом Гаусса без выбора ведущего элемента (матрица положительно определена). */
function solveBanded(A: Band, b: number[]): number[] {
  const n = b.length;
  const M = A.rows.map((r) => Float64Array.from(r));
  const at = (i: number, j: number) => M[i][j - i + BW];
  const y = [...b];
  const diag0 = A.rows.map((r) => Math.abs(r[BW]));
  for (let c = 0; c < n; c++) {
    if (Math.abs(at(c, c)) < 1e-9 * (diag0[c] + 1)) throw new Error("Система геометрически изменяема (недостаточно опор)");
    const rmax = Math.min(n - 1, c + BW);
    for (let r = c + 1; r <= rmax; r++) {
      const fct = at(r, c) / at(c, c);
      if (fct === 0) continue;
      for (let k = c; k <= Math.min(n - 1, c + BW); k++) M[r][k - r + BW] -= fct * at(c, k);
      y[r] -= fct * y[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = y[r];
    for (let k = r + 1; k <= Math.min(n - 1, r + BW); k++) sum -= at(r, k) * x[k];
    x[r] = sum / at(r, r);
  }
  return x;
}

export function analyzeBeam(model: BeamModel, divisions = 240): BeamResult {
  const { spans, supports, EI, loads } = model;
  const qAt = (l: Extract<BeamLoad, { type: "udl" }>, x: number, Ltot: number) => {
    const a = l.from ?? 0, b = l.to ?? Ltot;
    if (x < a - 1e-9 || x > b + 1e-9) return 0;
    if (l.q2 == null || b - a < 1e-9) return l.q;
    return l.q + ((l.q2 - l.q) * (x - a)) / (b - a);
  };
  if (supports.length !== spans.length + 1) throw new Error("supports.length must be spans.length + 1");
  const supportX: number[] = [0];
  for (const L of spans) supportX.push(supportX[supportX.length - 1] + L);
  const Ltot = supportX[supportX.length - 1];

  // ключевые точки сетки
  const keys = new Set<number>(supportX);
  for (const k of model.extraKeys ?? []) keys.add(clamp(k, 0, Ltot));
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
  const K = new Band(nd);
  const F = new Array(nd).fill(0);
  const elemQ: [number, number][] = [];
  const idx = (x: number) => xs.findIndex((v) => Math.abs(v - x) < 1e-6);

  for (let e = 0; e < nn - 1; e++) {
    const L = xs[e + 1] - xs[e];
    // интенсивность на концах элемента (сетка содержит границы всех участков нагрузки)
    const xa = xs[e] + 1e-7 * L, xb = xs[e + 1] - 1e-7 * L;
    let qa = 0, qb = 0;
    for (const l of loads) if (l.type === "udl") { qa += qAt(l, xa, Ltot); qb += qAt(l, xb, Ltot); }
    elemQ.push([qa, qb]);
    const k = elemK(EI, L);
    const d = [2 * e, 2 * e + 1, 2 * e + 2, 2 * e + 3];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) K.add(d[i], d[j], k[i][j]);
    const fe = elemF(qa, qb, L);
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
    if (s === "fixed" || s === "slide") fixed.add(2 * n + 1);
    if (s === "spring") K.add(2 * n, 2 * n, model.springs?.[i] ?? 0);
  });
  const free = [...Array(nd).keys()].filter((d) => !fixed.has(d));
  // исключение закрепленных степеней свободы сохраняет порядок, поэтому лента не расширяется
  const Kff = new Band(free.length);
  free.forEach((gi, a) => {
    for (let b = Math.max(0, a - BW); b <= Math.min(free.length - 1, a + BW); b++) {
      const v = K.get(gi, free[b]);
      if (v) Kff.add(a, b, v);
    }
  });
  const uf = solveBanded(Kff, free.map((i) => F[i]));
  const u = new Array(nd).fill(0);
  free.forEach((d, k) => (u[d] = uf[k]));

  const reactions = supports.map((s, i) => {
    const n = idx(supportX[i]);
    const r = (d: number) => K.mulRow(d, u) - F[d];
    const R = s === "free" || s === "slide" ? 0 : s === "spring" ? -(model.springs?.[i] ?? 0) * u[2 * n] : r(2 * n);
    return { x: supportX[i], R, M: s === "fixed" || s === "slide" ? r(2 * n + 1) : 0 };
  });

  const X: number[] = [], M: number[] = [], V: number[] = [], W: number[] = [];
  for (let e = 0; e < nn - 1; e++) {
    const L = xs[e + 1] - xs[e];
    const ue = [u[2 * e], u[2 * e + 1], u[2 * e + 2], u[2 * e + 3]];
    const [qa, qb] = elemQ[e];
    const k = elemK(EI, L), fe = elemF(qa, qb, L);
    const f = k.map((row, i) => row.reduce((a, kij, j) => a + kij * ue[j], 0) - fe[i]);
    const M1 = -f[1], M2 = f[3], V1 = f[0], V2 = -f[2];
    const Mmid = (M1 + M2) / 2 + ((qa + qb) * L * L) / 16;
    const wmid = -(0.5 * ue[0] + (L / 8) * ue[1] + 0.5 * ue[2] - (L / 8) * ue[3]);
    X.push(xs[e], xs[e] + L / 2, xs[e + 1]);
    M.push(M1, Mmid, M2);
    V.push(V1, V1 - ((3 * qa + qb) * L) / 8, V2);
    W.push(-ue[0], wmid, -ue[2]);
  }

  const spanDeflections = spanDeflectionsOf(X, W, spans, supports);

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

function elemF(qa: number, qb: number, L: number): number[] {
  // линейная нагрузка qa → qb (вниз) → согласованные узловые силы: равномерная qa + треугольная (qb − qa)
  const p = qb - qa;
  return [
    -(qa * L) / 2 - (3 * p * L) / 20,
    -(qa * L * L) / 12 - (p * L * L) / 30,
    -(qa * L) / 2 - (7 * p * L) / 20,
    (qa * L * L) / 12 + (p * L * L) / 20,
  ];
}

function clamp(v: number, a: number, b: number) {
  return Math.min(b, Math.max(a, v));
}

/** Прогибы по пролетам: для пролета — относительно хорды опор, для консоли — абсолютный, Lref = 2L. */
export function spanDeflectionsOf(X: number[], W: number[], spans: number[], supports: SupportType[]) {
  const supportX: number[] = [0];
  for (const L of spans) supportX.push(supportX[supportX.length - 1] + L);
  return spans.map((L, i) => {
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
}

/** Суперпозиция результатов, посчитанных на одной сетке: Σ f_i · R_i. */
export function combineResults(parts: BeamResult[], f: number[], spans: number[], supports: SupportType[]): BeamResult {
  const base = parts[0];
  const n = base.x.length;
  const M = new Array(n).fill(0), V = new Array(n).fill(0), W = new Array(n).fill(0);
  const reactions = base.reactions.map((r) => ({ x: r.x, R: 0, M: 0 }));
  parts.forEach((p, i) => {
    const k = f[i];
    if (!k) return;
    for (let j = 0; j < n; j++) { M[j] += k * p.M[j]; V[j] += k * p.V[j]; W[j] += k * p.w[j]; }
    p.reactions.forEach((r, j) => { reactions[j].R += k * r.R; reactions[j].M += k * r.M; });
  });
  return {
    x: base.x, M, V, w: W, reactions,
    Mmax: Math.max(...M), Mmin: Math.min(...M), Vabs: Math.max(...V.map(Math.abs)),
    spanDeflections: spanDeflectionsOf(base.x, W, spans, supports),
  };
}
