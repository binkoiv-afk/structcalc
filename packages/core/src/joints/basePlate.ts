// Вузол «опорна плита на анкерах»: база колони на фундаменті або кронштейн на анкерах до стіни.
// Складові вузла: профіль, опорна плита, ребра, кутові шви, анкери, бетон. Розрахунок — для кожного сполучення.
// Одиниці: Н, мм, МПа. Зусилля — розрахункові.

import type { CodeId } from "../codes/types";
import { Check, f, mkCheck } from "../codes/types";
import { steel } from "../catalog/materials";
import { checkAnchors } from "../connections/anchors";
import type { AnchorType } from "../connections/anchors";
import { checkFillet, weldShape } from "../connections/welds";
import type { WeldProcess, WeldSeg } from "../connections/welds";
import { jointCompat, layerMat, stackEffect } from "./stack";
import type { CompatInput, CompatNote, StackLayer } from "./stack";

export type NodeKind = "base" | "bracket";

/** Профіль, що приходить у вузол: двотавр або прямокутна труба. Для кронштейна потрібні A, Wy, Wz, Avz. */
export interface NodeProfile {
  /** CHS: h = b = d, tw = tf = t */
  kind: "I" | "RHS" | "CHS";
  h: number; b: number; tw: number; tf: number;
  A?: number; Wy?: number; Wz?: number; Avz?: number;
}

/** Сполучення навантажень.
 *  base: N (+ стиск), My — момент у площині стінки, Mz — з площини, Vz — вздовж стінки, Vy — поперек;
 *  bracket: P — вертикальна сила на кінці (вниз +), H — висмикування від стіни (+), Q — бічна сила. */
export interface NodeCombo { name: string; N?: number; My?: number; Mz?: number; Vz?: number; Vy?: number; P?: number; H?: number; Q?: number;
  /** base: крутний момент навколо осі колони, Н·мм */
  T?: number }

export interface BasePlateInput {
  code: CodeId;
  kind: NodeKind;
  profile: NodeProfile;
  profileSteel: string;
  /** виліт кронштейна від стіни до точки прикладання сил, мм */
  lever?: number;
  /** плита: L — вздовж висоти профілю h, B — вздовж ширини b */
  plate: { L: number; B: number; t: number; steel: string;
    /** зрізані кути плити (катет 45°), мм */
    chamfer?: number };
  /** зміщення осі профілю від центра плити, мм (x — вздовж L) */
  offset?: { x: number; y: number };
  /** кронштейн: точка прикладання сил відносно осі профілю в площині плити, мм (x — вгору, y — вбік) */
  loadPoint?: { x: number; y: number };
  /** пакет між плитою і основою, зверху вниз (прокладки, підливка); якщо заданий — замінює concrete.grout */
  stack?: StackLayer[];
  /** метали деталей і середовище — для перевірки сумісності */
  compat?: Omit<CompatInput, "stack" | "welded" | "base">;
  /** ребра: web — по осі стінки за полицями (2 шт.), tips — по краях полиць (4 шт.; для труби — поперечні 2 шт.).
   *  on — застаріле, те саме що web */
  ribs: { web?: boolean; tips?: boolean; on?: boolean; hr: number; tr: number;
    /** висота ребра біля краю плити, мм (форма — трапеція; за замовчуванням 0.3·h_r) */
    hr2?: number; };
  weld: { kf: number; process: WeldProcess; milled: boolean };
  anchors: {
    type: AnchorType; d: number; steel: string; hef: number; dh?: number;
    nx: number; ny: number; sx: number; sy: number;
    /** довільні координати анкерів від центра плити (x — вздовж L), замість сітки */
    points?: { x: number; y: number }[];
    NRkp?: number; tauRk?: number;
  };
  /** reinforced — армування обмежує тріщини від розколювання (EN 1992-4, 7.2.1.7(2) b)) */
  concrete: { fck: number; cracked: boolean; Lc: number; Bc: number; h: number; grout: number; reinforced?: boolean };
  /** передача зсуву тертям 0.2·N_c (EN 1993-1-8, 6.2.2(6)) */
  friction: boolean;
  gammaC?: number;
  gammaN?: number;
  combos: NodeCombo[];
}

export interface NodeComboResult {
  name: string;
  checks: Check[];
  values: { k: string; v: string }[];
  maxUtil: number;
  ok: boolean;
  forces: { x: number; y: number; N: number; V: number }[];
  sigC: number;
  /** зусилля, зведені до центра плити */
  Nc: number; Ms: number; Mw: number; Vs: number; Vw: number; T: number;
}

export interface NodeResult {
  combos: NodeComboResult[];
  /** обвідна: для кожної перевірки — найгірше сполучення */
  envelope: (Check & { combo: string })[];
  governing: number;
  maxUtil: number;
  ok: boolean;
  /** сумісність матеріалів і роботи пакета */
  compat: CompatNote[];
  /** мінімальна довжина анкера над бетоном: пакет + плита + шайба + гайка + 2 нитки */
  anchorStickout: number;
}

// Коефіцієнти Б.Г. Галеркіна для плит, що обперті на 4 сторони (α) і на 3 сторони (β)
const ALPHA4: [number, number][] = [[1, 0.048], [1.1, 0.055], [1.2, 0.063], [1.3, 0.069], [1.4, 0.075], [1.5, 0.081], [1.6, 0.086], [1.7, 0.091], [1.8, 0.094], [1.9, 0.098], [2, 0.1], [1e9, 0.125]];
const BETA3: [number, number][] = [[0.5, 0.06], [0.6, 0.074], [0.7, 0.088], [0.8, 0.097], [0.9, 0.107], [1, 0.112], [1.2, 0.12], [1.4, 0.126], [2, 0.132], [1e9, 0.133]];
function interp(t: [number, number][], x: number) {
  if (x <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) if (x <= t[i][0]) {
    if (t[i][0] > 1e8) return t[i - 1][1] + (t[i][1] - t[i - 1][1]) * Math.min(1, (x - t[i - 1][0]) / 2);
    return t[i - 1][1] + ((t[i][1] - t[i - 1][1]) * (x - t[i - 1][0])) / (t[i][0] - t[i - 1][0]);
  }
  return t[t.length - 1][1];
}

export interface PlatePanel { id: string; support: "4" | "3" | "2" | "cant"; a: number; b: number; coef: number; M: number }

const ribFlags = (r: BasePlateInput["ribs"]) => ({ web: !!(r.web ?? r.on), tips: !!r.tips });

/** Згинальні моменти в ділянках плити від рівномірного відпору σ (на 1 мм ширини). */
export function platePanels(p: NodeProfile, L: number, B: number, ribs: BasePlateInput["ribs"], sigma: number): PlatePanel[] {
  const out: PlatePanel[] = [];
  const { web, tips } = ribFlags(ribs);
  const add = (id: string, support: PlatePanel["support"], a: number, b: number) => {
    if (a <= 0 || (support !== "cant" && b <= 0)) return;
    let coef: number, M: number;
    if (support === "cant") { coef = 0.5; M = 0.5 * sigma * a * a; }
    else if (support === "4") { const s = Math.min(a, b), l = Math.max(a, b); coef = interp(ALPHA4, l / s); M = coef * sigma * s * s; a = s; b = l; }
    else {
      // 3 сторони або 2 суміжні (a — вільна сторона / діагональ, b — до неї)
      if (b / a < 0.5) { coef = 0.5; M = 0.5 * sigma * b * b; support = "cant"; [a, b] = [b, a]; }
      else { coef = interp(BETA3, b / a); M = coef * sigma * a * a; }
    }
    out.push({ id, support, a, b, coef, M });
  };
  const two = (id: string, c: number, w: number) => { const d = Math.hypot(c, w); add(id, "2", d, (c * w) / d); };
  const cL = (L - p.h) / 2, cB = (B - p.b) / 2;
  if (p.kind === "I") add("between", "3", p.h - 2 * p.tf, (p.b - p.tw) / 2);
  else add("inside", "4", p.h - 2 * p.tf, p.b - 2 * p.tw);
  if (p.kind === "CHS") {
    if (cL > 0) web ? two("outRib", cL, (B - ribs.tr) / 2) : add("outL", "cant", cL, 0);
    if (cB > 0) tips ? two("outRibB", cB, (L - ribs.tr) / 2) : add("sideB", "cant", cB, 0);
    return out;
  }
  if (cB > 0) add("sideB", "cant", cB, 0);
  if (cL > 0) {
    if (web && tips) add("outRibs3", "3", p.b / 2 - ribs.tr, cL);
    else if (tips) add("outRibs3", "3", p.b - ribs.tr, cL);
    else if (web) two("outRib", cL, (B - ribs.tr) / 2);
    else add("outL", "cant", cL, 0);
  }
  return out;
}

/** Відстань від точки до відрізка */
function distSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
  return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
}

/** Зведення сполучення до зусиль на плиті: Nc (+ стиск), Ms (розтяг з боку +x), Mw (розтяг з боку +y), Vs, Vw */
export function comboToPlate(i: BasePlateInput, c: NodeCombo) {
  const pr = profileForces(i, c);
  const ex = i.offset?.x ?? 0, ey = i.offset?.y ?? 0;
  // перенос з осі профілю (ex, ey) у центр плити: стиск N у точці +ex зменшує розтяг з боку +x
  return { Nc: pr.Nc, Ms: pr.Ms - pr.Nc * ex, Mw: pr.Mw - pr.Nc * ey, Vs: pr.Vs, Vw: pr.Vw, T: pr.T + ex * pr.Vw - ey * pr.Vs };
}

/** Зусилля на осі профілю біля плити (для шва і кореня кронштейна) */
export function profileForces(i: BasePlateInput, c: NodeCombo) {
  if (i.kind === "bracket") {
    // x плити — вгору, P діє вниз (−x), Q — вбік (+y), H — від стіни
    const e = i.lever ?? 0, P = c.P ?? 0, H = c.H ?? 0, Q = c.Q ?? 0;
    const lx = i.loadPoint?.x ?? 0, ly = i.loadPoint?.y ?? 0;
    return { Nc: -H, Ms: P * e + H * lx, Mw: Q * e + H * ly, Vs: -P, Vw: Q, T: lx * Q + ly * P };
  }
  return { Nc: c.N ?? 0, Ms: c.My ?? 0, Mw: c.Mz ?? 0, Vs: c.Vz ?? 0, Vw: c.Vy ?? 0, T: c.T ?? 0 };
}

function checkCombo(i: BasePlateInput, c: NodeCombo): NodeComboResult {
  const gc = i.gammaC ?? 1, gn = i.gammaN ?? 1;
  const p = i.profile, pl = i.plate, an = i.anchors, cc = i.concrete;
  const { Nc, Ms, Mw, Vs, Vw, T } = comboToPlate(i, c);
  const pf = profileForces(i, c);
  const ex = i.offset?.x ?? 0, ey = i.offset?.y ?? 0;
  const se = stackEffect(i.stack ?? (cc.grout > 0 ? [{ mat: "grout", t: cc.grout }] : []), an.d);
  const dbn = i.code === "DBN";
  const checks: Check[] = [];
  const values: { k: string; v: string }[] = [];

  // ---------- 1. Тертя під плитою ----------
  const V = Math.hypot(Vs, Vw);
  const Ff = i.friction && se.frictionOk && Nc > 0 ? 0.2 * Nc : 0;
  const kV = V > 0 ? Math.max(0, V - Ff) / V : 0;
  if (Ff > 0) values.push({ k: "F_f,Rd = 0.2·N_c", v: `${f(Ff / 1000)} kN` });

  // ---------- 2. Анкери + розподіл тиску під плитою ----------
  const apts = anchorPoints(an);
  const xMin = Math.min(...apts.map((q) => q.x)), xMax = Math.max(...apts.map((q) => q.x));
  const yMin = Math.min(...apts.map((q) => q.y)), yMax = Math.max(...apts.map((q) => q.y));
  // бетон центрований по плиті
  const edge = (v: number) => (Number.isFinite(v) ? Math.max(v, 1) : Infinity);
  const ar = checkAnchors({
    code: i.code, type: an.type, d: an.d, dh: an.dh, hef: an.hef, steel: an.steel, fck: cc.fck, cracked: cc.cracked, h: cc.h,
    nx: an.nx, ny: an.ny, sx: an.sx, sy: an.sy, points: apts,
    cxm: edge(cc.Lc / 2 + xMin), cxp: edge(cc.Lc / 2 - xMax), cym: edge(cc.Bc / 2 + yMin), cyp: edge(cc.Bc / 2 - yMax),
    bx: pl.L, by: pl.B, N: -Nc, My: Ms, Mx: Mw, Vx: Vs * kV, Vy: Vw * kV, T: T * kV,
    // зсув з плечем, якщо підливка товща за d/2 (EN 1992-4, 6.2.2.3); плита з гайками з двох боків не повертається — α_M = 2
    // з піддатливими шарами — плече через увесь неметалевий пакет і α_M = 1 (див. stackEffect)
    standoff: se.standoff, alphaM: se.alphaM, NRkp: an.NRkp, tauRk: an.tauRk, gammaN: gn, splitReinf: cc.reinforced,
  });
  checks.push(...ar.checks);
  const sig = ar.sigC;

  // ---------- 3. Бетон під плитою ----------
  const fcd = cc.fck / 1.5;
  const L1 = Math.min(cc.Lc, 3 * pl.L, pl.L + cc.h), B1 = Math.min(cc.Bc, 3 * pl.B, pl.B + cc.h);
  const alpha = Math.max(1, Math.min(3, Math.sqrt((L1 * B1) / (pl.L * pl.B))));
  const betaJ = 2 / 3;
  const fjd = betaJ * alpha * fcd;
  if (sig > 0) {
    values.push({ k: "σ_c,max", v: `${f(sig, 2)} MPa` });
    checks.push(mkCheck("nodeBearing", "EN 1993-1-8, 6.2.5, (6.6); EN 1992-1-1, 6.7, (6.63)",
      "σ_c,max / f_jd ≤ 1, f_jd = β_j·α·f_cd, α = √(A_c1/A_c0) ≤ 3",
      `f_cd = ${cc.fck}/1.5 = ${f(fcd, 2)} MPa; A_c1 = ${f(L1, 0)}×${f(B1, 0)}; α = ${f(alpha, 3)}; f_jd = ${f(betaJ, 3)}·${f(alpha, 3)}·${f(fcd, 2)} = ${f(fjd, 2)} MPa; ${f(sig, 2)} / ${f(fjd, 2)}`,
      sig / fjd, ["linearPressure"]));
    if (se.tGrout > 0.2 * Math.min(pl.L, pl.B)) checks.push(mkCheck("nodeGrout", "EN 1993-1-8, 6.2.5(7)", "t_g ≤ 0.2·min(L; B)", `${se.tGrout} ≤ ${f(0.2 * Math.min(pl.L, pl.B), 0)} mm`, se.tGrout / (0.2 * Math.min(pl.L, pl.B))));
    // зминання шарів пакета: тиск з площі плити на площу прокладки (без розподілу через шари — в запас)
    se.layers.forEach((l, k) => {
      if (l.m.group === "metal") return;
      const Ll = Math.min(l.L ?? pl.L, pl.L), Bl = Math.min(l.B ?? pl.B, pl.B);
      const sl = sig * (pl.L * pl.B) / (Ll * Bl), fd = l.fd ?? l.m.fd;
      checks.push(mkCheck("nodeLayerBearing", `шар ${k + 1}: ${l.m.ref.split(":")[0]}, t = ${l.t} mm${Ll < pl.L || Bl < pl.B ? `, ${f(Ll, 0)}×${f(Bl, 0)} mm` : ""}`,
        "σ_c,max·A_пл/A_шару ≤ f_d,шару", `${f(sig, 2)}·${f(pl.L * pl.B / (Ll * Bl), 3)} = ${f(sl, 2)} / ${f(fd, 2)} MPa (${l.fd ? "f_d задано" : l.m.ref.includes(":") ? l.m.ref.split(":").slice(1).join(":").trim() : "f_d типове"})`, sl / fd));
    });
  }

  // ---------- 4. Плита: згин від відпору бетону ----------
  const pst = steel(pl.steel);
  const Ryp = pst.strength(pl.t, "sheet");
  const Rp = dbn ? Ryp * gc : Ryp; // EN: γM0 = 1.0
  const pRef = dbn ? "R_y·γ_c" : "f_y/γ_M0";
  if (sig > 0) {
    // профіль зміщено — більший виліт з одного боку; рахуємо як симетричну плиту з більшим вильотом (в запас)
    const panels = platePanels(p, pl.L + 2 * Math.abs(ex), pl.B + 2 * Math.abs(ey), i.ribs, sig);
    const g = panels.reduce((a, b) => (b.M > a.M ? b : a), panels[0]);
    if (g) {
      const s = (6 * g.M) / (pl.t * pl.t);
      const treq = Math.sqrt((6 * g.M) / Rp);
      values.push({ k: "M_max (плита)", v: `${f(g.M / 1000, 3)} kN·m/m` });
      values.push({ k: "t_треб.", v: `${f(treq, 1)} mm` });
      const sup = { "4": "4 сторони, α", "3": "3 сторони, β", "2": "2 суміжні, β (діагональ)", cant: "консоль" }[g.support];
      checks.push(mkCheck("nodePlateBend", dbn ? "ДБН В.2.6-198, п. 9.2.1, ф. (9.1); Посібник до СНиП II-23-81*, ділянки плити (Б.Г. Галеркін)" : "EN 1993-1-8, 6.2.5(4), (6.5); EN 1993-1-1, 6.2.5",
        `6·M_max / t² ≤ ${pRef}`, `ділянка «${g.id}» (${sup}): a = ${f(g.a, 0)}, b = ${f(g.b, 0)} mm, k = ${f(g.coef, 3)}; M = ${f(g.M, 0)} N·mm/mm; σ = 6·${f(g.M, 0)}/${pl.t}² = ${f(s, 1)} / ${f(Rp, 0)} MPa`,
        s * gn / Rp, [`panel_${g.id}`]));
    }
  }

  // ---------- 5. Плита: згин від розтягнутих анкерів (Т-подібний елемент) ----------
  const kf = i.weld.kf;
  const sup: [number, number, number, number][] = [];
  const rf = ribFlags(i.ribs);
  if (p.kind === "CHS") {
    // коло — ламаною з 36 відрізків
    for (let k = 0; k < 36; k++) {
      const a0 = (k / 36) * 2 * Math.PI, a1 = ((k + 1) / 36) * 2 * Math.PI, r0 = p.h / 2;
      sup.push([r0 * Math.cos(a0), r0 * Math.sin(a0), r0 * Math.cos(a1), r0 * Math.sin(a1)]);
    }
    if (rf.tips) sup.push([0, p.h / 2, 0, pl.B / 2], [0, -p.h / 2, 0, -pl.B / 2]);
  } else if (p.kind === "I") {
    sup.push([p.h / 2, -p.b / 2, p.h / 2, p.b / 2], [-p.h / 2, -p.b / 2, -p.h / 2, p.b / 2]);
    sup.push([-p.h / 2 + p.tf, p.tw / 2, p.h / 2 - p.tf, p.tw / 2], [-p.h / 2 + p.tf, -p.tw / 2, p.h / 2 - p.tf, -p.tw / 2]);
  } else {
    sup.push([p.h / 2, -p.b / 2, p.h / 2, p.b / 2], [-p.h / 2, -p.b / 2, -p.h / 2, p.b / 2], [-p.h / 2, p.b / 2, p.h / 2, p.b / 2], [-p.h / 2, -p.b / 2, p.h / 2, -p.b / 2]);
  }
  // зсув опорних ліній на вісь профілю; ребра доходять до краю плити
  for (const q of sup) { q[0] += ex; q[2] += ex; q[1] += ey; q[3] += ey; }
  if (p.kind === "CHS" && rf.tips) { sup[sup.length - 2][3] = pl.B / 2; sup[sup.length - 1][3] = -pl.B / 2; }
  if (rf.web) sup.push([ex + p.h / 2, ey, pl.L / 2, ey], [ex - p.h / 2, ey, -pl.L / 2, ey]);
  if (rf.tips && p.kind !== "CHS") for (const sy of [-1, 1]) for (const sx of [-1, 1]) sup.push([ex + sx * p.h / 2, ey + sy * p.b / 2, sx * pl.L / 2, ey + sy * p.b / 2]);
  const ch = Math.max(0, pl.chamfer ?? 0);
  let worstT: { u: number; s: string } | null = null;
  for (const a of ar.forces) {
    if (a.N <= 0) continue;
    const m0 = Math.min(...sup.map((s) => distSeg(a.x, a.y, ...s)));
    const m = Math.max(m0 - 0.8 * kf, an.d / 2);
    let e = Math.min(pl.L / 2 - Math.abs(a.x), pl.B / 2 - Math.abs(a.y));
    // зрізаний кут: відстань до лінії зрізу
    if (ch > 0) e = Math.max(0, Math.min(e, (pl.L / 2 + pl.B / 2 - ch - Math.abs(a.x) - Math.abs(a.y)) / Math.SQRT2));
    let leff = Math.min(2 * Math.PI * m, 4 * m + 1.25 * e);
    // сусідні анкери ділять ширину плити
    const sNear = Math.min(...ar.forces.filter((q) => q !== a).map((q) => Math.hypot(q.x - a.x, q.y - a.y)));
    if (Number.isFinite(sNear)) leff = Math.min(leff, sNear);
    const Mpl = 0.25 * leff * pl.t * pl.t * Rp;
    const FT = (2 * Mpl) / m;
    const u = a.N / FT;
    if (!worstT || u > worstT.u)
      worstT = { u, s: `m = ${f(m, 0)} mm; e = ${f(e, 0)} mm; l_eff = min(2πm; 4m + 1.25e) = ${f(leff, 0)} mm; M_pl = 0.25·l_eff·t²·${pRef} = ${f(Mpl / 1e6, 3)} kN·m; F_T = 2M_pl/m = ${f(FT / 1000)} kN; ${f(a.N / 1000)} / ${f(FT / 1000)} kN` };
  }
  if (worstT) checks.push(mkCheck("nodePlateTension", "EN 1993-1-8, 6.2.6.11, 6.2.4, табл. 6.2, 6.6 (без важеля)", "F_t,Ed / (2·M_pl,Rd/m) ≤ 1", worstT.s, worstT.u));

  // ---------- 6. Шов профіль — плита ----------
  const cst = steel(i.profileSteel);
  const Run = Math.min(cst.ultimate(p.tf, "shaped"), pst.ultimate(pl.t, "sheet"));
  const Ryn = Math.min(cst.yieldChar(p.tf, "shaped"), pst.yieldChar(pl.t, "sheet"));
  const segs: WeldSeg[] = p.kind === "CHS"
    ? Array.from({ length: 36 }, (_, k) => {
      const a0 = (k / 36) * 2 * Math.PI, a1 = ((k + 1) / 36) * 2 * Math.PI, r0 = p.h / 2;
      return { y1: r0 * Math.cos(a0), z1: r0 * Math.sin(a0), y2: r0 * Math.cos(a1), z2: r0 * Math.sin(a1) };
    })
    : weldShape(p.kind === "I" ? "iProfile" : "rhs", { b: p.b, h: p.h, tf: p.tf, tw: p.tw });
  let Nw = -pf.Nc;
  if (i.weld.milled && Nw < 0) Nw = 0;
  const wr = checkFillet({
    code: i.code, segs, kf, process: i.weld.process, Run, Ryn, tmin: Math.min(p.tf, pl.t), tmax: Math.max(p.tf, pl.t),
    N: Nw, Vy: pf.Vw, Vz: pf.Vs, Mx: pf.T, My: pf.Ms, Mz: -pf.Mw, gammaC: gc, gammaN: gn,
  });
  // шов по колу — замкнений, перевірка мінімальної довжини окремих ділянок не потрібна
  checks.push(...wr.checks.filter((ch) => !(p.kind === "CHS" && ch.key === "weldLmin")).map((ch) => ({ ...ch, clause: ch.clause + " — профіль/плита" })));

  // ---------- 7. Ребра ----------
  const cL = (pl.L - p.h) / 2 + Math.abs(ex), cB = (pl.B - p.b) / 2 + Math.abs(ey);
  const ribCases: { id: string; c: number; w: number }[] = [];
  if (p.kind === "CHS") {
    if (rf.web && cL > 0) ribCases.push({ id: "web", c: cL, w: pl.B / 2 });
    if (rf.tips && cB > 0) ribCases.push({ id: "tips", c: cB, w: pl.L / 2 });
  } else if (cL > 0) {
    if (rf.web) ribCases.push({ id: "web", c: cL, w: rf.tips ? p.b / 2 : pl.B / 2 });
    if (rf.tips) ribCases.push({ id: "tips", c: cL, w: (rf.web ? p.b / 4 : p.b / 2) + Math.max(0, cB) });
  }
  if (ribCases.length && sig > 0) {
    const rc = ribCases.reduce((a, b) => (b.w * b.c * b.c > a.w * a.c * a.c ? b : a));
    const { c, w } = rc;
    const Mr = (sig * w * c * c) / 2, Qr = sig * w * c;
    const Ryr = pst.strength(i.ribs.tr, "sheet") * (dbn ? gc : 1);
    const sr = (6 * Mr) / (i.ribs.tr * i.ribs.hr ** 2), tr = (1.5 * Qr) / (i.ribs.tr * i.ribs.hr);
    const lbl = rc.id === "web" ? "ребро по осі стінки" : "ребро по краю полиці";
    checks.push(mkCheck("nodeRibBend", dbn ? "ДБН В.2.6-198, п. 9.2.1, ф. (9.1)" : "EN 1993-1-1, 6.2.5", `6M/(t_r·h_r²) ≤ ${pRef}`,
      `${lbl}: тиск з ширини ${f(w, 0)} mm, виліт ${f(c, 0)} mm; M = ${f(Mr / 1e6, 3)} kN·m; σ = ${f(sr, 1)} / ${f(Ryr, 0)} MPa`, sr * gn / Ryr));
    checks.push(mkCheck("nodeRibShear", dbn ? "ДБН В.2.6-198, п. 9.2.1, ф. (9.2)" : "EN 1993-1-1, 6.2.6", `1.5Q/(t_r·h_r) ≤ ${dbn ? "R_s·γ_c" : "f_y/(√3·γ_M0)"}`,
      `${lbl}: Q = ${f(Qr / 1000)} kN; τ = ${f(tr, 1)} / ${f(Ryr / Math.sqrt(3), 0)} MPa`, (tr * gn) / (Ryr / Math.sqrt(3))));
    const rw = checkFillet({
      code: i.code, segs: weldShape("lines2v", { b: i.ribs.tr, h: i.ribs.hr }), kf, process: i.weld.process, Run, Ryn,
      tmin: Math.min(i.ribs.tr, p.tf), tmax: Math.max(i.ribs.tr, p.tf), N: 0, Vy: 0, Vz: Qr, Mx: 0, My: Mr, Mz: 0, gammaC: gc, gammaN: gn,
    });
    checks.push(...rw.checks.filter((ch) => ch.key !== "weldLmin").map((ch) => ({ ...ch, key: ch.key + "Rib", clause: ch.clause + ` — ${lbl}` })));
  }

  // ---------- 8. Корінь кронштейна ----------
  if (i.kind === "bracket" && p.A && p.Wy) {
    const Ry = cst.strength(p.tf, "shaped") * (dbn ? gc : 1);
    const Mb = Math.abs(pf.Ms), Mwb = Math.abs(pf.Mw);
    const s = Math.abs(pf.Nc) / p.A + Mb / p.Wy + (p.Wz ? Mwb / p.Wz : 0);
    // кручення від зміщеної сили: відкритий двотавр — τ = T·t/I_t; труби — формула Бредта
    const Tt = Math.abs(pf.T);
    const tauT = Tt === 0 ? 0 : p.kind === "I" ? (Tt * Math.max(p.tf, p.tw)) / ((2 * p.b * p.tf ** 3 + (p.h - 2 * p.tf) * p.tw ** 3) / 3)
      : p.kind === "RHS" ? Tt / (2 * (p.h - p.tf) * (p.b - p.tw) * p.tw) : Tt / (2 * Math.PI * ((p.h - p.tw) / 2) ** 2 * p.tw);
    const tau = Math.abs(pf.Vs) / (p.Avz ?? (p.h - 2 * p.tf) * p.tw) + tauT;
    const red = Math.sqrt(s * s + 3 * tau * tau);
    checks.push(mkCheck("nodeRootNormal", dbn ? "ДБН В.2.6-198, п. 9.2.1, ф. (9.1)" : "EN 1993-1-1, 6.2.1, (6.1)", `N/A + M_y/W_y + M_z/W_z ≤ ${dbn ? "R_y·γ_c" : "f_y/γ_M0"}`,
      `M_y = ${f(Mb / 1e6, 2)} kN·m; σ = ${f(s, 1)} / ${f(Ry, 0)} MPa`, (s * gn) / Ry));
    checks.push(mkCheck("nodeRootReduced", dbn ? "ДБН В.2.6-198, п. 9.2.1, ф. (9.4)" : "EN 1993-1-1, 6.2.1, (6.1)", `${dbn ? "0.87·√(σ² + 3τ²) ≤ R_y·γ_c" : "√(σ² + 3τ²) ≤ f_y/γ_M0"}`,
      `τ = ${tauT > 0 ? `τ_V + τ_T = ${f(tau - tauT, 1)} + ${f(tauT, 1)} = ` : ""}${f(tau, 1)} MPa; √(${f(s, 1)}² + 3·${f(tau, 1)}²) = ${f(red, 1)} / ${f((dbn ? 1.15 : 1) * Ry, 0)} MPa`, (red * gn) / ((dbn ? 1.15 : 1) * Ry)));
  }

  values.push(...ar.values.filter((v) => !v.k.startsWith("σ_c")));
  const u = checks.map((x) => x.util);
  return {
    name: c.name, checks, values, forces: ar.forces, sigC: sig, Nc, Ms, Mw, Vs, Vw, T,
    maxUtil: u.some((x) => Number.isNaN(x)) ? NaN : Math.max(0, ...u), ok: checks.every((x) => x.ok),
  };
}

export function checkBasePlate(i: BasePlateInput): NodeResult {
  const combos = (i.combos.length ? i.combos : [{ name: "1" }]).map((c, k) => checkCombo(i, { ...c, name: c.name.trim() || String(k + 1) }));
  const env = new Map<string, Check & { combo: string }>();
  for (const r of combos) for (const ch of r.checks) {
    const id = ch.key + "|" + ch.clause;
    const cur = env.get(id);
    if (!cur || ch.util > cur.util || Number.isNaN(ch.util)) env.set(id, { ...ch, combo: r.name });
  }
  const envelope = [...env.values()];
  let governing = 0;
  combos.forEach((r, k) => { if (!(combos[governing].maxUtil >= r.maxUtil)) governing = k; });
  const u = envelope.map((c) => c.util);
  const stack = i.stack ?? (i.concrete.grout > 0 ? [{ mat: "grout", t: i.concrete.grout }] : []);
  stack.forEach((l) => layerMat(l.mat));
  const compat = i.compat ? jointCompat({ ...i.compat, stack, welded: true, base: "concrete" }) : [];
  const d = i.anchors.d;
  const anchorStickout = stack.reduce((a, l) => a + l.t, 0) + i.plate.t + 0.15 * d + 4 + 0.8 * d + 2 * Math.max(1.5, 0.12 * d);
  return { combos, envelope, governing, maxUtil: u.some((x) => Number.isNaN(x)) ? NaN : Math.max(0, ...u), ok: envelope.every((c) => c.ok), compat, anchorStickout };
}

/** Координати анкерів від центра плити: задані вручну або сітка nx × ny */
export function anchorPoints(an: BasePlateInput["anchors"]): { x: number; y: number }[] {
  if (an.points?.length) return an.points;
  const pts: { x: number; y: number }[] = [];
  for (let a = 0; a < an.nx; a++) for (let b = 0; b < an.ny; b++) pts.push({ x: (a - (an.nx - 1) / 2) * an.sx, y: (b - (an.ny - 1) / 2) * an.sy });
  return pts;
}
