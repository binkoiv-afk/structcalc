// Снег EN 1991-1-3 и ветер EN 1991-1-4 (рекомендуемые значения; национальные приложения могут отличаться).
// Давления в Па.

/** EN 1991-1-3, табл. 5.2: μ1 для односкатных/двускатных покрытий */
export function snowMu1EN(alphaDeg: number): number {
  if (alphaDeg <= 30) return 0.8;
  if (alphaDeg >= 60) return 0;
  return (0.8 * (60 - alphaDeg)) / 30;
}

export interface SnowInputEN {
  sk: number; // Па
  alpha: number;
  muManual?: number;
  Ce?: number;
  Ct?: number;
}

export function snowEN(i: SnowInputEN) {
  const mu = i.muManual ?? snowMu1EN(i.alpha);
  const Ce = i.Ce ?? 1, Ct = i.Ct ?? 1;
  return { mu, Ce, Ct, sk: i.sk, s: mu * Ce * Ct * i.sk }; // (5.1)
}

export type TerrainEN = "0" | "I" | "II" | "III" | "IV";
/** EN 1991-1-4, табл. 4.1 */
export const TERRAIN_EN: Record<TerrainEN, { z0: number; zmin: number }> = {
  "0": { z0: 0.003, zmin: 1 },
  I: { z0: 0.01, zmin: 1 },
  II: { z0: 0.05, zmin: 2 },
  III: { z0: 0.3, zmin: 5 },
  IV: { z0: 1.0, zmin: 10 },
};

export interface WindInputEN {
  vb: number; // базовая скорость ветра, м/с (vb = cdir·cseason·vb,0)
  z: number; // м
  terrain: TerrainEN;
  cpe: number; // или cf для отдельных элементов
  co?: number; // орография
  cscd?: number;
  rho?: number; // кг/м³
}

export function windEN(i: WindInputEN) {
  const { z0, zmin } = TERRAIN_EN[i.terrain];
  const co = i.co ?? 1, rho = i.rho ?? 1.25, cscd = i.cscd ?? 1;
  const ze = Math.max(i.z, zmin);
  const kr = 0.19 * (z0 / 0.05) ** 0.07; // (4.5)
  const cr = kr * Math.log(ze / z0); // (4.4)
  const vm = cr * co * i.vb; // (4.3)
  const Iv = 1 / (co * Math.log(ze / z0)); // (4.7), kI = 1
  const qb = 0.5 * rho * i.vb ** 2; // (4.10)
  const qp = (1 + 7 * Iv) * 0.5 * rho * vm ** 2; // (4.8)
  return { kr, cr, vm, Iv, qb, qp, ce: qp / qb, cpe: i.cpe, cscd, w: cscd * qp * i.cpe }; // (5.1)
}
