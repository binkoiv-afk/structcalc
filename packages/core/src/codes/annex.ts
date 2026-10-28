// Національні додатки до Єврокодів: параметри, що визначаються на національному рівні (NDP).
// Формули EN однакові в усіх країнах; країна змінює ці числа, а деякі — й окремі формули (v_min, cot θ, ν1, продавлювання).
// Активний додаток — один на застосунок (екран перераховується при зміні країни). Для ДБН не використовується.
// Значення і джерела — /mnt/project-files/calc-app/norms/ndp/ (ndp.json, ndp.md), docs/VERIFICATION.md.

export type AnnexId = "EU" | "UA" | "MD" | "PL" | "DE" | "FR" | "RO";
type Tr = [string, string, string];

export interface ShearArgs {
  /** k = 1 + √(200/d) ≤ 2; ρ_l; f_ck, МПа; d, мм; σ_cp, МПа; вид елемента; для продавлювання середньої колони — u0/d */
  k: number; rho: number; fck: number; d: number; sigCp: number; member: "beam" | "slab" | "punch"; u0d?: number;
}

export interface Annex {
  id: AnnexId;
  /** назва в меню (uk, ru, en) і позначення стандартів, напр. «PN-EN» */
  name: Tr; prefix: string;
  e1990: {
    /** γ_G,sup, γ_G,inf, γ_Q; ξ (6.10b); формула сполучення ULS; ψ0 супутніх за замовчуванням */
    gG: number; gGinf: number; gQ: number; xi: number; eq: "6.10" | "6.10ab"; psi0: number;
  };
  e1992: {
    gc: number; gs: number; acc: number;
    /** v_Rd,c, МПа (6.2a, 6.2b; 6.47) */
    vRdc: (a: ShearArgs) => number;
    /** найбільший cot θ (6.7N) */
    cotMax: (a: { fck: number; fcd: number; sigCd: number; VEd: number; bw: number; z: number }) => number;
    /** ν1 для V_Rd,max (6.9) */
    nu1: (fck: number) => number;
    rhoWmin: (fck: number, fctm: number, fyk: number) => number;
    /** продавлювання: перевірка біля колони — EN (6.53) на u0 або DE: v_Ed(u1) ≤ 1.4·v_Rd,c */
    punchMax: "u0" | "u1x1.4";
    kOut: number; beta: [number, number, number];
    /** найбільший крок стрижнів плит, мм (9.3.1.1 (3)) */
    slabS: (h: number) => { main: number; sec: number };
  };
  e1993: { gM0: number; gM1: number; gM2: number };
  /** відмінності від рекомендованих і обмеження (uk, ru, en) */
  notes: Tr[];
  sources: string[];
}

const recVRdc = (cR: number, vK: number, k1: number, gc: number) => (a: ShearArgs) =>
  Math.max((cR / gc) * a.k * (100 * a.rho * a.fck) ** (1 / 3), vK * a.k ** 1.5 * Math.sqrt(a.fck)) + k1 * a.sigCp;
const nuRec = (fck: number) => 0.6 * (1 - fck / 250);
const rhoRec = (fck: number, _fctm: number, fyk: number) => (0.08 * Math.sqrt(fck)) / fyk;
const sRec = (h: number) => ({ main: Math.min(3 * h, 400), sec: Math.min(3.5 * h, 450) });

const REC = {
  e1990: { gG: 1.35, gGinf: 1.0, gQ: 1.5, xi: 0.85, eq: "6.10" as const, psi0: 0.7 },
  e1992: {
    gc: 1.5, gs: 1.15, acc: 1.0, vRdc: recVRdc(0.18, 0.035, 0.15, 1.5), cotMax: () => 2.5, nu1: nuRec, rhoWmin: rhoRec,
    punchMax: "u0" as const, kOut: 1.5, beta: [1.15, 1.4, 1.5] as [number, number, number], slabS: sRec,
  },
  e1993: { gM0: 1.0, gM1: 1.0, gM2: 1.25 },
};

const EU: Annex = {
  id: "EU", name: ["EN — рекомендовані значення", "EN — рекомендуемые значения", "EN — recommended values"], prefix: "EN", ...REC,
  notes: [], sources: ["EN 1990:2002+A1, EN 1992-1-1:2004+AC, EN 1993-1-1:2005, EN 1993-1-8:2005 — рекомендовані значення"],
};

const UA: Annex = {
  id: "UA", name: ["Україна — ДСТУ-Н Б EN", "Украина — ДСТУ-Н Б EN", "Ukraine — ДСТУ-Н Б EN"], prefix: "ДСТУ-Н Б EN", ...REC,
  notes: [
    ["ДБН А.1.1-94 (Зміна № 2), 5.2: за Єврокодами — рекомендовані значення NDP; ДБН і Єврокоди в одній будівлі не змішують.",
      "ДБН А.1.1-94 (Изменение № 2), 5.2: по Еврокодам — рекомендуемые значения NDP; ДБН и Еврокоды в одном здании не смешивают.",
      "ДБН А.1.1-94 (Amendment 2), 5.2: Eurocodes are used with the recommended NDP values; ДБН and Eurocodes are not mixed in one building."],
  ],
  sources: ["ДБН А.1.1-94:2010 зі Зміною № 2 (2022), п. 5.2", "ДСТУ-Н Б EN 1990, 1992-1-1, 1993-1-1, 1993-1-8"],
};

const MD: Annex = {
  id: "MD", name: ["Молдова — SM EN (рекомендовані)", "Молдова — SM EN (рекомендуемые)", "Moldova — SM EN (recommended)"], prefix: "SM EN", ...REC,
  notes: [
    ["Національні додатки SM EN …/NA:2018 ще не внесено (тексти недоступні) — рекомендовані значення EN. Обов'язкові в Молдові — NCM; Єврокоди добровільні.",
      "Национальные приложения SM EN …/NA:2018 ещё не внесены (тексты недоступны) — рекомендуемые значения EN. Обязательны в Молдове NCM; Еврокоды добровольные.",
      "SM EN …/NA:2018 national annexes are not included yet (texts unavailable) — EN recommended values. NCM codes are mandatory in Moldova; Eurocodes are voluntary."],
  ],
  sources: ["SM EN 1990…1999 (2010–2011); 15 NA для EC0–EC2 (2018) — не прочитано"],
};

const PL: Annex = {
  id: "PL", name: ["Польща — PN-EN", "Польша — PN-EN", "Poland — PN-EN"], prefix: "PN-EN",
  e1990: { ...REC.e1990, eq: "6.10ab" },
  e1992: { ...REC.e1992, gc: 1.4, vRdc: recVRdc(0.18, 0.035, 0.15, 1.4), cotMax: () => 2.0 },
  e1993: { gM0: 1.0, gM1: 1.0, gM2: 1.25 },
  notes: [
    ["Сполучення (6.10a) і (6.10b), ξ = 0.85; γ_c = 1.4; cot θ ≤ 2.0.", "Сочетания (6.10a) и (6.10b), ξ = 0.85; γ_c = 1.4; cot θ ≤ 2.0.", "Combinations (6.10a) and (6.10b), ξ = 0.85; γ_c = 1.4; cot θ ≤ 2.0."],
  ],
  sources: ["PN-EN 1990:2004/NA; PN-EN 1992-1-1:2008/NA; PN-EN 1993-1-1/NA; PN-EN 1993-1-8"],
};

// DIN EN 1992-1-1/NA: v_min = (κ1/γc)·k^1.5·√fck, κ1 = 0.0525 (d ≤ 600) … 0.0375 (d ≥ 800); C_Rd,c = 0.15/γc для балок і плит,
// 0.18/γc для продавлювання (×(0.1·u0/d + 0.6) при u0/d < 4); k1 = 0.12 (зріз), 0.10 (продавлювання)
const deVRdc = (a: ShearArgs) => {
  const gc = 1.5, kap = a.d <= 600 ? 0.0525 : a.d >= 800 ? 0.0375 : 0.0525 - ((a.d - 600) / 200) * 0.015;
  const cR = a.member === "punch" ? (0.18 / gc) * (a.u0d !== undefined && a.u0d < 4 ? 0.1 * a.u0d + 0.6 : 1) : 0.15 / gc;
  const k1 = a.member === "punch" ? 0.1 : 0.12;
  return Math.max(cR * a.k * (100 * a.rho * a.fck) ** (1 / 3), (kap / gc) * a.k ** 1.5 * Math.sqrt(a.fck)) + k1 * a.sigCp;
};
const DE: Annex = {
  id: "DE", name: ["Німеччина — DIN EN", "Германия — DIN EN", "Germany — DIN EN"], prefix: "DIN EN",
  e1990: { ...REC.e1990 },
  e1992: {
    ...REC.e1992, acc: 0.85, vRdc: deVRdc,
    // (6.7aDE): cot θ ≤ (1.2 + 1.4·σcd/fcd)/(1 − V_Rd,cc/V_Ed) ≤ 3.0, V_Rd,cc = 0.5·0.48·fck^(1/3)·(1 − 1.2·σcd/fcd)·bw·z
    cotMax: ({ fck, fcd, sigCd, VEd, bw, z }) => {
      const VRdcc = 0.5 * 0.48 * fck ** (1 / 3) * (1 - (1.2 * sigCd) / fcd) * bw * z;
      const den = 1 - VRdcc / Math.max(VEd, 1e-9);
      return den <= 0 ? 3 : Math.max(1, Math.min(3, (1.2 + (1.4 * sigCd) / fcd) / den));
    },
    nu1: (fck) => 0.75 * Math.min(1, 1.1 - fck / 500),
    rhoWmin: (_fck, fctm, fyk) => (0.16 * fctm) / fyk,
    punchMax: "u1x1.4", beta: [1.1, 1.4, 1.5],
    slabS: (h) => ({ main: h <= 150 ? 150 : h >= 250 ? 250 : h, sec: 250 }),
  },
  e1993: { gM0: 1.0, gM1: 1.1, gM2: 1.25 },
  notes: [
    ["α_cc = 0.85; v_min з κ1 за d; C_Rd,c = 0.15/γ_c (зріз), k1 = 0.12; cot θ за (6.7aDE) ≤ 3.0; ν1 = 0.75·ν2; ρ_w,min = 0.16·f_ctm/f_yk; γ_M1 = 1.1.",
      "α_cc = 0.85; v_min с κ1 по d; C_Rd,c = 0.15/γ_c (срез), k1 = 0.12; cot θ по (6.7aDE) ≤ 3.0; ν1 = 0.75·ν2; ρ_w,min = 0.16·f_ctm/f_yk; γ_M1 = 1.1.",
      "α_cc = 0.85; v_min with κ1 by d; C_Rd,c = 0.15/γ_c (shear), k1 = 0.12; cot θ by (6.7aDE) ≤ 3.0; ν1 = 0.75·ν2; ρ_w,min = 0.16·f_ctm/f_yk; γ_M1 = 1.1."],
    ["Продавлювання: v_Ed(u1) ≤ 1.4·v_Rd,c, β = 1.10/1.40/1.50. Арматура продавлювання — за EN (6.52); правила DIN для неї (κ_sw, перший ряд) не реалізовано.",
      "Продавливание: v_Ed(u1) ≤ 1.4·v_Rd,c, β = 1.10/1.40/1.50. Арматура продавливания — по EN (6.52); правила DIN для неё (κ_sw, первый ряд) не реализованы.",
      "Punching: v_Ed(u1) ≤ 1.4·v_Rd,c, β = 1.10/1.40/1.50. Punching reinforcement uses EN (6.52); the DIN rules for it (κ_sw, first row) are not implemented."],
  ],
  sources: ["DIN EN 1990/NA:2010-12; DIN EN 1992-1-1/NA:2013-04 (+A1:2015); DIN EN 1993-1-1/NA:2018-12; DIN EN 1993-1-8/NA:2020-11 — за вторинними джерелами"],
};

// NF EN 1992-1-1/NA: v_min = 0.34/γc·√fck для плит з поперечним перерозподілом, 0.053/γc·k^1.5·√fck для балок і інших
const FR: Annex = {
  id: "FR", name: ["Франція — NF EN", "Франция — NF EN", "France — NF EN"], prefix: "NF EN",
  e1990: { ...REC.e1990 },
  e1992: {
    ...REC.e1992,
    vRdc: (a) => Math.max((0.18 / 1.5) * a.k * (100 * a.rho * a.fck) ** (1 / 3),
      a.member === "slab" ? (0.34 / 1.5) * Math.sqrt(a.fck) : (0.053 / 1.5) * a.k ** 1.5 * Math.sqrt(a.fck)) + 0.15 * a.sigCp,
  },
  e1993: { gM0: 1.0, gM1: 1.0, gM2: 1.25 },
  notes: [
    ["v_min = 0.34/γ_c·√f_ck для плит, 0.053/γ_c·k^1.5·√f_ck для балок і продавлювання; решта — рекомендовані. Зміну NA/A1 (2016) не враховано.",
      "v_min = 0.34/γ_c·√f_ck для плит, 0.053/γ_c·k^1.5·√f_ck для балок и продавливания; остальное — рекомендуемые. Изменение NA/A1 (2016) не учтено.",
      "v_min = 0.34/γ_c·√f_ck for slabs, 0.053/γ_c·k^1.5·√f_ck for beams and punching; the rest are recommended. NA/A1 (2016) not included."],
  ],
  sources: ["NF EN 1990/NA (NF P06-100-2); NF EN 1992-1-1/NA:2007; NF EN 1993-1-1/NA; NF EN 1993-1-8/NA"],
};

const RO: Annex = {
  id: "RO", name: ["Румунія — SR EN", "Румыния — SR EN", "Romania — SR EN"], prefix: "SR EN",
  e1990: { ...REC.e1990 },
  e1992: { ...REC.e1992, slabS: (h) => ({ main: Math.min(2 * h, 250), sec: Math.min(3 * h, 350) }) },
  e1993: { gM0: 1.0, gM1: 1.0, gM2: 1.25 },
  notes: [
    ["Основи проєктування — CR 0-2012 (6.10). Крок стрижнів плит: основні 2h ≤ 250, розподільні 3h ≤ 350 мм. γ_M для сталі — рекомендовані (не звірено).",
      "Основы проектирования — CR 0-2012 (6.10). Шаг стержней плит: основные 2h ≤ 250, распределительные 3h ≤ 350 мм. γ_M для стали — рекомендуемые (не сверено).",
      "Basis of design — CR 0-2012 (6.10). Slab bar spacing: main 2h ≤ 250, secondary 3h ≤ 350 mm. Steel γ_M are recommended (not verified)."],
  ],
  sources: ["CR 0-2012; SR EN 1992-1-1:2004/NB:2008; SR EN 1993-1-1/NB"],
};

export const ANNEXES: Record<AnnexId, Annex> = { EU, UA, MD, PL, DE, FR, RO };

let current: Annex = EU;
/** активний національний додаток */
export const annex = (): Annex => current;
export function setAnnex(id: AnnexId) { current = ANNEXES[id] ?? EU; }
