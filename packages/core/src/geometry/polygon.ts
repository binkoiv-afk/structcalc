// Геометрические характеристики сечения, заданного набором контуров.
// Внешний контур — против часовой стрелки (положительная площадь),
// отверстия — по часовой (отрицательная). Единицы: мм.

export type Pt = { x: number; y: number };
export type Loop = Pt[];

export interface Moments {
  A: number;
  Sx: number; // ∫y dA
  Sy: number; // ∫x dA
  Ixx: number; // ∫y² dA
  Iyy: number; // ∫x² dA
  Ixy: number; // ∫xy dA
}

export function loopMoments(p: Loop): Moments {
  let A = 0, Sx = 0, Sy = 0, Ixx = 0, Iyy = 0, Ixy = 0;
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    const c = a.x * b.y - b.x * a.y;
    A += c;
    Sy += (a.x + b.x) * c;
    Sx += (a.y + b.y) * c;
    Ixx += (a.y * a.y + a.y * b.y + b.y * b.y) * c;
    Iyy += (a.x * a.x + a.x * b.x + b.x * b.x) * c;
    Ixy += (a.x * b.y + 2 * a.x * a.y + 2 * b.x * b.y + b.x * a.y) * c;
  }
  return { A: A / 2, Sx: Sx / 6, Sy: Sy / 6, Ixx: Ixx / 12, Iyy: Iyy / 12, Ixy: Ixy / 24 };
}

export function sumMoments(loops: Loop[]): Moments {
  const r: Moments = { A: 0, Sx: 0, Sy: 0, Ixx: 0, Iyy: 0, Ixy: 0 };
  for (const l of loops) {
    const m = loopMoments(l);
    r.A += m.A; r.Sx += m.Sx; r.Sy += m.Sy; r.Ixx += m.Ixx; r.Iyy += m.Iyy; r.Ixy += m.Ixy;
  }
  return r;
}

/** Отсечение контура полуплоскостью y ≥ c (Сазерленд–Ходжмен). Вырожденные
 *  ребра на линии отсечения не влияют на интегралы площади и моментов. */
export function clipAbove(p: Loop, c: number): Loop {
  const out: Loop = [];
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    const ain = a.y >= c, bin = b.y >= c;
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = (c - a.y) / (b.y - a.y);
      out.push({ x: a.x + t * (b.x - a.x), y: c });
    }
  }
  return out;
}

export function swapXY(loops: Loop[]): Loop[] {
  // Зеркальная перестановка осей меняет обход, поэтому разворачиваем контур.
  return loops.map((l) => l.map((p) => ({ x: p.y, y: p.x })).reverse());
}

export function translate(loops: Loop[], dx: number, dy: number): Loop[] {
  return loops.map((l) => l.map((p) => ({ x: p.x + dx, y: p.y + dy })));
}

/** Пластический момент сопротивления относительно горизонтальной оси:
 *  ищем ось, делящую площадь пополам, затем Wpl = S_верх − S_низ. */
export function plasticModulusX(loops: Loop[]): number {
  const total = sumMoments(loops).A;
  let lo = Infinity, hi = -Infinity;
  for (const l of loops) for (const p of l) { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); }
  const areaAbove = (c: number) => sumMoments(loops.map((l) => clipAbove(l, c))).A;
  let a = lo, b = hi;
  for (let i = 0; i < 80; i++) {
    const m = (a + b) / 2;
    if (areaAbove(m) > total / 2) a = m; else b = m;
  }
  const c = (a + b) / 2;
  const up = sumMoments(loops.map((l) => clipAbove(l, c)));
  const all = sumMoments(loops);
  const sUp = up.Sx - c * up.A;
  const sDown = all.Sx - c * all.A - sUp;
  return sUp - sDown;
}

/** Четверть окружности (дуга) от угла a0 до a1 (рад) вокруг центра. */
export function arc(cx: number, cy: number, r: number, a0: number, a1: number, seg = 24): Pt[] {
  const pts: Pt[] = [];
  if (r <= 0) return [{ x: cx, y: cy }];
  for (let i = 0; i <= seg; i++) {
    const a = a0 + ((a1 - a0) * i) / seg;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}
