// НВФ: Г-подібний кронштейн (полиця до стіни + крило на ребро), параметричний.
// Сили від напрямної прикладені на лінії заклепок (x_g від стіни): вага V (лише несучий кронштейн) і вітер H (тиск — стиск крила, відсос — розтяг).
// Перевірки: крило біля згину (σ від N і M = V·плече, τ), стійкість плоскої форми крила як консолі (M_cr = 4.013·√(EI_z·GI_t)/L для сили на кінці),
// нетто-переріз по ряду отворів, полиця як половина Т-елемента EN 1993-1-8 (форми 1–3), анкери (момент ваги на пару анкерів відносно стисненої кромки + підпір п'ятою),
// заклепки (зріз — значення виробника, зминання — EN 1993-1-3 табл. 8.4), хід у пазах від температури.
// Методика — /mnt/project-files/calc-app/norms/facade/facade.md, розділ 8 (Hilti, buildingskin, al-fas).

import type { Check } from "../codes/types";
import { ALLOYS } from "./curtainWall";

export type BrMat = { kind: "steel" | "al" | "ss"; id: string; f: number; fu: number; E: number; G: number; alpha: number; gM0: number; gM1: number; gM2: number };
/** Сталь з покриттям EN 10346 (S…GD), нержавійка 1.4301 (EN 1993-1-4), алюміній EN 1999-1-1 */
export const BR_MATERIALS: BrMat[] = [
  { kind: "steel", id: "S250GD+Z", f: 250, fu: 330, E: 210000, G: 81000, alpha: 12e-6, gM0: 1.0, gM1: 1.0, gM2: 1.25 },
  { kind: "steel", id: "S280GD+Z", f: 280, fu: 360, E: 210000, G: 81000, alpha: 12e-6, gM0: 1.0, gM1: 1.0, gM2: 1.25 },
  { kind: "steel", id: "S350GD+Z", f: 350, fu: 420, E: 210000, G: 81000, alpha: 12e-6, gM0: 1.0, gM1: 1.0, gM2: 1.25 },
  { kind: "steel", id: "DX51D+Z (f_y ≈ 140)", f: 140, fu: 270, E: 210000, G: 81000, alpha: 12e-6, gM0: 1.0, gM1: 1.0, gM2: 1.25 },
  { kind: "ss", id: "1.4301 (A2)", f: 210, fu: 520, E: 200000, G: 76900, alpha: 16e-6, gM0: 1.1, gM1: 1.1, gM2: 1.25 },
  ...ALLOYS.map((a) => ({ kind: "al" as const, id: a.id, f: a.f0, fu: a.fu, E: 70000, G: 27000, alpha: 23e-6, gM0: 1.1, gM1: 1.1, gM2: 1.25 })),
];

export interface BrHole { y: number; slot: boolean }
export interface LBracket {
  /** вилет від стіни до кінця крила L, висота крила H_w, ширина полиці b_f, товщина t, внутрішній радіус гиба r; мм */
  L: number; Hw: number; bf: number; t: number; r: number;
  /** анкери в полиці: кількість (1, 2), крок по висоті, відстань осі від зовнішньої грані крила, ширина й довжина овалу, діаметр шайби */
  nA: 1 | 2; sA: number; eA: number; dA: number; lA: number; dw: number;
  /** ряд під заклепки: відстань від кінця крила, отвори (y від верху), діаметр, довжина пазу */
  xr: number; holes: BrHole[]; dh: number; ls: number;
}
export const L_BRACKET_DEFAULT: LBracket = {
  L: 160, Hw: 140, bf: 40, t: 2, r: 2, nA: 2, sA: 100, eA: 20, dA: 10, lA: 13.5, dw: 20,
  xr: 14.7, dh: 5, ls: 12,
  holes: [{ y: 11, slot: false }, { y: 37.5, slot: false }, { y: 55.5, slot: true }, { y: 84.5, slot: true }, { y: 102.5, slot: false }, { y: 129, slot: false }],
};

export interface BrInput {
  br: LBracket; mat: string;
  /** режим: несучий (вага + вітер, круглі отвори) чи опорний (лише вітер, пази) */
  fixed: boolean;
  /** характеристичні: вага V_k, кН (на несучий кронштейн), вітер тиск H_p і відсос H_s, кН (на кронштейн) */
  Vk: number; Hp: number; Hs: number;
  gG: number; gQ: number;
  /** заклепки: кількість у режимі, розрахунковий опір зрізу однієї, кН; анкер: N_Rd, V_Rd, кН */
  nR: number; FvRd: number; NRdA: number; VRdA: number;
  /** температура: перепад ΔT, К; відстань від несучого кронштейна до цього, м; α напрямної */
  dT: number; xFix: number; alphaG: number;
}

export interface BrCase { name: "suction" | "pressure"; N: number; V: number; M: number }
export interface BrResult {
  mat: BrMat; lever: number; cases: BrCase[];
  anchor: { Nt: number; V: number; z: number[] };
  rivet: { F: number; FbRd: number };
  Mcr: number; chiLT: number; lamLT: number;
  travel: number; travelLim: number;
  checks: Check[];
}

const f = (x: number, n = 2) => x.toFixed(n);

export function checkLBracket(i: BrInput): BrResult {
  const b = i.br, mat = BR_MATERIALS.find((m) => m.id === i.mat) ?? BR_MATERIALS[0];
  const fd = mat.f / mat.gM0, t = b.t, Hw = b.Hw;
  const al = mat.kind === "al";
  const cl = al ? "EN 1999-1-1" : mat.kind === "ss" ? "EN 1993-1-4 / 1-1" : "EN 1993-1-3 / 1-1";
  // плече ваги: від кореня крила (зовнішня грань полиці + r) до лінії заклепок
  const xg = b.L - b.xr, x0 = t + b.r, lever = xg - x0; // мм
  const V = i.fixed ? i.gG * i.Vk : 0;
  const cases: BrCase[] = [
    { name: "suction", N: i.gQ * Math.abs(i.Hs), V, M: (V * lever) / 1000 },
    { name: "pressure", N: -i.gQ * Math.abs(i.Hp), V, M: (V * lever) / 1000 },
  ];
  const A = Hw * t, W = (t * Hw * Hw) / 6; // мм², мм³
  const checks: Check[] = [];
  // 1. крило біля згину: σ = |N|/A + M/W
  let uS = 0, cS = cases[0];
  for (const c of cases) { const u = ((Math.abs(c.N) * 1e3) / A + (c.M * 1e6) / W) / fd; if (u > uS) { uS = u; cS = c; } }
  checks.push({ key: "br_root", clause: `${cl}, 6.2.1 (5)`, formula: "σ = |N_Ed|/A + M_Ed/W_el ≤ f_y/γ_M0; M = V_Ed·(x_g − t − r)",
    subst: `${cS.name === "suction" ? "відсос" : "тиск"}: N = ${f(cS.N)} kN, V = ${f(cS.V)} kN, плече ${f(lever, 1)} mm, M = ${f(cS.M, 3)} kN·m; A = ${f(A, 0)} mm², W = ${f(W, 0)} mm³; σ = ${f(uS * fd, 1)} ≤ ${f(fd, 1)} MPa`, util: uS, ok: uS <= 1 });
  // 2. зріз
  const tau = (1.5 * V * 1e3) / A, uT = tau / (fd / Math.sqrt(3));
  checks.push({ key: "br_shear", clause: `${cl}, 6.2.6`, formula: "τ = 1.5·V_Ed/(H_w·t) ≤ f_y/(√3·γ_M0)", subst: `τ = ${f(tau, 1)} ≤ ${f(fd / Math.sqrt(3), 1)} MPa`, util: uT, ok: uT <= 1 });
  // 3. стійкість плоскої форми: консольна пластина, сила на кінці
  const Lc = lever, EIz = (mat.E * Hw * t ** 3) / 12, GIt = (mat.G * Hw * t ** 3) / 3;
  const Mcr = (4.013 * Math.sqrt(EIz * GIt)) / Lc / 1e6; // кН·м
  const Mel = (W * mat.f) / 1e6, lamLT = Math.sqrt(Mel / Mcr);
  const aLT = al ? 0.2 : 0.76, l0 = al ? 0.4 : 0.2; // алюміній — клас A (EN 1999 6.3.2.2), сталь — крива d (пластина)
  const phi = 0.5 * (1 + aLT * (lamLT - l0) + lamLT ** 2), chiLT = lamLT <= l0 ? 1 : Math.min(1, 1 / (phi + Math.sqrt(phi ** 2 - lamLT ** 2)));
  {
    const c = cases[1]; // тиск: стиск + згин — найгірше
    const NRd = (A * mat.f) / mat.gM1 / 1e3, MbRd = (chiLT * Mel) / mat.gM1;
    const u = Math.abs(c.N) / NRd + (c.M > 0 ? c.M / MbRd : 0);
    checks.push({ key: "br_ltb", clause: al ? "EN 1999-1-1, 6.3.2" : "EN 1993-1-1, 6.3.2.2, 6.3.3", formula: "N_Ed/N_Rd + M_Ed/(χ_LT·W·f_y/γ_M1) ≤ 1; M_cr = 4.013·√(EI_z·GI_t)/L",
      subst: `M_cr = ${f(Mcr, 3)} kN·m; λ̄_LT = ${f(lamLT, 3)}; χ_LT = ${f(chiLT, 3)}; ${f(Math.abs(c.N))}/${f(NRd)} + ${f(c.M, 3)}/${f(MbRd, 3)} = ${f(u, 3)}`, util: u, ok: u <= 1 });
  }
  // 4. нетто-переріз по ряду заклепок (розтяг при відсосі)
  {
    const holesW = b.holes.length * b.dh, Anet = (Hw - holesW) * t, NuRd = (0.9 * Anet * mat.fu) / mat.gM2 / 1e3, u = cases[0].N / NuRd;
    checks.push({ key: "br_net", clause: `${cl}, 6.2.3`, formula: "N_Ed ≤ 0.9·A_net·f_u/γ_M2", subst: `A_net = (${Hw} − ${b.holes.length}·${b.dh})·${t} = ${f(Anet, 0)} mm²; ${f(cases[0].N)} ≤ ${f(NuRd)} kN`, util: u, ok: u <= 1 });
  }
  // 5–6. анкери і полиця як половина Т-подібного елемента (EN 1993-1-8, 6.2.4): шарніри біля гиба і по осі анкера, підпір — п'ята полиці
  const ys = b.nA === 2 ? [Hw / 2 + b.sA / 2, Hw / 2 - b.sA / 2] : [Hw / 2]; // відстані анкерів від нижньої кромки, мм
  const Mw = (V * xg) / 1000; // кН·м від стіни до лінії заклепок
  const sum2 = ys.reduce((s, z) => s + z * z, 0);
  const FtM = (Mw * 1e3 * ys[0]) / sum2; // кН — відрив верхньої зони від моменту ваги
  const Fext = FtM + cases[0].N / b.nA; // зовнішня сила з крила на зону одного анкера
  const m = Math.max(b.eA - t - 0.8 * b.r, 1), n = Math.max(Math.min(b.bf - b.eA, 1.25 * m), 1);
  const leff = Math.min(Hw / b.nA, 2 * Math.PI * m, 4 * m + 1.25 * n);
  const Mpl = (0.25 * leff * t * t * fd) / 1e3; // кН·мм
  const Q = (Fext * m) / n; // підпір п'ятою (жорстка п'ята, пружно — в запас для анкера)
  const Nt = Fext + Q, VA = V / b.nA;
  {
    const uN = Nt / i.NRdA, uV = VA / i.VRdA, u = Math.max(uN, uV, uN ** 1.5 + uV ** 1.5);
    checks.push({ key: "br_anchor", clause: "EN 1992-4, 7.2.3 (ETA); EN 1993-1-8, 6.2.4", formula: "F = M_w·z₁/Σz² + H/n; N = F·(m + n)/n (з підпором); (N/N_Rd)^1.5 + (V/V_Rd)^1.5 ≤ 1",
      subst: `M_w = ${f(V)}·${f(xg, 1)} = ${f(Mw, 4)} kN·m; z = ${ys.map((z) => f(z, 0)).join(", ")} mm; F = ${f(FtM, 3)} + ${f(cases[0].N / b.nA, 3)} = ${f(Fext, 3)}; m = ${f(m, 1)}, n = ${f(n, 1)} mm; N = ${f(Nt, 3)} ≤ ${i.NRdA}; V = ${f(VA, 3)} ≤ ${i.VRdA} kN`, util: u, ok: u <= 1 });
  }
  {
    const F1 = (2 * Mpl) / m, F2 = (Mpl + n * i.NRdA) / (m + n), F3 = i.NRdA, FRd = Math.min(F1, F2, F3);
    const mode = FRd === F1 ? 1 : FRd === F2 ? 2 : 3, u = Fext / FRd;
    checks.push({ key: "br_flange", clause: "EN 1993-1-8, 6.2.4, табл. 6.2 (половина Т-елемента)", formula: "F ≤ min(2M_pl/m; (M_pl + n·N_Rd)/(m + n); N_Rd), M_pl = 0.25·l_eff·t²·f_y/γ_M0",
      subst: `l_eff = min(H_w/n_A; 2πm; 4m + 1.25n) = ${f(leff, 1)} mm; M_pl = ${f(Mpl * 1000, 0)} N·mm; F_1 = ${f(F1, 3)}, F_2 = ${f(F2, 3)}, F_3 = ${f(F3, 3)} kN (форма ${mode}); F = ${f(Fext, 3)} kN`, util: u, ok: u <= 1 });
  }
  // 7. заклепки: зріз (виробник) і зминання кронштейна (EN 1993-1-3 табл. 8.4)
  const F = Math.hypot(V, Math.max(cases[0].N, Math.abs(cases[1].N))) / Math.max(i.nR, 1);
  const aB = Math.min(3.6 * Math.sqrt(t / b.dh), 2.1), FbRd = (aB * mat.fu * b.dh * t) / mat.gM2 / 1e3;
  {
    const FRd = Math.min(i.FvRd, FbRd), u = F / FRd;
    checks.push({ key: "br_rivet", clause: "EN 1993-1-3, табл. 8.4; ETA заклепки", formula: "F = √(V² + H²)/n ≤ min(F_v,Rd; F_b,Rd), F_b,Rd = α·f_u·d·t/γ_M2, α = 3.6√(t/d) ≤ 2.1",
      subst: `n = ${i.nR}; F = ${f(F, 3)} kN; F_b,Rd = ${f(aB, 2)}·${mat.fu}·${b.dh}·${t}/${mat.gM2} = ${f(FbRd, 3)}; F_v,Rd = ${i.FvRd} kN`, util: u, ok: u <= 1 });
  }
  // 8. хід у пазах від температури (лише опорний режим)
  const travel = i.alphaG * i.dT * i.xFix * 1000, travelLim = b.ls - b.dh;
  if (!i.fixed) {
    const u = travel / travelLim;
    checks.push({ key: "br_slot", clause: "практика НВФ (Hilti MFT, альбоми)", formula: "Δ = α·ΔT·x ≤ l_паз − d", subst: `Δ = ${i.alphaG.toExponential(1)}·${i.dT}·${f(i.xFix * 1000, 0)} = ${f(travel, 1)} ≤ ${f(travelLim, 1)} mm`, util: u, ok: u <= 1 });
  }
  return { mat, lever, cases, anchor: { Nt, V: VA, z: ys }, rivet: { F, FbRd }, Mcr, chiLT, lamLT, travel, travelLim, checks };
}
