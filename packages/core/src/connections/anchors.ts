// Анкерне кріплення до бетону: закладні з головкою, механічні та хімічні (клейові) анкери.
// EN 1992-4:2018 (ДСТУ-Н Б EN 1992-4), CEN/TS 1992-4-2:2009; сталь анкера за ДБН — Rba (ДБН В.2.6-198, 7.7, табл. Д.6).
// Одиниці: Н, мм, МПа. Зусилля — розрахункові.

import type { CodeId } from "../codes/types";
import { Check, f, mkCheck } from "../codes/types";
import { BOLT_AS, boltForces } from "./bolts";
import type { ConnResult } from "./bolts";

export type AnchorType = "headed" | "mechanical" | "bonded";

/** Сталі анкерів: fuk, fyk (МПа); Rba за ДБН табл. Д.6 [d ≤ 20, ≤ 30, ≤ 36, ≤ 56, ≤ 80, ≤ 100, ≤ 140] */
export const ANCHOR_STEELS: { id: string; fuk: number; fyk: number; rba?: number[] }[] = [
  { id: "Ст3пс2", fuk: 370, fyk: 245, rba: [200, 190, 190, 180, 180, 180, 165] },
  { id: "09Г2С", fuk: 490, fyk: 325, rba: [265, 245, 230, 230, 220, 210, 210] },
  { id: "10Г2С1", fuk: 510, fyk: 345, rba: [270, 265, 265, 265, 235, 235, NaN] },
  { id: "4.6", fuk: 400, fyk: 240 },
  { id: "5.6", fuk: 500, fyk: 300 },
  { id: "5.8", fuk: 500, fyk: 400 },
  { id: "8.8", fuk: 800, fyk: 640 },
  { id: "A4-70", fuk: 700, fyk: 450 },
];

export function rbaDBN(steelId: string, d: number): number {
  const s = ANCHOR_STEELS.find((x) => x.id === steelId);
  if (!s) return NaN;
  if (!s.rba) return 0.8 * s.fyk; // (7.1) Rba = 0.80·Ryn
  const lim = [20, 30, 36, 56, 80, 100, 140];
  const i = lim.findIndex((l) => d <= l);
  return s.rba[i < 0 ? s.rba.length - 1 : i];
}

/** Класи бетону: fck (циліндрична), МПа */
export const CONCRETE_CLASSES: { id: string; fck: number }[] = [
  { id: "C12/15", fck: 12 }, { id: "C16/20", fck: 16 }, { id: "C20/25", fck: 20 }, { id: "C25/30", fck: 25 },
  { id: "C30/37", fck: 30 }, { id: "C35/45", fck: 35 }, { id: "C40/50", fck: 40 }, { id: "C45/55", fck: 45 }, { id: "C50/60", fck: 50 },
];

export interface AnchorInput {
  code: CodeId;
  type: AnchorType;
  d: number; // діаметр різьби, мм
  dnom?: number; // зовнішній діаметр анкера (для крайового руйнування), мм
  dh?: number; // діаметр головки (закладні), мм
  hef: number; // ефективна глибина анкерування, мм
  steel: string;
  fck: number;
  cracked: boolean;
  h: number; // товщина бетонного елемента, мм
  /** розташування: nx стовпців (вздовж x) з кроком sx, ny рядів з кроком sy */
  nx: number; ny: number; sx: number; sy: number;
  /** відстань від крайніх анкерів до країв бетону, мм (Infinity — краю немає) */
  cxm: number; cxp: number; cym: number; cyp: number;
  /** опорна плита: bx × by, мм (центр — у центрі групи) */
  bx: number; by: number;
  /** зусилля: N (+ відрив), Mx (розтяг з боку +y), My (розтяг з боку +x), Vx, Vy, T (кручення) */
  N: number; Mx: number; My: number; Vx: number; Vy: number; T: number;
  /** зазор/підливка між плитою і бетоном (плече зсуву), мм; αM = 1 (вільний поворот) або 2 */
  standoff?: number;
  alphaM?: number;
  /** дані ETA (необов'язкові) */
  NRkp?: number; // опір висмикуванню механічного анкера, Н
  tauRk?: number; // хімічний: τRk для заданого стану бетону, МПа
  tauRkUcr?: number; // хімічний: τRk,ucr, МПа
  psiSus?: number;
  ccrSp?: number; // мм
  hmin?: number; // мм
  k8?: number; // відколювання (pry-out)
  gammaInst?: number;
  /** армування: крайове армування/хомути (ψre,V = 1.4), арматура з кроком ≥ 150 (ψre,N = 1) */
  edgeReinf?: boolean;
  sparseReinf?: boolean;
  /** арматура обмежує розкриття тріщин від розколювання (6.2.6.2 b)) */
  splitReinf?: boolean;
  gammaN?: number;
}

interface Pt { x: number; y: number }

/** площа об'єднання прямокутників (x1, y1, x2, y2) */
function unionArea(rs: [number, number, number, number][]): number {
  const rr = rs.filter((r) => r[2] > r[0] && r[3] > r[1]);
  const xs = [...new Set(rr.flatMap((r) => [r[0], r[2]]))].sort((a, b) => a - b);
  let A = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const xm = (xs[i] + xs[i + 1]) / 2;
    const iv = rr.filter((r) => r[0] <= xm && r[2] >= xm).map((r) => [r[1], r[3]] as [number, number]).sort((a, b) => a[0] - b[0]);
    let len = 0, cur: [number, number] | null = null;
    for (const v of iv) {
      if (!cur || v[0] > cur[1]) { if (cur) len += cur[1] - cur[0]; cur = [...v] as [number, number]; } else cur[1] = Math.max(cur[1], v[1]);
    }
    if (cur) len += cur[1] - cur[0];
    A += len * (xs[i + 1] - xs[i]);
  }
  return A;
}

/** Розподіл відриву між анкерами при жорсткій плиті: лінійна деформація, бетон лише стиск, анкери лише розтяг (EN 1992-4, 6.2.1). */
export function anchorTension(pts: Pt[], As: number, bx: number, by: number, N: number, Mx: number, My: number, Ec: number) {
  const Es = 200000;
  const G = 24;
  const cells: Pt[] = [];
  for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) cells.push({ x: (-0.5 + (i + 0.5) / G) * bx, y: (-0.5 + (j + 0.5) / G) * by });
  const dA = (bx * by) / (G * G);
  let e = [0, 0, 0]; // ε = e0 + ex·x + ey·y
  const strain = (p: Pt) => e[0] + e[1] * p.x + e[2] * p.y;
  // початкове наближення: усі анкери + увесь бетон
  let actA = pts.map(() => true), actC = cells.map(() => true);
  for (let it = 0; it < 60; it++) {
    const K = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const add = (p: Pt, k: number) => {
      const v = [1, p.x, p.y];
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) K[a][b] += k * v[a] * v[b];
    };
    pts.forEach((p, i) => actA[i] && add(p, Es * As));
    cells.forEach((p, i) => actC[i] && add(p, Ec * dA));
    // стійкість: якщо нічого не активне — лише анкери
    if (!actA.some(Boolean) && !actC.some(Boolean)) pts.forEach((p) => add(p, Es * As));
    const sol = solve3(K, [N, My, Mx]);
    if (!sol) break;
    e = sol;
    const nA = pts.map((p) => strain(p) > 0);
    const nC = cells.map((p) => strain(p) < 0);
    const same = nA.every((v, i) => v === actA[i]) && nC.every((v, i) => v === actC[i]);
    actA = nA; actC = nC;
    if (same) break;
  }
  const F = pts.map((p) => Math.max(0, Es * As * strain(p)));
  let C = 0, Cx = 0, Cy = 0, sigC = 0;
  for (const p of cells) {
    const s = strain(p);
    if (s < 0) { const c = -Ec * s * dA; C += c; Cx += c * p.x; Cy += c * p.y; sigC = Math.max(sigC, -Ec * s); }
  }
  return { F, C, cx: C ? Cx / C : 0, cy: C ? Cy / C : 0, sigC };
}

function solve3(K: number[][], b: number[]): number[] | null {
  const m = K.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-12) {
      // вироджений напрямок (напр. один ряд анкерів без бетону) — фіксуємо нульову кривизну
      m[c] = m[c].map((_, j) => (j === c ? 1 : 0));
      continue;
    }
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < 3; r++) if (r !== c) {
      const k = m[r][c] / m[c][c];
      for (let j = c; j < 4; j++) m[r][j] -= k * m[c][j];
    }
  }
  return m.map((r, i) => r[3] / r[i]);
}

export function checkAnchors(i: AnchorInput): ConnResult & { forces: { x: number; y: number; N: number; V: number }[]; sigC: number } {
  const gn = i.gammaN ?? 1;
  const CL = "EN 1992-4";
  const As = BOLT_AS[i.d] ?? 0.78 * i.d * i.d;
  const st = ANCHOR_STEELS.find((s) => s.id === i.steel) ?? ANCHOR_STEELS[3];
  const { fuk, fyk } = st;
  const dnom = i.dnom ?? i.d;
  const fck = i.fck;
  const Ecm = 22000 * ((fck + 8) / 10) ** 0.3;
  const gMc = 1.5 * (i.gammaInst ?? (i.type === "headed" ? 1.0 : 1.2));
  const n = i.nx * i.ny;

  // координати анкерів (центр групи — 0,0)
  const pts: Pt[] = [];
  for (let a = 0; a < i.nx; a++) for (let b = 0; b < i.ny; b++) pts.push({ x: (a - (i.nx - 1) / 2) * i.sx, y: (b - (i.ny - 1) / 2) * i.sy });
  const X0 = -((i.nx - 1) / 2) * i.sx - i.cxm, X1 = ((i.nx - 1) / 2) * i.sx + i.cxp;
  const Y0 = -((i.ny - 1) / 2) * i.sy - i.cym, Y1 = ((i.ny - 1) / 2) * i.sy + i.cyp;
  const edgeDist = (p: Pt) => Math.min(p.x - X0, X1 - p.x, p.y - Y0, Y1 - p.y);

  const tens = anchorTension(pts, As, i.bx, i.by, i.N * gn, i.Mx * gn, i.My * gn, Ecm);
  const sh = boltForces({ cols: i.nx, rows: i.ny, px: i.sx, py: i.sy }, i.Vx * gn, i.Vy * gn, i.T * gn);
  // порядок точок у boltForces: for cols { for rows } — збігається з pts
  const forces = pts.map((p, k) => ({ ...p, N: tens.F[k], V: sh.forces[k].v }));
  const NEd = Math.max(0, ...tens.F);
  const NEdG = tens.F.reduce((a, b) => a + b, 0);
  const VEd = Math.max(0, ...sh.forces.map((q) => q.v));
  const VEdG = Math.hypot(i.Vx, i.Vy) * gn;
  const tIdx = pts.map((_, k) => k).filter((k) => tens.F[k] > 1e-6 * Math.max(1, NEdG));

  const checks: Check[] = [];
  const bN: { s: number; c: number } = { s: 0, c: 0 }, bV = { s: 0, c: 0 };
  const values = [
    { k: "n", v: String(n) },
    { k: "N_Ed,max / ΣN_Ed", v: `${f(NEd / 1000)} / ${f(NEdG / 1000)} kN` },
    { k: "V_Ed,max / V_Ed", v: `${f(VEd / 1000)} / ${f(VEdG / 1000)} kN` },
    ...(tens.C > 0 ? [{ k: "σ_c,max (під плитою)", v: `${f(tens.sigC, 1)} MPa` }] : []),
    { k: "γ_Mc", v: f(gMc, 2) },
  ];

  // ---------- Сталь анкера: розтяг ----------
  const gMsN = Math.max(1.2 * fuk / fyk, 1.4);
  const NRds = i.code === "DBN" ? rbaDBN(i.steel, i.d) * As : (As * fuk) / gMsN;
  if (NEd > 0) {
    const u = NEd / NRds;
    bN.s = u;
    if (i.code === "DBN") {
      const Rba = rbaDBN(i.steel, i.d);
      checks.push(mkCheck("anchorSteelN", "ДБН В.2.6-198, п. 7.7, ф. (7.1), табл. Д.6", "N_Ed / (R_ba·A_bn) ≤ 1",
        `R_ba = ${f(Rba, 0)} MPa; ${f(NEd / 1000)} / (${f(Rba, 0)}·${f(As, 1)}) = ${f(NEd / 1000)} / ${f(NRds / 1000)} kN`, u));
    } else {
      checks.push(mkCheck("anchorSteelN", `${CL}, 7.2.1.3, табл. 7.1`, "N_Ed / (A_s·f_uk/γ_Ms) ≤ 1",
        `γ_Ms = ${f(gMsN, 2)}; ${f(NEd / 1000)} / ${f(NRds / 1000)} kN`, u));
    }
  }

  // ---------- Бетон: конус виривання ----------
  const k1 = i.type === "headed" ? (i.cracked ? 8.9 : 12.7) : (i.cracked ? 7.7 : 11.0);
  let hef = i.hef;
  let ccrN = 1.5 * hef, scrN = 3 * hef;
  // вузький елемент (7.2.1.4 (8)): ≥ 3 краї ближче за c_cr,N
  const allEdges = [i.cxm, i.cxp, i.cym, i.cyp];
  const near = allEdges.filter((c) => c < ccrN);
  const notes: string[] = [];
  if (near.length >= 3) {
    const cmax = Math.max(...near);
    const smax = Math.max(i.nx > 1 ? (i.nx - 1) * i.sx : 0, i.ny > 1 ? (i.ny - 1) * i.sy : 0);
    const h2 = Math.max(cmax / 1.5, smax / 3);
    if (h2 < hef) { scrN = scrN * h2 / hef; ccrN = ccrN * h2 / hef; hef = h2; notes.push("narrowHef"); }
  }
  const coneArea = (idx: number[], scr: number) => {
    const c = scr / 2;
    const rects = idx.map((k) => {
      const p = pts[k];
      return [Math.max(p.x - c, X0), Math.max(p.y - c, Y0), Math.min(p.x + c, X1), Math.min(p.y + c, Y1)] as [number, number, number, number];
    });
    return unionArea(rects);
  };
  const psiRe = i.sparseReinf || hef >= 100 ? 1 : Math.min(1, 0.5 + hef / 200);
  const N0c = k1 * Math.sqrt(fck) * hef ** 1.5;
  const eccOf = (idx: number[], scr: number) => {
    const T = idx.reduce((a, k) => a + tens.F[k], 0);
    if (!T) return 1;
    const gx = idx.reduce((a, k) => a + pts[k].x, 0) / idx.length, gy = idx.reduce((a, k) => a + pts[k].y, 0) / idx.length;
    const rx = idx.reduce((a, k) => a + tens.F[k] * pts[k].x, 0) / T, ry = idx.reduce((a, k) => a + tens.F[k] * pts[k].y, 0) / T;
    return Math.min(1, 1 / (1 + 2 * Math.abs(rx - gx) / scr)) * Math.min(1, 1 / (1 + 2 * Math.abs(ry - gy) / scr));
  };
  const coneRk = (idx: number[], withEcc: boolean) => {
    const Ac = coneArea(idx, scrN), A0 = scrN * scrN;
    const c = Math.min(...idx.map((k) => edgeDist(pts[k])));
    const psiS = Math.min(1, 0.7 + 0.3 * c / ccrN);
    const psiEc = withEcc ? eccOf(idx, scrN) : 1;
    // ψM,N (7.7): стиск під плитою від моменту
    let psiM = 1;
    if (withEcc && tens.C > 0 && c >= 1.5 * hef && NEdG > 0) {
      const T = NEdG, tx = idx.reduce((a, k) => a + tens.F[k] * pts[k].x, 0) / T, ty = idx.reduce((a, k) => a + tens.F[k] * pts[k].y, 0) / T;
      const z = Math.hypot(tx - tens.cx, ty - tens.cy);
      if (tens.C / T >= 0.8 && z / hef < 1.5) psiM = Math.max(1, 2 - z / (1.5 * hef));
    }
    return { NRk: N0c * (Ac / A0) * psiS * psiRe * psiEc * psiM, Ac, A0, psiS, psiEc, psiM };
  };
  const betaNc: number[] = [];
  if (NEdG > 0 && tIdx.length) {
    const r = coneRk(tIdx, true);
    const NRd = r.NRk / gMc;
    betaNc.push(NEdG / NRd);
    values.push({ k: "N⁰_Rk,c", v: `${f(N0c / 1000)} kN` });
    checks.push(mkCheck("anchorCone", `${CL}, 7.2.1.4, (7.1)–(7.7); CEN/TS 1992-4-2, 6.2.5`,
      "N_Ed^g / (N⁰_Rk,c·A_c,N/A⁰_c,N·ψ_s,N·ψ_re,N·ψ_ec,N·ψ_M,N/γ_Mc) ≤ 1",
      `k1 = ${k1}; h_ef = ${f(hef, 0)}; N⁰ = ${k1}·√${fck}·${f(hef, 0)}^1.5 = ${f(N0c / 1000)} kN; A/A⁰ = ${f(r.Ac / 100, 0)}/${f(r.A0 / 100, 0)} cm²; ψ_s = ${f(r.psiS, 3)}; ψ_re = ${f(psiRe, 3)}; ψ_ec = ${f(r.psiEc, 3)}; ψ_M = ${f(r.psiM, 3)}; ${f(NEdG / 1000)} / ${f(NRd / 1000)} kN`,
      NEdG / NRd, notes.length ? notes : undefined));
  }

  // ---------- Висмикування (механічні, закладні) ----------
  if (NEd > 0 && i.type !== "bonded") {
    let NRkp = i.NRkp;
    let subst = "";
    if (i.type === "headed") {
      const dh = i.dh ?? 1.9 * i.d;
      const Ah = (Math.PI / 4) * (dh * dh - i.d * i.d);
      const k2 = i.cracked ? 7.5 : 10.5;
      NRkp = k2 * Ah * fck;
      subst = `A_h = π/4·(${f(dh, 0)}² − ${i.d}²) = ${f(Ah, 0)} mm²; N_Rk,p = ${k2}·A_h·f_ck = ${f(NRkp / 1000)} kN; `;
    }
    if (NRkp) {
      const NRd = NRkp / gMc;
      betaNc.push(NEd / NRd);
      checks.push(mkCheck("anchorPullOut", `${CL}, 7.2.1.5${i.type === "headed" ? ", (7.11)" : " (ETA)"}`, "N_Ed^h / (N_Rk,p/γ_Mp) ≤ 1",
        `${subst}${f(NEd / 1000)} / ${f(NRd / 1000)} kN`, NEd / NRd, i.type === "mechanical" ? ["fromETA"] : undefined));
    } else values.push({ k: "N_Rk,p", v: "→ ETA" });
  }

  // ---------- Комбіноване висмикування і руйнування бетону (хімічні) ----------
  let NRkpBond = Infinity;
  if (i.type === "bonded") {
    const tauUcr = i.tauRkUcr ?? 12, tau = i.tauRk ?? (i.cracked ? 7 : tauUcr);
    const psiSus = i.psiSus ?? 1;
    const scrNp = Math.min(7.3 * i.d * Math.sqrt(psiSus * tauUcr), 3 * hef);
    const ccrNp = scrNp / 2;
    const N0p = psiSus * tau * Math.PI * i.d * hef;
    const k3 = i.cracked ? 7.7 : 11.0;
    const tauC = (k3 / (Math.PI * i.d)) * Math.sqrt(hef * fck);
    const bondRk = (idx: number[], withEcc: boolean) => {
      const nn = idx.length;
      const Ap = coneArea(idx, scrNp), A0 = scrNp * scrNp;
      const c = Math.min(...idx.map((k) => edgeDist(pts[k])));
      const psiS = Math.min(1, 0.7 + 0.3 * c / ccrNp);
      const g0 = Math.max(1, Math.sqrt(nn) - (Math.sqrt(nn) - 1) * Math.min(1, tau / tauC) ** 1.5);
      const s = nn > 1 ? Math.min(i.nx > 1 ? i.sx : Infinity, i.ny > 1 ? i.sy : Infinity) : scrNp;
      const psiG = Math.max(1, g0 - Math.sqrt(Math.min(1, s / scrNp)) * (g0 - 1));
      const psiEc = withEcc ? eccOf(idx, scrNp) : 1;
      return { NRk: N0p * (Ap / A0) * psiG * psiS * psiRe * psiEc, Ap, A0, psiS, psiG, psiEc };
    };
    if (NEdG > 0 && tIdx.length) {
      const r = bondRk(tIdx, true);
      NRkpBond = r.NRk;
      const NRd = r.NRk / gMc;
      betaNc.push(NEdG / NRd);
      checks.push(mkCheck("anchorBond", `${CL}, 7.2.1.6, (7.13)–(7.20)`, "N_Ed^g / (N⁰_Rk,p·A_p,N/A⁰_p,N·ψ_g,Np·ψ_s,Np·ψ_re,N·ψ_ec,Np/γ_Mp) ≤ 1",
        `τ_Rk = ${tau} MPa; N⁰_Rk,p = ψ_sus·τ_Rk·π·d·h_ef = ${f(N0p / 1000)} kN; s_cr,Np = ${f(scrNp, 0)} mm; A/A⁰ = ${f(r.Ap / 100, 0)}/${f(r.A0 / 100, 0)} cm²; ψ_g = ${f(r.psiG, 3)}; ψ_s = ${f(r.psiS, 3)}; ψ_ec = ${f(r.psiEc, 3)}; ${f(NEdG / 1000)} / ${f(NRd / 1000)} kN`,
        NEdG / NRd, ["fromETA"]));
    }
    if (VEdG > 0) NRkpBond = bondRk(pts.map((_, k) => k), false).NRk;
  }

  // ---------- Розколювання ----------
  const ccrSp = i.ccrSp ?? (i.type === "headed" ? 1.5 * i.hef : 2 * i.hef);
  // закладні: h ≥ h_ef + головка + захисний шар (≈ h_ef + 100); хімічні (типово за ETA): h_ef + max(30; 2d₀), не менше 100;
  // механічні: 2h_ef
  const hmin = i.hmin ?? (i.type === "headed" ? i.hef + 100 : i.type === "bonded" ? Math.max(100, i.hef + Math.max(30, 2 * (i.d + 2))) : Math.max(100, 2 * i.hef));
  if (i.h < hmin) checks.push(mkCheck("anchorHmin", `${CL}, 7.2.1.7 (ETA)`, "h ≥ h_min", `${i.h} ≥ ${f(hmin, 0)} mm`, hmin / i.h, ["fromETA"]));
  if (NEdG > 0 && tIdx.length && !i.splitReinf) {
    const cmin = Math.min(...allEdges);
    const need = cmin < (n > 1 ? 1.2 : 1.0) * ccrSp;
    if (need) {
      const scrSp = 2 * ccrSp;
      const Ac = coneArea(tIdx, scrSp), A0 = scrSp * scrSp;
      const c = Math.min(...tIdx.map((k) => edgeDist(pts[k])));
      const psiS = Math.min(1, 0.7 + 0.3 * c / ccrSp);
      const psiH = Math.min(Math.max(1, (2 * i.hef / hmin) ** (2 / 3)), (i.h / hmin) ** (2 / 3));
      const N0 = i.type === "bonded" ? psiSusN0(i, hef) : N0c;
      const NRk = N0 * (Ac / A0) * psiS * psiRe * eccOf(tIdx, scrSp) * psiH;
      const NRd = NRk / gMc;
      betaNc.push(NEdG / NRd);
      checks.push(mkCheck("anchorSplit", `${CL}, 7.2.1.7, (7.23); CEN/TS 1992-4-2, (18), (19)`, "N_Ed^g / (N⁰_Rk·A_c,N/A⁰_c,N·ψ_s,N·ψ_re,N·ψ_ec,N·ψ_h,sp/γ_Msp) ≤ 1",
        `c_cr,sp = ${f(ccrSp, 0)} mm; h_min = ${f(hmin, 0)} mm; ψ_h,sp = ${f(psiH, 3)}; ${f(NEdG / 1000)} / ${f(NRd / 1000)} kN`, NEdG / NRd, ["fromETA"]));
    }
  }

  // ---------- Вибух бічної поверхні (закладні, c < 0.5 h_ef) ----------
  if (i.type === "headed" && NEd > 0) {
    const c1 = Math.min(...tIdx.map((k) => edgeDist(pts[k])));
    if (c1 < 0.5 * i.hef) {
      const dh = i.dh ?? 1.9 * i.d;
      const Ah = (Math.PI / 4) * (dh * dh - i.d * i.d);
      const k5 = i.cracked ? 8.7 : 12.2;
      const N0cb = k5 * c1 * Math.sqrt(Ah) * Math.sqrt(fck);
      const NRd = N0cb / gMc; // окремий анкер біля краю (запас: без групового ефекту)
      betaNc.push(NEd / NRd);
      checks.push(mkCheck("anchorBlowOut", `${CL}, 7.2.1.8, (7.26); CEN/TS 1992-4-2, 6.2.7`, "N_Ed / (k5·c1·√A_h·√f_ck/γ_Mc) ≤ 1",
        `c1 = ${f(c1, 0)} mm; ${f(NEd / 1000)} / ${f(NRd / 1000)} kN`, NEd / NRd));
    }
  }

  // ---------- Сталь анкера: зсув ----------
  if (VEd > 0) {
    const gMsV = fuk <= 800 && fyk / fuk <= 0.8 ? Math.max(fuk / fyk, 1.25) : 1.5;
    const e1 = i.standoff ?? 0;
    let VRd: number, subst: string, key = "anchorSteelV";
    if (e1 > 0) {
      const ds = Math.sqrt((4 * As) / Math.PI);
      const Wel = (Math.PI * ds ** 3) / 32;
      const M0 = 1.2 * Wel * fuk;
      const MRk = M0 * Math.max(0, 1 - NEd / NRds);
      const l = 0.5 * i.d + e1;
      const aM = i.alphaM ?? 1;
      VRd = (aM * MRk / l) / gMsV;
      subst = `l = a3 + e1 = ${f(l, 0)} mm; M⁰_Rk,s = 1.2·W_el·f_uk = ${f(M0 / 1e6, 3)} kNm; α_M = ${aM}; ${f(VEd / 1000)} / ${f(VRd / 1000)} kN`;
      key = "anchorSteelVM";
    } else {
      const k6 = fuk <= 500 ? 0.6 : 0.5;
      VRd = (k6 * As * fuk) / gMsV;
      subst = `k6 = ${k6}; γ_Ms = ${f(gMsV, 2)}; ${f(VEd / 1000)} / ${f(VRd / 1000)} kN`;
    }
    const u = VEd / VRd;
    bV.s = u;
    checks.push(mkCheck(key, `${CL}, 7.2.2.3, ${e1 > 0 ? "(7.37)" : "(7.35)"}`, e1 > 0 ? "V_Ed / (α_M·M_Rk,s/(l·γ_Ms)) ≤ 1" : "V_Ed / (k6·A_s·f_uk/γ_Ms) ≤ 1", subst, u));
  }

  // ---------- Відколювання (pry-out) ----------
  const betaVc: number[] = [];
  if (VEdG > 0) {
    const k8 = i.k8 ?? (i.hef < 60 ? 1 : 2);
    const all = pts.map((_, k) => k);
    const NRkc = coneRk(all, false).NRk;
    const base = i.type === "bonded" ? Math.min(NRkc, NRkpBond) : NRkc;
    const VRd = (k8 * base) / gMc;
    betaVc.push(VEdG / VRd);
    checks.push(mkCheck("anchorPryOut", `${CL}, 7.2.2.4, (7.39)`, "V_Ed^g / (k8·N_Rk,c/γ_Mc) ≤ 1",
      `k8 = ${k8}; N_Rk = ${f(base / 1000)} kN; ${f(VEdG / 1000)} / ${f(VRd / 1000)} kN`, VEdG / VRd));
  }

  // ---------- Крайове руйнування бетону ----------
  if (VEdG > 0) {
    const k9 = i.cracked ? 1.7 : 2.4;
    const psiReV = !i.cracked || i.edgeReinf ? 1.4 : 1.0;
    const lf = Math.min(i.hef, 12 * dnom);
    const eV = VEdG ? Math.abs(i.T * gn) / VEdG : 0;
    const edges: { key: string; c1: number; nrm: [number, number]; front: number[]; side: [number, number]; along: (p: Pt) => number }[] = [
      { key: "+x", c1: i.cxp, nrm: [1, 0], front: pts.map((_, k) => k).filter((k) => Math.abs(pts[k].x - Math.max(...pts.map((p) => p.x))) < 1e-6), side: [i.cym, i.cyp], along: (p) => p.y },
      { key: "−x", c1: i.cxm, nrm: [-1, 0], front: pts.map((_, k) => k).filter((k) => Math.abs(pts[k].x - Math.min(...pts.map((p) => p.x))) < 1e-6), side: [i.cym, i.cyp], along: (p) => p.y },
      { key: "+y", c1: i.cyp, nrm: [0, 1], front: pts.map((_, k) => k).filter((k) => Math.abs(pts[k].y - Math.max(...pts.map((p) => p.y))) < 1e-6), side: [i.cxm, i.cxp], along: (p) => p.x },
      { key: "−y", c1: i.cym, nrm: [0, -1], front: pts.map((_, k) => k).filter((k) => Math.abs(pts[k].y - Math.min(...pts.map((p) => p.y))) < 1e-6), side: [i.cxm, i.cxp], along: (p) => p.x },
    ];
    const vx = i.Vx * gn, vy = i.Vy * gn;
    for (const E of edges) {
      if (!Number.isFinite(E.c1) || E.c1 > Math.min(10 * i.hef, 60 * dnom)) continue;
      const cosA = (vx * E.nrm[0] + vy * E.nrm[1]) / VEdG;
      let c1 = E.c1;
      // вузький тонкий елемент (7.2.2.5 (6))
      const c2max = Math.max(...E.side), smax = Math.max(...E.front.map((k) => E.along(pts[k]))) - Math.min(...E.front.map((k) => E.along(pts[k])));
      if (c2max < 1.5 * c1 && i.h < 1.5 * c1) c1 = Math.max(c2max / 1.5, i.h / 1.5, smax / 3);
      const alpha = 0.1 * Math.sqrt(lf / c1), beta = 0.1 * (dnom / c1) ** 0.2;
      const V0 = k9 * dnom ** alpha * lf ** beta * Math.sqrt(fck) * c1 ** 1.5;
      // площа A_c,V: об'єднання смуг ±1.5c1 вздовж краю, обмежених бічними краями, × min(h, 1.5c1)
      const lo = Math.min(...pts.map(E.along)) - E.side[0], hi = Math.max(...pts.map(E.along)) + E.side[1];
      const ivs = E.front.map((k) => [Math.max(E.along(pts[k]) - 1.5 * c1, lo), Math.min(E.along(pts[k]) + 1.5 * c1, hi)] as [number, number]).sort((a, b) => a[0] - b[0]);
      let w = 0, cur: [number, number] | null = null;
      for (const v of ivs) { if (!cur || v[0] > cur[1]) { if (cur) w += cur[1] - cur[0]; cur = [...v] as [number, number]; } else cur[1] = Math.max(cur[1], v[1]); }
      if (cur) w += cur[1] - cur[0];
      const Ac = w * Math.min(i.h, 1.5 * c1), A0 = 4.5 * c1 * c1;
      const psiS = Math.min(1, 0.7 + 0.3 * Math.min(...E.side) / (1.5 * c1));
      const psiH = Math.max(1, Math.sqrt((1.5 * c1) / i.h));
      const psiEc = Math.min(1, 1 / (1 + (2 * eV) / (3 * c1)));
      const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
      const psiA = cosA <= 0 ? 2.5 : Math.max(1, 1 / Math.sqrt(cosA * cosA + (0.5 * sinA) ** 2));
      const VRk = V0 * (Ac / A0) * psiS * psiH * psiEc * psiA * psiReV;
      const VRd = VRk / gMc;
      betaVc.push(VEdG / VRd);
      checks.push(mkCheck("anchorEdge", `${CL}, 7.2.2.5, (7.40)–(7.48); край ${E.key}`, "V_Ed^g / (V⁰_Rk,c·A_c,V/A⁰_c,V·ψ_s,V·ψ_h,V·ψ_ec,V·ψ_α,V·ψ_re,V/γ_Mc) ≤ 1",
        `c1 = ${f(c1, 0)} mm; V⁰_Rk,c = ${k9}·${dnom}^${f(alpha, 3)}·${f(lf, 0)}^${f(beta, 3)}·√${fck}·${f(c1, 0)}^1.5 = ${f(V0 / 1000)} kN; A/A⁰ = ${f(Ac / 100, 0)}/${f(A0 / 100, 0)} cm²; ψ_s = ${f(psiS, 3)}; ψ_h = ${f(psiH, 3)}; ψ_ec = ${f(psiEc, 3)}; ψ_α = ${f(psiA, 3)}; ψ_re = ${psiReV}; ${f(VEdG / 1000)} / ${f(VRd / 1000)} kN`,
        VEdG / VRd));
    }
  }

  // ---------- Взаємодія N + V ----------
  if (bN.s > 0 && bV.s > 0) {
    const u = bN.s ** 2 + bV.s ** 2;
    checks.push(mkCheck("anchorInterSteel", `${CL}, 7.2.3, табл. 7.3, (7.54)`, "β_N² + β_V² ≤ 1", `${f(bN.s, 3)}² + ${f(bV.s, 3)}² = ${f(u, 3)}`, u));
  }
  bN.c = Math.max(0, ...betaNc); bV.c = Math.max(0, ...betaVc);
  if (bN.c > 0 && bV.c > 0) {
    const u = bN.c ** 1.5 + bV.c ** 1.5;
    checks.push(mkCheck("anchorInterConcrete", `${CL}, 7.2.3, табл. 7.3, (7.55)`, "β_N^1.5 + β_V^1.5 ≤ 1", `${f(bN.c, 3)}^1.5 + ${f(bV.c, 3)}^1.5 = ${f(u, 3)}`, u));
  }

  const u = checks.map((c) => c.util);
  return {
    checks, values, forces, sigC: tens.sigC,
    maxUtil: u.some((x) => Number.isNaN(x)) ? NaN : Math.max(0, ...u), ok: checks.every((c) => c.ok),
  };
}

function psiSusN0(i: AnchorInput, hef: number): number {
  const tauUcr = i.tauRkUcr ?? 12, tau = i.tauRk ?? (i.cracked ? 7 : tauUcr);
  const k1 = i.cracked ? 7.7 : 11.0;
  return Math.min((i.psiSus ?? 1) * tau * Math.PI * i.d * hef, k1 * Math.sqrt(i.fck) * hef ** 1.5);
}
