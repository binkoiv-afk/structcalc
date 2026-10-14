// Стали. Значения для толщин до 16–20 мм; для более толстого проката
// прочность снижается — это учитывается функцией по толщине.
// ВНИМАНИЕ: перед выпуском сверить с ДБН В.2.6-198 табл. Е.2 и EN 10025/10219.

export interface SteelGrade {
  id: string;
  code: "DBN" | "EN";
  E: number; // МПа
  G: number; // МПа
  /** расчетное сопротивление Ry (ДБН) или предел текучести fy (EN), МПа, по толщине t (мм) */
  strength: (t: number) => number;
  /** временное сопротивление: Run (ДБН) или fu (EN) */
  ultimate: (t: number) => number;
}

const E = 210000, G = 81000;
// ДБН В.2.6-198: E = 2.06·10⁵ МПа, G = 0.79·10⁵ МПа
const Ed = 206000, Gd = 79000;

export const STEELS: SteelGrade[] = [
  // ДБН В.2.6-198:2014, табл. Е.2 (фасонный прокат / трубы) — Ry уже включает γm
  { id: "C235", code: "DBN", E: Ed, G: Gd, strength: (t) => (t <= 20 ? 230 : 220), ultimate: () => 350 },
  { id: "C245", code: "DBN", E: Ed, G: Gd, strength: (t) => (t <= 20 ? 240 : 230), ultimate: () => 360 },
  { id: "C255", code: "DBN", E: Ed, G: Gd, strength: (t) => (t <= 10 ? 240 : t <= 20 ? 230 : 220), ultimate: () => 360 },
  { id: "C345", code: "DBN", E: Ed, G: Gd, strength: (t) => (t <= 10 ? 335 : t <= 20 ? 315 : 300), ultimate: () => 460 },
  // EN 10025-2 / EN 10219-1, номинальные значения fy, fu
  { id: "S235", code: "EN", E, G, strength: (t) => (t <= 16 ? 235 : 225), ultimate: () => 360 },
  { id: "S275", code: "EN", E, G, strength: (t) => (t <= 16 ? 275 : 265), ultimate: () => 430 },
  { id: "S355", code: "EN", E, G, strength: (t) => (t <= 16 ? 355 : 345), ultimate: () => 490 },
  { id: "S420", code: "EN", E, G, strength: (t) => (t <= 16 ? 420 : 400), ultimate: () => 520 },
  { id: "S460", code: "EN", E, G, strength: (t) => (t <= 16 ? 460 : 440), ultimate: () => 540 },
];

export function steel(id: string): SteelGrade {
  const s = STEELS.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown steel ${id}`);
  return s;
}
