// Сейсмічні спектри: ДБН В.1.1-12:2014, 6.3 (ф. 6.1–6.3, табл. 6.3–6.7) і EN 1998-1, 3.2.2 (розрахунковий спектр S_d).
// Прискорення — у частках g.

import type { CodeId } from "../codes/types";

export type SoilDBN = "I" | "II" | "III";
export type GroundEN = "A" | "B" | "C" | "D" | "E";

export interface SeismicInput {
  on: boolean;
  /** напрямки дії: X, Y — горизонтальні, Z — вертикальна складова */
  dirs: { x: boolean; y: boolean; z: boolean };
  /** кількість форм (авто-збільшується до 85 % модальної маси) */
  nModes?: number;
  // ---- ДБН В.1.1-12
  /** розрахункова амплітуда прискорення основи a0, g (табл. 6.5) */
  a0?: number;
  /** сейсмічність майданчика, бали (для k1, kгр, перекосів) */
  intensity?: 6 | 7 | 8 | 9;
  soil?: SoilDBN;
  /** враховувати kгр за табл. 6.6 (сейсмічність визначена за інженерно-геологічними вишукуваннями) */
  kgr?: boolean;
  k1?: number; k2?: number;
  /** кількість поверхів — k3 = 1 + 0.04·(n − 5) ≤ 1.6 (ф. 6.2) */
  storeys?: number;
  /** рівень впливу для перекосів (табл. 6.8): слабкий, проектний, максимальний */
  level?: "SZ" | "PZ" | "MRZ";
  // ---- EN 1998-1
  /** референтне пікове прискорення a_gR, g; коефіцієнт важливості γ_I */
  agR?: number; gammaI?: number;
  ground?: GroundEN;
  spectrum?: 1 | 2;
  /** коефіцієнт поведінки q; нижня межа β */
  q?: number; beta?: number;
  /** коефіцієнти сполучення / маси для загружень (id → c); за замовчуванням — за категорією */
  coef?: Record<string, number>;
}

/** Табл. 6.7: спектральний коефіцієнт динамічності β(T), 0.8 ≤ β ≤ 2.5 */
export function betaDBN(T: number, soil: SoilDBN): number {
  const Tc = soil === "I" ? 0.4 : soil === "II" ? 0.6 : 1.2;
  let b: number;
  if (T <= 0.1) b = 1 + 15 * T;
  else if (T <= Tc) b = 2.5;
  else b = soil === "I" ? 1.35 / T ** (2 / 3) : soil === "II" ? 1.8 / T ** (2 / 3) : 3 / T;
  return Math.min(2.5, Math.max(0.8, b));
}

/** Табл. 6.6: kгр */
export function kgrDBN(soil: SoilDBN, I: number): number {
  const row = soil === "I" ? [1, 1.2, 1.3, 1.4] : soil === "II" ? [1, 1, 1, 1] : [1, 0.8, 0.75, 0.7];
  return row[Math.min(3, Math.max(0, I - 6))];
}

/** Табл. 6.5: a0 за інтенсивністю на картах А і В */
export const A0_TABLE: { A: number; B: number; a0: number }[] = [
  { A: 6, B: 6, a0: 0.05 }, { A: 6, B: 7, a0: 0.08 }, { A: 7, B: 7, a0: 0.1 }, { A: 7, B: 8, a0: 0.15 },
  { A: 8, B: 8, a0: 0.2 }, { A: 8, B: 9, a0: 0.3 }, { A: 9, B: 9, a0: 0.4 },
];

/** Табл. 6.3 (вибрані рядки): k1 за сейсмічністю 6 / 7–8 / 9 */
export const K1_TABLE: Record<string, [number, number, number]> = {
  elastic: [1, 1, 1], steelFrame: [0.25, 0.25, 0.3], rcFrame: [0.25, 0.35, 0.45], rcFrameWalls: [0.25, 0.3, 0.4], local: [0.4, 0.5, 0.55], heavyDamage: [0.2, 0.2, 0.3],
};
export const k1Of = (kind: string, I: number) => { const r = K1_TABLE[kind] ?? K1_TABLE.steelFrame; return I <= 6 ? r[0] : I >= 9 ? r[2] : r[1]; };

/** Табл. 6.9: кореляція сусідніх форм за відношенням періодів T_{i+1}/T_i */
export function rhoDBN(r: number): number {
  const t: [number, number][] = [[0.9, 0.5], [0.93, 0.7], [0.95, 0.8], [0.97, 0.9], [1, 1]];
  if (r < 0.9) return 0;
  for (let k = 1; k < t.length; k++) if (r <= t[k][0]) return t[k - 1][1] + ((t[k][1] - t[k - 1][1]) * (r - t[k - 1][0])) / (t[k][0] - t[k - 1][0]);
  return 1;
}

/** EN 1998-1, табл. 3.2 / 3.3: S, T_B, T_C, T_D */
const EN_PAR: Record<1 | 2, Record<GroundEN, [number, number, number, number]>> = {
  1: { A: [1, 0.15, 0.4, 2], B: [1.2, 0.15, 0.5, 2], C: [1.15, 0.2, 0.6, 2], D: [1.35, 0.2, 0.8, 2], E: [1.4, 0.15, 0.5, 2] },
  2: { A: [1, 0.05, 0.25, 1.2], B: [1.35, 0.05, 0.25, 1.2], C: [1.5, 0.1, 0.25, 1.2], D: [1.8, 0.1, 0.3, 1.2], E: [1.6, 0.05, 0.25, 1.2] },
};

/** EN 1998-1, 3.2.2.5 (3.13)–(3.16): S_d(T)/g; вертикальна — 3.2.2.3 (табл. 3.4), q ≤ 1.5 */
export function sdEN(T: number, s: SeismicInput, vertical = false): number {
  const type = s.spectrum ?? 1, ag = (s.agR ?? 0.1) * (s.gammaI ?? 1), b = s.beta ?? 0.2;
  let S: number, TB: number, TC: number, TD: number, a: number, q: number, eta: number;
  if (vertical) {
    S = 1; [TB, TC, TD] = type === 1 ? [0.05, 0.15, 1] : [0.05, 0.15, 1]; a = (type === 1 ? 0.9 : 0.45) * ag; q = Math.min(1.5, s.q ?? 1.5); eta = 3;
  } else {
    [S, TB, TC, TD] = EN_PAR[type][s.ground ?? "B"]; a = ag; q = s.q ?? 1.5; eta = 2.5;
  }
  if (T <= TB) return a * S * (2 / 3 + (T / TB) * (eta / q - 2 / 3));
  if (T <= TC) return (a * S * eta) / q;
  if (T <= TD) return Math.max((a * S * eta * TC) / (q * T), b * a);
  return Math.max((a * S * eta * TC * TD) / (q * T * T), b * a);
}

/** CQC, EN 1998-1, 4.3.3.3.2: кореляція форм при ζ = 5 % */
export function rhoCQC(Ti: number, Tj: number, z = 0.05): number {
  const r = Ti / Tj;
  return (8 * z * z * (1 + r) * r ** 1.5) / ((1 - r * r) ** 2 + 4 * z * z * r * (1 + r) ** 2);
}

/** Прискорення для форми з періодом T (частки g) з усіма коефіцієнтами: ДБН — k1·k2·k3·a0·kгр·β(T); EN — S_d(T) */
export function seisSa(code: CodeId, s: SeismicInput, T: number, vertical: boolean): number {
  if (code === "EN") return sdEN(T, s, vertical);
  const I = s.intensity ?? 7, soil = s.soil ?? "II";
  const k1 = vertical ? 0.5 : s.k1 ?? k1Of("steelFrame", I), k2 = s.k2 ?? 1;
  const n = s.storeys ?? 1, k3 = n > 5 ? Math.min(1.6, 1 + 0.04 * (n - 5)) : 1;
  const a0 = (s.a0 ?? 0.1) * (vertical ? 0.7 : 1), kg = s.kgr ? kgrDBN(soil, I) : 1;
  return k1 * k2 * k3 * a0 * kg * betaDBN(T, soil);
}

/** Допустимий перекіс поверху: ДБН табл. 6.8 (сталевий каркас), EN 4.4.3.2 (d_r·ν ≤ 0.0075·h, ν = 0.5) */
export function driftLimit(code: CodeId, s: SeismicInput): number {
  if (code === "EN") return 0.0075 / 0.5;
  return s.level === "SZ" ? 0.0067 : s.level === "MRZ" ? 0.02 : 0.012;
}
