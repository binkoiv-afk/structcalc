// Стали. ДБН: Ry = Ryn/γm (ДБН В.2.6-198, табл. 7.1, 7.2); Ryn, Run — ДСТУ 8539:2015, табл. 4 и 5.
// EN: fy, fu по EN 10025-2 / EN 10219-1.

/** вид проката: листовой (и заготовки гнутых профилей) или фасонный */
export type Product = "sheet" | "shaped";

export interface SteelGrade {
  id: string;
  code: "DBN" | "EN";
  E: number; // МПа
  G: number; // МПа
  /** характеристическое сопротивление Ryn (ДБН) или fy (EN), МПа; NaN — прокат такой толщины не поставляется */
  yieldChar: (t: number, product?: Product) => number;
  /** коэффициент надежности по материалу γm (ДБН, табл. 7.2); для EN = 1 */
  gammaM: number;
  /** расчетное сопротивление Ry = Ryn/γm (ДБН) или fy (EN) */
  strength: (t: number, product?: Product) => number;
  /** временное сопротивление Run (ДБН) или fu (EN) */
  ultimate: (t: number, product?: Product) => number;
  /** источник значений */
  source: string;
}

const E = 210000, G = 81000;
// ДБН В.2.6-198: E = 2.06·10⁵ МПа, G = 0.79·10⁵ МПа
const Ed = 206000, Gd = 79000;

/** строка таблицы: [t_from, t_to, σт, σв]; диапазон «от t_from (не включая, кроме первой строки) до t_to включительно» */
type Row = [number, number, number, number];

function lookup(rows: Row[] | undefined, t: number, k: 2 | 3): number {
  if (!rows) return NaN;
  for (let i = 0; i < rows.length; i++) {
    const [a, b] = rows[i];
    if ((i === 0 ? t >= a : t > a) && t <= b) return rows[i][k];
  }
  return NaN;
}

function dstu(id: string, sheet?: Row[], shaped?: Row[]): SteelGrade {
  const tab = (p?: Product) => (p === "shaped" ? shaped ?? sheet : sheet ?? shaped);
  const ryn = (t: number, p?: Product) => lookup(tab(p), t, 2);
  return {
    id, code: "DBN", E: Ed, G: Gd, gammaM: 1.025, source: "ДСТУ 8539:2015, табл. 4/5; γm — ДБН табл. 7.2",
    yieldChar: ryn, strength: (t, p) => ryn(t, p) / 1.025, ultimate: (t, p) => lookup(tab(p), t, 3),
  };
}

function dbnEN(id: string, fy16: number, fy40: number, fu: number): SteelGrade {
  const fy = (t: number) => (t <= 16 ? fy16 : t <= 40 ? fy40 : NaN);
  return { id, code: "DBN", E: Ed, G: Gd, gammaM: 1.05, source: "EN 10025-2 / EN 10219-1; γm = 1.05 — ДБН табл. 7.2",
    yieldChar: fy, strength: (t) => fy(t) / 1.05, ultimate: () => fu };
}

function en(id: string, fy16: number, fy40: number, fu: number): SteelGrade {
  const fy = (t: number) => (t <= 16 ? fy16 : t <= 40 ? fy40 : NaN);
  return { id, code: "EN", E, G, gammaM: 1, source: "EN 10025-2 / EN 10219-1", yieldChar: fy, strength: fy, ultimate: () => fu };
}

export const STEELS: SteelGrade[] = [
  // ДСТУ 8539:2015 — табл. 4 (лист, заготовки гнутых профилей), табл. 5 (фасон)
  dstu("C235", [[2, 3.9, 235, 360], [3.9, 4, 235, 360]]),
  dstu("C245", [[2, 3.9, 245, 370], [3.9, 30, 235, 370]], [[4, 20, 245, 370], [20, 40, 235, 370]]),
  dstu("C255",
    [[2, 3.9, 255, 380], [3.9, 10, 245, 380], [10, 20, 245, 370], [20, 40, 235, 370]],
    [[4, 10, 255, 380], [10, 20, 245, 370], [20, 40, 235, 370]]),
  dstu("C345",
    [[2, 3.9, 345, 490], [3.9, 10, 345, 490], [10, 20, 325, 470], [20, 40, 305, 460], [40, 60, 285, 450], [60, 80, 275, 440], [80, 160, 265, 430]],
    [[4, 10, 345, 480], [10, 20, 325, 470], [20, 40, 305, 460]]),
  dstu("C355", [[8, 16, 355, 470], [16, 40, 345, 470], [40, 60, 335, 470], [60, 80, 325, 460], [80, 100, 315, 460], [100, 160, 295, 460]],
    [[8, 16, 355, 470], [16, 40, 345, 470]]),
  dstu("C390", [[8, 50, 390, 520]], [[8, 10, 390, 520], [10, 20, 380, 500], [20, 40, 370, 490]]),
  // Стали по ДСТУ EN 10025 / 10219 при расчете по ДБН (табл. Г.5), γm = 1.05
  dbnEN("S235 (ДБН)", 235, 225, 360),
  dbnEN("S275 (ДБН)", 275, 265, 410),
  dbnEN("S355 (ДБН)", 355, 345, 470),
  // EN 10025-2 / EN 10219-1
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
