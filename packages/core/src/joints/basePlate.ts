// Вузол «опорна плита на анкерах»: база колони на фундаменті або кронштейн на анкерах до стіни.
// Складові вузла: профіль, опорна плита, ребра, кутові шви, анкери, бетон. Розрахунок — для кожного сполучення.
// Одиниці: Н, мм, МПа. Зусилля — розрахункові.

import type { CodeId } from "../codes/types";
import { Check, f, mkCheck } from "../codes/types";
import { steel } from "../catalog/materials";
import { checkAnchors } from "../connections/anchors";
import type { AnchorType } from "../connections/anchors";
import { checkFillet, weldShape } from "../connections/welds";
import type { WeldProcess } from "../connections/welds";

export type NodeKind = "base" | "bracket";

/** Профіль, що приходить у вузол: двотавр або прямокутна труба. Для кронштейна потрібні A, Wy, Wz, Avz. */
export interface NodeProfile {
  kind: "I" | "RHS";
  h: number; b: number; tw: number; tf: number;
  A?: number; Wy?: number; Wz?: number; Avz?: number;
}

/** Сполучення навантажень.
 *  base: N (+ стиск), My — момент у площині стінки, Mz — з площини, Vz — вздовж стінки, Vy — поперек;
 *  bracket: P — вертикальна сила на кінці (вниз +), H — висмикування від стіни (+), Q — бічна сила. */
export interface NodeCombo { name: string; N?: number; My?: number; Mz?: number; Vz?: number; Vy?: number; P?: number; H?: number; Q?: number }

export interface BasePlateInput {
  code: CodeId;
  kind: NodeKind;
  profile: NodeProfile;
  profileSteel: string;
  /** виліт кронштейна від стіни до точки прикладання сил, мм */
  lever?: number;
  /** плита: L — вздовж висоти профілю h, B — вздовж ширини b */
  plate: { L: number; B: number; t: number; steel: string };
  /** ребра по осі стінки за межами полиць (2 шт.) */
  ribs: { on: boolean; hr: number; tr: number };
  weld: { kf: number; process: WeldProcess; milled: boolean };
  anchors: {
    type: AnchorType; d: number; steel: string; hef: number; dh?: number;
    nx: number; ny: number; sx: number; sy: number;
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
  /** зусилля, зведені до плити */
  Nc: number; Ms: number; Mw: number; Vs: number; Vw: number;
}

export interface NodeResult {
  combos: NodeComboResult[];
  /** обвідна: для кожної перевірки — найгірше сполучення */
  envelope: (Check & { combo: string })[];
  governing: number;
  maxUtil: number;
  ok: boolean;
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

/** Згинальні моменти в ділянках плити від рівномірного відпору σ (на 1 мм ширини). */
export function platePanels(p: NodeProfile, L: number, B: number, ribs: BasePlateInput["ribs"], sigma: number): PlatePanel[] {
  const out: PlatePanel[] = [];
  const add = (id: string, support: PlatePanel["support"], a: number, b: number) => {
    if (a <= 0 && b <= 0) return;
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
  const cL = (L - p.h) / 2, cB = (B - p.b) / 2;
  if (p.kind === "I") add("between", "3", p.h - 2 * p.tf, (p.b - p.tw) / 2);
  else add("inside", "4", p.h - 2 * p.tf, p.b - 2 * p.tw);
  if (cB > 0) add("sideB", "cant", cB, 0);
  if (cL > 0) {
    if (ribs.on) {
      const bs = (B - ribs.tr) / 2, d = Math.hypot(cL, bs);
      add("outRib", "2", d, (cL * bs) / d);
    } else add("outL", "cant", cL, 0);
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
  if (i.kind === "bracket") {
    const e = i.lever ?? 0, P = c.P ?? 0, H = c.H ?? 0, Q = c.Q ?? 0;
    return { Nc: -H, Ms: P * e, Mw: Q * e, Vs: P, Vw: Q };
  }
  return { Nc: c.N ?? 0, Ms: c.My ?? 0, Mw: c.Mz ?? 0, Vs: c.Vz ?? 0, Vw: c.Vy ?? 0 };
}

function checkCombo(i: BasePlateInput, c: NodeCombo): NodeComboResult {
  const gc = i.gammaC ?? 1, gn = i.gammaN ?? 1;
  const p = i.profile, pl = i.plate, an = i.anchors, cc = i.concrete;
  const { Nc, Ms, Mw, Vs, Vw } = comboToPlate(i, c);
  const dbn = i.code === "DBN";
  const checks: Check[] = [];
  const values: { k: string; v: string }[] = [];

  // ---------- 1. Тертя під плитою ----------
  const V = Math.hypot(Vs, Vw);
  const Ff = i.friction && Nc > 0 ? 0.2 * Nc : 0;
  const kV = V > 0 ? Math.max(0, V - Ff) / V : 0;
  if (Ff > 0) values.push({ k: "F_f,Rd = 0.2·N_c", v: `${f(Ff / 1000)} kN` });

  // ---------- 2. Анкери + розподіл тиску під плитою ----------
  const cxe = (cc.Lc - (an.nx - 1) * an.sx) / 2, cye = (cc.Bc - (an.ny - 1) * an.sy) / 2;
  const edge = (v: number) => (v > 0 && Number.isFinite(v) ? v : Infinity);
  const ar = checkAnchors({
    code: i.code, type: an.type, d: an.d, dh: an.dh, hef: an.hef, steel: an.steel, fck: cc.fck, cracked: cc.cracked, h: cc.h,
    nx: an.nx, ny: an.ny, sx: an.sx, sy: an.sy,
    cxm: edge(cxe), cxp: edge(cxe), cym: edge(cye), cyp: edge(cye),
    bx: pl.L, by: pl.B, N: -Nc, My: Ms, Mx: Mw, Vx: Vs * kV, Vy: Vw * kV, T: 0,
    // зсув з плечем, якщо підливка товща за d/2 (EN 1992-4, 6.2.2.3); плита з гайками з двох боків не повертається — α_M = 2
    standoff: cc.grout > an.d / 2 ? cc.grout : 0, alphaM: 2, NRkp: an.NRkp, tauRk: an.tauRk, gammaN: gn, splitReinf: cc.reinforced,
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
    if (cc.grout > 0.2 * Math.min(pl.L, pl.B)) checks.push(mkCheck("nodeGrout", "EN 1993-1-8, 6.2.5(7)", "t_g ≤ 0.2·min(L; B)", `${cc.grout} ≤ ${f(0.2 * Math.min(pl.L, pl.B), 0)} mm`, cc.grout / (0.2 * Math.min(pl.L, pl.B))));
  }

  // ---------- 4. Плита: згин від відпору бетону ----------
  const pst = steel(pl.steel);
  const Ryp = pst.strength(pl.t, "sheet");
  const Rp = dbn ? Ryp * gc : Ryp; // EN: γM0 = 1.0
  const pRef = dbn ? "R_y·γ_c" : "f_y/γ_M0";
  if (sig > 0) {
    const panels = platePanels(p, pl.L, pl.B, i.ribs, sig);
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
  if (p.kind === "I") {
    sup.push([p.h / 2, -p.b / 2, p.h / 2, p.b / 2], [-p.h / 2, -p.b / 2, -p.h / 2, p.b / 2]);
    sup.push([-p.h / 2 + p.tf, p.tw / 2, p.h / 2 - p.tf, p.tw / 2], [-p.h / 2 + p.tf, -p.tw / 2, p.h / 2 - p.tf, -p.tw / 2]);
  } else {
    sup.push([p.h / 2, -p.b / 2, p.h / 2, p.b / 2], [-p.h / 2, -p.b / 2, -p.h / 2, p.b / 2], [-p.h / 2, p.b / 2, p.h / 2, p.b / 2], [-p.h / 2, -p.b / 2, p.h / 2, -p.b / 2]);
  }
  if (i.ribs.on) sup.push([p.h / 2, 0, pl.L / 2, 0], [-p.h / 2, 0, -pl.L / 2, 0]);
  let worstT: { u: number; s: string } | null = null;
  for (const a of ar.forces) {
    if (a.N <= 0) continue;
    const m0 = Math.min(...sup.map((s) => distSeg(a.x, a.y, ...s)));
    const m = Math.max(m0 - 0.8 * kf, an.d / 2);
    const e = Math.min(pl.L / 2 - Math.abs(a.x), pl.B / 2 - Math.abs(a.y));
    let leff = Math.min(2 * Math.PI * m, 4 * m + 1.25 * e);
    if (an.ny > 1) leff = Math.min(leff, an.sy);
    if (an.nx > 1 && Math.abs(a.x) < p.h / 2) leff = Math.min(leff, an.sx);
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
  const segs = weldShape(p.kind === "I" ? "iProfile" : "rhs", { b: p.b, h: p.h, tf: p.tf, tw: p.tw });
  let Nw = -Nc;
  if (i.weld.milled && Nw < 0) Nw = 0;
  const wr = checkFillet({
    code: i.code, segs, kf, process: i.weld.process, Run, Ryn, tmin: Math.min(p.tf, pl.t), tmax: Math.max(p.tf, pl.t),
    N: Nw, Vy: Vw, Vz: Vs, Mx: 0, My: Ms, Mz: -Mw, gammaC: gc, gammaN: gn,
  });
  checks.push(...wr.checks.map((ch) => ({ ...ch, key: ch.key, clause: ch.clause + " — профіль/плита" })));

  // ---------- 7. Ребра ----------
  const cL = (pl.L - p.h) / 2;
  if (i.ribs.on && cL > 0 && sig > 0) {
    const w = pl.B / 2;
    const Mr = (sig * w * cL * cL) / 2, Qr = sig * w * cL;
    const Ryr = pst.strength(i.ribs.tr, "sheet") * (dbn ? gc : 1);
    const sr = (6 * Mr) / (i.ribs.tr * i.ribs.hr ** 2), tr = (1.5 * Qr) / (i.ribs.tr * i.ribs.hr);
    checks.push(mkCheck("nodeRibBend", dbn ? "ДБН В.2.6-198, п. 9.2.1, ф. (9.1)" : "EN 1993-1-1, 6.2.5", `6M/(t_r·h_r²) ≤ ${pRef}`,
      `тиск з ширини B/2 = ${f(w, 0)} mm, виліт ${f(cL, 0)} mm; M = ${f(Mr / 1e6, 3)} kN·m; σ = ${f(sr, 1)} / ${f(Ryr, 0)} MPa`, sr * gn / Ryr));
    checks.push(mkCheck("nodeRibShear", dbn ? "ДБН В.2.6-198, п. 9.2.1, ф. (9.2)" : "EN 1993-1-1, 6.2.6", `1.5Q/(t_r·h_r) ≤ ${dbn ? "R_s·γ_c" : "f_y/(√3·γ_M0)"}`,
      `Q = ${f(Qr / 1000)} kN; τ = ${f(tr, 1)} / ${f(Ryr / Math.sqrt(3), 0)} MPa`, (tr * gn) / (Ryr / Math.sqrt(3))));
    const rw = checkFillet({
      code: i.code, segs: weldShape("lines2v", { b: i.ribs.tr, h: i.ribs.hr }), kf, process: i.weld.process, Run, Ryn,
      tmin: Math.min(i.ribs.tr, p.tf), tmax: Math.max(i.ribs.tr, p.tf), N: 0, Vy: 0, Vz: Qr, Mx: 0, My: Mr, Mz: 0, gammaC: gc, gammaN: gn,
    });
    checks.push(...rw.checks.filter((ch) => ch.key !== "weldLmin").map((ch) => ({ ...ch, key: ch.key + "Rib", clause: ch.clause + " — ребро/полиця" })));
  }

  // ---------- 8. Корінь кронштейна ----------
  if (i.kind === "bracket" && p.A && p.Wy) {
    const Ry = cst.strength(p.tf, "shaped") * (dbn ? gc : 1);
    const Mb = Math.abs(Ms), Mwb = Math.abs(Mw);
    const s = Math.abs(Nc) / p.A + Mb / p.Wy + (p.Wz ? Mwb / p.Wz : 0);
    const tau = Math.abs(Vs) / (p.Avz ?? (p.h - 2 * p.tf) * p.tw);
    const red = Math.sqrt(s * s + 3 * tau * tau);
    checks.push(mkCheck("nodeRootNormal", dbn ? "ДБН В.2.6-198, п. 9.2.1, ф. (9.1)" : "EN 1993-1-1, 6.2.1, (6.1)", `N/A + M_y/W_y + M_z/W_z ≤ ${dbn ? "R_y·γ_c" : "f_y/γ_M0"}`,
      `M_y = ${f(Mb / 1e6, 2)} kN·m; σ = ${f(s, 1)} / ${f(Ry, 0)} MPa`, (s * gn) / Ry));
    checks.push(mkCheck("nodeRootReduced", dbn ? "ДБН В.2.6-198, п. 9.2.1, ф. (9.4)" : "EN 1993-1-1, 6.2.1, (6.1)", `${dbn ? "0.87·√(σ² + 3τ²) ≤ R_y·γ_c" : "√(σ² + 3τ²) ≤ f_y/γ_M0"}`,
      `τ = ${f(tau, 1)} MPa; √(${f(s, 1)}² + 3·${f(tau, 1)}²) = ${f(red, 1)} / ${f((dbn ? 1.15 : 1) * Ry, 0)} MPa`, (red * gn) / ((dbn ? 1.15 : 1) * Ry)));
  }

  values.push(...ar.values.filter((v) => !v.k.startsWith("σ_c")));
  const u = checks.map((x) => x.util);
  return {
    name: c.name, checks, values, forces: ar.forces, sigC: sig, Nc, Ms, Mw, Vs, Vw,
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
  return { combos, envelope, governing, maxUtil: u.some((x) => Number.isNaN(x)) ? NaN : Math.max(0, ...u), ok: envelope.every((c) => c.ok) };
}
