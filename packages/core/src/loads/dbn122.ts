// Снігові та вітрові навантаження за ДБН В.1.2-2:2006 (зі Змінами № 1, 2).
// Тиски в Па; погонні навантаження на балку — в кН/м.

/** лінійна інтерполяція за таблицею [x, y], за межами — крайні значення */
export function interpTable(tab: [number, number][], x: number): number {
  if (x <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) {
    const [x1, y1] = tab[i];
    if (x <= x1) {
      const [x0, y0] = tab[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return tab[tab.length - 1][1];
}

/** табл. 8.1: γfm снігу від середнього періоду повторюваності T, років */
const SNOW_GFM: [number, number][] = [[1, 0.24], [5, 0.55], [10, 0.69], [20, 0.83], [40, 0.96], [50, 1.0], [60, 1.04], [80, 1.1], [100, 1.14], [150, 1.22], [200, 1.26], [300, 1.34], [500, 1.44]];
/** табл. 8.3: γfe снігу від частки часу η */
const SNOW_GFE: [number, number][] = [[0.002, 0.88], [0.005, 0.74], [0.01, 0.62], [0.02, 0.49], [0.03, 0.4], [0.04, 0.34], [0.05, 0.28], [0.1, 0.1]];
/** табл. 9.1: γfm вітру */
const WIND_GFM: [number, number][] = [[5, 0.55], [10, 0.69], [15, 0.77], [25, 0.87], [40, 0.96], [50, 1.0], [70, 1.07], [100, 1.14], [150, 1.22], [200, 1.28], [300, 1.35], [500, 1.45]];
/** табл. 9.3: γfe вітру */
const WIND_GFE: [number, number][] = [[0.002, 0.42], [0.005, 0.33], [0.01, 0.27], [0.02, 0.21], [0.03, 0.18], [0.04, 0.16], [0.05, 0.14], [0.1, 0.09]];

export const snowGammaFm = (T: number) => interpTable(SNOW_GFM, T);
export const snowGammaFe = (eta: number) => interpTable(SNOW_GFE, eta);
export const windGammaFm = (T: number) => interpTable(WIND_GFM, T);
export const windGammaFe = (eta: number) => interpTable(WIND_GFE, eta);

/** Додаток В: приблизні терміни експлуатації Tef, років */
export const TEF_PRESETS: { key: string; Tef: number }[] = [
  { key: "residential", Tef: 100 },
  { key: "industrial", Tef: 60 },
  { key: "storage", Tef: 60 },
  { key: "agricultural", Tef: 50 },
  { key: "mobile", Tef: 20 },
  { key: "towers", Tef: 40 },
];

/** Схема 1 додатка Ж (варіант 1): μ = 1 при α ≤ 25°, 0 при α ≥ 60°, між ними — лінійно */
export function snowMuPitched(alphaDeg: number): number {
  if (alphaDeg <= 25) return 1;
  if (alphaDeg >= 60) return 0;
  return (60 - alphaDeg) / 35;
}

export interface SnowInputDBN {
  S0: number; // Па
  alpha: number; // ухил покрівлі, град
  /** схема 1, варіант 2 (двосхилі 20°…30°): навітряний схил 0.75μ, підвітряний 1.25μ — береться 1.25μ */
  uneven?: boolean;
  /** μ задано вручну (інші схеми додатка Ж) */
  muManual?: number;
  Ce?: number; // 8.9
  H?: number; // висота над рівнем моря, км
  T: number; // середній період повторюваності, років
  eta?: number; // частка часу, 8.12
}

export interface SnowResultDBN {
  mu: number; Ce: number; Calt: number; C: number; gfm: number; gfe: number;
  S0: number; Sm: number; Se: number;
}

export function snowDBN(i: SnowInputDBN): SnowResultDBN {
  let mu = i.muManual ?? snowMuPitched(i.alpha);
  if (i.muManual == null && i.uneven && i.alpha >= 20 && i.alpha <= 30) mu *= 1.25;
  const Ce = i.Ce ?? 1;
  const H = i.H ?? 0;
  const Calt = H >= 0.5 ? 1.4 * H + 0.3 : 1; // (8.5)
  const C = mu * Ce * Calt; // (8.4)
  const gfm = snowGammaFm(i.T), gfe = snowGammaFe(i.eta ?? 0.02);
  return { mu, Ce, Calt, C, gfm, gfe, S0: i.S0, Sm: gfm * i.S0 * C, Se: gfe * i.S0 * C };
}

export type TerrainDBN = "I" | "II" | "III" | "IV";
const CH_Z = [5, 10, 20, 40, 60, 80, 100, 150, 200];
/** табл. 9.01 — споруди з періодом власних коливань T ≤ 0.25 с */
const CH_901: Record<TerrainDBN, number[]> = {
  I: [0.9, 1.2, 1.35, 1.6, 1.75, 1.9, 1.95, 2.15, 2.3],
  II: [0.7, 0.9, 1.15, 1.45, 1.65, 1.75, 1.85, 2.1, 2.2],
  III: [0.4, 0.6, 0.85, 1.15, 1.35, 1.5, 1.6, 1.85, 2.05],
  IV: [0.2, 0.4, 0.65, 1.0, 1.1, 1.2, 1.25, 1.35, 1.45],
};
/** табл. 9.02 — інші будівлі та споруди */
const CH_902: Record<TerrainDBN, number[]> = {
  I: [1.4, 1.8, 1.95, 2.25, 2.45, 2.65, 2.7, 2.95, 3.1],
  II: [1.2, 1.5, 1.85, 2.2, 2.45, 2.6, 2.7, 3.0, 3.15],
  III: [0.9, 1.2, 1.55, 2.0, 2.25, 2.45, 2.6, 2.9, 3.2],
  IV: [0.6, 1.0, 1.4, 1.95, 2.25, 2.5, 2.7, 3.1, 3.4],
};

/** коефіцієнт висоти споруди Ch (9.9); flexible — старший період коливань > 0.25 с (табл. 9.02) */
export function windCh(z: number, terrain: TerrainDBN, flexible = false): number {
  const row = (flexible ? CH_902 : CH_901)[terrain];
  return interpTable(CH_Z.map((x, k) => [x, row[k]] as [number, number]), z);
}

/** Типові аеродинамічні коефіцієнти (додаток І). Решта схем — введенням вручну. */
export const CAER_PRESETS: { key: string; value: number; ref: string }[] = [
  { key: "wallWindward", value: 0.8, ref: "дод. І, схема 2, Ce1" },
  { key: "wallLeeward", value: -0.6, ref: "дод. І, схема 2, Ce3 (b/l ≥ 2, h1/l ≥ 1)" },
  { key: "roofSuctionTorso", value: -0.7, ref: "дод. І, схема 2, примітка (вітер у торець)" },
  { key: "flatPlate", value: 1.4, ref: "дод. І, схема 1 (Cx)" },
];

export interface WindInputDBN {
  W0: number; // Па
  z: number; // висота над землею, м
  terrain: TerrainDBN;
  flexible?: boolean;
  Caer: number;
  H?: number; // км
  Crel?: number;
  Cdir?: number;
  Cd?: number;
  T: number;
  eta?: number;
}

export interface WindResultDBN {
  Caer: number; Ch: number; Calt: number; Crel: number; Cdir: number; Cd: number; C: number;
  gfm: number; gfe: number; W0: number; Wm: number; We: number;
}

export function windDBN(i: WindInputDBN): WindResultDBN {
  const Ch = windCh(i.z, i.terrain, i.flexible);
  const H = i.H ?? 0;
  const Calt = H > 0.5 ? 2 * H : 1; // (9.4)
  const Crel = i.Crel ?? 1, Cdir = i.Cdir ?? 1, Cd = i.Cd ?? 1;
  const C = i.Caer * Ch * Calt * Crel * Cdir * Cd; // (9.3)
  const gfm = windGammaFm(i.T), gfe = windGammaFe(i.eta ?? 0.02);
  return { Caer: i.Caer, Ch, Calt, Crel, Cdir, Cd, C, gfm, gfe, W0: i.W0, Wm: gfm * i.W0 * C, We: gfe * i.W0 * C };
}
