// Сніг і вітер за національними додатками EN 1991-1-3 / EN 1991-1-4: зони, висота над рівнем моря, міста.
// Формули EN 1991 (μ1, q_p(z)) — в en1991.ts; тут — що змінює країна: s_k за зоною і висотою, v_b,0 за зоною,
// категорії місцевості (Франція: IIIa/IIIb), профіль q_p (Німеччина: змішані профілі NA.B), ψ для снігу й вітру.
// Значення і джерела — /mnt/project-files/calc-app/norms/climate/, docs/VERIFICATION.md.

import type { AnnexId } from "../codes/annex";
import { TERRAIN_EN, type TerrainEN } from "./en1991";
import { CITIES_DE, CITIES_PL } from "./citiesDEPL";
import { CITIES_FR, CITIES_RO } from "./citiesFRRO";

type Tr = [string, string, string];

export interface SnowZone {
  id: string;
  /** s_k, кН/м², за висотою A, м */
  sk: (A: number) => number;
  /** формула для звіту */
  f: string;
}
export interface WindZone {
  id: string;
  /** v_b,0, м/с, за висотою A, м */
  vb0: (A: number) => number;
  f: string;
}
export interface Terrain { id: string; z0: number; zmin: number; name: Tr }
export interface ClimateCity {
  name: string; region: string; snow: string; wind: string; alt: number;
  /** достовірність зони: v — офіційний перелік, s — копія офіційної таблиці, l — імовірно */
  sSt?: "v" | "s" | "l"; wSt?: "v" | "s" | "l";
}

export interface ClimateEN {
  id: AnnexId;
  snowRef: string; windRef: string;
  snowZones: SnowZone[]; windZones: WindZone[];
  terrains: Terrain[];
  /** q_p(z), Па, якщо країна задає власний профіль замість (4.8); інакше — EN 1991-1-4 */
  qp?: (a: { vb: number; z: number; terrain: string; A: number }) => { qp: number; f: string } | undefined;
  /** ψ0 для снігу за висотою, ψ0 для вітру */
  psiSnow: (A: number) => number; psiWind: number;
  cities: ClimateCity[];
  notes: Tr[];
}

const T = (id: TerrainEN, name: Tr): Terrain => ({ id, ...TERRAIN_EN[id], name });
const TERR_EN: Terrain[] = [
  T("0", ["море, узбережжя", "море, побережье", "sea, coast"]),
  T("I", ["озера, рівнина без перешкод", "озёра, равнина без препятствий", "lakes, flat open land"]),
  T("II", ["низька рослинність, окремі перешкоди", "низкая растительность, отдельные препятствия", "low vegetation, isolated obstacles"]),
  T("III", ["передмістя, ліс, селища", "пригород, лес, посёлки", "suburbs, forest, villages"]),
  T("IV", ["міська забудова ≥15 м", "городская застройка ≥15 м", "urban, ≥15 m buildings"]),
];
const psiRec = (A: number) => (A > 1000 ? 0.7 : 0.5);
const r2 = (x: number) => Math.round(x * 100) / 100;

// ── Німеччина: DIN EN 1991-1-3/NA:2019-04, DIN EN 1991-1-4/NA:2010-12 ──
const deS = (a: number, b: number, min: number, k = 1) => (A: number) => k * Math.max(min, a + b * ((A + 140) / 760) ** 2);
const DE: ClimateEN = {
  id: "DE", snowRef: "DIN EN 1991-1-3/NA, NA.2", windRef: "DIN EN 1991-1-4/NA, NA.B",
  snowZones: [
    { id: "1", sk: deS(0.19, 0.91, 0.65), f: "0.19 + 0.91·((A+140)/760)² ≥ 0.65" },
    { id: "1a", sk: deS(0.19, 0.91, 0.65, 1.25), f: "1.25·(0.19 + 0.91·((A+140)/760)²) ≥ 0.81" },
    { id: "2", sk: deS(0.25, 1.91, 0.85), f: "0.25 + 1.91·((A+140)/760)² ≥ 0.85" },
    { id: "2a", sk: deS(0.25, 1.91, 0.85, 1.25), f: "1.25·(0.25 + 1.91·((A+140)/760)²) ≥ 1.06" },
    { id: "3", sk: deS(0.31, 2.91, 1.1), f: "0.31 + 2.91·((A+140)/760)² ≥ 1.10" },
  ],
  windZones: [22.5, 25, 27.5, 30].map((v, i) => ({ id: String(i + 1), vb0: () => v, f: `${v}` })),
  terrains: [
    { id: "DE-B", z0: 0.05, zmin: 7, name: ["змішаний профіль: внутрішні райони", "смешанный профиль: внутренние районы", "mixed profile: inland"] },
    { id: "DE-K", z0: 0.05, zmin: 4, name: ["змішаний профіль: узбережжя, острови Балтики", "смешанный профиль: побережье, острова Балтики", "mixed profile: coast, Baltic islands"] },
    { id: "DE-N", z0: 0.05, zmin: 2, name: ["острови Північного моря", "острова Северного моря", "North Sea islands"] },
    ...TERR_EN.slice(1),
  ],
  // NA.B.3.3, табл. NA.B.3; вище 800 м — множник (0.2 + A/1000), NA.B.3.3 (3)
  qp: ({ vb, z, terrain, A }) => {
    const qb = 0.625 * vb * vb, zz = Math.min(z, 300);
    let qp: number, f: string;
    if (terrain === "DE-B") {
      if (zz <= 7) { qp = 1.5 * qb; f = "1.5·qb"; }
      else if (zz <= 50) { qp = 1.7 * qb * (zz / 10) ** 0.37; f = "1.7·qb·(z/10)^0.37"; }
      else { qp = 2.1 * qb * (zz / 10) ** 0.24; f = "2.1·qb·(z/10)^0.24"; }
    } else if (terrain === "DE-K") {
      if (zz <= 4) { qp = 1.8 * qb; f = "1.8·qb"; }
      else if (zz <= 50) { qp = 2.3 * qb * (zz / 10) ** 0.27; f = "2.3·qb·(z/10)^0.27"; }
      else { qp = 2.6 * qb * (zz / 10) ** 0.19; f = "2.6·qb·(z/10)^0.19"; }
    } else if (terrain === "DE-N") {
      if (zz <= 2) { qp = 1100; f = "1.1 kN/m²"; }
      else if (zz <= 50) { qp = 1500 * (zz / 10) ** 0.19; f = "1.5·(z/10)^0.19 kN/m²"; }
      else { qp = 1600 * (zz / 10) ** 0.17; f = "1.6·(z/10)^0.17 kN/m²"; }
    } else return undefined;
    if (A > 800) { qp *= 0.2 + A / 1000; f += ` · (0.2 + ${A}/1000)`; }
    return { qp, f };
  },
  psiSnow: psiRec, psiWind: 0.6, cities: CITIES_DE,
  notes: [
    ["Північнонімецька низовина (зони 1, 2): додатково особлива ситуація 2.3·s_k (NA.4.3) — тут не враховано.", "Северогерманская низменность (зоны 1, 2): дополнительно особая ситуация 2.3·s_k (NA.4.3) — здесь не учтена.", "North German lowland (zones 1, 2): additional accidental case 2.3·s_k (NA.4.3) not included here."],
    ["Вище 1100 м (вітер) і 1500 м (сніг) — окремий розгляд за NA.", "Выше 1100 м (ветер) и 1500 м (снег) — отдельное рассмотрение по NA.", "Above 1100 m (wind) and 1500 m (snow) — special consideration per NA."],
  ],
};

// ── Франція: NF EN 1991-1-3/NA:2007, NF EN 1991-1-4/NA:2008 ──
const frD1 = (A: number) => (A <= 200 ? 0 : A <= 500 ? A / 1000 - 0.2 : A <= 1000 ? 1.5 * A / 1000 - 0.45 : 3.5 * A / 1000 - 2.45);
const frD2 = (A: number) => (A <= 200 ? 0 : A <= 500 ? 1.5 * A / 1000 - 0.3 : A <= 1000 ? 3.5 * A / 1000 - 1.3 : 7 * A / 1000 - 4.8);
const FR: ClimateEN = {
  id: "FR", snowRef: "NF EN 1991-1-3/NA, 4.1 (1)", windRef: "NF EN 1991-1-4/NA, 4.2, 4.3.2",
  snowZones: ([["A1", 0.45], ["A2", 0.45], ["B1", 0.55], ["B2", 0.55], ["C1", 0.65], ["C2", 0.65], ["D", 0.9], ["E", 1.4]] as [string, number][])
    .map(([id, s]) => id === "E"
      ? { id, sk: (A: number) => s + frD2(A), f: `${s} + Δs2(A)` }
      : { id, sk: (A: number) => s + frD1(A), f: `${s} + Δs1(A)` }),
  windZones: [22, 24, 26, 28].map((v, i) => ({ id: String(i + 1), vb0: () => v, f: `${v}` })),
  terrains: [
    { id: "0", z0: 0.005, zmin: 1, name: TERR_EN[0].name },
    { id: "II", z0: 0.05, zmin: 2, name: ["відкрита місцевість, окремі перешкоди", "открытая местность, отдельные препятствия", "open land, isolated obstacles"] },
    { id: "IIIa", z0: 0.2, zmin: 5, name: ["бокаж, сади, розсіяна забудова", "бокаж, сады, рассеянная застройка", "hedgerows, orchards, scattered houses"] },
    { id: "IIIb", z0: 0.5, zmin: 9, name: ["селища, промзони, ліс", "посёлки, промзоны, лес", "villages, industrial zones, forest"] },
    { id: "IV", z0: 1.0, zmin: 15, name: TERR_EN[4].name },
  ],
  psiSnow: psiRec, psiWind: 0.6, cities: CITIES_FR,
  notes: [
    ["Зони — за префектурою департаменту; у 24 департаментах (сніг) і 23 (вітер) зона залежить від кантону — перевіряйте за комуною.", "Зоны — по префектуре департамента; в 24 департаментах (снег) и 23 (ветер) зона зависит от кантона — проверяйте по коммуне.", "Zones by the département préfecture; in 24 (snow) and 23 (wind) départements the zone depends on the canton — check by commune."],
    ["Особливе снігове навантаження s_Ad (A2, B1 1.00; B2, C2 1.35; D 1.80 кН/м²) — окреме особливе сполучення, тут не враховано.", "Особая снеговая нагрузка s_Ad (A2, B1 1.00; B2, C2 1.35; D 1.80 кН/м²) — отдельное особое сочетание, здесь не учтена.", "Accidental snow s_Ad (A2, B1 1.00; B2, C2 1.35; D 1.80 kN/m²) is a separate accidental combination, not included here."],
  ],
};

// ── Польща: PN-EN 1991-1-3/NA, PN-EN 1991-1-4/NA ──
const PL_CE: Record<string, [number, number, number, number]> = {
  "0": [3.0, 0.11, 1, 200], I: [2.8, 0.19, 1, 200], II: [2.3, 0.24, 2, 300], III: [1.9, 0.26, 5, 400], IV: [1.5, 0.29, 10, 500],
};
const PL: ClimateEN = {
  id: "PL", snowRef: "PN-EN 1991-1-3/NA, tabl. NB.1", windRef: "PN-EN 1991-1-4/NA, tabl. NA.1",
  snowZones: [
    { id: "1", sk: (A) => Math.max(0.7, 0.007 * A - 1.4), f: "0.007A − 1.4 ≥ 0.70" },
    { id: "2", sk: () => 0.9, f: "0.9" },
    { id: "3", sk: (A) => Math.max(1.2, 0.006 * A - 0.6), f: "0.006A − 0.6 ≥ 1.2" },
    { id: "4", sk: () => 1.6, f: "1.6" },
    { id: "5", sk: (A) => Math.max(2.0, 0.93 * Math.exp(0.00134 * A)), f: "0.93·e^(0.00134A) ≥ 2.0" },
  ],
  windZones: [
    { id: "1", vb0: (A) => (A <= 300 ? 22 : 22 * (1 + 0.0006 * (A - 300))), f: "22·(1 + 0.0006(A − 300)), A > 300" },
    { id: "2", vb0: () => 26, f: "26" },
    { id: "3", vb0: (A) => (A <= 300 ? 22 : 22 * (1 + 0.0006 * (A - 300))), f: "22·(1 + 0.0006(A − 300)), A > 300" },
  ],
  terrains: TERR_EN,
  // табл. NA.3: q_p = c_e(z)·q_b, z_min ≤ z ≤ z_max
  qp: ({ vb, z, terrain }) => {
    const t = PL_CE[terrain]; if (!t) return undefined;
    const ze = Math.min(Math.max(z, t[2]), t[3]), qb = 0.625 * vb * vb, ce = t[0] * (ze / 10) ** t[1];
    return { qp: ce * qb, f: `c_e·q_b = ${t[0]}·(z/10)^${t[1]}·q_b` };
  },
  psiSnow: psiRec, psiWind: 0.6, cities: CITIES_PL,
  notes: [
    ["Офіційного переліку зон за містами немає (лише карти NB.1, NA.1): зону ділянки перевіряйте за картою.", "Официального перечня зон по городам нет (только карты NB.1, NA.1): зону площадки проверяйте по карте.", "No official town list (maps NB.1, NA.1 only): check the site zone on the map."],
    ["У смузі 10 км по обидва боки межі вітрових зон 1/2 можна брати середнє.", "В полосе 10 км по обе стороны границы ветровых зон 1/2 можно брать среднее.", "Within 10 km of the wind zone 1/2 border the mean of both zones may be used."],
  ],
};

// ── Румунія: CR 1-1-3/2012 (сніг), CR 1-1-4/2012 (вітер) ──
// s0,k — за картою/табл. A.1, до 1000 м; 1000–1500 м — (3.1), (3.2); вище — значення на 1500 м.
const roS = (s0: number) => (A: number) => {
  const a = Math.min(Math.max(A, 1000), 1500) - 1000;
  return s0 >= 2.5 ? s0 : s0 >= 2 ? Math.max(s0, 2.0 + 0.00691 * a) : s0 + 0.00752 * a;
};
const RO: ClimateEN = {
  id: "RO", snowRef: "CR 1-1-3/2012, 3.1, tab. A.1", windRef: "CR 1-1-4/2012, 2.3",
  snowZones: [
    { id: "1.5", sk: roS(1.5), f: "1.5 (A ≤ 1000 m); 1.5 + 0.00752·(A − 1000) (3.2)" },
    { id: "2.0", sk: roS(2.0), f: "2.0 (A ≤ 1000 m); 2.0 + 0.00691·(A − 1000) (3.1)" },
    { id: "2.5", sk: roS(2.5), f: "2.5" },
  ],
  // зони задано тиском q_b, кПа; v_b = √(q_b/0.625)
  windZones: [0.4, 0.5, 0.6, 0.7].map((q) => ({ id: q.toFixed(1), vb0: () => Math.sqrt((q * 1000) / 0.625), f: `√(${q * 1000}/0.625)` })),
  terrains: TERR_EN,
  psiSnow: () => 0.7, psiWind: 0.7, cities: CITIES_RO,
  notes: [
    ["Сніг на покрівлі за CR 1-1-3: s = γIs·μ·Ce·Ct·s0,k; γIs = 1.0 для класу III–IV (1.10 — II, 1.15 — I) — множте вручну; Ce: 0.8 повна, 1.0 нормальна, 1.2 обмежена експозиція.", "Снег на покрытии по CR 1-1-3: s = γIs·μ·Ce·Ct·s0,k; γIs = 1.0 для класса III–IV (1.10 — II, 1.15 — I) — умножайте вручную; Ce: 0.8 полная, 1.0 нормальная, 1.2 ограниченная экспозиция.", "Roof snow per CR 1-1-3: s = γIs·μ·Ce·Ct·s0,k; γIs = 1.0 for class III–IV (1.10 II, 1.15 I) — apply manually; Ce 0.8 full, 1.0 normal, 1.2 limited exposure."],
    ["Вітрові зони q_b відомі не для всіх міст (таблицю A CR 1-1-4 не прочитано) — тоді зону вибирайте за картою. Пікова q_p — за формулами EN (g = 3.5).", "Ветровые зоны q_b известны не для всех городов (таблица A CR 1-1-4 не прочитана) — тогда зону выбирайте по карте. Пиковое q_p — по формулам EN (g = 3.5).", "Wind q_b zones are not known for every city (CR 1-1-4 Annex A not read) — pick the zone from the map then. Peak q_p uses the EN formulas (g = 3.5)."],
  ],
};

export const CLIMATES_EN: Partial<Record<AnnexId, ClimateEN>> = { DE, FR, PL, RO };

export function climateEN(id: AnnexId | undefined): ClimateEN | undefined {
  return id ? CLIMATES_EN[id] : undefined;
}

/** s_k за країною, зоною, висотою; кН/м² */
export function skZone(cl: ClimateEN, zone: string, A: number): number {
  const z = cl.snowZones.find((x) => x.id === zone) ?? cl.snowZones[0];
  return r2(z.sk(A));
}

/** v_b,0 за країною, зоною, висотою; м/с */
export function vb0Zone(cl: ClimateEN, zone: string, A: number): number {
  const z = cl.windZones.find((x) => x.id === zone) ?? cl.windZones[0];
  return r2(z.vb0(A));
}

/** Пікова швидкісна напір і тиск на поверхню з урахуванням профілю країни. Тиски в Па. */
export function windNational(cl: ClimateEN | undefined, i: { vb: number; z: number; terrain: string; cpe: number; A?: number; co?: number; cscd?: number }) {
  const cscd = i.cscd ?? 1;
  const own = cl?.qp?.({ vb: i.vb, z: i.z, terrain: i.terrain, A: i.A ?? 0 });
  if (own) {
    const qb = 0.625 * i.vb * i.vb;
    return { qb, qp: own.qp, ce: own.qp / qb, f: own.f, cr: NaN, Iv: NaN, w: cscd * own.qp * i.cpe };
  }
  // (4.4)–(4.8) з z0, zmin країни (Франція: 0 — z0 = 0.005, IIIa, IIIb)
  const t = cl?.terrains.find((x) => x.id === i.terrain) ?? TERRAIN_EN[(i.terrain in TERRAIN_EN ? i.terrain : "II") as TerrainEN];
  const ze = Math.max(i.z, t.zmin), co = i.co ?? 1;
  const kr = 0.19 * (t.z0 / 0.05) ** 0.07, cr = kr * Math.log(ze / t.z0), vm = cr * co * i.vb;
  const Iv = 1 / (co * Math.log(ze / t.z0)), qb = 0.625 * i.vb ** 2, qp = (1 + 7 * Iv) * 0.625 * vm ** 2;
  return { qb, qp, ce: qp / qb, f: "", cr, Iv, w: cscd * qp * i.cpe };
}
