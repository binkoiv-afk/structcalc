// Стоечно-ригельний фасад (СРС): стояк і ригелі.
// Стояк — балка на кронштейнах (одно-, двопрогінна, з консоллю або ланцюг Гербера через поверхи зі стиковим вкладишем-шарніром),
// вітер — рівномірно з ширини грузової смуги; вага скла — осьова сила (підвіс — розтяг, опора знизу — стиск зі стійкістю).
// Ригель — косий згин: вітер (трапеції від панелей зверху й знизу) + вага скла на двох підкладках (≈100 мм від країв), кручення від ексцентриситету скла.
// Алюміній — EN 1999-1-1 (ДСТУ-Н Б EN 1999-1-1); прогини — EN 13830; сталевий вкладиш ділить момент за жорсткістю.
// Методика і джерела — /mnt/project-files/calc-app/norms/facade/facade.md.

import type { Check } from "../codes/types";
import { annex } from "../codes/annex";

export interface Alloy { id: string; f0: number; fu: number; tmax: string }
/** EN 1999-1-1, табл. 3.2b (пресовані профілі) */
export const ALLOYS: Alloy[] = [
  { id: "6060-T66", f0: 150, fu: 195, tmax: "3–25" },
  { id: "6060-T66 (t ≤ 3)", f0: 160, fu: 215, tmax: "≤3" },
  { id: "6060-T6", f0: 140, fu: 170, tmax: "≤15" },
  { id: "6063-T6", f0: 160, fu: 195, tmax: "≤25" },
  { id: "6063-T66", f0: 200, fu: 245, tmax: "≤10" },
  { id: "6005A-T6", f0: 225, fu: 270, tmax: "≤5" },
  { id: "6061-T6", f0: 240, fu: 260, tmax: "≤20" },
  { id: "6082-T6", f0: 250, fu: 290, tmax: "≤5" },
];
export const E_AL = 70000, G_AL = 27000, RHO_AL = 27; // МПа, МПа, кН/м³
const E_ST = 210000;

export type CwScheme = "single" | "two" | "cant" | "gerber";
export type CwLimit = "2015" | "2003" | "custom";

export interface CwSection {
  /** I_x — згин від вітру (з площини фасаду), I_y — у площині; см⁴; W — см³; A — см²; tw — товщина стінки, мм; D — глибина, мм */
  Ix: number; Iy: number; Wx: number; Wy: number; A: number; tw: number; D: number;
  /** для ригеля: площа, обмежена серединною лінією коробки, см², і товщина, мм (кручення за Бредтом); 0 — не перевіряти */
  Am?: number; tt?: number;
}

export interface CwInput {
  code: "DBN" | "EN";
  /** крок стояків = проліт ригеля, м; крайній стояк — половина смуги */
  a: number; edge: boolean;
  scheme: CwScheme;
  /** прольоти, м: single — [L]; two — [L1, L2]; cant — [L], c — консоль; gerber — [H] (поверх), c — від кронштейна до вкладиша */
  spans: number[]; c: number;
  /** кронштейн, що несе вагу: зверху (стояк підвішений, розтяг) або знизу (стиск) */
  hang: boolean;
  /** висоти панелей між ригелями знизу вгору, м (на поверх / на стояк) */
  panes: number[];
  /** характеристичний вітер, кПа (тиск +, відсос −): для стояка і для ригеля (своя площа) */
  wP: number; wS: number; wPt: number; wSt: number;
  /** розрахунковий коефіцієнт вітру (EN γQ; ДБН γfm) і ваги (EN γG; ДБН γf) */
  gW: number; gG: number;
  /** скло: товщини шарів, мм; підкладки від краю, мм; ексцентриситет навантаження від передньої грані ригеля e і від неї до центру згину e0, мм */
  glass: number[]; ab: number; e: number; e0: number;
  alloy: string; gM1?: number;
  mullion: CwSection; transom: CwSection;
  /** сталевий вкладиш у стояку: I, см⁴; W, см³; fy, МПа; 0 — немає */
  insert: { I: number; W: number; fy: number };
  limit: CwLimit; custDiv: number; custCap: number;
}

export interface CwPoint { x: number; M: number; V: number; w: number }
export interface CwSpanDefl { from: number; to: number; L: number; Lref: number; w: number; lim: number; cant: boolean }
export interface CwTransom { i: number; hB: number; hA: number; G: number; Mx: number; My: number; T: number; fw: number; fg: number; fgLim: number; fwLim: number; util: number }
export interface CwResult {
  /** епюри від характеристичного вітру 1 кПа·смуга — домножено на тиск */
  pts: CwPoint[]; supports: number[]; hinges: number[]; length: number;
  q: number; reactions: { x: number; R: number }[];
  Mmax: number; Vmax: number; N: number; Gstorey: number; selfW: number;
  defl: CwSpanDefl[];
  transoms: CwTransom[]; tWorst: number;
  checks: Check[]; mullionChecks: Check[]; transomChecks: Check[];
  f0: number; gM1: number; shareAl: number;
}

/** Межа прогину рами за EN 13830, мм; L — мм */
export function cwLimit(kind: CwLimit, L: number, div = 300, cap = 15): number {
  if (kind === "2003") return Math.min(L / 200, 15);
  if (kind === "custom") return cap > 0 ? Math.min(L / div, cap) : L / div;
  return L <= 3000 ? L / 200 : L < 7500 ? 5 + L / 300 : L / 250;
}

/** Схема стояка: опори (кронштейни), шарніри (вкладиші), довжина; x від низу, м */
export function cwGeometry(s: CwScheme, spans: number[], c: number) {
  if (s === "two") return { supports: [0, spans[0], spans[0] + spans[1]], hinges: [] as number[], length: spans[0] + spans[1] };
  if (s === "cant") return { supports: [0, spans[0]], hinges: [] as number[], length: spans[0] + c };
  if (s === "gerber") {
    const H = spans[0], n = 4;
    return { supports: Array.from({ length: n + 1 }, (_, k) => k * H), hinges: Array.from({ length: n - 1 }, (_, k) => (k + 1) * H + c), length: n * H };
  }
  return { supports: [0, spans[0]], hinges: [] as number[], length: spans[0] };
}

/**
 * Балка Ейлера–Бернуллі з шарнірами: рівномірне навантаження q (кН/м), EI (кН·м²).
 * Точні значення: кубічні елементи + частинний розв'язок для q всередині елемента.
 */
export function beamHinged(supports: number[], hinges: number[], length: number, q: number, EI: number, sub = 24) {
  const keys = [...new Set([0, length, ...supports, ...hinges].map((x) => +x.toFixed(6)))].filter((x) => x >= 0 && x <= length + 1e-9).sort((a, b) => a - b);
  const xs: number[] = [];
  for (let k = 0; k < keys.length - 1; k++) for (let j = 0; j < sub; j++) xs.push(keys[k] + ((keys[k + 1] - keys[k]) * j) / sub);
  xs.push(keys[keys.length - 1]);
  const isH = (x: number) => hinges.some((h) => Math.abs(h - x) < 1e-6);
  const isS = (x: number) => supports.some((h) => Math.abs(h - x) < 1e-6);
  // ступені: w у кожному вузлі; θ зліва/справа (у шарнірі — різні)
  let nd = 0;
  const wD: number[] = [], tL: number[] = [], tR: number[] = [];
  for (const x of xs) { wD.push(nd++); const t = nd++; tL.push(t); tR.push(isH(x) ? nd++ : t); }
  const K = Array.from({ length: nd }, () => new Float64Array(nd)), F = new Float64Array(nd);
  const elems: { a: number; b: number; L: number; dofs: number[] }[] = [];
  for (let k = 0; k < xs.length - 1; k++) {
    const L = xs[k + 1] - xs[k], dofs = [wD[k], tR[k], wD[k + 1], tL[k + 1]];
    const c = EI / L ** 3;
    const ke = [[12, 6 * L, -12, 6 * L], [6 * L, 4 * L * L, -6 * L, 2 * L * L], [-12, -6 * L, 12, -6 * L], [6 * L, 2 * L * L, -6 * L, 4 * L * L]];
    const fe = [q * L / 2, q * L * L / 12, q * L / 2, -q * L * L / 12];
    for (let i = 0; i < 4; i++) { F[dofs[i]] += fe[i]; for (let j = 0; j < 4; j++) K[dofs[i]][dofs[j]] += c * ke[i][j]; }
    elems.push({ a: k, b: k + 1, L, dofs });
  }
  const fixed = new Set<number>();
  xs.forEach((x, k) => { if (isS(x)) fixed.add(wD[k]); });
  const free = [...Array(nd).keys()].filter((d) => !fixed.has(d));
  const n = free.length, A = free.map((i) => Float64Array.from(free.map((j) => K[i][j]))), b = Float64Array.from(free.map((i) => F[i]));
  for (let p = 0; p < n; p++) {
    let m = p;
    for (let r = p + 1; r < n; r++) if (Math.abs(A[r][p]) > Math.abs(A[m][p])) m = r;
    if (Math.abs(A[m][p]) < 1e-12) throw new Error("mechanism");
    [A[p], A[m]] = [A[m], A[p]]; [b[p], b[m]] = [b[m], b[p]];
    for (let r = p + 1; r < n; r++) {
      const f = A[r][p] / A[p][p]; if (!f) continue;
      for (let cI = p; cI < n; cI++) A[r][cI] -= f * A[p][cI];
      b[r] -= f * b[p];
    }
  }
  const u = new Float64Array(nd), xf = new Float64Array(n);
  for (let p = n - 1; p >= 0; p--) { let s = b[p]; for (let cI = p + 1; cI < n; cI++) s -= A[p][cI] * xf[cI]; xf[p] = s / A[p][p]; }
  free.forEach((d, i) => { u[d] = xf[i]; });
  // реакції (проти навантаження +): R = F − K·u у закріплених w
  const reactions = supports.map((x) => {
    const k = xs.findIndex((y) => Math.abs(y - x) < 1e-6), d = wD[k];
    let R = F[d]; for (let j = 0; j < nd; j++) R -= K[d][j] * u[j];
    return { x, R };
  });
  // зусилля в елементах: сили на кінцях від елемента f = ke·ue − fe; M(s) = f1 − f0·s + q s²/2 (провисання +), V(s) = −f0 + q·s
  const pts: CwPoint[] = [];
  elems.forEach((el, k) => {
    const L = el.L, ue = el.dofs.map((d) => u[d]), c = EI / L ** 3;
    const ke = [[12, 6 * L, -12, 6 * L], [6 * L, 4 * L * L, -6 * L, 2 * L * L]];
    const f0 = c * ke[0].reduce((s, v, i) => s + v * ue[i], 0) - q * L / 2;
    const f1 = c * ke[1].reduce((s, v, i) => s + v * ue[i], 0) - q * L * L / 12;
    const ns = k === elems.length - 1 ? 2 : 1;
    for (let j = 0; j < ns; j++) {
      const s = j * L, xi = s / L;
      const N1 = 1 - 3 * xi * xi + 2 * xi ** 3, N2 = L * (xi - 2 * xi * xi + xi ** 3), N3 = 3 * xi * xi - 2 * xi ** 3, N4 = L * (-xi * xi + xi ** 3);
      const w = N1 * ue[0] + N2 * ue[1] + N3 * ue[2] + N4 * ue[3] + (q * s * s * (L - s) ** 2) / (24 * EI);
      pts.push({ x: xs[el.a] + s, M: f1 - f0 * s + (q * s * s) / 2, V: -f0 + q * s, w });
    }
  });
  return { pts, reactions, xs };
}

/** EN 1999-1-1 6.3.1: χ для класу A (α = 0.20, λ̄0 = 0.10) */
export function chiAl(lam: number) {
  if (lam <= 0.1) return 1;
  const phi = 0.5 * (1 + 0.2 * (lam - 0.1) + lam * lam);
  return Math.min(1, 1 / (phi + Math.sqrt(phi * phi - lam * lam)));
}

/** Ригель: вітер від двох панелей (трапеції), вага скла на двох підкладках, кручення */
function transomForces(L: number, hB: number, hA: number, w: number, G: number, ab: number, ecc: number) {
  // трапеція від панелі висотою h: q0 = w·min(h, L)/2, a = min(h, L)/2; M = q0(3L² − 4a²)/24; f·EI = q0(25L⁴ − 40L²a² + 16a⁴)/1920
  let M = 0, fEI = 0;
  for (const h of [hB, hA]) {
    if (h <= 0) continue;
    const a = Math.min(h, L) / 2, q0 = (w * Math.min(h, L)) / 2;
    M += (q0 * (3 * L * L - 4 * a * a)) / 24;
    fEI += (q0 * (25 * L ** 4 - 40 * L * L * a * a + 16 * a ** 4)) / 1920;
  }
  const P = G / 2, A = Math.min(ab, L / 2);
  return { Mx: M, fxEI: fEI, My: P * A, fyEI: (P * A * (3 * L * L - 4 * A * A)) / 24, T: P * ecc, P, A };
}

export function checkCurtainWall(i: CwInput): CwResult {
  const al = ALLOYS.find((x) => x.id === i.alloy) ?? ALLOYS[0];
  const gM1 = i.gM1 ?? 1.1, f0 = al.f0, fd = f0 / gM1;
  const m = i.mullion, st = i.insert;
  const EIal = (E_AL * m.Ix) / 1e5, EIst = st.I > 0 ? (E_ST * st.I) / 1e5 : 0; // кН·м²
  const shareAl = EIal / (EIal + EIst);
  const geo = cwGeometry(i.scheme, i.spans, i.c);
  const bw = i.edge ? i.a / 2 : i.a;
  // епюри на 1 кН/м, далі масштабуємо
  const unit = beamHinged(geo.supports, geo.hinges, geo.length, 1, EIal + EIst);
  const wk = Math.max(Math.abs(i.wP), Math.abs(i.wS)), q = wk * bw;
  const pts = unit.pts.map((p) => ({ x: p.x, M: p.M * q, V: p.V * q, w: p.w * q }));
  const reactions = unit.reactions.map((r) => ({ x: r.x, R: r.R * q }));
  const Mmax = Math.max(...pts.map((p) => Math.abs(p.M))), Vmax = Math.max(...pts.map((p) => Math.abs(p.V)));
  // прогини між сусідніми кронштейнами (EN 13830: L — відстань між точками кріплення; консоль — 2c)
  const defl: CwSpanDefl[] = [];
  const S = geo.supports;
  for (let k = 0; k < S.length - 1; k++) {
    const seg = pts.filter((p) => p.x >= S[k] - 1e-9 && p.x <= S[k + 1] + 1e-9), w = Math.max(...seg.map((p) => Math.abs(p.w))) * 1000, L = (S[k + 1] - S[k]) * 1000;
    defl.push({ from: S[k], to: S[k + 1], L, Lref: L, w, lim: cwLimit(i.limit, L, i.custDiv, i.custCap), cant: false });
  }
  if (geo.length > S[S.length - 1] + 1e-6) {
    const c = (geo.length - S[S.length - 1]) * 1000, w = Math.abs(pts[pts.length - 1].w) * 1000;
    defl.push({ from: S[S.length - 1], to: geo.length, L: c, Lref: 2 * c, w, lim: cwLimit(i.limit, 2 * c, i.custDiv, i.custCap), cant: true });
  }
  // вага: панелі шириною a (з обох боків по половині) на стояк; крайній — половина
  const tg = i.glass.reduce((s, t) => s + t, 0) / 1000;
  const paneG = i.panes.map((h) => bw * h * tg * 25); // кН
  const Gstorey = paneG.reduce((s, g) => s + g, 0);
  const pieceL = i.scheme === "gerber" ? i.spans[0] : geo.length;
  const selfW = (m.A / 1e4) * RHO_AL * pieceL;
  const N = Gstorey + selfW, NEd = i.gG * N;
  const MEd = i.gW * Mmax, VEd = i.gW * Vmax;

  const na = annex();
  const cl = i.code === "EN" ? "EN 1999-1-1" : "ДСТУ-Н Б EN 1999-1-1";
  const MRd = (m.Wx * fd) / 1e3; // кН·м
  const NRd = (m.A * 100 * fd) / 1e3; // кН
  const mc: Check[] = [];
  const f = (x: number, n = 2) => x.toFixed(n);
  // 1. згин + осьова
  const Mal = MEd * shareAl;
  if (i.hang || i.scheme === "gerber") {
    const u = NEd / NRd + Mal / MRd;
    mc.push({ key: "cw_mBend", clause: `${cl}, 6.2.5, 6.2.9`, formula: "N_Ed/N_Rd + M_Ed,al/M_Rd ≤ 1 (N — розтяг)",
      subst: `${f(NEd)}/${f(NRd)} + ${f(Mal)}/${f(MRd)} = ${f(u, 3)}`, util: u, ok: u <= 1 });
  } else {
    // стиск: стійкість у площині вітру (I_x, L — найбільший проліт між кронштейнами) і з площини (I_y, L — найбільша панель)
    const Lx = Math.max(...defl.filter((d) => !d.cant).map((d) => d.L)) / 1000, Ly = Math.max(...i.panes);
    const Ncr = (I: number, L: number) => (Math.PI ** 2 * E_AL * I * 1e4) / (L * 1000) ** 2 / 1e3;
    const lx = Math.sqrt((m.A * 100 * f0) / 1e3 / Ncr(m.Ix, Lx)), ly = Math.sqrt((m.A * 100 * f0) / 1e3 / Ncr(m.Iy, Ly));
    const chi = Math.min(chiAl(lx), chiAl(ly));
    const u = NEd / (chi * NRd) + Mal / MRd;
    mc.push({ key: "cw_mBuck", clause: `${cl}, 6.3.1, 6.3.3`, formula: "N_Ed/(χ·N_Rd) + M_Ed,al/M_Rd ≤ 1 (лінійна взаємодія, в запас)",
      subst: `λ̄x = ${f(lx)} (L = ${f(Lx)} m), λ̄y = ${f(ly)} (L = ${f(Ly)} m); χ = ${f(chi, 3)}; ${f(NEd)}/(${f(chi, 3)}·${f(NRd)}) + ${f(Mal)}/${f(MRd)} = ${f(u, 3)}`, util: u, ok: u <= 1 });
  }
  // 2. зріз: дві стінки коробки
  const Av = 2 * m.tw * m.D, VRd = (Av * fd) / Math.sqrt(3) / 1e3;
  const uV = (VEd * shareAl) / VRd;
  mc.push({ key: "cw_mShear", clause: `${cl}, 6.2.6`, formula: "V_Ed/(A_v·f_0/(√3·γ_M1)) ≤ 1, A_v = 2·t_w·D", subst: `A_v = 2·${m.tw}·${m.D} = ${Av.toFixed(0)} mm²; ${f(VEd * shareAl)}/${f(VRd)} = ${f(uV, 3)}`, util: uV, ok: uV <= 1 });
  // 3. сталевий вкладиш
  if (EIst > 0) {
    const Mst = MEd * (1 - shareAl), Rst = (st.W * st.fy) / 1e3 / na.e1993.gM0, u = Mst / Rst;
    mc.push({ key: "cw_mInsert", clause: "EN 1993-1-1, 6.2.5", formula: "M_st = M_Ed·EI_st/ΣEI; M_st/(W_st·f_y/γ_M0) ≤ 1",
      subst: `M_st = ${f(MEd)}·${f(1 - shareAl, 3)} = ${f(Mst)} kN·m; ${f(Mst)}/${f(Rst)} = ${f(u, 3)}`, util: u, ok: u <= 1 });
  }
  // 4. прогини
  for (const d of defl) {
    const u = d.w / d.lim;
    mc.push({ key: d.cant ? "cw_mDeflC" : "cw_mDefl", clause: i.limit === "custom" ? "—" : `EN 13830:${i.limit}`,
      formula: i.limit === "2015" ? "L ≤ 3 m: L/200; 3–7.5 m: 5 mm + L/300; > 7.5 m: L/250" : i.limit === "2003" ? "min(L/200; 15 mm)" : `min(L/${i.custDiv}; ${i.custCap} mm)`,
      subst: `x = ${f(d.from)}–${f(d.to)} m, L${d.cant ? " = 2c" : ""} = ${d.Lref.toFixed(0)} mm: w = ${f(d.w, 1)} ≤ ${f(d.lim, 1)} mm`, util: u, ok: u <= 1 });
  }

  // ── ригелі ──
  const t = i.transom, L = i.a, ab = i.ab / 1000, ecc = (i.e + i.e0) / 1000;
  const tc: Check[] = [];
  const transoms: CwTransom[] = [];
  const EIx = (E_AL * t.Ix) / 1e5, EIy = (E_AL * t.Iy) / 1e5;
  const MxRd = (t.Wx * fd) / 1e3, MyRd = (t.Wy * fd) / 1e3;
  const wt = Math.max(Math.abs(i.wPt), Math.abs(i.wSt));
  for (let k = 0; k <= i.panes.length; k++) {
    const hB = k > 0 ? i.panes[k - 1] : 0, hA = k < i.panes.length ? i.panes[k] : 0;
    const G = hA > 0 ? L * hA * tg * 25 : 0;
    const r = transomForces(L, hB, hA, wt, G, ab, ecc);
    const fw = (r.fxEI / EIx) * 1000, fg = (r.fyEI / EIy) * 1000;
    const util = (i.gW * r.Mx) / MxRd + (i.gG * r.My) / MyRd;
    transoms.push({ i: k, hB, hA, G, Mx: r.Mx, My: r.My, T: r.T, fw, fg, fgLim: Math.min((L * 1000) / 500, 3), fwLim: cwLimit(i.limit, L * 1000, i.custDiv, i.custCap), util });
  }
  // визначальний ригель — за найбільшим використанням (міцність, прогини)
  const score = (x: CwTransom) => Math.max(x.util, x.fw / x.fwLim, x.fg / x.fgLim);
  let tW = 0;
  transoms.forEach((x, k) => { if (score(x) > score(transoms[tW])) tW = k; });
  const T0 = transoms[tW];
  {
    const u = T0.util;
    tc.push({ key: "cw_tBend", clause: `${cl}, 6.2.9.1`, formula: "M_x,Ed/M_x,Rd + M_y,Ed/M_y,Rd ≤ 1 (лінійна взаємодія, в запас)",
      subst: `M_x = ${f(i.gW)}·${f(T0.Mx, 3)} = ${f(i.gW * T0.Mx, 3)}; M_y = ${f(i.gG)}·${f(T0.My, 3)} = ${f(i.gG * T0.My, 3)} kN·m; ${f(i.gW * T0.Mx, 3)}/${f(MxRd, 3)} + ${f(i.gG * T0.My, 3)}/${f(MyRd, 3)} = ${f(u, 3)}`, util: u, ok: u <= 1 });
    const uw = T0.fw / T0.fwLim;
    tc.push({ key: "cw_tDeflW", clause: i.limit === "custom" ? "—" : `EN 13830:${i.limit}`, formula: "f_вітер ≤ f_lim(L)", subst: `L = ${(L * 1000).toFixed(0)} mm: ${f(T0.fw, 1)} ≤ ${f(T0.fwLim, 1)} mm`, util: uw, ok: uw <= 1 });
    // кручення і додатковий провис від повороту
    let fTw = 0;
    if (t.Am && t.tt && T0.T > 0) {
      const TEd = i.gG * T0.T, tau = (TEd * 1e6) / (2 * t.Am * 100 * t.tt), tRd = fd / Math.sqrt(3), u = tau / tRd;
      tc.push({ key: "cw_tTors", clause: `${cl}, 6.2.7`, formula: "τ_t = T_Ed/(2·A_m·t) ≤ f_0/(√3·γ_M1); T = P·(e + e0)",
        subst: `T = ${f(i.gG)}·${f(T0.T * 1000, 1)} = ${f(TEd * 1000, 1)} N·m; τ = ${f(tau, 1)} ≤ ${f(tRd, 1)} MPa`, util: u, ok: u <= 1 });
      // I_t коробки ≈ 4·A_m²·t/p, p ≈ 4√A_m (квадратна оцінка); поворот на підкладці θ = T·a/(G·I_t)
      const Am = t.Am * 100, It = (4 * Am * Am * t.tt) / (4 * Math.sqrt(Am)), th = (T0.T * 1e6 * (ab * 1000)) / (G_AL * It);
      fTw = th * (ecc * 1000);
    }
    const fg = T0.fg + fTw, ug = fg / T0.fgLim;
    tc.push({ key: "cw_tDeflG", clause: "EN 13830:2003; практика систем (ift, Stabalux)", formula: "f_скло ≤ min(L/500; 3 mm); f = P·a(3L² − 4a²)/(24EI_y)" + (fTw ? " + θ·(e + e0)" : ""),
      subst: `P = ${f(T0.G / 2, 3)} kN, a = ${i.ab} mm: ${f(T0.fg, 2)}${fTw ? ` + ${f(fTw, 2)}` : ""} = ${f(fg, 2)} ≤ ${f(T0.fgLim, 2)} mm`, util: ug, ok: ug <= 1 });
  }
  const checks = [...mc, ...tc];
  return { pts, supports: geo.supports, hinges: geo.hinges, length: geo.length, q, reactions, Mmax, Vmax, N, Gstorey, selfW, defl, transoms, tWorst: tW, checks, mullionChecks: mc, transomChecks: tc, f0, gM1, shareAl };
}

// ── вітер на фасад ──
/** EN 1991-1-4, табл. 7.1: c_pe,10 і c_pe,1 вертикальних стін; h/d — інтерполяція між 0.25, 1, 5 */
const CPE: Record<"A" | "B" | "C" | "D" | "E", [[number, number], [number, number], [number, number]]> = {
  // [h/d ≤ 0.25, h/d = 1, h/d ≥ 5] × [c_pe,10, c_pe,1]
  A: [[-1.2, -1.4], [-1.2, -1.4], [-1.2, -1.4]],
  B: [[-0.8, -1.1], [-0.8, -1.1], [-0.8, -1.1]],
  C: [[-0.5, -0.5], [-0.5, -0.5], [-0.5, -0.5]],
  D: [[0.7, 1.0], [0.8, 1.0], [0.8, 1.0]],
  E: [[-0.3, -0.3], [-0.5, -0.5], [-0.7, -0.7]],
};
export function cpeWall(zone: keyof typeof CPE, hd: number, area: number) {
  const t = CPE[zone];
  const lerp = (k: 0 | 1) => (hd <= 0.25 ? t[0][k] : hd <= 1 ? t[0][k] + ((t[1][k] - t[0][k]) * (hd - 0.25)) / 0.75 : hd >= 5 ? t[2][k] : t[1][k] + ((t[2][k] - t[1][k]) * (hd - 1)) / 4);
  const c10 = lerp(0), c1 = lerp(1);
  const cpe = area <= 1 ? c1 : area >= 10 ? c10 : c1 - (c1 - c10) * Math.log10(area); // (рис. 7.2)
  return { c10, c1, cpe };
}
