// Стали. Значения для толщин до 16–20 мм; для более толстого проката
// прочность снижается — это учитывается функцией по толщине.
// ВНИМАНИЕ: перед выпуском сверить с ДБН В.2.6-198 табл. Е.2 и EN 10025/10219.

export interface SteelGrade {
  id: string;
  code: "DBN" | "EN";
  E: number; // МПа
  G: number; // МПа
  /** характеристический опор Ryn (ДБН) или fy (EN), МПа, по толщине t (мм) */
  yieldChar: (t: number) => number;
  /** коэффициент надежности по материалу γm (ДБН, табл. 7.2); для EN = 1 */
  gammaM: number;
  /** расчетное сопротивление Ry = Ryn/γm (ДБН, табл. 7.1) или fy (EN) */
  strength: (t: number) => number;
  /** временное сопротивление Run (ДБН) или fu (EN) */
  ultimate: (t: number) => number;
}

const E = 210000, G = 81000;
// ДБН В.2.6-198: E = 2.06·10⁵ МПа, G = 0.79·10⁵ МПа
const Ed = 206000, Gd = 79000;

function dbn(id: string, gammaM: number, ryn: (t: number) => number, run: (t: number) => number): SteelGrade {
  return { id, code: "DBN", E: Ed, G: Gd, yieldChar: ryn, gammaM, strength: (t) => ryn(t) / gammaM, ultimate: run };
}
function en(id: string, fy16: number, fy40: number, fu: number): SteelGrade {
  const fy = (t: number) => (t <= 16 ? fy16 : fy40);
  return { id, code: "EN", E, G, yieldChar: fy, gammaM: 1, strength: fy, ultimate: () => fu };
}

// ДБН: Ry = Ryn/γm (табл. 7.1), γm = 1.025 для классов по ДСТУ 8539, 1.05 — прочий прокат (табл. 7.2).
// Ryn по толщине (фасонный прокат, толщина полки) — по ДСТУ 8539, ТРЕБУЕТ СВЕРКИ с текстом стандарта.
export const STEELS: SteelGrade[] = [
  dbn("C235", 1.025, (t) => (t <= 20 ? 235 : 225), () => 360),
  dbn("C245", 1.025, (t) => (t <= 20 ? 245 : 235), () => 370),
  dbn("C255", 1.025, (t) => (t <= 10 ? 255 : t <= 20 ? 245 : 235), (t) => (t <= 10 ? 380 : 370)),
  dbn("C345", 1.025, (t) => (t <= 10 ? 345 : t <= 20 ? 325 : 305), (t) => (t <= 10 ? 490 : t <= 20 ? 470 : 460)),
  // Стали EN по ДСТУ EN 10025/10219 при расчете по ДБН (табл. Г.5), γm = 1.05
  dbn("C275 (S275)", 1.05, (t) => (t <= 16 ? 275 : 265), () => 410),
  dbn("C355 (S355)", 1.05, (t) => (t <= 16 ? 355 : 345), () => 470),
  // EN 10025-2 / EN 10219-1, номинальные fy, fu
  en("S235", 235, 225, 360),
  en("S275", 275, 265, 430),
  en("S355", 355, 345, 490),
  en("S420", 420, 400, 520),
  en("S460", 460, 440, 540),
];

export function steel(id: string): SteelGrade {
  const s = STEELS.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown steel ${id}`);
  return s;
}
