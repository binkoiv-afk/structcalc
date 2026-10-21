// Теплофізика багатошарової огороджувальної конструкції (одновимірна стаціонарна задача):
// опір теплопередачі і U, температури в шарах, точка роси на внутрішній поверхні, температурний фактор,
// конденсація в товщі і річний баланс вологи методом Глазера (ДСТУ EN ISO 13788, помісячно).
// ДБН В.2.6-31:2021 — вимоги (табл. 1, 3, 5, Б.2, Б.4); EN ISO 6946 — опори поверхонь і повітряних прошарків.
import type { Check, CodeId } from "../codes/types";
import { mkCheck } from "../codes/types";

/** Група матеріалу для допустимого приросту вологості Δw_д (ДБН В.2.6-31:2021, табл. 5) */
export type MoistGroup = "minwool" | "eps" | "pur" | "aerated" | "perlite" | "organic" | "ceramic" | "foamglass" | "silicate" | "fill" | "concrete" | "other";
export const DW_LIMIT: Record<MoistGroup, number> = {
  minwool: 2.5, eps: 2.0, pur: 3.0, aerated: 1.2, perlite: 2.0, organic: 7.0, ceramic: 1.5, foamglass: 1.5, silicate: 2.0, fill: 3.0, concrete: 2.0, other: Infinity,
};

/** λ, Вт/(м·К); μ — фактор опору паропроникненню (EN ISO 10456); ρ, кг/м³. air — замкнений повітряний прошарок, vent — вентильований */
export interface ThermalMaterial { id: string; lambda: number; mu: number; rho: number; group: MoistGroup; air?: boolean; vent?: boolean }

// типові розрахункові значення (умови експлуатації Б); для конкретного виробу — з паспорта
export const THERMAL_MATERIALS: ThermalMaterial[] = [
  { id: "rc", lambda: 2.04, mu: 110, rho: 2500, group: "concrete" },
  { id: "concrete", lambda: 1.86, mu: 100, rho: 2400, group: "concrete" },
  { id: "claybrick", lambda: 0.81, mu: 10, rho: 1800, group: "ceramic" },
  { id: "claybrickHollow", lambda: 0.58, mu: 8, rho: 1400, group: "ceramic" },
  { id: "ceramicBlock", lambda: 0.22, mu: 8, rho: 800, group: "ceramic" },
  { id: "silicatebrick", lambda: 0.87, mu: 15, rho: 1800, group: "silicate" },
  { id: "aerated400", lambda: 0.13, mu: 8, rho: 400, group: "aerated" },
  { id: "aerated500", lambda: 0.16, mu: 8, rho: 500, group: "aerated" },
  { id: "keramzitConc", lambda: 0.52, mu: 6, rho: 1200, group: "aerated" },
  { id: "cementMortar", lambda: 0.93, mu: 20, rho: 1800, group: "concrete" },
  { id: "limePlaster", lambda: 0.81, mu: 10, rho: 1600, group: "concrete" },
  { id: "facadePlaster", lambda: 0.7, mu: 20, rho: 1600, group: "concrete" },
  { id: "gypsumBoard", lambda: 0.21, mu: 8, rho: 800, group: "organic" },
  { id: "minwoolFacade", lambda: 0.041, mu: 1, rho: 140, group: "minwool" },
  { id: "minwoolLight", lambda: 0.039, mu: 1, rho: 35, group: "minwool" },
  { id: "minwoolRoof", lambda: 0.042, mu: 1, rho: 160, group: "minwool" },
  { id: "eps", lambda: 0.04, mu: 40, rho: 20, group: "eps" },
  { id: "xps", lambda: 0.034, mu: 150, rho: 35, group: "eps" },
  { id: "pir", lambda: 0.024, mu: 60, rho: 35, group: "pur" },
  { id: "foamglass", lambda: 0.045, mu: 1e5, rho: 120, group: "foamglass" },
  { id: "keramzitFill", lambda: 0.14, mu: 2, rho: 400, group: "fill" },
  { id: "pine", lambda: 0.18, mu: 50, rho: 500, group: "organic" },
  { id: "osb", lambda: 0.13, mu: 30, rho: 650, group: "organic" },
  { id: "plywood", lambda: 0.17, mu: 150, rho: 600, group: "organic" },
  { id: "steel", lambda: 58, mu: 1e7, rho: 7850, group: "other" },
  { id: "aluminium", lambda: 160, mu: 1e7, rho: 2700, group: "other" },
  { id: "vaporBarrier", lambda: 0.33, mu: 5e5, rho: 950, group: "other" },
  { id: "windMembrane", lambda: 0.2, mu: 40, rho: 300, group: "other" },
  { id: "bitumen", lambda: 0.17, mu: 5e4, rho: 1100, group: "other" },
  { id: "pvcMembrane", lambda: 0.16, mu: 1.5e4, rho: 1400, group: "other" },
  { id: "airGap", lambda: 0, mu: 1, rho: 1.2, group: "other", air: true },
  { id: "ventGap", lambda: 0, mu: 1, rho: 1.2, group: "other", vent: true },
];
export const thermalMaterial = (id: string) => THERMAL_MATERIALS.find((m) => m.id === id);

export type ThermalElement = "wall" | "roof" | "attic" | "floor";
export type BuildingKind = "res" | "pub" | "ind";
/** Шар від внутрішньої поверхні назовні; d — мм; lambda/mu/rho — власні значення замість бібліотечних */
export interface ThermalLayer { mat: string; d: number; lambda?: number; mu?: number; rho?: number; name?: string }
export interface MonthClimate { te: number; phie: number }

export interface ThermalInput {
  code: CodeId; element: ThermalElement; layers: ThermalLayer[];
  /** внутрішнє повітря, °C і % */
  ti: number; phii: number;
  /** розрахункова зовнішня температура (ДБН — табл. Б.4 за зоною), °C */
  te: number;
  zone?: 1 | 2; building?: BuildingKind;
  /** власна вимога: ДБН — R_q,min, м²·К/Вт; EN — U_max, Вт/(м²·К) */
  Rmin?: number; Umax?: number;
  /** коефіцієнт теплотехнічної однорідності r ≤ 1 (кріплення, теплопровідні включення) */
  r?: number;
  /** 12 місяців — середня температура і відносна вологість зовнішнього повітря */
  climate?: MonthClimate[];
  /** критична вологість на внутрішній поверхні для фактора f_Rsi (EN ISO 13788: 0.8 — пліснява) */
  phiCrit?: number;
}

export interface LayerResult { mat: string; d: number; lambda: number; mu: number; rho: number; R: number; sd: number; th1: number; th2: number; excluded: boolean; dw?: number; dwLim?: number; group: MoistGroup }
export interface GlaserPoint { sd: number; x: number; th: number; ps: number; p: number }
export interface MonthResult { m: number; te: number; phie: number; gc: number; Ma: number; planes: number[] }
export interface ThermalResult {
  Rsi: number; Rse: number; Rt: number; Rred: number; U: number; layers: LayerResult[];
  tsi: number; tse: number; tdew: number; dt: number; dtMax?: number; fRsi: number; fRsiMin?: number;
  Rmin?: number; Umax?: number;
  design: GlaserPoint[]; jan: GlaserPoint[]; janPlanes: number[];
  months: MonthResult[]; maxMa: number; /** найменше накопичення за усталений рік; > 0 — не висихає */ endMa: number;
  checks: Check[]; maxUtil: number;
}

/** Тиск насиченої пари, Па (ДСТУ EN ISO 13788, дод. E) */
export const psat = (th: number) => (th >= 0 ? 610.5 * Math.exp((17.269 * th) / (237.3 + th)) : 610.5 * Math.exp((21.875 * th) / (265.5 + th)));
/** Точка роси, °C — обернена до psat */
export function dewPoint(p: number): number {
  const l = Math.log(Math.max(p, 1e-6) / 610.5);
  return p >= 610.5 ? (237.3 * l) / (17.269 - l) : (265.5 * l) / (21.875 - l);
}

/** R_q,min, м²·К/Вт (ДБН В.2.6-31:2021, табл. 1) — житлові й громадські будинки */
export const RQ_MIN: Record<ThermalElement, [number, number]> = { wall: [4.0, 3.5], roof: [7.0, 6.0], attic: [6.0, 5.5], floor: [5.0, 4.0] };
/** Δθ_int-si,max, °C (ДБН В.2.6-31:2021, табл. 3); горищне — як покриття */
export const DT_MAX: Record<BuildingKind, Record<ThermalElement, number>> = {
  res: { wall: 4.0, roof: 3.0, attic: 3.0, floor: 2.0 },
  pub: { wall: 5.0, roof: 4.0, attic: 4.0, floor: 2.5 },
  ind: { wall: 7.0, roof: 5.0, attic: 5.0, floor: 2.5 },
};
/** Розрахункова температура зовнішнього повітря за зоною (ДБН В.2.6-31:2021, табл. Б.4) */
export const TE_ZONE: Record<1 | 2, number> = { 1: -22, 2: -19 };

/** Опори тепловіддачі поверхонь, м²·К/Вт. ДБН: α_в = 8.7, α_з = 23 / 12 (горище) / 6 (над підвалом); EN ISO 6946, табл. 7 */
export function surfaceR(code: CodeId, el: ThermalElement): [number, number] {
  if (code === "DBN") return [1 / 8.7, 1 / { wall: 23, roof: 23, attic: 12, floor: 6 }[el]];
  const si = { wall: 0.13, roof: 0.1, attic: 0.1, floor: 0.17 }[el];
  // суміжний неопалюваний простір — R_se = R_si
  return [si, el === "wall" || el === "roof" ? 0.04 : si];
}

/** Замкнений повітряний прошарок, EN ISO 6946, табл. 8 (поверхні з високою випромінювальною здатністю) */
export function airGapR(d: number, el: ThermalElement): number {
  const ds = [0, 5, 7, 10, 15, 25, 50, 100, 300];
  const tab = el === "wall" ? [0, 0.11, 0.13, 0.15, 0.17, 0.18, 0.18, 0.18, 0.18]
    : el === "floor" ? [0, 0.11, 0.13, 0.15, 0.17, 0.19, 0.21, 0.22, 0.23]
    : [0, 0.11, 0.13, 0.15, 0.16, 0.16, 0.16, 0.16, 0.16];
  if (d >= 300) return tab[8];
  const k = ds.findIndex((x) => x > d);
  return tab[k - 1] + ((tab[k] - tab[k - 1]) * (d - ds[k - 1])) / (ds[k] - ds[k - 1]);
}

/** Орієнтовні середньомісячні t і φ (норми 1991–2020); для проєкту — за ДСТУ-Н Б В.1.1-27 або національним додатком */
export const CLIMATES: Record<string, MonthClimate[]> = Object.fromEntries(Object.entries({
  kyiv: [[-3.5, -2.9, 1.9, 9.4, 15.5, 19.0, 21.0, 20.1, 14.6, 8.4, 2.5, -1.8], [84, 81, 75, 66, 64, 69, 69, 68, 74, 79, 86, 86]],
  lviv: [[-3.0, -1.8, 2.2, 8.8, 14.0, 17.1, 18.9, 18.3, 13.4, 8.2, 3.0, -1.5], [84, 82, 77, 70, 70, 73, 74, 75, 79, 82, 86, 86]],
  kharkiv: [[-4.5, -3.8, 1.2, 9.6, 15.9, 19.5, 21.6, 20.5, 14.5, 7.9, 1.6, -2.8], [86, 83, 78, 66, 62, 66, 66, 64, 71, 79, 87, 87]],
  odesa: [[-0.9, -0.2, 3.7, 9.8, 16.0, 20.5, 23.2, 22.7, 17.6, 11.6, 5.6, 1.0], [85, 83, 80, 75, 72, 69, 66, 66, 71, 77, 84, 86]],
  warsaw: [[-1.8, -0.6, 3.0, 9.0, 14.2, 17.6, 19.6, 19.0, 14.0, 8.6, 3.6, -0.2], [86, 83, 76, 67, 68, 69, 70, 71, 78, 83, 88, 88]],
  berlin: [[0.6, 1.4, 4.8, 9.9, 14.6, 17.8, 19.9, 19.4, 15.1, 10.0, 5.2, 1.9], [85, 81, 75, 67, 66, 67, 67, 70, 76, 82, 87, 87]],
}).map(([k, [t, h]]) => [k, t.map((te, i) => ({ te, phie: h[i] }))]));

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** δ0 — паропроникність повітря, кг/(м·с·Па) (ДСТУ EN ISO 13788, 3.1) */
const D0 = 2e-10;

interface Node { x: number; R: number; sd: number; layer: number }

/** Нижня опукла оболонка з обов'язковими точками: тиск пари не перевищує насичення (Глазер) */
function vaporLine(nodes: { sd: number; ps: number }[], pi: number, pe: number, wet: Set<number>): { p: number[]; planes: number[] } {
  const n = nodes.length, p = new Array(n).fill(0);
  // опорні точки: внутрішня й зовнішня поверхні + мокрі площини (там p = p_sat)
  const fixed = [0, ...[...wet].filter((k) => k > 0 && k < n - 1).sort((a, b) => a - b), n - 1];
  const val = (k: number) => (k === 0 ? Math.min(pi, nodes[0].ps) : k === n - 1 ? Math.min(pe, nodes[n - 1].ps) : nodes[k].ps);
  const touch: number[] = [];
  for (let s = 0; s + 1 < fixed.length; s++) {
    const a = fixed[s], b = fixed[s + 1];
    // монотонний ланцюг по sd: нижня оболонка точок (a, val), (k, ps), (b, val)
    const pts: [number, number, number][] = [[nodes[a].sd, val(a), a]];
    for (let k = a + 1; k < b; k++) pts.push([nodes[k].sd, nodes[k].ps, k]);
    pts.push([nodes[b].sd, val(b), b]);
    const hull: [number, number, number][] = [];
    for (const q of pts) {
      // однакові sd (шар без опору пари): опорну точку a не прибираємо, з решти лишаємо меншу
      const last = hull[hull.length - 1];
      if (last && Math.abs(last[0] - q[0]) < 1e-12) {
        if (last[2] === a || (q[1] > last[1] && q[2] !== b)) continue;
        hull.pop();
      }
      while (hull.length >= 2) {
        const [x1, y1] = hull[hull.length - 2], [x2, y2] = hull[hull.length - 1];
        if ((x2 - x1) * (q[1] - y1) - (y2 - y1) * (q[0] - x1) <= 1e-12) hull.pop(); else break;
      }
      hull.push(q);
    }
    for (let h = 0; h + 1 < hull.length; h++) {
      const [x1, y1, k1] = hull[h], [x2, y2, k2] = hull[h + 1];
      for (let k = k1; k <= k2; k++) p[k] = x2 - x1 > 1e-12 ? y1 + ((y2 - y1) * (nodes[k].sd - x1)) / (x2 - x1) : Math.min(y1, y2);
      if (h > 0 && k1 !== a && k1 !== b) touch.push(k1);
    }
    if (s > 0) touch.push(a);
  }
  return { p, planes: [...new Set(touch)].sort((x, y) => x - y) };
}

export function checkThermal(i: ThermalInput): ThermalResult {
  const code = i.code, el = i.element, bk = i.building ?? "res", zone = i.zone ?? 1;
  const [Rsi, Rse0] = surfaceR(code, el);
  // вентильований прошарок: усе зовні від нього не враховується, R_se = R_si (EN ISO 6946, 6.9.4)
  const vi = i.layers.findIndex((l) => thermalMaterial(l.mat)?.vent);
  const Rse = vi >= 0 ? Rsi : Rse0;
  const layers: LayerResult[] = i.layers.map((l, k) => {
    const m = thermalMaterial(l.mat) ?? { id: l.mat, lambda: 1, mu: 1, rho: 1000, group: "other" as MoistGroup };
    const lambda = l.lambda ?? m.lambda, mu = l.mu ?? m.mu, rho = l.rho ?? m.rho, d = Math.max(0, l.d);
    const excluded = vi >= 0 && k >= vi;
    const R = excluded ? 0 : m.air ? airGapR(d, el) : lambda > 0 ? d / 1000 / lambda : 0;
    return { mat: l.mat, d, lambda, mu, rho, R, sd: excluded ? 0 : (mu * d) / 1000, th1: 0, th2: 0, excluded, group: m.group };
  });
  const Rl = layers.reduce((a, l) => a + l.R, 0), Rt = Rsi + Rl + Rse, r = Math.min(1, Math.max(0.3, i.r ?? 1)), Rred = r * Rt, U = 1 / Rred;

  // вузли: поверхні шарів + поділ кожного шару на під-шари (p_sat в шарі опукла — конденсація може бути всередині)
  const nodes: Node[] = [{ x: 0, R: Rsi, sd: 0, layer: 0 }];
  let x = 0, R = Rsi, sd = 0;
  layers.forEach((l, k) => {
    if (l.excluded) return;
    const ns = Math.min(20, Math.max(1, Math.ceil(l.R / 0.05)));
    for (let s = 1; s <= ns; s++) nodes.push({ x: x + (l.d * s) / ns, R: R + (l.R * s) / ns, sd: sd + (l.sd * s) / ns, layer: k });
    x += l.d; R += l.R; sd += l.sd;
  });
  // температури — за приведеним опором (r враховує додаткові втрати через включення)
  const thAt = (n: Node, ti: number, te: number) => ti - ((ti - te) * n.R) / Rt;
  const line = (ti: number, te: number, phii: number, phie: number, wet: Set<number>) => {
    const nn = nodes.map((n) => { const th = thAt(n, ti, te); return { sd: n.sd, x: n.x, th, ps: psat(th) }; });
    const { p, planes } = vaporLine(nn, (phii / 100) * psat(ti), (phie / 100) * psat(te), wet);
    return { pts: nn.map((q, k) => ({ ...q, p: p[k] })) as GlaserPoint[], planes };
  };
  const design = line(i.ti, i.te, i.phii, 85, new Set()).pts;
  let lay = 0;
  for (const l of layers) {
    if (l.excluded) { l.th1 = l.th2 = NaN; continue; }
    const R1 = Rsi + layers.slice(0, lay).reduce((a, q) => a + q.R, 0);
    l.th1 = i.ti - ((i.ti - i.te) * R1) / Rt; l.th2 = i.ti - ((i.ti - i.te) * (R1 + l.R)) / Rt; lay++;
  }
  const tsi = i.ti - (i.ti - i.te) * Rsi / Rt, tse = i.ti - ((i.ti - i.te) * (Rt - Rse)) / Rt;
  const tdew = dewPoint((i.phii / 100) * psat(i.ti));
  // Δθ = (θ_int − θ_e)/(R_Σ·α_в) = (θ_int − θ_e)·R_si/R_Σ
  const dtv = ((i.ti - i.te) * Rsi) / Rred;
  const fRsi = (Rred - Rsi) / Rred;

  // помісячний баланс вологи (ДСТУ EN ISO 13788, розд. 6): три річні цикли, звіт — останній;
  // для Δw — найбільше накопичення в кожній площині за останній цикл
  const clim = i.climate?.length === 12 ? i.climate : CLIMATES.kyiv;
  const Ma = new Map<number, number>(), peak = new Map<number, number>();
  let months: MonthResult[] = [];
  let maxMa = 0;
  for (let cyc = 0; cyc < 3; cyc++) {
    months = [];
    maxMa = 0;
    peak.clear();
    for (let m = 0; m < 12; m++) {
      const c = clim[m], ti = Math.max(i.ti, c.te);
      const wet = new Set([...Ma].filter(([, v]) => v > 0).map(([k]) => k));
      const { pts, planes } = line(ti, c.te, i.phii, c.phie, wet);
      const sec = DAYS[m] * 86400;
      let gc = 0;
      for (const k of new Set([...planes, ...wet])) {
        if (k <= 0 || k >= pts.length - 1) continue;
        // потік до площини мінус потік від неї (найближчі вузли з іншим sd)
        let a = k - 1; while (a > 0 && pts[k].sd - pts[a].sd < 1e-12) a--;
        let b = k + 1; while (b < pts.length - 1 && pts[b].sd - pts[k].sd < 1e-12) b++;
        const gin = pts[k].sd - pts[a].sd > 1e-12 ? (D0 * (pts[a].p - pts[k].p)) / (pts[k].sd - pts[a].sd) : 0;
        const gout = pts[b].sd - pts[k].sd > 1e-12 ? (D0 * (pts[k].p - pts[b].p)) / (pts[b].sd - pts[k].sd) : 0;
        const old = Ma.get(k) ?? 0, v = Math.max(0, old + (gin - gout) * sec * 1000); // г/м²
        gc += v - old;
        Ma.set(k, v);
        peak.set(k, Math.max(peak.get(k) ?? 0, v));
      }
      const tot = [...Ma.values()].reduce((q, v) => q + v, 0);
      maxMa = Math.max(maxMa, tot);
      months.push({ m: m + 1, te: c.te, phie: c.phie, gc, Ma: tot, planes });
    }
  }
  // висихає за рік, якщо в усталеному циклі є місяць без накопиченої вологи (цикл від місяця початку конденсації)
  const endMa = Math.min(...months.map((m) => m.Ma));
  const jm = clim.reduce((b, c, k) => (c.te < clim[b].te ? k : b), 0);
  const janL = line(Math.max(i.ti, clim[jm].te), clim[jm].te, i.phii, clim[jm].phie, new Set());
  // Δw: накопичення в площинах шару (площина на межі — теплішому шару), віднесене до маси шару
  const perLayer = new Map<number, number>();
  for (const [k, v] of peak) if (v > 0) perLayer.set(nodes[k].layer, (perLayer.get(nodes[k].layer) ?? 0) + v);
  for (const [L, v] of perLayer) {
    const l = layers[L];
    if (!l || l.d <= 0) continue;
    l.dw = (v / 1000 / (l.rho * (l.d / 1000))) * 100;
    l.dwLim = DW_LIMIT[l.group];
  }

  // температурний фактор: p_sat,min = p_int/φ_crit на поверхні, найгірший місяць (ДСТУ EN ISO 13788, розд. 5)
  const phiC = i.phiCrit ?? 0.8;
  let fRsiMin = 0;
  for (const c of clim) {
    if (c.te >= i.ti - 0.5) continue;
    const thMin = dewPoint(((i.phii / 100) * psat(i.ti)) / phiC);
    fRsiMin = Math.max(fRsiMin, (thMin - c.te) / (i.ti - c.te));
  }

  const f = (v: number, n = 2) => (Number.isFinite(v) ? v.toFixed(n) : "—");
  const checks: Check[] = [];
  const Rmin = code === "DBN" ? i.Rmin ?? RQ_MIN[el][zone - 1] : undefined, Umax = code === "EN" ? i.Umax : undefined;
  const Rform = `R_Σ = R_si + Σ d/λ + R_se = ${f(Rsi, 3)} + ${layers.filter((l) => !l.excluded).map((l) => f(l.R, 3)).join(" + ")} + ${f(Rse, 3)} = ${f(Rt, 3)}`;
  if (code === "DBN") {
    checks.push(mkCheck("tR", "ДБН В.2.6-31:2021, п. 5.2, табл. 1 (R_Σпр ≥ R_q,min)", "R_Σпр = r·R_Σ ≥ R_q,min",
      `${Rform}; r = ${f(r)} → R_Σпр = ${f(Rred, 3)} ≥ ${f(Rmin!)} m²·K/W`, Rmin! / Rred));
    const dtMax = DT_MAX[bk][el];
    checks.push(mkCheck("tDt", "ДБН В.2.6-31:2021, п. 5.4, табл. 3", "Δθ = (θ_int − θ_e)/(R_Σпр·α_в) ≤ Δθ_max",
      `(${f(i.ti, 1)} − (${f(i.te, 1)}))/(${f(Rred, 3)}·${f(1 / Rsi, 1)}) = ${f(dtv)} ≤ ${f(dtMax, 1)} °C`, dtv / dtMax));
    checks.push(mkCheck("tDew", "ДБН В.2.6-31:2021, п. 5.5.1 (θ_si ≥ θ_D)", "θ_si = θ_int − Δθ ≥ θ_D",
      `θ_si = ${f(tsi, 1)} °C; θ_D(${f(i.ti, 0)} °C, ${f(i.phii, 0)} %) = ${f(tdew, 1)} °C`, (i.ti - tsi) / Math.max(1e-6, i.ti - tdew)));
  } else {
    if (Umax) checks.push(mkCheck("tU", "EN ISO 6946, 6.7.1 (U = 1/R_T); national requirement", "U = 1/R_T ≤ U_max",
      `${Rform}; r = ${f(r)} → U = ${f(U, 3)} ≤ ${f(Umax, 3)} W/(m²·K)`, U / Umax));
    checks.push(mkCheck("tFrsi", "EN ISO 13788, 5 (φ_si ≤ " + f(phiC * 100, 0) + " %)", "f_Rsi = (θ_si − θ_e)/(θ_i − θ_e) ≥ f_Rsi,min",
      `f_Rsi = ${f(fRsi, 3)} ≥ ${f(fRsiMin, 3)}`, (1 - fRsi) / Math.max(1e-6, 1 - fRsiMin)));
  }
  const wl = layers.filter((l) => l.dw !== undefined);
  const wGov = wl.reduce<LayerResult | undefined>((b, l) => (!b || l.dw! / l.dwLim! > b.dw! / b.dwLim! ? l : b), undefined);
  if (code === "DBN") checks.push(mkCheck("tMoist", "ДБН В.2.6-31:2021, п. 5.11, табл. 5; метод — ДСТУ EN ISO 13788 (п. 6.15)", "Δw = M_a/(ρ·d) ≤ Δw_д",
    wGov ? `${wGov.mat}: M_a = ${f(maxMa, 0)} g/m², Δw = ${f(wGov.dw!)} ≤ ${Number.isFinite(wGov.dwLim!) ? f(wGov.dwLim!, 1) : "—"} %` : "M_a = 0 g/m²",
    wGov ? (Number.isFinite(wGov.dwLim!) ? wGov.dw! / wGov.dwLim! : 0) : 0));
  checks.push(mkCheck("tDry", "ДСТУ EN ISO 13788, 6.4–6.5 (річний цикл)", "min M_a за рік = 0",
    `M_a,max = ${f(maxMa, 0)} g/m²; min M_a = ${f(endMa, 0)} g/m²`, endMa > 0.5 ? 1 + endMa / Math.max(maxMa, 1e-9) : 0));

  const us = checks.map((c) => c.util);
  return {
    Rsi, Rse, Rt, Rred, U, layers, tsi, tse, tdew, dt: dtv, dtMax: code === "DBN" ? DT_MAX[bk][el] : undefined, fRsi, fRsiMin: code === "EN" ? fRsiMin : undefined,
    Rmin, Umax, design, jan: janL.pts, janPlanes: janL.planes, months, maxMa, endMa, checks, maxUtil: Math.max(0, ...us),
  };
}
