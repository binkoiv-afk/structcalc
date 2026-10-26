// Залізобетонний елемент прямокутного або таврового перерізу: міцність нормальних перерізів за деформаційною
// моделлю (ДБН В.2.6-98:2009, 6.1 — діаграма бетону (3.4), арматури — рис. 3.6 б; EN 1992-1-1, 3.1.7, 3.2.7),
// похилі перерізи (зріз), конструктивні вимоги, тріщини і прогин (граничні стани другої групи).
// Одиниці всередині — мм, Н, МПа; на вході й виході — кН, кН·м.
import type { Check, CodeId } from "../codes/types";
import { mkCheck } from "../codes/types";
import { deflectionLimitDSTU } from "../codes/dbn198";

export interface RcConcrete {
  id: string;
  /** нормативна (ДБН — призмова f_ck,prism, EN — циліндрова f_ck) і розрахункова міцність на стиск, МПа */
  fck: number; fcd: number; fctm: number; fctk: number;
  /** E_cm — для другої групи; E_cd — для діаграми першої групи, МПа */
  Ecm: number; Ecd: number;
  /** ДБН — ε_c1,cd і ε_cu1,cd; EN — ε_c2 і ε_cu2 (абсолютні величини) */
  ec1: number; ecu: number;
}

/** ДБН В.2.6-98:2009, табл. 3.1 (γ_c = 1.3) */
const DBN_T31: [string, number, number, number, number, number, number, number, number][] = [
  // клас, f_ck,prism, f_cd, f_ctm, f_ctk,0.05, E_cm, E_cd (ГПа), ε_c1,cd, ε_cu1,cd (‰)
  ["C8/10", 7.5, 6.0, 1.2, 0.8, 18, 12.6, 1.56, 3.75],
  ["C12/15", 11, 8.5, 1.6, 1.1, 23, 16.3, 1.58, 3.70],
  ["C16/20", 15, 11.5, 1.9, 1.3, 27, 20, 1.62, 3.59],
  ["C20/25", 18.5, 14.5, 2.2, 1.5, 30, 23, 1.65, 3.44],
  ["C25/30", 22, 17, 2.6, 1.8, 32.5, 25, 1.69, 3.28],
  ["C30/35", 25.5, 19.5, 2.8, 2.0, 34.5, 27, 1.72, 3.10],
  ["C32/40", 29, 22, 3.0, 2.1, 36, 28.5, 1.76, 2.93],
  ["C35/45", 32, 25, 3.2, 2.2, 37.5, 30.5, 1.80, 2.72],
  ["C40/50", 36, 27.5, 3.5, 2.5, 39, 32, 1.84, 2.57],
  ["C45/55", 39.5, 30, 3.8, 2.7, 39.5, 33, 1.87, 2.43],
  ["C50/60", 43, 33, 4.1, 3.0, 40, 34, 1.91, 2.29],
];
const EN_FCK: [string, number][] = [["C12/15", 12], ["C16/20", 16], ["C20/25", 20], ["C25/30", 25], ["C30/37", 30], ["C35/45", 35], ["C40/50", 40], ["C45/55", 45], ["C50/60", 50]];

export function rcConcretes(code: CodeId): RcConcrete[] {
  if (code === "DBN") return DBN_T31.map(([id, fck, fcd, fctm, fctk, Ecm, Ecd, ec1, ecu]) => ({ id, fck, fcd, fctm, fctk, Ecm: Ecm * 1000, Ecd: Ecd * 1000, ec1: ec1 / 1000, ecu: ecu / 1000 }));
  // EN 1992-1-1, табл. 3.1; γ_c = 1.5, α_cc = 1.0
  return EN_FCK.map(([id, fck]) => {
    const fctm = 0.3 * fck ** (2 / 3), Ecm = 22000 * ((fck + 8) / 10) ** 0.3;
    return { id, fck, fcd: fck / 1.5, fctm, fctk: 0.7 * fctm, Ecm, Ecd: Ecm, ec1: 0.002, ecu: 0.0035 };
  });
}
export const rcConcrete = (code: CodeId, id: string) => rcConcretes(code).find((c) => c.id === id) ?? rcConcretes(code)[3];

export interface RcRebar { id: string; fyk: number }
/** ДБН — ДСТУ 3760 (класи табл. 2.1); EN — EN 1992-1-1, дод. C */
export const RC_REBARS: Record<CodeId, RcRebar[]> = {
  DBN: [{ id: "A240C", fyk: 240 }, { id: "A400C", fyk: 400 }, { id: "A500C", fyk: 500 }, { id: "B500", fyk: 500 }],
  EN: [{ id: "B500B", fyk: 500 }, { id: "B500C", fyk: 500 }, { id: "B450C", fyk: 450 }],
};
/** γ_s: ДБН — табл. 2.1 (залежить від класу і діаметра); EN — 1.15 */
export function gammaS(code: CodeId, cls: string, d: number): number {
  if (code === "EN") return 1.15;
  if (cls === "A240C") return 1.05;
  if (cls === "A400C") return 1.1;
  if (cls === "A500C") return d <= 22 ? 1.15 : 1.2;
  return 1.2; // B500
}
export const fyd = (code: CodeId, cls: string, d: number) => (RC_REBARS[code].find((r) => r.id === cls)?.fyk ?? 500) / gammaS(code, cls, d);
/** Граничне видовження ε_ud = 0.9·ε_uk (рис. 3.6, примітка): ДБН — ε_uk = 2.5 % (ДСТУ 3760), EN клас B — 5 %, C — 7.5 % */
export const epsUd = (code: CodeId, cls: string) => 0.9 * (code === "DBN" ? 0.025 : cls.endsWith("C") ? 0.075 : 0.05);
const ES = 200000;

export const BAR_DIAMETERS = [6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 32, 36, 40];
const barA = (d: number) => (Math.PI * d * d) / 4;

export interface RcLayer { n: number; d: number }
export interface RcInput {
  code: CodeId; concrete: string; rebar: string;
  /** переріз: ширина ребра b, висота h; полиця зверху bf×hf (0 — прямокутник), мм */
  b: number; h: number; bf?: number; hf?: number;
  /** захисний шар до хомута, мм; хомути: діаметр, кількість гілок, крок, клас */
  c: number; sw: { d: number; legs: number; s: number; cls: string };
  /** ряди нижньої (перший — крайній) і верхньої арматури */
  bot: RcLayer[]; top: RcLayer[];
  /** «section» — задані зусилля; «beam» — однопрольотна балка з рівномірним навантаженням */
  mode: "section" | "beam";
  /** зусилля перерізу (перша група): M — кН·м (+ — розтяг унизу), N — кН (+ — стиск), V — кН; M_qp — квазіпостійна, для тріщин */
  M?: number; N?: number; V?: number; Mqp?: number;
  /** балка: прольот, м; опори; навантаження характеристичні, кН/м (без власної ваги); коефіцієнти */
  L?: number; supports?: "ss" | "fp" | "ff" | "cant"; g?: number; q?: number; gammaG?: number; gammaQ?: number; psi2?: number; selfWeight?: boolean;
  /** коефіцієнт повзучості φ(∞, t0), гранична ширина тріщин, мм, граничний прогин l/n (0 — за нормою) */
  phi?: number; wlim?: number; deflN?: number;
}

export interface RcBar { y: number; z: number; d: number; A: number; top: boolean }
export interface MKPoint { k: number; M: number; eTop: number; eBot: number }
export interface RcSectionState { M: number; k: number; e0: number; x: number; eTop: number; eBot: number; es: number; esTop: number }
export interface RcUlsResult { MRd: number; state: RcSectionState; curve: MKPoint[]; NRd: number }
export interface RcResult {
  conc: RcConcrete; fyd: number; fywd: number; d: number; dTop: number; As: number; AsTop: number; bars: RcBar[];
  Ac: number; selfW: number;
  /** розрахункові зусилля: M+ (проліт), M− (опора), N, V */
  MEd: number; MEdNeg: number; NEd: number; VEd: number; Mqp: number; MqpNeg: number;
  pos: RcUlsResult; neg?: RcUlsResult;
  shear: { VRdc: number; VRds: number; VRdmax: number; cot: number; rhoW: number; rhoWmin: number; sMax: number };
  crack: { Mcr: number; sigmaS: number; x: number; srMax: number; wk: number; neg?: { Mcr: number; sigmaS: number; wk: number } };
  defl?: { f: number; flim: number; n: number; xs: number[]; ws: number[] };
  checks: Check[]; maxUtil: number;
  /** перший ряд, за якого згин проходить (підказка «Поставити») */
  needBot?: RcLayer; needTop?: RcLayer;
}

/** Ширина перерізу на глибині y від верху */
const widthAt = (i: RcInput, y: number) => (i.bf && i.hf && i.bf > i.b && y < i.hf ? i.bf : i.b);

/** Розміщення стрижнів: ряди від краю (зазор між рядами — max(d, 25)), стрижні рівномірно по ширині ребра */
export function rcBars(i: RcInput): RcBar[] {
  const out: RcBar[] = [];
  const place = (layers: RcLayer[], top: boolean) => {
    let edge = i.c + i.sw.d; // відстань від грані до краю ряду
    layers.forEach((l, k) => {
      if (l.n <= 0) return;
      if (k > 0) edge += Math.max(layers[k - 1].d, 25);
      const y = top ? edge + l.d / 2 : i.h - edge - l.d / 2;
      const w = i.b - 2 * (i.c + i.sw.d) - l.d;
      for (let j = 0; j < l.n; j++) out.push({ y, z: l.n === 1 ? 0 : -w / 2 + (w * j) / (l.n - 1), d: l.d, A: barA(l.d), top });
      edge += l.d;
    });
  };
  place(i.bot, false); place(i.top, true);
  return out;
}

/** σ_c(ε) стиску (ε > 0 — стиск): ДБН — (3.4), EN — парабола-прямокутник (3.17) */
export function rcSigmaC(code: CodeId, c: RcConcrete, e: number): number {
  if (e <= 0) return 0;
  if (code === "DBN") {
    const k = (1.05 * c.Ecd * c.ec1) / c.fcd, eta = e / c.ec1;
    return Math.max(0, (c.fcd * (k * eta - eta * eta)) / (1 + (k - 2) * eta));
  }
  return e >= c.ec1 ? c.fcd : c.fcd * (1 - (1 - e / c.ec1) ** 2);
}

/** Перерізи для інтегрування: смуги бетону і стрижні; flip — для від'ємного моменту (переріз догори дном) */
function fibres(i: RcInput, flip: boolean) {
  const n = 160, strips: { y: number; A: number }[] = [];
  for (let k = 0; k < n; k++) {
    const y0 = (i.h * (k + 0.5)) / n, yy = flip ? i.h - y0 : y0;
    strips.push({ y: y0, A: (widthAt(i, yy) * i.h) / n });
  }
  const bars = rcBars(i).map((b) => ({ ...b, y: flip ? i.h - b.y : b.y, ten: flip ? b.top : !b.top }));
  return { strips, bars };
}

/** Граничний стан перерізу при заданій N: трасування M–κ до вичерпання (екстремальний або деформаційний критерій, ДБН 6.1.2) */
export function rcUls(i: RcInput, conc: RcConcrete, NEd: number, flip: boolean): RcUlsResult {
  const { strips, bars } = fibres(i, flip), h = i.h, code = i.code;
  const fy = fyd(code, i.rebar, Math.max(...[...i.bot, ...i.top].map((l) => l.d), 10)), eud = epsUd(code, i.rebar);
  const sigS = (e: number) => Math.max(-fy, Math.min(fy, ES * e));
  // ε(y) = e0 + κ·(h/2 − y): κ > 0 — стиск угорі
  const NM = (e0: number, k: number) => {
    let N = 0, M = 0;
    for (const s of strips) { const e = e0 + k * (h / 2 - s.y), sc = rcSigmaC(code, conc, e) * s.A; N += sc; M += sc * (h / 2 - s.y); }
    for (const b of bars) { const e = e0 + k * (h / 2 - b.y), ss = sigS(e) * b.A; N += ss; M += ss * (h / 2 - b.y); }
    return [N, M];
  };
  const NN = NEd * 1000;
  const solve = (k: number) => {
    // N(e0) зростає з e0 (до піку бетону) — бісекція
    let lo = -0.06, hi = conc.ecu;
    if (NM(hi, k)[0] < NN) return null;
    for (let it = 0; it < 70; it++) { const m = (lo + hi) / 2; if (NM(m, k)[0] < NN) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  const yb = Math.max(...bars.filter((b) => b.ten).map((b) => b.y), h * 0.9);
  const limitOk = (e0: number, k: number) => e0 + k * (h / 2) <= conc.ecu * (1 + 1e-9) && e0 + k * (h / 2 - yb) >= -eud;
  const curve: MKPoint[] = [];
  let best: RcSectionState | null = null;
  const st = (e0: number, k: number): RcSectionState => {
    const M = NM(e0, k)[1] / 1e6, eTop = e0 + (k * h) / 2, eBot = e0 - (k * h) / 2;
    const bt = bars.filter((b) => b.ten), bc = bars.filter((b) => !b.ten);
    return { M, k, e0, x: k > 0 ? Math.min(h, Math.max(0, eTop / k)) : 0, eTop, eBot, es: bt.length ? e0 + k * (h / 2 - Math.max(...bt.map((b) => b.y))) : 0, esTop: bc.length ? e0 + k * (h / 2 - Math.min(...bc.map((b) => b.y))) : 0 };
  };
  // осьова несуча здатність (κ = 0): найбільша N при ε ≤ ε_c1 (рівномірний стиск)
  const NRd = NM(conc.ec1, 0)[0] / 1000;
  let kPrev = 0, e0Prev = solve(0);
  if (e0Prev === null) return { MRd: 0, state: st(conc.ec1, 0), curve, NRd };
  best = st(e0Prev, 0); curve.push({ k: 0, M: best.M, eTop: best.eTop, eBot: best.eBot });
  const kMax = (conc.ecu + eud) / (0.5 * h);
  for (let s = 1; s <= 300; s++) {
    const k = kMax * (s / 300) ** 1.6, e0 = solve(k);
    if (e0 === null || !limitOk(e0, k)) {
      // уточнюємо межу між останнім допустимим і першим недопустимим кроком
      let a = kPrev, b = k;
      for (let it = 0; it < 40; it++) { const m = (a + b) / 2, e = solve(m); if (e !== null && limitOk(e, m)) { a = m; e0Prev = e; } else b = m; }
      if (a > kPrev && e0Prev !== null) { const S = st(e0Prev, a); curve.push({ k: a, M: S.M, eTop: S.eTop, eBot: S.eBot }); if (S.M > best.M) best = S; }
      break;
    }
    const S = st(e0, k);
    curve.push({ k, M: S.M, eTop: S.eTop, eBot: S.eBot });
    if (S.M > best.M) best = S;
    kPrev = k; e0Prev = e0;
  }
  return { MRd: Math.max(0, best.M), state: best, curve, NRd };
}

/** Пружний переріз з тріщиною (без розтягнутого бетону): висота стиснутої зони, I_II; αe = Es/Ec */
function crackedSection(i: RcInput, flip: boolean, ae: number) {
  const { strips, bars } = fibres(i, flip);
  // зведена площа стрижня: у стиснутій зоні (αe − 1)·A (бетон під стрижнем уже враховано), у розтягнутій αe·A
  const fac = (y: number, x: number) => (y < x ? ae - 1 : ae);
  const S = (x: number) => strips.reduce((a, s) => a + (s.y < x ? s.A * (x - s.y) : 0), 0) + bars.reduce((a, b) => a + fac(b.y, x) * b.A * (x - b.y), 0);
  let lo = 0, hi = i.h;
  for (let it = 0; it < 60; it++) { const m = (lo + hi) / 2; if (S(m) < 0) lo = m; else hi = m; }
  const x = (lo + hi) / 2;
  const I = strips.reduce((a, s) => a + (s.y < x ? s.A * (x - s.y) ** 2 : 0), 0) + bars.reduce((a, b) => a + fac(b.y, x) * b.A * (x - b.y) ** 2, 0);
  const ten = bars.filter((b) => b.ten);
  const d = ten.length ? ten.reduce((a, b) => a + b.A * b.y, 0) / ten.reduce((a, b) => a + b.A, 0) : i.h * 0.9;
  return { x, I, d, As: ten.reduce((a, b) => a + b.A, 0) };
}
/** Пружний переріз без тріщин (зведений) */
function uncracked(i: RcInput, flip: boolean, ae: number) {
  const { strips, bars } = fibres(i, flip);
  const A = strips.reduce((a, s) => a + s.A, 0) + bars.reduce((a, b) => a + (ae - 1) * b.A, 0);
  const yc = (strips.reduce((a, s) => a + s.A * s.y, 0) + bars.reduce((a, b) => a + (ae - 1) * b.A * b.y, 0)) / A;
  const I = strips.reduce((a, s) => a + s.A * (s.y - yc) ** 2 + (s.A * (i.h / strips.length) ** 2) / 12, 0) + bars.reduce((a, b) => a + (ae - 1) * b.A * (b.y - yc) ** 2, 0);
  return { A, yc, I };
}

export function checkRc(i: RcInput): RcResult {
  const code = i.code, conc = rcConcrete(code, i.concrete), checks: Check[] = [];
  const f = (v: number, n = 2) => (Number.isFinite(v) ? v.toFixed(n) : "—");
  const bars = rcBars(i), botBars = bars.filter((b) => !b.top), topBars = bars.filter((b) => b.top);
  const As = botBars.reduce((a, b) => a + b.A, 0), AsTop = topBars.reduce((a, b) => a + b.A, 0);
  const dOf = (bs: RcBar[], top: boolean) => (bs.length ? (top ? i.h - bs.reduce((a, b) => a + b.A * b.y, 0) / bs.reduce((a, b) => a + b.A, 0) : bs.reduce((a, b) => a + b.A * b.y, 0) / bs.reduce((a, b) => a + b.A, 0)) : i.h - i.c - i.sw.d - 8);
  const d = dOf(botBars, false), dTop = dOf(topBars, true);
  const Ac = i.b * i.h + (i.bf && i.hf && i.bf > i.b ? (i.bf - i.b) * i.hf : 0);
  const dMax = Math.max(10, ...[...i.bot, ...i.top].filter((l) => l.n > 0).map((l) => l.d));
  const fy = fyd(code, i.rebar, dMax), fyk = RC_REBARS[code].find((r) => r.id === i.rebar)?.fyk ?? 500;
  const fywk = RC_REBARS[code].find((r) => r.id === i.sw.cls)?.fyk ?? fyk, fywd = fyd(code, i.sw.cls, i.sw.d);
  const selfW = i.selfWeight === false ? 0 : (25 * Ac) / 1e6; // кН/м

  // зусилля
  let MEd = 0, MEdNeg = 0, VEd = 0, V0 = 0, Mqp = 0, MqpNeg = 0;
  const NEd = i.mode === "section" ? i.N ?? 0 : 0;
  const L = i.L ?? 6, sup = i.supports ?? "ss";
  const gG = i.gammaG ?? (code === "DBN" ? 1.1 : 1.35), gQ = i.gammaQ ?? (code === "DBN" ? 1.2 : 1.5), psi2 = i.psi2 ?? 0.3;
  const wd = gG * ((i.g ?? 0) + selfW) + gQ * (i.q ?? 0), wqp = (i.g ?? 0) + selfW + psi2 * (i.q ?? 0);
  // коефіцієнти: M+ = a·wL², M− = b·wL², V = c·wL (пружна робота)
  const COEF: Record<string, [number, number, number]> = { ss: [1 / 8, 0, 1 / 2], fp: [9 / 128, 1 / 8, 5 / 8], ff: [1 / 24, 1 / 12, 1 / 2], cant: [0, 1 / 2, 1] };
  if (i.mode === "beam") {
    const [a, bb, cc] = COEF[sup];
    MEd = a * wd * L * L; MEdNeg = bb * wd * L * L;
    // поперечна сила на відстані d від грані опори (EN 1992-1-1, 6.2.1(8); рівномірне навантаження)
    V0 = cc * wd * L;
    VEd = Math.max(0, V0 - (wd * d) / 1000);
    Mqp = a * wqp * L * L; MqpNeg = bb * wqp * L * L;
  } else {
    const M = i.M ?? 0;
    if (M >= 0) MEd = M; else MEdNeg = -M;
    VEd = Math.abs(i.V ?? 0); V0 = VEd;
    const mq = i.Mqp ?? 0;
    if (mq >= 0) Mqp = mq; else MqpNeg = -mq;
  }

  // 1. Міцність нормального перерізу
  const pos = rcUls(i, conc, NEd, false);
  const neg = MEdNeg > 0 || (i.mode === "section" && (i.M ?? 0) < 0) ? rcUls(i, conc, NEd, true) : undefined;
  const clM = code === "DBN" ? "ДБН В.2.6-98:2009, 6.1.1–6.1.2 (деформаційна модель; діаграма бетону (3.4), табл. 3.1; арматури — рис. 3.6 б)" : "EN 1992-1-1, 6.1 (діаграми 3.17 і 3.8, рис. 6.1)";
  const sState = (r: RcUlsResult) => `ε_c = ${f(r.state.eTop * 1000)} ‰, ε_s = ${f(r.state.es * 1000)} ‰, x = ${f(r.state.x, 0)} mm`;
  if (MEd > 0 || (!neg && i.mode === "section"))
    checks.push(mkCheck("rcM", clM, "M_Ed ≤ M_Rd(N_Ed)", `M_Rd = ${f(pos.MRd)} kN·m (${sState(pos)}); ${f(MEd)} / ${f(pos.MRd)}${NEd ? `; N_Ed = ${f(NEd, 1)} kN` : ""}`,
      MEd > 0 ? MEd / Math.max(pos.MRd, 1e-9) : NEd > 0 ? NEd / pos.NRd : 0));
  if (neg) checks.push(mkCheck("rcMneg", clM, "M_Ed⁻ ≤ M_Rd⁻(N_Ed)", `M_Rd⁻ = ${f(neg.MRd)} kN·m (${sState(neg)}); ${f(MEdNeg)} / ${f(neg.MRd)}`, MEdNeg / Math.max(neg.MRd, 1e-9)));
  if (NEd > 0) checks.push(mkCheck("rcN", clM, "N_Ed ≤ N_Rd (κ = 0, ε ≤ ε_c1)", `${f(NEd, 1)} / ${f(pos.NRd, 1)} kN; без впливу прогину (6.1.3) — для гнучких колон окремо`, NEd / pos.NRd));

  // 2. Похилі перерізи: V_Rd,c (6.2.a,b), V_Rd,s (6.8), V_Rd,max (6.9); ДБН — 6.2.1.6–6.2.1.8 і ДСТУ Б В.2.6-156 (ті ж формули)
  const gc = code === "DBN" ? 1.3 : 1.5, fckS = conc.fck;
  const kk = Math.min(2, 1 + Math.sqrt(200 / d)), rhoL = Math.min(0.02, As / (i.b * d));
  const sigCp = Math.min(0.2 * conc.fcd, Math.max(0, (NEd * 1000) / Ac));
  const VRdc = Math.max((0.18 / gc) * kk * (100 * rhoL * fckS) ** (1 / 3), 0.035 * kk ** 1.5 * Math.sqrt(fckS)) * i.b * d / 1000 + (0.15 * sigCp * i.b * d) / 1000;
  // α_cw — вплив стиску на V_Rd,max (ДСТУ Б В.2.6-156, 4.6.3.3; EN 6.2.3 (3)); ν1 = ν, бо σ_sw = f_ywd > 0.8·f_yk
  const sc = Math.max(0, (NEd * 1000) / Ac), aCw = sc <= 0 ? 1 : sc <= 0.25 * conc.fcd ? 1 + sc / conc.fcd : sc <= 0.5 * conc.fcd ? 1.25 : Math.max(0, 2.5 * (1 - sc / conc.fcd));
  const Asw = i.sw.legs * barA(i.sw.d), z = 0.9 * d, nu1 = 0.6 * (1 - fckS / 250) * aCw;
  let bestV = 0, cot = 2.5, VRds = 0, VRdmax = 0;
  for (let c = 1; c <= 2.5001; c += 0.01) {
    const vs = i.sw.s > 0 ? ((Asw / i.sw.s) * z * fywd * c) / 1000 : 0, vm = (i.b * z * nu1 * conc.fcd) / (c + 1 / c) / 1000, v = Math.min(vs, vm);
    if (v > bestV) { bestV = v; cot = c; VRds = vs; VRdmax = vm; }
  }
  if (!bestV) { VRds = 0; VRdmax = (i.b * z * nu1 * conc.fcd) / (2.5 + 0.4) / 1000; }
  const rhoW = i.sw.s > 0 ? Asw / (i.sw.s * i.b) : 0, rhoWmin = (0.08 * Math.sqrt(fckS)) / fywk, sMax = 0.75 * d;
  const DS = "ДСТУ Б В.2.6-156:2010";
  const clV = code === "DBN" ? `${DS}, 4.6.2.1 (4.36), (4.37); 4.6.3.3 (4.44), (4.45)` : "EN 1992-1-1, 6.2.2 (6.2), 6.2.3 (6.8), (6.9)";
  const aCwTxt = aCw !== 1 ? `; α_cw = ${f(aCw, 3)}` : "";
  if (VEd > 0) {
    const VRd = Math.max(VRdc, Math.min(VRds, VRdmax));
    checks.push(mkCheck("rcV", clV, VEd <= VRdc ? "V_Ed ≤ V_Rd,c" : "V_Ed ≤ V_Rd = min(V_Rd,s; V_Rd,max)",
      `V_Rd,c = ${f(VRdc, 1)}; V_Rd,s = ${f(VRds, 1)} (cot θ = ${f(cot)}); V_Rd,max = ${f(VRdmax, 1)}${aCwTxt}; ${f(VEd, 1)} / ${f(VRd, 1)} kN`, VEd / VRd));
    // біля опори (без зменшення на d): V_Ed ≤ V_Rd,max; без розрахункових хомутів — V_Ed ≤ 0.5·b·d·ν·f_cd
    const noSw = VEd <= VRdc, cap = noSw ? (0.5 * i.b * d * 0.6 * (1 - fckS / 250) * conc.fcd) / 1000 : VRdmax;
    checks.push(mkCheck("rcV0", code === "DBN" ? (noSw ? `${DS}, 4.6.2.7, 4.6.1.4` : `${DS}, 4.6.1.4, 4.6.3.3 (4.45)`) : (noSw ? "EN 1992-1-1, 6.2.2 (6)" : "EN 1992-1-1, 6.2.1 (8), 6.2.3 (6.9)"),
      noSw ? "V_Ed,0 ≤ 0.5·b·d·ν·f_cd" : "V_Ed,0 ≤ V_Rd,max", `${f(V0, 1)} / ${f(cap, 1)} kN`, V0 / Math.max(cap, 1e-9)));
  }
  checks.push(mkCheck("rcRhoW", code === "DBN" ? `${DS}, 8.2.6.5 (8.4), (8.5)` : "EN 1992-1-1, 9.2.2 (9.5N)", "ρ_w = A_sw/(s·b) ≥ 0.08·√f_ck / f_yk",
    `${f(rhoW * 1000, 3)}‰ ≥ ${f(rhoWmin * 1000, 3)}‰`, rhoW > 0 ? rhoWmin / rhoW : Infinity));
  checks.push(mkCheck("rcSw", code === "DBN" ? `${DS}, 8.2.6.6 (8.6)` : "EN 1992-1-1, 9.2.2 (9.6N)", "s ≤ s_l,max = 0.75·d", `${f(i.sw.s, 0)} ≤ ${f(sMax, 0)} mm`, i.sw.s / sMax));
  if (i.sw.legs >= 2) {
    const st = (i.b - 2 * i.c - i.sw.d) / (i.sw.legs - 1), stMax = Math.min(0.75 * d, 600);
    checks.push(mkCheck("rcSt", code === "DBN" ? `${DS}, 8.2.6.8 (8.8)` : "EN 1992-1-1, 9.2.2 (9.8N)", "s_t ≤ 0.75·d ≤ 600 mm", `${i.sw.legs} гілки; ${f(st, 0)} ≤ ${f(stMax, 0)} mm`, st / stMax));
  }
  // стиснута арматура, врахована в розрахунку, охоплюється хомутами з кроком ≤ 15·Ø
  const comp = [...(MEd > 0 || (i.mode === "section" && !neg) ? topBars : []), ...(MEdNeg > 0 ? botBars : [])];
  if (comp.length) {
    const dc = Math.min(...comp.map((b) => b.d)), sc15 = 15 * dc;
    checks.push(mkCheck("rcSwC", code === "DBN" ? `${DS}, 8.2.2.3` : "EN 1992-1-1, 9.2.1.2 (3)", "s ≤ 15·Ø_стисн", `${f(i.sw.s, 0)} ≤ 15·${dc} = ${f(sc15, 0)} mm`, i.sw.s / sc15));
  }

  // 3. Конструктивні вимоги: A_s,min, A_s,max, просвіт між стрижнями
  const AsMin = Math.max(0.26 * conc.fctm / fyk, 0.0013) * i.b * d;
  const clMin = code === "DBN" ? `${DS}, 8.2.1.1 (8.1)` : "EN 1992-1-1, 9.2.1.1 (9.1N)";
  checks.push(mkCheck("rcAsMin", clMin, "A_s ≥ max(0.26·f_ctm/f_yk; 0.0013)·b·d", `${f(As, 0)} ≥ ${f(AsMin, 0)} mm²`, As > 0 ? AsMin / As : Infinity));
  checks.push(mkCheck("rcAsMax", code === "DBN" ? `${DS}, 8.2.1.4` : "EN 1992-1-1, 9.2.1.1 (3)", "A_s + A_s' ≤ 0.04·A_c", `${f(As + AsTop, 0)} ≤ ${f(0.04 * Ac, 0)} mm²`, (As + AsTop) / (0.04 * Ac)));
  for (const [layers, nm] of [[i.bot, "bot"], [i.top, "top"]] as const) layers.forEach((l, k) => {
    if (l.n < 2) return;
    const clear = (i.b - 2 * (i.c + i.sw.d) - l.n * l.d) / (l.n - 1), need = Math.max(l.d, 25);
    checks.push(mkCheck("rcGap", code === "DBN" ? "ДБН В.2.6-98:2009, 8.2; ДСТУ Б В.2.6-156 (як EN 1992-1-1, 8.2)" : "EN 1992-1-1, 8.2 (2)", "a ≥ max(φ; d_g + 5; 20) mm",
      `${nm === "bot" ? "↓" : "↑"}${k + 1}: ${l.n}Ø${l.d}; a = ${f(clear, 0)} ≥ ${f(need, 0)} mm`, clear > 0 ? need / clear : Infinity));
  });

  // 4. Тріщини (друга група): σ_s у перерізі з тріщиною, w_k = s_r,max·(ε_sm − ε_cm) — ДБН 7.3.4 (7.3), EN 7.3.4 (7.8)–(7.11)
  const phi = i.phi ?? 2, EcEff = conc.Ecm / (1 + phi), aeL = ES / EcEff, ae = ES / conc.Ecm, wlim = i.wlim ?? 0.3;
  const crackOf = (Mk: number, flip: boolean) => {
    const un = uncracked(i, flip, ae), yt = i.h - un.yc;
    const Mcr = (conc.fctm * un.I) / yt / 1e6;
    const cs = crackedSection(i, flip, aeL);
    if (Mk <= Mcr || cs.As <= 0) return { Mcr, sigmaS: 0, x: cs.x, srMax: 0, wk: 0 };
    const sigmaS = (aeL * Mk * 1e6 * (cs.d - cs.x)) / cs.I;
    const bars0 = (flip ? topBars : botBars), phiEq = bars0.length ? bars0.reduce((a, b) => a + b.d * b.d, 0) / bars0.reduce((a, b) => a + b.d, 0) : 12;
    const hcef = Math.min(2.5 * (i.h - cs.d), (i.h - cs.x) / 3, i.h / 2), bt = flip && i.bf && i.hf && i.bf > i.b ? i.bf : i.b;
    const rho = cs.As / (bt * hcef), cc = i.c + i.sw.d;
    const lay = (flip ? i.top : i.bot)[0], gap = lay && lay.n > 1 ? (i.b - 2 * cc - lay.d) / (lay.n - 1) : 0;
    const srMax = gap > 5 * (cc + phiEq / 2) ? 1.3 * (i.h - cs.x) : 3.4 * cc + (0.425 * 0.8 * 0.5 * phiEq) / rho;
    const de = Math.max((sigmaS - (0.4 * conc.fctm * (1 + ae * rho)) / rho) / ES, (0.6 * sigmaS) / ES);
    return { Mcr, sigmaS, x: cs.x, srMax, wk: srMax * de };
  };
  const cr = crackOf(Mqp, false), crN = MqpNeg > 0 ? crackOf(MqpNeg, true) : undefined;
  const clW = code === "DBN" ? `${DS}, 5.3.4 (5.8)–(5.14), табл. 5.1` : "EN 1992-1-1, 7.3.4 (7.8)–(7.11), табл. 7.1N";
  for (const [c, M, key] of [[cr, Mqp, "rcCrack"], [crN, MqpNeg, "rcCrackNeg"]] as const) {
    if (!c || M <= 0) continue;
    checks.push(mkCheck(key, clW, "w_k = s_r,max·(ε_sm − ε_cm) ≤ w_lim",
      M <= c.Mcr ? `M_qp = ${f(M)} ≤ M_cr = ${f(c.Mcr)} kN·m — тріщин немає` : `M_qp = ${f(M)} > M_cr = ${f(c.Mcr)}; σ_s = ${f(c.sigmaS, 0)} MPa; s_r,max = ${f(c.srMax, 0)} mm; w_k = ${f(c.wk, 3)} ≤ ${f(wlim)} mm`,
      c.wk / wlim));
  }

  // A_s,min для обмеження тріщин: A_s·σ_s ≥ k_c·k·f_ct,eff·A_ct, σ_s = f_yk, k_c = 0.4 (згин), k = 1…0.65 (h = 300…800) — ДСТУ 5.3.2 (5.1), EN 7.3.2 (7.1)
  const kH = i.h <= 300 ? 1 : i.h >= 800 ? 0.65 : 1 - (0.35 * (i.h - 300)) / 500;
  for (const [M, flip, key] of [[Mqp, false, "rcAsMinCr"], [MqpNeg, true, "rcAsMinCrNeg"]] as const) {
    if (M <= 0) continue;
    const un = uncracked(i, flip, 1), Act = fibres(i, flip).strips.reduce((a, s) => a + (s.y > un.yc ? s.A : 0), 0);
    const need = (0.4 * kH * conc.fctm * Act) / fyk, have = flip ? AsTop : As;
    checks.push(mkCheck(key, code === "DBN" ? `${DS}, 5.3.2 (5.1)` : "EN 1992-1-1, 7.3.2 (7.1)", "A_s ≥ k_c·k·f_ct,eff·A_ct / f_yk",
      `k = ${f(kH, 2)}; A_ct = ${f(Act / 100, 0)} cm²; ${f(have, 0)} ≥ ${f(need, 0)} mm²`, have > 0 ? need / have : Infinity));
  }

  // 5. Прогин балки: кривина κ = ζ·κ_II + (1 − ζ)·κ_I, ζ = 1 − 0.5·(M_cr/M)² (EN 7.4.3 (7.18), (7.19)); інтеграл Мора у звільненій схемі
  let defl: RcResult["defl"];
  if (i.mode === "beam") {
    const sec = [false, true].map((flip) => {
      const un = uncracked(i, flip, aeL), cs = crackedSection(i, flip, aeL), unS = uncracked(i, flip, ae);
      return { I1: un.I, I2: cs.I, Mcr: (conc.fctm * unS.I) / (i.h - unS.yc) / 1e6 };
    });
    const kap = (M: number) => {
      const s = sec[M >= 0 ? 0 : 1], m = Math.abs(M), k1 = (m * 1e6) / (EcEff * s.I1), k2 = (m * 1e6) / (EcEff * s.I2);
      const z = m <= s.Mcr ? 0 : 1 - 0.5 * (s.Mcr / m) ** 2;
      return Math.sign(M) * (z * k2 + (1 - z) * k1);
    };
    const Lmm = L * 1000, n = 200, w = wqp, Mx = (x: number) => {
      const X = x / 1000;
      if (sup === "ss") return (w * X * (L - X)) / 2;
      if (sup === "fp") return -w * L * L / 8 + (5 * w * L * X) / 8 - (w * X * X) / 2;
      if (sup === "ff") return -w * L * L / 12 + (w * L * X) / 2 - (w * X * X) / 2;
      return (-w * (L - X) ** 2) / 2;
    };
    // точка з найбільшим прогином і одинична сила там у статично визначній схемі
    const a = sup === "cant" ? Lmm : sup === "fp" ? 0.5785 * Lmm : Lmm / 2;
    const mUnit = (x: number) => (sup === "cant" ? -(Lmm - x) : x <= a ? (x * (Lmm - a)) / Lmm : (a * (Lmm - x)) / Lmm);
    let fmax = 0;
    for (let k = 0; k < n; k++) { const x = ((k + 0.5) * Lmm) / n; fmax += kap(Mx(x)) * mUnit(x) * (Lmm / n); }
    // форма прогину (для графіка): подвійне інтегрування кривини у звільненій схемі з поправкою на опори
    const xs: number[] = [], ws: number[] = [];
    for (let k = 0; k <= 40; k++) {
      const p = (k * Lmm) / 40;
      const mu = (x: number) => (sup === "cant" ? (x <= p ? -(p - x) : 0) : x <= p ? (x * (Lmm - p)) / Lmm : (p * (Lmm - x)) / Lmm);
      let s = 0; for (let j = 0; j < n; j++) { const x = ((j + 0.5) * Lmm) / n; s += kap(Mx(x)) * mu(x) * (Lmm / n); }
      xs.push(p / 1000); ws.push(s);
    }
    const nDen = i.deflN && i.deflN > 0 ? i.deflN : code === "DBN" ? deflectionLimitDSTU(sup === "cant" ? 2 * L : L) : 250;
    const flim = ((sup === "cant" ? 2 * Lmm : Lmm) / nDen);
    defl = { f: Math.abs(fmax), flim, n: nDen, xs, ws };
    checks.push(mkCheck("rcDefl", code === "DBN" ? `ДБН В.2.6-98:2009, 7.4.4; ${DS}, 5.4.3.1 (5.18); ДСТУ Б В.1.2-3:2006, табл. 1` : "EN 1992-1-1, 7.4.1 (4), 7.4.3 (7.18)",
      `f ≤ ${sup === "cant" ? "2l" : "l"}/${f(nDen, 0)}`, `φ = ${f(phi, 1)}, E_c,eff = ${f(EcEff / 1000, 1)} GPa; f = ${f(Math.abs(fmax), 1)} ≤ ${f(flim, 1)} mm`, Math.abs(fmax) / flim));
  }

  // підбір першого ряду: найменший діаметр (від поточного), за якого згин проходить і стрижні вміщуються з просвітом max(φ; 25)
  const needOf = (top: boolean): RcLayer | undefined => {
    const lays = top ? i.top : i.bot, Med = top ? MEdNeg : MEd;
    if (!lays.length || Med <= 0) return undefined;
    for (const dd of BAR_DIAMETERS.filter((x) => x >= lays[0].d)) {
      const room = i.b - 2 * (i.c + i.sw.d), nFit = Math.max(1, Math.floor((room + Math.max(dd, 25)) / (dd + Math.max(dd, 25))));
      for (let nb = 2; nb <= nFit; nb++) {
        const ii = { ...i, [top ? "top" : "bot"]: [{ n: nb, d: dd }, ...lays.slice(1)] } as RcInput;
        if (rcUls(ii, conc, NEd, top).MRd >= Med) return { n: nb, d: dd };
      }
    }
    return undefined;
  };
  const us = checks.map((c) => c.util);
  const maxUtil = Math.max(0, ...us);
  const failOf = (k: string) => checks.some((c) => c.key === k && c.util > 1);
  return {
    conc, fyd: fy, fywd, d, dTop, As, AsTop, bars, Ac, selfW, MEd, MEdNeg, NEd, VEd, Mqp, MqpNeg, pos, neg,
    shear: { VRdc, VRds, VRdmax, cot, rhoW, rhoWmin, sMax },
    crack: { ...cr, neg: crN ? { Mcr: crN.Mcr, sigmaS: crN.sigmaS, wk: crN.wk } : undefined },
    defl, checks, maxUtil,
    needBot: failOf("rcM") ? needOf(false) : undefined, needTop: failOf("rcMneg") ? needOf(true) : undefined,
  };
}
