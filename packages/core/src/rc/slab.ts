// Залізобетонна плита прямокутна в плані: балочна або обперта по контуру (вільна, шарнірна або защемлена кожна грань).
// Зусилля — пружний розрахунок пластини МСЕ (елемент МІТЦ4, ν = 0.2), армування за моментами Вуда–Армера,
// перевірки перерізу смуги 1 м — модулем залізобетону (деформаційна модель, зріз без поперечної арматури, тріщини),
// прогин — пружний прогин пластини × відношення кривини з тріщинами і повзучістю до пружної (EN 7.4.3),
// конструювання плит — ДСТУ Б В.2.6-156, 8.3 (EN 9.3).
// Одиниці всередині — мм, Н, МПа; на вході й виході — м, кН/м², кН·м/м, кН/м, мм²/м.
import type { Check, CodeId } from "../codes/types";
import { mkCheck } from "../codes/types";
import { deflectionLimitDSTU } from "../codes/dbn198";
import { shellForces, shellPrepare } from "../analysis/shell";
import type { ShellElement } from "../analysis/shell";
import { skyFactor, SkyMatrix, skySolve } from "../analysis/skyline";
import { checkRc, rcConcrete, rcCurvature, rcUls } from "./rc";
import type { RcInput, RcResult } from "./rc";
import { annex } from "../codes/annex";

export type SlabEdge = "free" | "pin" | "fix";
/** армування на 1 м: діаметр і крок, мм (d = 0 — немає) */
export interface SlabBars { d: number; s: number }
export interface SlabInput {
  code: CodeId; concrete: string; rebar: string;
  /** прольоти (між осями опор), м; товщина, мм; захисний шар до крайнього стрижня, мм */
  lx: number; ly: number; h: number; c: number;
  /** грані: x0 — x = 0, x1 — x = lx, y0 — y = 0, y1 — y = ly */
  edges: { x0: SlabEdge; x1: SlabEdge; y0: SlabEdge; y1: SlabEdge };
  /** навантаження характеристичні, кН/м² (g — без власної ваги) */
  g: number; q: number; selfWeight?: boolean; gammaG?: number; gammaQ?: number; psi2?: number;
  /** армування: низ x (крайній ряд), низ y (над ним), верх x (крайній), верх y (під ним) */
  botX: SlabBars; botY: SlabBars; topX: SlabBars; topY: SlabBars;
  phi?: number; wlim?: number; deflN?: number;
}

export interface SlabField {
  nx: number; ny: number;
  /** у вузлах (рядки по y): моменти Вуда–Армера, кН·м/м (≥ 0); прогин повний, мм */
  mbx: number[]; mby: number[]; mtx: number[]; mty: number[]; w: number[];
}
export interface SlabResult {
  wd: number; wqp: number; selfW: number;
  /** робота: балочна (згин у x або y) або по контуру; відношення більшого прольоту до меншого */
  kind: "x" | "y" | "two"; ratio: number;
  M: { bx: number; by: number; tx: number; ty: number }; V: { x: number; y: number };
  As: { bx: number; by: number; tx: number; ty: number };
  /** прогин: пружний (E_cm, без тріщин), множник кривини, повний; граничний; розрахунковий прольот, м */
  defl: { el: number; k: number; f: number; flim: number; n: number; l: number; dir: "x" | "y" };
  field: SlabField;
  rc: { x: RcResult; xNeg: RcResult; y: RcResult; yNeg: RcResult };
  checks: Check[]; maxUtil: number;
  /** найменше армування ряду (за площею), за якого згин проходить — підказка «Поставити» */
  need: Partial<Record<"botX" | "botY" | "topX" | "topY", SlabBars>>;
}

const barA = (d: number) => (Math.PI * d * d) / 4;
export const slabAs = (b: SlabBars) => (b.d > 0 && b.s > 0 ? (barA(b.d) * 1000) / b.s : 0);

/** Пружна пластина: моменти [mx, my, mxy] (Н·мм/мм, m > 0 — розтяг угорі) у вузлах, |q| у центрах (Н/мм), прогин (мм) від тиску q (МПа, донизу) */
export function slabFem(i: SlabInput, qMPa: number, E: number) {
  const Lx = i.lx * 1000, Ly = i.ly * 1000, sz = Math.min(Lx, Ly) / 16;
  const nx = Math.max(8, Math.min(40, Math.round(Lx / sz))), ny = Math.max(8, Math.min(40, Math.round(Ly / sz)));
  const nn = (nx + 1) * (ny + 1), id = (a: number, b: number) => b * (nx + 1) + a;
  const fixed = new Uint8Array(nn * 3);
  for (let b = 0; b <= ny; b++) for (let a = 0; a <= nx; a++) {
    const es: SlabEdge[] = [a === 0 ? i.edges.x0 : "free", a === nx ? i.edges.x1 : "free", b === 0 ? i.edges.y0 : "free", b === ny ? i.edges.y1 : "free"];
    const k = id(a, b);
    if (es.some((e) => e !== "free")) fixed[k * 3] = 1;
    if (es.some((e) => e === "fix")) { fixed[k * 3 + 1] = 1; fixed[k * 3 + 2] = 1; }
    // «жорсткий» шарнір (як у Кірхгофа): уздовж грані w = 0 ⇒ нахил уздовж грані теж 0 — грань x = const тримає θx, y = const — θy
    if (es[0] === "pin" || es[1] === "pin") fixed[k * 3 + 1] = 1;
    if (es[2] === "pin" || es[3] === "pin") fixed[k * 3 + 2] = 1;
  }
  const eq = new Int32Array(nn * 3).fill(-1);
  let n = 0;
  for (let k = 0; k < nn * 3; k++) if (!fixed[k]) eq[k] = n++;
  const el: ShellElement = { id: "e", nodes: ["1", "2", "3", "4"], t: i.h, E, nu: 0.2 };
  const dx = Lx / nx, dy = Ly / ny;
  const sp = shellPrepare(el, [[0, 0, 0], [dx, 0, 0], [dx, dy, 0], [0, dy, 0]]);
  const LOC = [2, 3, 4]; // w, θx, θy у 6 ступенях вузла
  const K = new SkyMatrix(n), F = new Float64Array(n), fe = (-qMPa * dx * dy) / 4;
  const elemNodes = (a: number, b: number) => [id(a, b), id(a + 1, b), id(a + 1, b + 1), id(a, b + 1)];
  for (let b = 0; b < ny; b++) for (let a = 0; a < nx; a++) {
    const dofs: number[] = [];
    for (const k of elemNodes(a, b)) for (let r = 0; r < 3; r++) dofs.push(eq[k * 3 + r]);
    for (let p = 0; p < 12; p++) {
      if (dofs[p] < 0) continue;
      const rp = Math.floor(p / 3) * 6 + LOC[p % 3];
      for (let q = 0; q <= p; q++) if (dofs[q] >= 0) K.add(dofs[p], dofs[q], sp.K[rp][Math.floor(q / 3) * 6 + LOC[q % 3]]);
      if (p % 3 === 0) F[dofs[p]] += fe;
    }
  }
  const fac = skyFactor(K);
  if (!fac) throw new Error("slab: mechanism");
  const u = skySolve(fac, F);
  const U = (k: number, r: number) => (eq[k * 3 + r] >= 0 ? u[eq[k * 3 + r]] : 0);
  // моменти беремо в центрах елементів (у МІТЦ4 m_x стала вздовж x у межах елемента) і переносимо у вузли
  const w = new Array(nn).fill(0);
  for (let k = 0; k < nn; k++) w[k] = -U(k, 0);
  let qx = 0, qy = 0;
  const z24 = new Array(24).fill(0), ec: number[][] = [];
  for (let b = 0; b < ny; b++) for (let a = 0; a < nx; a++) {
    const ug = new Array(24).fill(0);
    elemNodes(a, b).forEach((k, j) => { for (let r = 0; r < 3; r++) ug[j * 6 + LOC[r]] = U(k, r); });
    const fr = shellForces(el, sp, ug, z24);
    qx = Math.max(qx, Math.abs(fr.c[6])); qy = Math.max(qy, Math.abs(fr.c[7]));
    ec.push(fr.c.slice(3, 6));
  }
  // ваги для вузла p по центрах елементів 0…n−1: усередині — середнє двох, на грані — квадратична екстраполяція з трьох
  const wts = (p: number, ne: number): [number, number][] =>
    p === 0 ? [[0, 15 / 8], [1, -10 / 8], [2, 3 / 8]] : p === ne ? [[ne - 1, 15 / 8], [ne - 2, -10 / 8], [ne - 3, 3 / 8]] : [[p - 1, 0.5], [p, 0.5]];
  const m: number[][] = [];
  for (let b = 0; b <= ny; b++) for (let a = 0; a <= nx; a++) {
    const v = [0, 0, 0];
    for (const [ea, wa] of wts(a, nx)) for (const [eb, wb] of wts(b, ny)) for (let r = 0; r < 3; r++) v[r] += wa * wb * ec[eb * nx + ea][r];
    m.push(v);
  }
  return { nx, ny, m, w, qx, qy };
}

export function checkSlab(i: SlabInput): SlabResult {
  const code = i.code, conc = rcConcrete(code, i.concrete), checks: Check[] = [], DS = "ДСТУ Б В.2.6-156:2010";
  const f = (v: number, n = 2) => (Number.isFinite(v) ? v.toFixed(n) : "—");
  const selfW = i.selfWeight === false ? 0 : (25 * i.h) / 1000;
  const gG = i.gammaG ?? (code === "DBN" ? 1.1 : annex().e1990.gG), gQ = i.gammaQ ?? (code === "DBN" ? 1.2 : annex().e1990.gQ), psi2 = i.psi2 ?? 0.3, phi = i.phi ?? 2;
  const wd = gG * (i.g + selfW) + gQ * i.q, wqp = i.g + selfW + psi2 * i.q;
  const fem = slabFem(i, wd / 1000, conc.Ecm);
  const nn = fem.m.length;
  // Вуд–Армер (спрощено): низ M = −m + |mxy|, верх M = m + |mxy| (≥ 0), кН·м/м
  const mbx: number[] = [], mby: number[] = [], mtx: number[] = [], mty: number[] = [];
  for (const [mx, my, mxy] of fem.m) {
    const t = Math.abs(mxy);
    mbx.push(Math.max(0, -mx + t) / 1000); mby.push(Math.max(0, -my + t) / 1000);
    mtx.push(Math.max(0, mx + t) / 1000); mty.push(Math.max(0, my + t) / 1000);
  }
  const mx = (a: number[]) => Math.max(0, ...a);
  const M = { bx: mx(mbx), by: mx(mby), tx: mx(mtx), ty: mx(mty) }, V = { x: fem.qx, y: fem.qy };
  const kq = wqp / wd;

  // характер роботи
  const sup = (e: SlabEdge) => e !== "free";
  const spanX = sup(i.edges.x0) && sup(i.edges.x1), spanY = sup(i.edges.y0) && sup(i.edges.y1);
  const ratio = Math.max(i.lx, i.ly) / Math.min(i.lx, i.ly);
  const supX = sup(i.edges.x0) || sup(i.edges.x1), supY = sup(i.edges.y0) || sup(i.edges.y1);
  const mX = M.bx, mY = M.by; // за прольотними моментами: опорні від защемлення не роблять плиту балочною
  const kind: SlabResult["kind"] = spanX && !spanY ? "x" : spanY && !spanX ? "y" : spanX && spanY && ratio > 2 ? (i.lx < i.ly ? "x" : "y")
    : !spanX && !spanY && supX !== supY ? (supX ? "x" : "y") : mX >= 2 * mY ? "x" : mY >= 2 * mX ? "y" : "two";

  // перерізи смуг 1 м: x — крайні ряди, y — другі ряди
  const As = { bx: slabAs(i.botX), by: slabAs(i.botY), tx: slabAs(i.topX), ty: slabAs(i.topY) };
  const lay = (b: SlabBars, A: number) => (b.d > 0 && b.s > 0 ? [{ n: Math.max(2, Math.round(1000 / b.s)), d: b.d, As: A }] : []);
  const strip = (dir: "x" | "y", Mb: number, Mt: number, neg: boolean): RcInput => {
    const [bot, top, bo, to] = dir === "x" ? [i.botX, i.topX, 0, 0] : [i.botY, i.topY, i.botX.d, i.topX.d];
    // другий ряд лежить на першому: захисний шар збільшуємо на діаметр першого ряду (низ і верх однаково, у запас — більший)
    const c = i.c + Math.max(bo, to);
    return {
      code, concrete: i.concrete, rebar: i.rebar, b: 1000, h: i.h, member: "slab", c, sw: { d: 0, legs: 0, s: 0, cls: i.rebar },
      bot: lay(bot, dir === "x" ? As.bx : As.by), top: lay(top, dir === "x" ? As.tx : As.ty), mode: "section",
      M: neg ? -Mt : Mb, N: 0, V: dir === "x" ? V.x : V.y, Mqp: neg ? -Mt * kq : Mb * kq, phi, wlim: i.wlim ?? 0.3,
    };
  };
  const rc = { x: checkRc(strip("x", M.bx, M.tx, false)), xNeg: checkRc(strip("x", M.bx, M.tx, true)), y: checkRc(strip("y", M.by, M.ty, false)), yNeg: checkRc(strip("y", M.by, M.ty, true)) };
  const take = (r: RcResult, keys: string[], sfx: "X" | "Y") => {
    for (const c of r.checks) if (keys.includes(c.key)) checks.push({ ...c, key: `${c.key}${sfx}` });
  };
  const posKeys = ["rcM", "rcV", "rcAsMin", "rcAsMax", "rcCrack", "rcAsMinCr"], negKeys = ["rcMneg", "rcCrackNeg", "rcAsMinCrNeg"];
  if (M.bx > 0 || As.bx > 0) take(rc.x, posKeys.filter((k) => M.bx > 0 || !["rcM", "rcCrack", "rcAsMinCr"].includes(k)), "X");
  if (M.tx > 0) take(rc.xNeg, negKeys, "X");
  if (M.by > 0 || As.by > 0) take(rc.y, posKeys.filter((k) => M.by > 0 || !["rcM", "rcCrack", "rcAsMinCr"].includes(k)), "Y");
  if (M.ty > 0) take(rc.yNeg, negKeys, "Y");
  // поперечна сила для плит — без поперечної арматури (V_Rd,c), клауза зі зміною для плити
  for (const c of checks) if (c.key.startsWith("rcV")) c.clause = code === "DBN" ? `${DS}, 4.6.2.1 (4.36), (4.37); 8.3.2` : "EN 1992-1-1, 6.2.2 (6.2)";

  // конструювання плит: крок (8.3.1.3), допоміжна арматура ≥ 20 % (8.3.1.2), часткове защемлення шарнірних граней (8.3.1.6)
  const mainDir: "x" | "y" = kind === "two" ? (mX >= mY ? "x" : "y") : kind;
  const sMain = code === "DBN" ? Math.min(3 * i.h, 400) : annex().e1992.slabS(i.h).main, sSec = code === "DBN" ? Math.min(3 * i.h, 450) : annex().e1992.slabS(i.h).sec;
  const clS = code === "DBN" ? `${DS}, 8.3.1.3` : "EN 1992-1-1, 9.3.1.1 (3)";
  for (const [nm, b, main] of [["botX", i.botX, mainDir === "x"], ["botY", i.botY, mainDir === "y"], ["topX", i.topX, true], ["topY", i.topY, true]] as const) {
    if (!(b.d > 0 && b.s > 0)) continue;
    if (nm.startsWith("top") && (nm === "topX" ? M.tx : M.ty) <= 0) continue;
    const lim = main ? sMain : sSec;
    checks.push(mkCheck(main ? "slSmain" : "slSsec", clS, `s ≤ s_max = ${f(lim, 0)} mm`,
      `${nm}: Ø${b.d}/${b.s}; ${b.s} ≤ ${f(lim, 0)} mm`, b.s / lim));
  }
  if (kind !== "two") {
    const main = mainDir === "x" ? As.bx : As.by, sec = mainDir === "x" ? As.by : As.bx;
    checks.push(mkCheck("slSec20", code === "DBN" ? `${DS}, 8.3.1.2` : "EN 1992-1-1, 9.3.1.1 (2)", "A_s,розп ≥ 0.2·A_s,осн",
      `${f(sec, 0)} ≥ 0.2·${f(main, 0)} = ${f(0.2 * main, 0)} mm²/m`, sec > 0 ? (0.2 * main) / sec : Infinity));
  }
  for (const [dir, e1, e2] of [["x", i.edges.x0, i.edges.x1], ["y", i.edges.y0, i.edges.y1]] as const) {
    if (e1 !== "pin" && e2 !== "pin") continue;
    const Mspan = dir === "x" ? M.bx : M.by, need = 0.15 * Mspan;
    if (need <= 0) continue;
    const r = dir === "x" ? rc.xNeg : rc.yNeg, have = r.neg?.MRd ?? 0;
    checks.push(mkCheck(dir === "x" ? "slFixX" : "slFixY", code === "DBN" ? `${DS}, 8.3.1.6` : "EN 1992-1-1, 9.3.1.2 (2)",
      "M_Rd,верх ≥ 0.15·M_прольоту (на ≥ 0.2·l від грані)", `${f(have)} ≥ 0.15·${f(Mspan)} = ${f(need)} kN·m/m`, have > 0 ? need / have : Infinity));
  }

  // прогин: пружний від квазіпостійного × κ_eff/κ_el у напрямку більшого моменту в точці найбільшого прогину
  let kMax = 0;
  for (let k = 1; k < nn; k++) if (Math.abs(fem.w[k]) > Math.abs(fem.w[kMax])) kMax = k;
  const wEl = Math.abs(fem.w[kMax]) * kq;
  const [mxK, myK, mxyK] = fem.m[kMax];
  const dirD: "x" | "y" = Math.abs(mxK) >= Math.abs(myK) ? "x" : "y";
  const Mq = ((dirD === "x" ? Math.max(0, -mxK) : Math.max(0, -myK)) + Math.abs(mxyK)) / 1000 * kq;
  const sec = strip(dirD, 0, 0, false), cur = rcCurvature(sec, Mq, phi, false);
  const kEl = (Mq * 1e6) / (conc.Ecm * (1000 * i.h ** 3) / 12);
  const kD = kEl > 0 ? cur.k / kEl : 1 + phi;
  const fTot = wEl * kD;
  const ls: number[] = [];
  if (spanX) ls.push(i.lx); if (spanY) ls.push(i.ly);
  if (!ls.length) ls.push(2 * Math.max(sup(i.edges.x0) || sup(i.edges.x1) ? i.lx : 0, sup(i.edges.y0) || sup(i.edges.y1) ? i.ly : 0));
  const lD = Math.min(...ls), cant = !spanX && !spanY;
  const nDen = i.deflN && i.deflN > 0 ? i.deflN : code === "DBN" ? deflectionLimitDSTU(lD) : 250, flim = (lD * 1000) / nDen;
  checks.push(mkCheck("slDefl", code === "DBN" ? `ДБН В.2.6-98:2009, 7.4.4; ${DS}, 5.4; ДСТУ Б В.1.2-3:2006, табл. 1` : "EN 1992-1-1, 7.4.1 (4), 7.4.3 (7.18)",
    `f ≤ ${cant ? "2l" : "l"}/${f(nDen, 0)}`, `f_el = ${f(wEl, 1)} mm × ${f(kD, 2)} (тріщини, φ = ${f(phi, 1)}) = ${f(fTot, 1)} ≤ ${f(flim, 1)} mm`, fTot / flim));

  const scale = kD * kq;
  const field: SlabField = { nx: fem.nx, ny: fem.ny, mbx, mby, mtx, mty, w: fem.w.map((v) => Math.abs(v) * scale) };
  // підбір: діаметри від поточного до 20, кроки 100…300 у межах s_max; найменша площа, за якої M_Rd ≥ M_Ed
  const need: SlabResult["need"] = {};
  for (const [k, Med, dir, top] of [["botX", M.bx, "x", false], ["botY", M.by, "y", false], ["topX", M.tx, "x", true], ["topY", M.ty, "y", true]] as const) {
    const r = dir === "x" ? (top ? rc.xNeg : rc.x) : top ? rc.yNeg : rc.y, have = top ? r.neg?.MRd ?? 0 : r.pos.MRd;
    if (Med <= have) continue;
    const cur = i[k], sMax = top || mainDir === dir ? sMain : sSec, opts: SlabBars[] = [];
    for (const d of [8, 10, 12, 14, 16, 18, 20].filter((d) => d >= Math.max(8, cur.d))) for (const sp of [100, 125, 150, 175, 200, 250, 300].filter((x) => x <= sMax)) opts.push({ d, s: sp });
    opts.sort((a, b) => slabAs(a) - slabAs(b));
    for (const o of opts) {
      const ii = strip(dir, 0, 0, false), lays = lay(o, slabAs(o));
      const si = { ...ii, [top ? "top" : "bot"]: lays } as RcInput;
      if (rcUls(si, conc, 0, top).MRd >= Med) { need[k] = o; break; }
    }
  }
  const maxUtil = Math.max(0, ...checks.map((c) => c.util));
  return { wd, wqp, selfW, kind, ratio, M, V, As, defl: { el: wEl, k: kD, f: fTot, flim, n: nDen, l: lD, dir: dirD }, field, rc, checks, maxUtil, need };
}
