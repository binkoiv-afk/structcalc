// Сніг і вітер за національними додатками EN 1991-1-3 / EN 1991-1-4: зони, висота над рівнем моря, міста.
// Формули EN 1991 (μ1, q_p(z)) — в en1991.ts; тут — що змінює країна: s_k за зоною і висотою, v_b,0 за зоною,
// категорії місцевості (Франція: IIIa/IIIb), профіль q_p (Німеччина: змішані профілі NA.B), ψ для снігу й вітру.
// Значення і джерела — /mnt/project-files/calc-app/norms/climate/, docs/VERIFICATION.md.

import type { AnnexId } from "../codes/annex";
import { TERRAIN_EN, type TerrainEN } from "./en1991";

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
export interface ClimateCity { name: string; region: string; snow: string; wind: string; alt: number }

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
  psiSnow: psiRec, psiWind: 0.6, cities: [],
  notes: [],
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
  psiSnow: psiRec, psiWind: 0.6, cities: [],
  notes: [],
};

// ── Польща: PN-EN 1991-1-3/NA, PN-EN 1991-1-4/NA ──
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
  psiSnow: psiRec, psiWind: 0.6, cities: [],
  notes: [],
};

export const CLIMATES_EN: Partial<Record<AnnexId, ClimateEN>> = { DE, FR, PL };

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
