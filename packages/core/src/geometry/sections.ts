// Параметрические сечения. Оси (как в EN 1993): y–y — сильная ось (горизонтальная),
// z–z — слабая. В отчете по ДБН они подписываются как x–x и y–y.
// Единицы: мм, мм², мм⁴, мм⁶, кг/м.

import { arc, Loop, Pt, plasticModulusX, sumMoments, swapXY, translate } from "./polygon";

export type SectionKind = "I" | "RHS" | "CHS" | "C" | "L" | "RECT";

/** Элемент стенки/полки для классификации сечения. */
export interface PlateElement {
  role: "flange" | "web";
  support: "internal" | "outstand";
  c: number;
  t: number;
}

export interface Section {
  kind: SectionKind;
  name: string;
  family?: string;
  dims: Record<string, number>;
  /** «прокат» (горячекатаный) или «гнутый» (холодноформованный) — влияет на кривые устойчивости */
  fabrication: "hot" | "cold" | "welded";
  h: number;
  b: number;
  A: number;
  Iy: number;
  Iz: number;
  Wy: number;
  Wz: number;
  Wply: number;
  Wplz: number;
  iy: number;
  iz: number;
  /** минимальный радиус инерции (главные оси) — для уголков */
  imin: number;
  It: number;
  Iw: number;
  /** площадь среза при поперечной силе вдоль z (параллельно стенке) */
  Avz: number;
  /** суммарная толщина стенок на нейтральной оси — для τ = Q·S/(I·t) */
  tWeb: number;
  mass: number;
  elements: PlateElement[];
  /** подвержено ли изгибно-крутильной потере устойчивости */
  ltbProne: boolean;
  /** признак приближенной геометрии (напр. уклон полок ГОСТ 8239 не учтен) */
  approx?: string;
  loops: Loop[];
}

const STEEL_DENSITY = 7850e-9; // кг/мм³

function finish(
  base: Omit<Section, "A" | "Iy" | "Iz" | "Wy" | "Wz" | "Wply" | "Wplz" | "iy" | "iz" | "imin" | "mass" | "loops">,
  rawLoops: Loop[],
): Section {
  const m0 = sumMoments(rawLoops);
  const cx = m0.Sy / m0.A, cy = m0.Sx / m0.A;
  const loops = translate(rawLoops, -cx, -cy);
  const m = sumMoments(loops);
  let ymax = 0, xmax = 0;
  for (const l of loops) for (const p of l) { ymax = Math.max(ymax, Math.abs(p.y)); xmax = Math.max(xmax, Math.abs(p.x)); }
  const Iy = m.Ixx, Iz = m.Iyy, Iyz = m.Ixy;
  const avg = (Iy + Iz) / 2, dif = Math.sqrt(((Iy - Iz) / 2) ** 2 + Iyz ** 2);
  const Imin = avg - dif;
  return {
    ...base,
    A: m.A,
    Iy,
    Iz,
    Wy: Iy / ymax,
    Wz: Iz / xmax,
    Wply: plasticModulusX(loops),
    Wplz: plasticModulusX(swapXY(loops)),
    iy: Math.sqrt(Iy / m.A),
    iz: Math.sqrt(Iz / m.A),
    imin: Math.sqrt(Imin / m.A),
    mass: m.A * STEEL_DENSITY * 1000,
    loops,
  };
}

const PI = Math.PI;

/** Двутавр с параллельными гранями полок и радиусами сопряжения r. */
export function iSection(name: string, h: number, b: number, tw: number, tf: number, r: number, opts: { family?: string; fabrication?: "hot" | "welded"; approx?: string } = {}): Section {
  const H = h / 2, T = tw / 2;
  const p: Pt[] = [
    { x: -b / 2, y: -H }, { x: b / 2, y: -H }, { x: b / 2, y: -H + tf },
    ...arc(T + r, -H + tf + r, r, -PI / 2, -PI),
    ...arc(T + r, H - tf - r, r, PI, PI / 2),
    { x: b / 2, y: H - tf }, { x: b / 2, y: H }, { x: -b / 2, y: H }, { x: -b / 2, y: H - tf },
    ...arc(-T - r, H - tf - r, r, PI / 2, 0),
    ...arc(-T - r, -H + tf + r, r, 0, -PI / 2),
    { x: -b / 2, y: -H + tf },
  ];
  const A = 2 * b * tf + (h - 2 * tf) * tw + (4 - PI) * r * r;
  const hw = h - 2 * tf;
  const fab = opts.fabrication ?? "hot";
  const Avz = fab === "hot" ? Math.max(A - 2 * b * tf + (tw + 2 * r) * tf, hw * tw) : hw * tw;
  // It с учетом галтелей (формула каталогов ArcelorMittal / Kindmann).
  const D = ((r + tw / 2) ** 2 + (r + tf) ** 2 - r * r) / (2 * r + tf);
  const It = (2 / 3) * (b - 0.63 * tf) * tf ** 3 + ((h - 2 * tf) * tw ** 3) / 3
    + (r > 0 ? 2 * (tw / tf) * (0.145 + (0.1 * r) / tf) * D ** 4 : 0);
  const Izf = (tf * b ** 3) / 12;
  const Iw = (Izf * (h - tf) ** 2) / 2;
  return finish(
    {
      kind: "I", name, family: opts.family, dims: { h, b, tw, tf, r }, fabrication: fab, h, b,
      It, Iw, Avz, tWeb: tw,
      elements: [
        { role: "flange", support: "outstand", c: (b - tw - 2 * r) / 2, t: tf },
        { role: "web", support: "internal", c: h - 2 * tf - 2 * r, t: tw },
      ],
      ltbProne: true, approx: opts.approx,
    },
    [p],
  );
}

function roundedRect(w: number, h: number, r: number, seg = 16): Pt[] {
  const W = w / 2, H = h / 2;
  return [
    ...arc(W - r, -H + r, r, -PI / 2, 0, seg),
    ...arc(W - r, H - r, r, 0, PI / 2, seg),
    ...arc(-W + r, H - r, r, PI / 2, PI, seg),
    ...arc(-W + r, -H + r, r, PI, (3 * PI) / 2, seg),
  ];
}

/** Радиусы гиба гнутых труб по EN 10219-2: ro = 2t (t ≤ 6), 2.5t (6 < t ≤ 10), 3t (t > 10). */
export function rhsOuterRadius(t: number): number {
  return t <= 6 ? 2 * t : t <= 10 ? 2.5 * t : 3 * t;
}

/** Прямоугольная/квадратная труба. h — высота (вдоль z), b — ширина. */
export function rhsSection(name: string, h: number, b: number, t: number, opts: { family?: string; fabrication?: "hot" | "cold"; ro?: number } = {}): Section {
  const fab = opts.fabrication ?? "cold";
  const ro = opts.ro ?? (fab === "cold" ? rhsOuterRadius(t) : 1.5 * t);
  const ri = Math.max(ro - t, 0);
  const outer = roundedRect(b, h, ro);
  const inner = roundedRect(b - 2 * t, h - 2 * t, ri).reverse();
  // Кручение по EN 10219-2 (Приложение B): It = t³·p/3 + 2·K·Am, K = 2·t·Am/p
  const rc = (ro + ri) / 2;
  const p = 2 * (b - t + (h - t)) - 2 * rc * (4 - PI);
  const Am = (b - t) * (h - t) - rc * rc * (4 - PI);
  const K = (2 * t * Am) / p;
  const It = (t ** 3 * p) / 3 + 2 * K * Am;
  const s = finish(
    {
      kind: "RHS", name, family: opts.family, dims: { h, b, t, ro }, fabrication: fab, h, b,
      It, Iw: 0, Avz: 0, tWeb: 2 * t,
      elements: [
        { role: "flange", support: "internal", c: b - 3 * t, t },
        { role: "web", support: "internal", c: h - 3 * t, t },
      ],
      ltbProne: false,
    },
    [outer, inner],
  );
  s.Avz = (s.A * h) / (b + h);
  return s;
}

export function chsSection(name: string, d: number, t: number, opts: { family?: string; fabrication?: "hot" | "cold" } = {}): Section {
  const outer = arc(0, 0, d / 2, 0, 2 * PI, 96).slice(0, -1);
  const inner = arc(0, 0, d / 2 - t, 0, 2 * PI, 96).slice(0, -1).reverse();
  const s = finish(
    {
      kind: "CHS", name, family: opts.family, dims: { d, t }, fabrication: opts.fabrication ?? "cold", h: d, b: d,
      It: 0, Iw: 0, Avz: 0, tWeb: 2 * t,
      elements: [{ role: "web", support: "internal", c: d, t }],
      ltbProne: false,
    },
    [outer, inner],
  );
  s.It = 2 * s.Iy;
  s.Avz = (2 * s.A) / PI;
  return s;
}

/** Швеллер с параллельными гранями полок. */
export function channelSection(name: string, h: number, b: number, tw: number, tf: number, r: number, opts: { family?: string } = {}): Section {
  const H = h / 2;
  const p: Pt[] = [
    { x: 0, y: -H }, { x: b, y: -H }, { x: b, y: -H + tf },
    ...arc(tw + r, -H + tf + r, r, -PI / 2, -PI),
    ...arc(tw + r, H - tf - r, r, PI, PI / 2),
    { x: b, y: H - tf }, { x: b, y: H }, { x: 0, y: H },
  ];
  const It = (2 * b * tf ** 3 + (h - tf) * tw ** 3) / 3;
  const s = finish(
    {
      kind: "C", name, family: opts.family, dims: { h, b, tw, tf, r }, fabrication: "hot", h, b,
      It, Iw: 0, Avz: 0, tWeb: tw,
      elements: [
        { role: "flange", support: "outstand", c: b - tw - r, t: tf },
        { role: "web", support: "internal", c: h - 2 * tf - 2 * r, t: tw },
      ],
      ltbProne: true,
    },
    [p],
  );
  s.Avz = s.A - 2 * b * tf + (tw + r) * tf;
  return s;
}

/** Уголок: вертикальная полка h, горизонтальная b, толщина t, радиус r. */
export function angleSection(name: string, h: number, b: number, t: number, r: number, opts: { family?: string } = {}): Section {
  const p: Pt[] = [
    { x: 0, y: 0 }, { x: b, y: 0 }, { x: b, y: t },
    ...arc(t + r, t + r, r, -PI / 2, -PI),
    { x: t, y: h }, { x: 0, y: h },
  ];
  return finish(
    {
      kind: "L", name, family: opts.family, dims: { h, b, t, r }, fabrication: "hot", h, b,
      It: ((h + b - t) * t ** 3) / 3, Iw: 0, Avz: h * t, tWeb: t,
      elements: [
        { role: "flange", support: "outstand", c: b, t },
        { role: "web", support: "outstand", c: h, t },
      ],
      ltbProne: false,
    },
    [p],
  );
}

export function rectSection(name: string, h: number, b: number): Section {
  const p: Pt[] = [{ x: 0, y: 0 }, { x: b, y: 0 }, { x: b, y: h }, { x: 0, y: h }];
  const lo = Math.min(h, b), hi = Math.max(h, b);
  const It = lo ** 3 * hi * (1 / 3 - 0.21 * (lo / hi) * (1 - lo ** 4 / (12 * hi ** 4)));
  const s = finish(
    {
      kind: "RECT", name, dims: { h, b }, fabrication: "hot", h, b,
      It, Iw: 0, Avz: 0, tWeb: b,
      elements: [], ltbProne: h > b,
    },
    [p],
  );
  s.Avz = s.A;
  return s;
}
