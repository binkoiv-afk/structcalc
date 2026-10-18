// Сталеві вузли примикання і стики: шарнір на ребрі (фінплита), фланцеве примикання до колони, фланцевий стик,
// стик на накладках, вузол ферми на фасонці, опорний столик, приварна консоль.
// Кожен вузол: параметри → перевірки для кожного сполучення → огинаюча; плюс геометрія деталей для креслення в трьох проєкціях.
// Осі вузла: x — уздовж балки (балка в бік +x від грані опори x = 0), z — вгору, y — вбік. Одиниці: Н, мм, МПа.
// Зусилля в сполученні (на кінці балки з боку опори): N > 0 — розтяг, V_z — зріз у площині стінки, M_y > 0 — розтягнуті верхні волокна.

import type { CodeId, Check } from "../codes/types";
import { f, mkCheck } from "../codes/types";
import { steel } from "../catalog/materials";
import type { Section } from "../geometry/sections";
import { BOLT_AS, BOLT_CLASSES, checkBolts } from "../connections/bolts";
import { checkFillet, weldShape } from "../connections/welds";
import type { WeldSeg } from "../connections/welds";
import type { NodeCombo } from "./basePlate";

export type JointKind = "finPlate" | "endPlate" | "flangeSplice" | "coverSplice" | "gusset" | "beamSeat" | "cantilever";
export const JOINT_KINDS: JointKind[] = ["finPlate", "endPlate", "flangeSplice", "coverSplice", "gusset", "beamSeat", "cantilever"];

/** Стрижень решітки ферми, що приходить на фасонку */
export interface GussetMember { sec: Section; steel: string; angle: number; Lw: number; kf: number; on: boolean }

export interface JointParams {
  /** пластина: товщина, висота (уздовж z), ширина (уздовж x для ребра, уздовж y для фланця) */
  tp: number; hp: number; bp: number;
  /** зазор між гранню опори й торцем балки (ребро, накладки), мм */
  gap: number;
  /** болти: діаметр, клас, рядів (по висоті), стовпців, крок по висоті p, крок по горизонталі pc, відстань до краю e1, розмах g */
  d: number; cls: string; rows: number; cols: number; p: number; pc: number; e1: number; g: number;
  friction: boolean;
  /** фланець: виступ плити за полиці (0 — урівень), внутрішніх рядів біля кожної полиці, відступ першого внутрішнього ряду */
  ext: number; rowsIn: number; ef: number;
  /** шви: основний і допоміжний катет */
  kf: number; kf2: number;
  /** накладки: полиці (товщина, довжина, внутрішні накладки), болтів поперек полиці, уздовж (на половину), крок */
  tcf: number; lcf: number; inner: boolean; nbf: number; nlf: number; pf: number;
  /** накладки стінки: товщина, висота, рядів, стовпців на половину, кроки */
  tcw: number; hcw: number; nrw: number; ncw: number; pw: number; pcw: number;
  /** фасонка: товщина, висота, довжина; вільна довжина між стрижнем і поясом */
  tg: number; hg: number; lg: number; cfree: number;
  members: GussetMember[];
  /** столик: товщина (виліт), ширина, висота; опорне ребро балки: товщина, ширина, виступ униз; коеф. нерівномірності */
  ts: number; bs: number; hs: number; tr: number; br: number; ar: number; kV: number;
  /** консоль: виліт до точки сили */
  lever: number;
}

export interface JointInput {
  code: CodeId;
  kind: JointKind;
  beam: Section; beamSteel: string;
  /** опора: колона (двотавр) — грань полиці або стінки; для стиків і фасонки не потрібна */
  column?: Section; colSteel?: string; colFace?: "flange" | "web";
  plateSteel: string;
  p: JointParams;
  /** сполучення: N, V_z, V_y, M_y, M_z, T (Н, Н·мм); вузол ферми — N1, N2, N3 (зусилля стрижнів решітки, Н) і P (сила у вузлі); консоль — P, H, Q */
  combos: (NodeCombo & { N1?: number; N2?: number; N3?: number })[];
  gammaC?: number; gammaN?: number;
}

export type JAxis = "x" | "y" | "z";
/** Призма: переріз poly у площині двох інших осей (для x — (y, z), для y — (x, z), для z — (x, y)), витягнутий від from до to */
export interface JPart { id: string; cls: string; axis: JAxis; from: number; to: number; poly: [number, number][]; hole?: [number, number][] }
export interface JDim { view: "front" | "top" | "side"; a: [number, number]; b: [number, number]; text: string; part?: string }

export interface JointComboResult { name: string; checks: Check[]; maxUtil: number; ok: boolean }
export interface JointResult {
  combos: JointComboResult[];
  envelope: (Check & { combo: string })[];
  maxUtil: number; ok: boolean;
  parts: JPart[]; dims: JDim[];
  values: { k: string; v: string }[];
  notes: string[];
}

// ---------------------------------------------------------------- типові параметри

export function jointDefaults(kind: JointKind, code: CodeId): { p: JointParams; beam: [string, string]; column?: [string, string]; combos: JointInput["combos"] } {
  const base: JointParams = {
    tp: 10, hp: 230, bp: 110, gap: 10, d: 20, cls: code === "DBN" ? "5.6" : "8.8", rows: 3, cols: 1, p: 70, pc: 60, e1: 45, g: 100, friction: false,
    ext: 0, rowsIn: 1, ef: 50, kf: 6, kf2: 6,
    tcf: 12, lcf: 0, inner: false, nbf: 2, nlf: 3, pf: 70, tcw: 8, hcw: 0, nrw: 3, ncw: 1, pw: 70, pcw: 60,
    tg: 10, hg: 300, lg: 420, cfree: 60, members: [],
    ts: 30, bs: 200, hs: 180, tr: 14, br: 180, ar: 15, kV: 1,
    lever: 600,
  };
  const st = code === "DBN" ? "C245" : "S235";
  if (kind === "finPlate") return { p: base, beam: ["IPE", "IPE 300"], column: ["HEB", "HEB 240"], combos: [{ name: "1", Vz: 90e3 }, { name: "2", Vz: 50e3, N: 25e3 }] };
  if (kind === "endPlate") return { p: { ...base, tp: 20, bp: 200, ext: 90, rowsIn: 1, d: 24, cls: code === "DBN" ? "10.9" : "10.9", g: 110, e1: 40, ef: 50, kf: 8, kf2: 6 },
    beam: ["IPE", "IPE 360"], column: ["HEB", "HEB 300"], combos: [{ name: "1", My: 120e6, Vz: 100e3 }, { name: "2", My: -50e6, Vz: 40e3, N: -20e3 }] };
  if (kind === "flangeSplice") return { p: { ...base, tp: 20, bp: 190, ext: 80, rowsIn: 1, d: 20, cls: code === "DBN" ? "10.9" : "10.9", g: 100, e1: 40, ef: 50, kf: 8, kf2: 6 },
    beam: ["IPE", "IPE 330"], combos: [{ name: "1", My: 110e6, Vz: 70e3 }, { name: "2", My: -50e6, Vz: 30e3, N: 40e3 }] };
  if (kind === "coverSplice") return { p: { ...base, tcf: 12, inner: false, nbf: 2, nlf: 3, pf: 70, e1: 40, g: 90, tcw: 8, hcw: 260, nrw: 4, ncw: 2, pw: 70, pcw: 60, d: 20, gap: 10 },
    beam: ["IPE", "IPE 360"], combos: [{ name: "1", My: 90e6, Vz: 80e3 }, { name: "2", My: -40e6, Vz: 30e3, N: 50e3 }] };
  if (kind === "gusset") {
    void st;
    return { p: { ...base, tg: 10, hg: 280, lg: 460, cfree: 50, kf: 6 },
      beam: ["RHS_COLD", "140×140×5"], combos: [{ name: "1", N1: -180e3, N2: 150e3, N3: -40e3 }, { name: "2", N1: -90e3, N2: 70e3, N3: -20e3 }] };
  }
  if (kind === "beamSeat") return { p: { ...base, ts: 30, bs: 220, hs: 180, tr: 16, br: 180, ar: 15, kf: 8, kf2: 7, kV: 1 },
    beam: ["IPE", "IPE 400"], column: ["HEB", "HEB 300"], combos: [{ name: "1", Vz: 260e3 }, { name: "2", Vz: 150e3 }] };
  return { p: { ...base, lever: 600, kf: 8 }, beam: ["IPE", "IPE 300"], column: ["HEB", "HEB 260"], combos: [{ name: "1", P: 45e3 }, { name: "2", P: 25e3, H: 10e3, Q: 3e3 }] };
}

/** Типові стрижні решітки для фасонки (переріз задає UI) */
export function gussetMembersDefault(sec: (fam: string, size: string) => Section | undefined, code: CodeId): GussetMember[] {
  const st = code === "DBN" ? "C245" : "S235";
  const s1 = sec("RHS_COLD", "100×100×5"), s2 = sec("RHS_COLD", "80×80×5"), s3 = sec("RHS_COLD", "60×60×4");
  const list: GussetMember[] = [];
  if (s1) list.push({ sec: s1, steel: st, angle: -135, Lw: 160, kf: 5, on: true });
  if (s2) list.push({ sec: s2, steel: st, angle: -45, Lw: 150, kf: 5, on: true });
  if (s3) list.push({ sec: s3, steel: st, angle: -90, Lw: 100, kf: code === "DBN" ? 4 : 5, on: true });
  return list;
}

// ---------------------------------------------------------------- допоміжне

interface Mat { R: number; Rs: number; Ru: number; Ryn: number; Run: number; fy: number; fu: number }
function mat(code: CodeId, id: string, t: number, gc: number): Mat {
  const g = steel(id);
  const Ryn = g.yieldChar(t, "sheet"), Run = g.ultimate(t, "sheet");
  if (code === "DBN") {
    const R = g.strength(t, "sheet") * gc;
    // R_u = R_un/γ_u, γ_u = 1.3 (розрахунок за тимчасовим опором, переріз нетто)
    return { R, Rs: 0.58 * R, Ru: (Run / 1.3) * gc, Ryn, Run, fy: R, fu: Run };
  }
  return { R: Ryn, Rs: Ryn / Math.sqrt(3), Ru: (0.9 * Run) / 1.25, Ryn, Run, fy: Ryn, fu: Run };
}
const CLs = (code: CodeId, dbn: string, en: string) => (code === "DBN" ? `ДБН В.2.6-198, ${dbn}` : `EN 1993-1-8, ${en}`);
const kNs = (v: number) => f(v / 1000, 1);
const kNms = (v: number) => f(v / 1e6, 2);
const d0Of = (d: number) => d + (d <= 24 ? 2 : 3);

/** Опір болта розтягу (одного), Н */
function boltFt(code: CodeId, d: number, cls: string, gc: number) {
  const B = BOLT_CLASSES[cls], As = BOLT_AS[d] ?? 0.78 * d * d;
  return code === "DBN" ? B.Rbt * As * gc : (0.9 * B.Rbun * As) / 1.25;
}

/** T-елемент (EN 1993-1-8, 6.2.4, табл. 6.2) — опір ряду з двох болтів, Н */
function tStub(leff: number, t: number, fy: number, m: number, e: number, Ft: number) {
  const n = Math.min(e, 1.25 * m);
  const Mpl = 0.25 * leff * t * t * fy;
  const FT1 = (4 * Mpl) / m, FT2 = (2 * Mpl + n * 2 * Ft) / (m + n), FT3 = 2 * Ft;
  const F = Math.min(FT1, FT2, FT3);
  return { F, mode: F === FT1 ? 1 : F === FT2 ? 2 : 3, FT1, FT2, FT3, n };
}

/** φ (χ) стиснутого елемента за кривою c (α = 0.49) — для фасонок і опорних ребер (наближено для обох норм) */
function chiC(lam: number, fy: number, E = 210000) {
  const lb = (lam / Math.PI) * Math.sqrt(fy / E);
  if (lb <= 0.2) return 1;
  const ph = 0.5 * (1 + 0.49 * (lb - 0.2) + lb * lb);
  return Math.min(1, 1 / (ph + Math.sqrt(ph * ph - lb * lb)));
}

// ---------------------------------------------------------------- геометрія для креслення

const rect = (u0: number, u1: number, v0: number, v1: number): [number, number][] => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
function iPoly(h: number, b: number, tw: number, tf: number, cu = 0, cv = 0): [number, number][] {
  const hb = b / 2, hh = h / 2, w = tw / 2;
  return [[-hb, -hh], [hb, -hh], [hb, -hh + tf], [w, -hh + tf], [w, hh - tf], [hb, hh - tf], [hb, hh], [-hb, hh], [-hb, hh - tf], [-w, hh - tf], [-w, -hh + tf], [-hb, -hh + tf]]
    .map(([u, v]) => [u + cu, v + cv] as [number, number]);
}
const circle = (r: number, cu: number, cv: number, n = 16): [number, number][] => Array.from({ length: n }, (_, k) => [cu + r * Math.cos((2 * Math.PI * k) / n), cv + r * Math.sin((2 * Math.PI * k) / n)] as [number, number]);

/** Переріз профілю в площині (y, z) — для стрижня вздовж x */
/** Двотавр як три пластини (полиці і стінка) — щоб у проєкціях було видно деталі між полицями */
function iRects(h: number, b: number, tw: number, tf: number): [number, number][][] {
  return [rect(-b / 2, b / 2, h / 2 - tf, h / 2), rect(-b / 2, b / 2, -h / 2, -h / 2 + tf), rect(-tw / 2, tw / 2, -h / 2 + tf, h / 2 - tf)];
}
function secPolys(s: Section): { poly: [number, number][]; hole?: [number, number][] }[] {
  if (s.kind === "I") return iRects(s.h, s.b, s.dims.tw ?? 6, s.dims.tf ?? 10).map((poly) => ({ poly }));
  return [secPoly(s)];
}
function secPoly(s: Section): { poly: [number, number][]; hole?: [number, number][] } {
  const t = s.dims.t ?? s.dims.tw ?? 5;
  if (s.kind === "I") return { poly: iPoly(s.h, s.b, s.dims.tw ?? 6, s.dims.tf ?? 10) };
  if (s.kind === "RHS") return { poly: rect(-s.b / 2, s.b / 2, -s.h / 2, s.h / 2), hole: rect(-s.b / 2 + t, s.b / 2 - t, -s.h / 2 + t, s.h / 2 - t) };
  if (s.kind === "CHS") return { poly: circle(s.h / 2, 0, 0, 24), hole: circle(s.h / 2 - t, 0, 0, 24) };
  if (s.kind === "C") { const tw = s.dims.tw ?? 6, tf = s.dims.tf ?? 9, hh = s.h / 2; return { poly: [[0, -hh], [s.b, -hh], [s.b, -hh + tf], [tw, -hh + tf], [tw, hh - tf], [s.b, hh - tf], [s.b, hh], [0, hh]] }; }
  if (s.kind === "L") { const tl = s.dims.t ?? 6; return { poly: [[0, 0], [s.b, 0], [s.b, tl], [tl, tl], [tl, s.h], [0, s.h]] }; }
  return { poly: rect(-s.b / 2, s.b / 2, -s.h / 2, s.h / 2) };
}

/** Болт уздовж осі axis: стрижень + головка й гайка */
function bolt(id: string, axis: JAxis, a0: number, a1: number, cu: number, cv: number, d: number): JPart[] {
  const hd = 0.7 * d, sw = 1.6 * d;
  return [
    { id, cls: "bolt", axis, from: a0 - hd, to: a1 + hd + 0.25 * d, poly: circle(d / 2, cu, cv, 12) },
    { id, cls: "bolt head", axis, from: a0 - hd, to: a0, poly: circle(sw / 2, cu, cv, 6) },
    { id, cls: "bolt head", axis, from: a1, to: a1 + hd, poly: circle(sw / 2, cu, cv, 6) },
  ];
}
/** Кутовий шов уздовж осі axis: трикутник з катетом k у куті (cu, cv), напрямки su, sv (±1) */
const weldP = (id: string, axis: JAxis, a0: number, a1: number, cu: number, cv: number, k: number, su: number, sv: number): JPart =>
  ({ id, cls: "weld", axis, from: a0, to: a1, poly: [[cu, cv], [cu + su * k, cv], [cu, cv + sv * k]] });

/** Колона (двотавр, вертикально) з гранню опори в площині x = 0 */
function columnParts(c: Section, face: "flange" | "web", zr: [number, number]): JPart[] {
  const h = c.h, b = c.b, tw = c.dims.tw ?? 8, tf = c.dims.tf ?? 12;
  // переріз колони в площині (x, y): полиця до балки — грань x = 0
  return iRects(h, b, tw, tf).map((r) => ({ id: "column", cls: "steel column", axis: "z" as JAxis, from: zr[0], to: zr[1],
    poly: r.map(([u, v]) => (face === "flange" ? [v - h / 2, u] : [u - tw / 2, v]) as [number, number]) }));
}

// ---------------------------------------------------------------- розрахунок

export function checkJoint(i: JointInput): JointResult {
  const gc = i.gammaC ?? 1, gn = i.gammaN ?? 1, code = i.code, p = i.p, s = i.beam;
  const parts: JPart[] = [], dims: JDim[] = [], notes: string[] = [], values: { k: string; v: string }[] = [];
  const h = s.h, b = s.b, tw = s.dims.tw ?? s.dims.t ?? 6, tf = s.dims.tf ?? s.dims.t ?? 10;
  const mb = mat(code, i.beamSteel, Math.max(tf, tw), gc), mp = mat(code, i.plateSteel, p.tp, gc);
  const d0 = d0Of(p.d);
  const col = i.column, face = i.colFace ?? "flange";
  const ctw = col?.dims.tw ?? 10, ctf = col?.dims.tf ?? 15, cr = col?.dims.r ?? 0;
  const tSup = col ? (face === "flange" ? ctf : ctw) : p.tp;
  const mc = col ? mat(code, i.colSteel ?? i.plateSteel, Math.max(ctf, ctw), gc) : mp;
  let perCombo: (c: JointInput["combos"][number]) => Check[] = () => [];
  const beamLen = Math.max(500, 1.6 * h);
  const sps = secPolys(s);
  const addBeam = (x0: number, x1: number, id = "beam") => { for (const sp of sps) parts.push({ id, cls: "steel", axis: "x", from: x0, to: x1, ...sp }); };

  if (i.kind === "finPlate") {
    // ---- шарнірне примикання на ребрі (накладці), приварному до опори; болти в стінці балки
    const nr = Math.max(1, p.rows), nc = Math.max(1, p.cols);
    const xb0 = p.bp - p.e1 - (nc - 1) * p.pc; // перший стовпець від грані опори
    const e = xb0 + ((nc - 1) * p.pc) / 2; // ексцентриситет групи від шва
    const zTop = ((nr - 1) * p.p) / 2;
    values.push({ k: "e (шов → центр болтів)", v: `${f(e, 0)} mm` }, { k: "h_w", v: `${f(h - 2 * tf, 0)} mm` });
    if (p.hp > h - 2 * tf - 2 * (s.dims.r ?? 0)) notes.push("finPlateTooHigh");
    if (xb0 - p.gap < 1.5 * d0) notes.push("finBeamEdge");
    perCombo = (c) => {
      const V = Math.abs(c.Vz ?? 0), N = c.N ?? 0, out: Check[] = [];
      out.push(...checkBolts({ code, kind: p.friction ? "friction" : "bearing", d: p.d, boltClass: p.cls, shearPlanes: 1, tmin: Math.min(p.tp, tw),
        Ryn: Math.min(mp.Ryn, mb.Ryn), Run: Math.min(mp.Run, mb.Run), group: { rows: nr, cols: nc, px: p.pc, py: p.p }, a: Math.min(p.e1, (p.hp - (nr - 1) * p.p) / 2),
        Fx: N, Fy: V, M: V * e, T: 0, gammaC: gc, gammaN: gn }).checks);
      const Vn = V * gn;
      const Av = p.hp * p.tp, Avn = (p.hp - nr * d0) * p.tp;
      out.push(mkCheck("jPlateShear", CLs(code, "п. 9.2.1, ф. (9.2)", "3.10; EN 1993-1-1, 6.2.6"), "V / (h_p·t_p) ≤ R_s", `${kNs(Vn)} kN / ${f(Av, 0)} mm² = ${f(Vn / Av, 1)} / ${f(mp.Rs, 0)} MPa`, Vn / Av / mp.Rs));
      out.push(mkCheck("jPlateShearNet", CLs(code, "п. 8.1.1 (нетто, R_u/γ_u)", "3.10.1, 6.2.6"), "V / ((h_p − n·d_0)·t_p) ≤ R_u/√3", `${kNs(Vn)} kN / ${f(Avn, 0)} mm² = ${f(Vn / Avn, 1)} / ${f(mp.Ru / Math.sqrt(3), 0)} MPa`, (Vn / Avn) / (mp.Ru / Math.sqrt(3))));
      const sig = (Vn * e) / ((p.tp * p.hp * p.hp) / 6), tau = Vn / Av;
      const sr = Math.sqrt(sig * sig + 3 * tau * tau);
      out.push(mkCheck("jPlateBend", CLs(code, "п. 9.2.1; п. 8.2.1 (σ_ef ≤ 1.15·R_y·γ_c)", "EN 1993-1-1, 6.2.1 (6.1)"), "√(σ² + 3τ²), σ = V·e/W_p",
        `M = ${kNms(Vn * e)} kN·m; σ = ${f(sig, 1)}, τ = ${f(tau, 1)}; σ_ef = ${f(sr, 1)} / ${f((code === "DBN" ? 1.15 : 1) * mp.R, 0)} MPa`, sr / ((code === "DBN" ? 1.15 : 1) * mp.R)));
      // вирив блоку (ексцентрично: 0.5·A_nt)
      const Ant = (p.e1 + (nc - 1) * p.pc - (nc - 0.5) * d0) * p.tp, Anv = ((p.hp + (nr - 1) * p.p) / 2 - (nr - 0.5) * d0) * p.tp;
      const Vb = 0.5 * (code === "DBN" ? mp.Ru : (mp.fu / 1.25)) * Ant + mp.Rs * Anv;
      out.push(mkCheck("jBlockTear", code === "DBN" ? "за EN 1993-1-8, 3.10.2 (2) з R_u, R_s (ДБН окремої формули не має)" : "EN 1993-1-8, 3.10.2 (3), (3.10)", "V ≤ 0.5·f_u·A_nt/γ_M2 + f_y·A_nv/(√3·γ_M0)",
        `A_nt = ${f(Ant, 0)}, A_nv = ${f(Anv, 0)} mm²; ${kNs(Vn)} / ${kNs(Vb)} kN`, Vn / Vb));
      const Avw = (h - 2 * tf - nr * d0) * tw;
      out.push(mkCheck("jBeamWebShear", CLs(code, "п. 9.2.1 (нетто по ряду отворів)", "EN 1993-1-1, 6.2.6"), "V / ((h_w − n·d_0)·t_w) ≤ R_s", `${kNs(Vn)} kN / ${f(Avw, 0)} mm² = ${f(Vn / Avw, 1)} / ${f(mb.Rs, 0)} MPa`, Vn / Avw / mb.Rs));
      const segs: WeldSeg[] = [{ y1: -p.tp / 2, z1: -p.hp / 2, y2: -p.tp / 2, z2: p.hp / 2 }, { y1: p.tp / 2, z1: -p.hp / 2, y2: p.tp / 2, z2: p.hp / 2 }];
      out.push(...checkFillet({ code, segs, kf: p.kf, process: "manual", Run: Math.min(mp.Run, mc.Run), Ryn: Math.min(mp.Ryn, mc.Ryn), tmin: Math.min(p.tp, tSup), tmax: Math.max(p.tp, tSup),
        N, Vy: 0, Vz: V, Mx: 0, My: V * e, Mz: 0, gammaC: gc, gammaN: gn }).checks.map((x) => ({ ...x, key: `jW_${x.key}` })));
      return out;
    };
    // креслення
    if (col) parts.push(...columnParts(col, face, [-h, h]));
    addBeam(p.gap, beamLen);
    parts.push({ id: "plate", cls: "plate", axis: "z", from: -p.hp / 2, to: p.hp / 2, poly: rect(0, p.bp, tw / 2, tw / 2 + p.tp) });
    for (let a = 0; a < nc; a++) for (let q = 0; q < nr; q++) parts.push(...bolt("bolts", "y", -tw / 2, tw / 2 + p.tp, xb0 + a * p.pc, zTop - q * p.p, p.d));
    parts.push(weldP("welds", "z", -p.hp / 2, p.hp / 2, 0, tw / 2 + p.tp, p.kf, 1, 1), weldP("welds", "z", -p.hp / 2, p.hp / 2, 0, tw / 2, p.kf, 1, -1));
    dims.push({ view: "front", a: [0, -p.hp / 2 - 30], b: [p.bp, -p.hp / 2 - 30], text: `${p.bp}`, part: "plate" },
      { view: "front", a: [p.bp + 30, -p.hp / 2], b: [p.bp + 30, p.hp / 2], text: `${p.hp}`, part: "plate" },
      { view: "front", a: [0, p.hp / 2 + 30], b: [xb0 + ((nc - 1) * p.pc) / 2, p.hp / 2 + 30], text: `e = ${f(e, 0)}`, part: "bolts" });
  } else if (i.kind === "endPlate" || i.kind === "flangeSplice" || i.kind === "cantilever") {
    const isI = s.kind === "I";
    const welded = i.kind === "cantilever";
    // ---- ряди болтів (фланець): зовнішні у виступах, внутрішні біля полиць
    const rowsZ: number[] = [];
    if (!welded) {
      if (p.ext > 0) { const zo = h / 2 + p.ext - p.e1; rowsZ.push(zo, -zo); }
      if (isI) for (let k = 0; k < p.rowsIn; k++) { const zi = h / 2 - tf - p.ef - k * p.p; if (zi > 0) rowsZ.push(zi, -zi); }
    }
    rowsZ.sort((a, c) => c - a);
    const nb = rowsZ.length * 2;
    const hp = h + 2 * p.ext;
    const Ft = boltFt(code, p.d, p.cls, gc);
    const aw = 0.7 * p.kf2, af = 0.7 * p.kf;
    if (!welded) values.push({ k: "Рядів / болтів", v: `${rowsZ.length} / ${nb}` }, { k: code === "DBN" ? "N_bt (R_bt·A_bn)" : "F_t,Rd", v: `${kNs(Ft)} kN` });
    if (!welded && !rowsZ.length) notes.push("noRows");
    const lever = welded ? p.lever : 0;
    perCombo = (c) => {
      const out: Check[] = [];
      // консоль: сили P, H, Q на вильоті і (зі «Збірки») зусилля біля опори N, V, M — додаються
      const N = (c.N ?? 0) + (welded ? c.H ?? 0 : 0);
      const V = Math.abs((c.Vz ?? 0) + (welded ? c.P ?? 0 : 0));
      const My = (c.My ?? 0) + (welded ? (c.P ?? 0) * lever : 0);
      const Vy = Math.abs((c.Vy ?? 0) + (welded ? c.Q ?? 0 : 0));
      const Mz = (c.Mz ?? 0) + (welded ? (c.Q ?? 0) * lever : 0);
      const gnN = N * gn, gV = V * gn, gM = My * gn;
      if (!welded && rowsZ.length) {
        // розтяг рядів: пружно з поворотом навколо центра стиснутої полиці
        const zc = gM >= 0 ? -(h - tf) / 2 : (h - tf) / 2, sg = gM >= 0 ? 1 : -1;
        const dts = rowsZ.map((z) => (z - zc) * sg).map((d) => (d > 0 ? d : 0));
        const S2 = dts.reduce((a, d) => a + d * d, 0) || 1;
        const rowF = dts.map((d) => (Math.abs(gM) * d) / S2 + (2 * Math.max(0, gnN)) / nb);
        const Fbmax = Math.max(...rowF) / 2;
        out.push(...checkBolts({ code, kind: p.friction ? "friction" : "bearing", d: p.d, boltClass: p.cls, shearPlanes: 1, tmin: i.kind === "flangeSplice" ? p.tp : Math.min(p.tp, tSup),
          Ryn: mp.Ryn, Run: mp.Run, group: { rows: rowsZ.length, cols: 2, px: p.g, py: rowsZ.length > 1 ? (rowsZ[0] - rowsZ[rowsZ.length - 1]) / (rowsZ.length - 1) : p.p },
          a: p.e1, Fx: 0, Fy: V, M: 0, T: Fbmax * nb / gn, gammaC: gc, gammaN: gn }).checks);
        // T-елементи плити (і полиці колони) по рядах
        const ep = (p.bp - p.g) / 2;
        rowsZ.forEach((z, k) => {
          if (rowF[k] <= 0) return;
          const outer = Math.abs(z) > h / 2;
          let m: number, e: number, leff: number;
          if (outer) {
            m = Math.abs(z) - h / 2 - 0.8 * Math.SQRT2 * af; e = p.e1;
            const ex = p.e1, w = p.g;
            leff = Math.min(2 * Math.PI * m, Math.PI * m + w, Math.PI * m + 2 * ep, 4 * m + 1.25 * ex, ep + 2 * m + 0.625 * ex, 0.5 * p.bp, 0.5 * w + 2 * m + 0.625 * ex);
            e = ep;
          } else {
            m = p.g / 2 - tw / 2 - 0.8 * Math.SQRT2 * aw; e = ep;
            leff = Math.min(2 * Math.PI * m, 4 * m + 1.25 * e);
          }
          m = Math.max(m, 5);
          const ts = tStub(leff, p.tp, mp.R, m, e, Ft);
          out.push(mkCheck("jTStubPlate", code === "DBN" ? "T-елемент за EN 1993-1-8, 6.2.4 з R_y, R_bt (ДБН окремої методики не має)" : "EN 1993-1-8, 6.2.4, табл. 6.2, 6.6",
            "F_ряду ≤ F_T,Rd = min(4M_pl/m; (2M_pl + n·ΣF_t)/(m + n); ΣF_t)",
            `ряд z = ${f(z, 0)}: m = ${f(m, 1)}, l_eff = ${f(leff, 0)} mm, M_pl = ${f(0.25 * leff * p.tp * p.tp * mp.R / 1e6, 2)} kN·m; форма ${ts.mode}; ${kNs(rowF[k])} / ${kNs(ts.F)} kN`, rowF[k] / ts.F, ["tStubNoGroup"]));
          if (col && i.kind === "endPlate" && face === "flange") {
            const mcol = Math.max(p.g / 2 - ctw / 2 - 0.8 * cr, 5), ecol = (col.b - p.g) / 2;
            const leffc = Math.min(2 * Math.PI * mcol, 4 * mcol + 1.25 * ecol);
            const tc = tStub(leffc, ctf, mc.R, mcol, ecol, Ft);
            out.push(mkCheck("jTStubColumn", code === "DBN" ? "T-елемент полиці колони за EN 1993-1-8, 6.2.6.4 з R_y" : "EN 1993-1-8, 6.2.6.4", "F_ряду ≤ F_T,fc,Rd",
              `ряд z = ${f(z, 0)}: m = ${f(mcol, 1)}, l_eff = ${f(leffc, 0)} mm; ${kNs(rowF[k])} / ${kNs(tc.F)} kN`, rowF[k] / tc.F, ["tStubNoGroup"]));
          }
        });
      }
      if (col && (i.kind === "endPlate" || i.kind === "cantilever")) {
        // полиця балки → колона: зусилля в полицях, панель стінки колони, стиск і розтяг стінки
        const Ff = Math.abs(gM) / (h - tf) + Math.abs(gnN) / 2;
        if (face === "flange") {
          const Avc = (col.h - ctf) * ctw;
          const Vwp = Math.abs(gM) / (h - tf);
          out.push(mkCheck("jColWebPanel", code === "DBN" ? "ДБН В.2.6-198, п. 9.2.1 (зріз панелі стінки колони)" : "EN 1993-1-8, 6.2.6.1, (6.7)", "V_wp ≤ 0.9·A_vc·R_s",
            `V_wp = M/(h − t_f) = ${kNs(Vwp)} kN; A_vc = ${f(Avc, 0)} mm²; ${kNs(Vwp)} / ${kNs(0.9 * Avc * mc.Rs)} kN`, Vwp / (0.9 * Avc * mc.Rs)));
          const sp2 = welded ? 0 : p.tp;
          const beff = tf + 2 * Math.SQRT2 * af + 5 * (ctf + cr) + 2 * sp2;
          out.push(mkCheck("jColWebComp", code === "DBN" ? "ДБН В.2.6-198 (місцеві напруження в стінці колони під зосередженим зусиллям), b_eff за EN 1993-1-8, 6.2.6.2" : "EN 1993-1-8, 6.2.6.2, (6.9) без ω, ρ", "F_c ≤ b_eff·t_wc·R_y",
            `b_eff = ${f(beff, 0)} mm; ${kNs(Ff)} / ${kNs(beff * ctw * mc.R)} kN`, Ff / (beff * ctw * mc.R), ["colWebNoBuckling"]));
        } else {
          notes.push("colWebFace");
        }
      }
      if (welded || i.kind === "endPlate" || i.kind === "flangeSplice") {
        // шов профілю до плити (або до колони — консоль)
        const segs = s.kind === "I" ? weldShape("iProfile", { b, h, tf, tw }) : s.kind === "CHS" ? Array.from({ length: 24 }, (_, k) => {
          const a0 = (k / 24) * 2 * Math.PI, a1 = ((k + 1) / 24) * 2 * Math.PI, r = h / 2;
          return { y1: r * Math.cos(a0), z1: r * Math.sin(a0), y2: r * Math.cos(a1), z2: r * Math.sin(a1) };
        }) : weldShape("rhs", { b, h });
        const tSupW = welded ? tSup : p.tp;
        out.push(...checkFillet({ code, segs, kf: p.kf, process: "manual", Run: Math.min(mb.Run, welded ? mc.Run : mp.Run), Ryn: Math.min(mb.Ryn, welded ? mc.Ryn : mp.Ryn),
          tmin: Math.min(tf, tSupW), tmax: Math.max(tf, tSupW), N, Vy, Vz: V, Mx: 0, My, Mz, gammaC: gc, gammaN: gn }).checks.map((x) => ({ ...x, key: `jW_${x.key}` })));
      }
      if (welded) {
        // переріз консолі біля опори
        const sig = Math.abs(gnN) / s.A + Math.abs(gM) / s.Wy + Math.abs(Mz * gn) / s.Wz, tau = gV / s.Avz;
        const se = Math.sqrt(sig * sig + 3 * tau * tau);
        const lim = (code === "DBN" ? 1.15 : 1) * mb.R;
        out.push(mkCheck("jCantRoot", code === "DBN" ? "ДБН В.2.6-198, п. 9.2.1, ф. (9.1); п. 8.2.1" : "EN 1993-1-1, 6.2.1 (6.1)", "σ_ef = √(σ² + 3τ²) біля опори",
          `M = ${kNms(gM)} kN·m; σ = ${f(sig, 1)}, τ = ${f(tau, 1)}; ${f(se, 1)} / ${f(lim, 0)} MPa`, se / lim));
      }
      if (i.kind === "flangeSplice" && isI && rowsZ.length) {
        // стиснута полиця на плиту — зминання торця не перевіряється (плити щільно); полиця на розтяг — через шов
      }
      return out;
    };
    // креслення
    const len = welded ? Math.max(p.lever + 150, 400) : beamLen;
    if (col && i.kind !== "flangeSplice") parts.push(...columnParts(col, face, [-hp / 2 - 150, hp / 2 + 150]));
    if (welded) {
      addBeam(0, len);
      dims.push({ view: "front", a: [0, -h / 2 - 40], b: [p.lever, -h / 2 - 40], text: `a = ${p.lever}`, part: "beam" });
    } else {
      const x0 = i.kind === "flangeSplice" ? 0 : 0;
      parts.push({ id: "plate", cls: "plate", axis: "x", from: x0, to: x0 + p.tp, poly: rect(-p.bp / 2, p.bp / 2, -hp / 2, hp / 2) });
      addBeam(p.tp, p.tp + len);
      if (i.kind === "flangeSplice") {
        parts.push({ id: "plate", cls: "plate", axis: "x", from: -p.tp, to: 0, poly: rect(-p.bp / 2, p.bp / 2, -hp / 2, hp / 2) });
        addBeam(-p.tp - len, -p.tp, "beam");
      }
      const xa = i.kind === "flangeSplice" ? -p.tp : -tSup;
      for (const z of rowsZ) for (const y of [-p.g / 2, p.g / 2]) parts.push(...bolt("bolts", "x", xa, p.tp, y, z, p.d));
      dims.push({ view: "side", a: [-p.g / 2, -hp / 2 - 30], b: [p.g / 2, -hp / 2 - 30], text: `g = ${p.g}`, part: "bolts" },
        { view: "side", a: [p.bp / 2 + 30, -hp / 2], b: [p.bp / 2 + 30, hp / 2], text: `${f(hp, 0)}`, part: "plate" },
        { view: "front", a: [-20, -hp / 2], b: [-20, -hp / 2], text: `t = ${p.tp}`, part: "plate" });
    }
    // шви по контуру профілю (схематично — по полицях)
    const xw = welded ? 0 : p.tp;
    if (s.kind === "I") {
      for (const sg of [1, -1]) {
        parts.push(weldP("welds", "y", -b / 2, b / 2, xw, sg * h / 2, p.kf, 1, sg));
        parts.push(weldP("welds", "y", -b / 2, b / 2, xw, sg * (h / 2 - tf), p.kf2, 1, -sg));
        parts.push(weldP("welds", "z", -h / 2 + tf, h / 2 - tf, xw, sg * tw / 2, p.kf2, 1, sg));
      }
    } else for (const sg of [1, -1]) {
      parts.push(weldP("welds", "y", -b / 2, b / 2, xw, sg * h / 2, p.kf, 1, sg));
      parts.push(weldP("welds", "z", -h / 2, h / 2, xw, sg * b / 2, p.kf, 1, sg));
    }
  } else if (i.kind === "coverSplice") {
    // ---- стик балки на накладках: полиці (зовнішні ± внутрішні накладки) і стінка (дві накладки)
    const hw = h - 2 * tf;
    const Af = b * tf, Aw = hw * tw, A = s.A;
    const Iw = (tw * hw ** 3) / 12, Iy = s.Iy;
    const lcf = p.lcf || 2 * (p.e1 * 2 + (p.nlf - 1) * p.pf) + p.gap;
    const hcw = p.hcw || hw - 2 * ((s.dims.r ?? 10) + 10);
    const lcw = 2 * (2 * p.e1 + (p.ncw - 1) * p.pcw) + p.gap;
    const ew = p.gap / 2 + p.e1 + ((p.ncw - 1) * p.pcw) / 2;
    const bci = (b - tw - 2 * (s.dims.r ?? 10)) / 2 - 5;
    values.push({ k: "M_w / M (частка стінки)", v: f(Iw / Iy, 3) }, { k: "Накладка полиці", v: `${f(b, 0)}×${p.tcf}×${f(lcf, 0)}${p.inner ? ` + 2×${f(bci, 0)}×${p.tcf}` : ""}` }, { k: "Накладки стінки", v: `2×${f(hcw, 0)}×${p.tcw}×${f(lcw, 0)}` });
    perCombo = (c) => {
      const out: Check[] = [];
      const N = (c.N ?? 0) * gn, V = Math.abs(c.Vz ?? 0) * gn, M = (c.My ?? 0) * gn;
      const Mw = (M * Iw) / Iy, Mf = M - Mw;
      const Ff = Math.abs(Mf) / (h - tf) + (Math.abs(N) * Af) / A;
      const Nw = (N * Aw) / A;
      // болти полиці (одно- або двозрізні)
      const tcov = p.inner ? Math.min(p.tcf * 2, p.tcf + p.tcf) : p.tcf;
      out.push(...checkBolts({ code, kind: p.friction ? "friction" : "bearing", d: p.d, boltClass: p.cls, shearPlanes: p.inner ? 2 : 1, tmin: Math.min(tf, tcov),
        Ryn: Math.min(mb.Ryn, mp.Ryn), Run: Math.min(mb.Run, mp.Run), group: { rows: p.nbf, cols: p.nlf, px: p.pf, py: p.nbf > 1 ? p.g / Math.max(1, p.nbf / 2) : p.g },
        a: p.e1, Fx: Ff / gn, Fy: 0, M: 0, T: 0, gammaC: gc, gammaN: gn }).checks.map((x) => ({ ...x, key: `jF_${x.key}` })));
      const Anc = (b - p.nbf * d0) * p.tcf + (p.inner ? 2 * (bci - (p.nbf / 2) * d0) * p.tcf : 0);
      const Agc = b * p.tcf + (p.inner ? 2 * bci * p.tcf : 0);
      out.push(mkCheck("jCoverNet", CLs(code, "п. 8.1.1, ф. (8.2) (нетто, R_u/γ_u)", "EN 1993-1-1, 6.2.3 (6.7)"), "F_f / A_n ≤ R_u", `${kNs(Ff)} kN / ${f(Anc, 0)} mm² = ${f(Ff / Anc, 1)} / ${f(mp.Ru, 0)} MPa`, Ff / Anc / mp.Ru));
      out.push(mkCheck("jCoverGross", CLs(code, "п. 8.1.1, ф. (8.1)", "EN 1993-1-1, 6.2.3 (6.6)"), "F_f / A ≤ R_y", `${kNs(Ff)} kN / ${f(Agc, 0)} mm² = ${f(Ff / Agc, 1)} / ${f(mp.R, 0)} MPa`, Ff / Agc / mp.R));
      const Anf = (b - p.nbf * d0) * tf;
      out.push(mkCheck("jFlangeNet", CLs(code, "п. 8.1.1, ф. (8.2)", "EN 1993-1-1, 6.2.3 (6.7)"), "F_f / A_n,f ≤ R_u", `${kNs(Ff)} kN / ${f(Anf, 0)} mm² = ${f(Ff / Anf, 1)} / ${f(mb.Ru, 0)} MPa`, Ff / Anf / mb.Ru));
      // болти стінки: двозрізні, зріз + момент частки стінки
      out.push(...checkBolts({ code, kind: p.friction ? "friction" : "bearing", d: p.d, boltClass: p.cls, shearPlanes: 2, tmin: Math.min(tw, 2 * p.tcw),
        Ryn: Math.min(mb.Ryn, mp.Ryn), Run: Math.min(mb.Run, mp.Run), group: { rows: p.nrw, cols: p.ncw, px: p.pcw, py: p.pw },
        a: p.e1, Fx: Nw / gn, Fy: V / gn, M: (Math.abs(Mw) + V * ew) / gn, T: 0, gammaC: gc, gammaN: gn }).checks.map((x) => ({ ...x, key: `jWb_${x.key}` })));
      const Wc = (2 * p.tcw * hcw * hcw) / 6, Ac = 2 * p.tcw * hcw;
      const sg = (Math.abs(Mw) + V * ew) / Wc + Math.abs(Nw) / Ac, tau = V / Ac;
      const se = Math.sqrt(sg * sg + 3 * tau * tau), lim = (code === "DBN" ? 1.15 : 1) * mp.R;
      out.push(mkCheck("jWebCover", CLs(code, "п. 9.2.1; п. 8.2.1", "EN 1993-1-1, 6.2.1 (6.1)"), "√(σ² + 3τ²) у накладках стінки",
        `M = ${kNms(Math.abs(Mw) + V * ew)} kN·m; σ = ${f(sg, 1)}, τ = ${f(tau, 1)}; ${f(se, 1)} / ${f(lim, 0)} MPa`, se / lim));
      return out;
    };
    // креслення: дві балки із зазором, накладки
    addBeam(-beamLen, -p.gap / 2); addBeam(p.gap / 2, beamLen);
    parts.push({ id: "covers", cls: "plate", axis: "x", from: -lcf / 2, to: lcf / 2, poly: rect(-b / 2, b / 2, h / 2, h / 2 + p.tcf) });
    parts.push({ id: "covers", cls: "plate", axis: "x", from: -lcf / 2, to: lcf / 2, poly: rect(-b / 2, b / 2, -h / 2 - p.tcf, -h / 2) });
    if (p.inner) for (const sy of [1, -1]) for (const sz of [1, -1]) {
      const y0 = sy > 0 ? tw / 2 + (s.dims.r ?? 10) + 5 : -tw / 2 - (s.dims.r ?? 10) - 5 - bci;
      parts.push({ id: "covers", cls: "plate", axis: "x", from: -lcf / 2, to: lcf / 2, poly: rect(y0, y0 + bci, sz > 0 ? h / 2 - tf - p.tcf : -h / 2 + tf, sz > 0 ? h / 2 - tf : -h / 2 + tf + p.tcf) });
    }
    for (const sy of [1, -1]) parts.push({ id: "webCovers", cls: "plate", axis: "x", from: -lcw / 2, to: lcw / 2, poly: rect(sy > 0 ? tw / 2 : -tw / 2 - p.tcw, sy > 0 ? tw / 2 + p.tcw : -tw / 2, -hcw / 2, hcw / 2) });
    const gy = p.nbf > 2 ? [-p.g / 2 - 40, -p.g / 2, p.g / 2, p.g / 2 + 40].slice(0, p.nbf) : [-p.g / 2, p.g / 2];
    for (const sx of [1, -1]) for (let k = 0; k < p.nlf; k++) {
      const x = sx * (p.gap / 2 + p.e1 + k * p.pf);
      for (const y of gy) for (const sz of [1, -1]) parts.push(...bolt("bolts", "z", sz > 0 ? h / 2 - tf - (p.inner ? p.tcf : 0) : -h / 2 - p.tcf, sz > 0 ? h / 2 + p.tcf : -h / 2 + tf + (p.inner ? p.tcf : 0), x, y, p.d));
    }
    for (const sx of [1, -1]) for (let a = 0; a < p.ncw; a++) for (let q = 0; q < p.nrw; q++)
      parts.push(...bolt("webBolts", "y", -tw / 2 - p.tcw, tw / 2 + p.tcw, sx * (p.gap / 2 + p.e1 + a * p.pcw), ((p.nrw - 1) / 2 - q) * p.pw, p.d));
    dims.push({ view: "front", a: [-lcf / 2, h / 2 + p.tcf + 30], b: [lcf / 2, h / 2 + p.tcf + 30], text: `${f(lcf, 0)}`, part: "covers" },
      { view: "front", a: [-lcw / 2, -hcw / 2 - 25], b: [lcw / 2, -hcw / 2 - 25], text: `${f(lcw, 0)}`, part: "webCovers" });
  } else if (i.kind === "gusset") {
    // ---- вузол ферми: пояс (s) уздовж x, фасонка під поясом, стрижні решітки приварені фланговими швами
    const ch = s.h, ms = p.members.filter((m) => m.on).slice(0, 3);
    const mg = mat(code, i.plateSteel, p.tg, gc);
    const keys = ["N1", "N2", "N3"] as const;
    perCombo = (c) => {
      const out: Check[] = [];
      let Fx = 0, Fz = 0;
      ms.forEach((m, k) => {
        const N = ((c[keys[k]] as number | undefined) ?? 0) * gn;
        if (!N) return;
        const th = (m.angle * Math.PI) / 180;
        Fx += N * Math.cos(th); Fz += N * Math.sin(th);
        const mm = mat(code, m.steel, Math.max(m.sec.dims.t ?? m.sec.dims.tw ?? 4, 4), gc);
        const bm = m.sec.b, tm = m.sec.dims.t ?? m.sec.dims.tw ?? 5;
        // флангові шви вздовж стрижня по двох гранях
        out.push(...checkFillet({ code, segs: weldShape("flank2", { b: m.Lw, h: bm }), kf: m.kf, process: "manual", Run: Math.min(mm.Run, mg.Run), Ryn: Math.min(mm.Ryn, mg.Ryn),
          tmin: Math.min(tm, p.tg), tmax: Math.max(tm, p.tg), N: 0, Vy: N / gn, Vz: 0, Mx: 0, My: 0, Mz: 0, gammaC: gc, gammaN: gn }).checks.map((x) => ({ ...x, key: `jW_${x.key}`, clause: `${x.clause} · стрижень ${k + 1}` })));
        // фасонка: ширина Вітмора
        const bw = bm + 2 * m.Lw * Math.tan(Math.PI / 6);
        const sig = Math.abs(N) / (bw * p.tg);
        out.push(mkCheck("jWhitmore", code === "DBN" ? "ДБН В.2.6-198, п. 8.1.1; ширина розподілу за Вітмором (30°)" : "EN 1993-1-1, 6.2.3; ширина Вітмора (30°)", "N / (b_w·t_g) ≤ R_y",
          `стрижень ${k + 1}: b_w = ${f(bw, 0)} mm; ${f(sig, 1)} / ${f(mg.R, 0)} MPa`, sig / mg.R));
        if (N < 0) {
          const lam = (0.65 * p.cfree * Math.sqrt(12)) / p.tg, chi = chiC(lam, mg.R);
          out.push(mkCheck("jGussetBuck", "стійкість фасонки за Торнтоном: l = 0.65·c, крива c (наближено для обох норм)", "N ≤ χ·b_w·t_g·R_y",
            `стрижень ${k + 1}: λ = ${f(lam, 1)}, χ = ${f(chi, 3)}; ${kNs(-N)} / ${kNs(chi * bw * p.tg * mg.R)} kN`, -N / (chi * bw * p.tg * mg.R)));
        }
      });
      // шов фасонки до поясу: дві лінії вздовж x з обох боків фасонки
      const segs: WeldSeg[] = [{ y1: -p.lg / 2, z1: -p.tg / 2, y2: p.lg / 2, z2: -p.tg / 2 }, { y1: -p.lg / 2, z1: p.tg / 2, y2: p.lg / 2, z2: p.tg / 2 }];
      const Mz = Fx * (ch / 2);
      out.push(...checkFillet({ code, segs, kf: p.kf, process: "manual", Run: Math.min(mb.Run, mg.Run), Ryn: Math.min(mb.Ryn, mg.Ryn), tmin: Math.min(p.tg, tf), tmax: Math.max(p.tg, tf),
        N: -Fz / gn, Vy: Fx / gn, Vz: 0, Mx: 0, My: 0, Mz: Mz / gn, gammaC: gc, gammaN: gn }).checks.map((x) => ({ ...x, key: `jWg_${x.key}` })));
      // переріз фасонки біля поясу
      const sg = Math.abs(Fz) / (p.lg * p.tg) + (6 * Math.abs(Mz)) / (p.tg * p.lg * p.lg), tau = Math.abs(Fx) / (p.lg * p.tg);
      const se = Math.sqrt(sg * sg + 3 * tau * tau), lim = (code === "DBN" ? 1.15 : 1) * mg.R;
      out.push(mkCheck("jGussetSec", code === "DBN" ? "ДБН В.2.6-198, п. 8.2.1" : "EN 1993-1-1, 6.2.1 (6.1)", "√(σ² + 3τ²) у перерізі фасонки біля поясу",
        `ΣN_x = ${kNs(Fx)}, ΣN_z = ${kNs(Fz)} kN; σ = ${f(sg, 1)}, τ = ${f(tau, 1)}; ${f(se, 1)} / ${f(lim, 0)} MPa`, se / lim));
      return out;
    };
    // креслення: пояс, фасонка, стрижні під кутами
    addBeam(-p.lg / 2 - 300, p.lg / 2 + 300, "beam");
    parts.push({ id: "gusset", cls: "plate", axis: "y", from: -p.tg / 2, to: p.tg / 2, poly: rect(-p.lg / 2, p.lg / 2, -ch / 2 - p.hg, -ch / 2) });
    ms.forEach((m, k) => {
      const th = (m.angle * Math.PI) / 180, ux = Math.cos(th), uz = Math.sin(th);
      // кінець стрижня — на відстані, де він виходить за межі фасонки на довжину шва
      const r0 = Math.max(ch / 2 + p.cfree, 60), r1 = r0 + Math.max(m.Lw + 250, 400);
      const hb = m.sec.b / 2, hhm = m.sec.h / 2;
      // стрижень — призма вздовж y не підходить; малюємо як смугу у площині xz (вигляд спереду) і в плані
      const nx = -uz, nz = ux;
      const pts: [number, number][] = [[r0 * ux + nx * hhm, r0 * uz + nz * hhm], [r1 * ux + nx * hhm, r1 * uz + nz * hhm], [r1 * ux - nx * hhm, r1 * uz - nz * hhm], [r0 * ux - nx * hhm, r0 * uz - nz * hhm]];
      parts.push({ id: `m${k + 1}`, cls: "steel member", axis: "y", from: -hb - p.tg / 2, to: hb + p.tg / 2, poly: pts });
    });
    dims.push({ view: "front", a: [-p.lg / 2, -ch / 2 - p.hg - 30], b: [p.lg / 2, -ch / 2 - p.hg - 30], text: `${p.lg}`, part: "gusset" },
      { view: "front", a: [p.lg / 2 + 30, -ch / 2 - p.hg], b: [p.lg / 2 + 30, -ch / 2], text: `${p.hg}`, part: "gusset" });
    if (ms.some((m) => m.Lw > p.lg)) notes.push("gussetShort");
  } else if (i.kind === "beamSeat") {
    // ---- опорний столик: товста пластина на опорі, опорне ребро балки з фрезерованим торцем
    const hw = h - 2 * tf;
    const mr = mat(code, i.plateSteel, p.tr, gc), ms = mat(code, i.plateSteel, p.ts, gc);
    const xr = p.gap + p.tr / 2; // ребро біля торця балки
    perCombo = (c) => {
      const out: Check[] = [];
      const V = Math.abs(c.Vz ?? 0) * gn;
      const Ar = p.br * p.tr;
      const Rp = code === "DBN" ? mr.Run / 1.025 * gc : mr.fy;
      out.push(mkCheck("jRibBearing", code === "DBN" ? "ДБН В.2.6-198, зминання торцевої поверхні (фрезерований торець), R_p = R_un/γ_m" : "EN 1993-1-1, 6.2.4 (торець ребра)", "V / (b_r·t_r) ≤ R_p",
        `${kNs(V)} kN / ${f(Ar, 0)} mm² = ${f(V / Ar, 1)} / ${f(Rp, 0)} MPa`, V / Ar / Rp));
      // ребро як стійка з ділянкою стінки 0.65·t_w·√(E/R_y)
      const bwPart = 0.65 * tw * Math.sqrt(210000 / mb.R);
      const As = Ar + bwPart * tw, Iz = (p.tr * p.br ** 3) / 12, ir = Math.sqrt(Iz / As), lam = hw / ir, chi = chiC(lam, mr.R);
      out.push(mkCheck("jRibBuck", code === "DBN" ? "ДБН В.2.6-198, опорне ребро як умовна стійка (ділянка стінки 0.65·t_w·√(E/R_y)), φ за кривою c" : "EN 1993-1-5, 9.4 (ребро як стійка), крива c", "V ≤ φ·A_s·R_y",
        `A_s = ${f(As, 0)} mm², i = ${f(ir, 1)}, λ = ${f(lam, 1)}, φ = ${f(chi, 3)}; ${kNs(V)} / ${kNs(chi * As * mr.R)} kN`, V / (chi * As * mr.R)));
      // шви ребра до стінки
      out.push(...checkFillet({ code, segs: [{ y1: -tw / 2, z1: -hw / 2, y2: -tw / 2, z2: hw / 2, flank: true }, { y1: tw / 2, z1: -hw / 2, y2: tw / 2, z2: hw / 2, flank: true }], kf: p.kf2, process: "manual",
        Run: Math.min(mr.Run, mb.Run), Ryn: Math.min(mr.Ryn, mb.Ryn), tmin: Math.min(tw, p.tr), tmax: Math.max(tw, p.tr), N: 0, Vy: 0, Vz: V / gn, Mx: 0, My: 0, Mz: 0, gammaC: gc, gammaN: gn })
        .checks.map((x) => ({ ...x, key: `jWr_${x.key}` })));
      // шви столика: два вертикальні шви по боках, сила з ексцентриситетом t_s/2
      const Vk = V * p.kV;
      out.push(...checkFillet({ code, segs: [{ y1: -p.bs / 2, z1: -p.hs / 2, y2: -p.bs / 2, z2: p.hs / 2 }, { y1: p.bs / 2, z1: -p.hs / 2, y2: p.bs / 2, z2: p.hs / 2 }], kf: p.kf, process: "manual",
        Run: Math.min(ms.Run, mc.Run), Ryn: Math.min(ms.Ryn, mc.Ryn), tmin: Math.min(p.ts, tSup), tmax: Math.max(p.ts, tSup), N: 0, Vy: 0, Vz: Vk / gn, Mx: 0, My: (Vk * p.ts) / 2 / gn, Mz: 0, gammaC: gc, gammaN: gn })
        .checks.map((x) => ({ ...x, key: `jWs_${x.key}` })));
      return out;
    };
    if (p.kV === 1) notes.push("seatKv");
    if (col) parts.push(...columnParts(col, face, [-h / 2 - p.ar - p.hs - 150, h / 2 + 150]));
    addBeam(p.gap, beamLen);
    const zb = -h / 2 - p.ar;
    parts.push({ id: "rib", cls: "plate", axis: "x", from: p.gap, to: p.gap + p.tr, poly: rect(-p.br / 2, p.br / 2, zb, h / 2 - tf) });
    parts.push({ id: "seat", cls: "plate", axis: "z", from: zb - p.hs, to: zb, poly: rect(0, p.ts, -p.bs / 2, p.bs / 2) });
    parts.push(weldP("welds", "z", zb - p.hs, zb, 0, p.bs / 2, p.kf, 1, 1), weldP("welds", "z", zb - p.hs, zb, 0, -p.bs / 2, p.kf, 1, -1));
    dims.push({ view: "front", a: [-30, zb - p.hs], b: [-30, zb], text: `${p.hs}`, part: "seat" },
      { view: "front", a: [0, zb - p.hs - 30], b: [p.ts, zb - p.hs - 30], text: `${p.ts}`, part: "seat" },
      { view: "front", a: [xr + 40, zb], b: [xr + 40, -h / 2], text: `${p.ar}`, part: "rib" });
  }

  const combos: JointComboResult[] = i.combos.map((c) => {
    const checks = perCombo(c);
    const u = checks.map((x) => x.util);
    return { name: c.name, checks, maxUtil: u.some((x) => Number.isNaN(x)) ? NaN : Math.max(0, ...u), ok: checks.every((x) => x.ok) };
  });
  const m = new Map<string, Check & { combo: string }>();
  for (const r of combos) for (const ch of r.checks) {
    const id = ch.key + "|" + ch.clause, cur = m.get(id);
    if (!cur || ch.util > cur.util || Number.isNaN(ch.util)) m.set(id, { ...ch, combo: r.name });
  }
  const envelope = [...m.values()];
  const us = envelope.map((x) => x.util);
  return { combos, envelope, parts, dims, values, notes: [...new Set(notes)],
    maxUtil: us.some((x) => Number.isNaN(x)) ? NaN : Math.max(0, ...us), ok: envelope.every((x) => x.ok) };
}
