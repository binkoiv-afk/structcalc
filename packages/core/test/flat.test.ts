import { describe, expect, it } from "vitest";
import { checkFlat, flatFem, perimeterW, punchCheck, punchK, punchPerimeter, rcConcrete } from "../src";
import type { FlatInput, PunchGeom } from "../src";

// 3×3 прольоти по 6 м, колони 400×400, h = 220
const fl = (o: Partial<FlatInput> = {}): FlatInput => ({
  code: "EN", concrete: "C30/37", rebar: "B500B", sx: [6, 6, 6], sy: [6, 6, 6], ov: 0.3, h: 220, c: 25,
  colShape: "rect", cx: 400, cy: 400, Hb: 3.3, Ha: 3.3, g: 1.5, q: 3,
  botX: { d: 12, s: 200 }, botY: { d: 12, s: 200 }, topX: { d: 16, s: 150 }, topY: { d: 16, s: 150 }, ...o,
});
const a = 6000, q = 0.01, E = 30000, h = 200, D = (E * h ** 3) / (12 * 0.96);

// Нескінченна плита на точкових опорах у вузлах квадратної сітки a×a (Надаї; Тимошенко, «Пластинки и оболочки», § 47):
// w(r) − w(0) = −(q/D)·Σ (e^{ik·r} − 1)/k⁴, k = 2π(m, n)/a — ряд Фур'є від навантаження q мінус реакції qa² у колонах
function series() {
  let S = 0, Sc = 0, Se = 0;
  const N = 600;
  for (let m = -N; m <= N; m++) for (let n = -N; n <= N; n++) {
    if (!m && !n) continue;
    const r2 = m * m + n * n;
    if ((m + n) % 2) S += 2 / r2 ** 2;
    Sc += ((-1) ** (m + n) * (m * m + 0.2 * n * n)) / r2 ** 2;
    Se += ((-1) ** m * (m * m + 0.2 * n * n)) / r2 ** 2;
  }
  const k = (q * a * a) / (4 * Math.PI ** 2);
  return { w: ((q * a ** 4) / (16 * Math.PI ** 4 * D)) * S, mc: k * Sc, me: k * Se };
}

describe("безбалочна плита", () => {
  it("нескінченна плита на точкових колонах — ряд Фур'є: w = 0.00580·qa⁴/D, m у центрі 0.0331·qa², між колонами 0.0513·qa²", () => {
    const s = series();
    expect(s.w / ((q * a ** 4) / D)).toBeCloseTo(0.0058, 4);
    expect(Math.abs(s.mc) / (q * a * a)).toBeCloseTo(0.0331, 3);
    expect(Math.abs(s.me) / (q * a * a)).toBeCloseTo(0.0513, 3);
    const r = flatFem(fl({ sx: [6], sy: [6], h, cx: 0, cy: 0, Hb: 0, Ha: 0, sym: true }), q, E);
    const c = r.nx / 2 + (r.ny / 2) * (r.nx + 1), e = r.nx / 2;
    expect(Math.abs(r.w[c] / s.w - 1)).toBeLessThan(0.02);
    expect(Math.abs(-r.m[c][0] / Math.abs(s.mc) - 1)).toBeLessThan(0.025);
    expect(Math.abs(-r.m[e][0] / Math.abs(s.me) - 1)).toBeLessThan(0.02);
    for (const col of r.cols) expect(col.V / (q * a * a)).toBeCloseTo(0.25, 6);
  });

  it("рівновага і симетрія: ΣV = q·площа; без колон вище/нижче — моменти колон нульові", () => {
    const r = checkFlat(fl());
    const area = (18 + 0.6) ** 2;
    expect(r.cols.reduce((s, c) => s + c.V, 0) / (r.wd * area)).toBeCloseTo(1, 6);
    const v = (l: string) => r.cols.find((c) => c.label === l)!;
    expect(v("A-1").V).toBeCloseTo(v("D-4").V, 6);
    expect(v("B-2").V).toBeCloseTo(v("C-3").V, 6);
    expect(v("A-2").V).toBeCloseTo(v("B-1").V, 6);
    const p = checkFlat(fl({ Hb: 0, Ha: 0 }));
    for (const c of p.cols) { expect(c.Mx).toBe(0); expect(c.My).toBe(0); }
    // защемлення колонами перерозподіляє: момент на крайній колоні напрямлений усередину плити
    const b1 = v("B-1");
    expect(-b1.My / b1.V).toBeGreaterThan(0);
  });

  it("контрольні контури (4.8.2): u1 і W1 — (4.80); крайня (EN (6.45); у ДСТУ (4.84) надруковано 4c2d і 2πdc2); кутова; кругла", () => {
    const d = 200, c1 = 400, c2 = 600;
    const int: PunchGeom = { shape: "rect", cx: c1, cy: c2, edgeX: null, edgeY: null };
    const pi = punchPerimeter(int, 2 * d), W = perimeterW(pi.pts);
    expect(pi.L).toBeCloseTo(2 * (c1 + c2) + 4 * Math.PI * d, 6);
    expect(W.L / pi.L).toBeCloseTo(1, 3);
    expect(W.Wx / (c1 ** 2 / 2 + c1 * c2 + 4 * c2 * d + 16 * d * d + 2 * Math.PI * d * c1)).toBeCloseTo(1, 3);
    // крайня: грань плити по x, впритул до колони; c1 ⟂ грані = cx, c2 ∥ грані = cy
    const edge: PunchGeom = { shape: "rect", cx: c1, cy: c2, edgeX: { s: -1, e: 0 }, edgeY: null };
    const pe = punchPerimeter(edge, 2 * d), We = perimeterW(pe.pts);
    expect(pe.kind).toBe("x");
    expect(pe.L).toBeCloseTo(c2 + 2 * c1 + 2 * Math.PI * d, 6);
    expect(We.Wy / (c2 ** 2 / 4 + c1 * c2 + 4 * c1 * d + 8 * d * d + Math.PI * d * c2)).toBeCloseTo(1, 3);
    const corner: PunchGeom = { shape: "rect", cx: c1, cy: c2, edgeX: { s: 1, e: 50 }, edgeY: { s: -1, e: 0 } };
    const pc = punchPerimeter(corner, 2 * d);
    expect(pc.kind).toBe("xy");
    expect(pc.L).toBeCloseTo(c1 + c2 + 50 + Math.PI * d, 6);
    expect(perimeterW(pc.pts).L / pc.L).toBeCloseTo(1, 3);
    // далеко від грані — повний контур
    expect(punchPerimeter({ ...edge, edgeX: { s: -1, e: 2000 } }, 2 * d).kind).toBe("full");
    expect(punchPerimeter({ shape: "circle", cx: 500, cy: 500, edgeX: null, edgeY: null }, 2 * d).L).toBeCloseTo(Math.PI * (500 + 4 * d), 6);
    // табл. 4.1
    expect(punchK(0.5)).toBe(0.45); expect(punchK(1)).toBe(0.6); expect(punchK(1.5)).toBeCloseTo(0.65, 9); expect(punchK(4)).toBe(0.8);
  });

  it("продавлювання середньої колони вручну: (4.78), (4.86), (4.92), (4.93), (4.94)", () => {
    const conc = rcConcrete("EN", "C30/37"), d = 200, V = 600e3, c = 400;
    const geom: PunchGeom = { shape: "rect", cx: c, cy: c, edgeX: null, edgeY: null };
    const base = { code: "EN" as const, conc, geom, V, ex: 100, ey: 0, d, rho: 0.008, h: 240, approx: false, rebar: "B500B" };
    const r = punchCheck(base);
    const u1 = 4 * c + 4 * Math.PI * d, W1 = 1.5 * c * c + 4 * c * d + 16 * d * d + 2 * Math.PI * d * c;
    const beta = 1 + (0.6 * u1 * 100) / W1;
    expect(r.u1).toBeCloseTo(u1, 6);
    expect(r.beta / beta).toBeCloseTo(1, 3);
    const k = 1 + Math.sqrt(200 / d), vRdc = Math.max((0.18 / 1.5) * k * (100 * 0.008 * 30) ** (1 / 3), 0.035 * k ** 1.5 * Math.sqrt(30));
    expect(r.vRdc).toBeCloseTo(vRdc, 9);
    expect(r.vRdMax).toBeCloseTo(0.5 * 0.6 * (1 - 30 / 250) * 20, 9);
    expect(r.vEd0 / ((beta * V) / (4 * c * d))).toBeCloseTo(1, 3);
    expect(r.vEd / ((beta * V) / (u1 * d))).toBeCloseTo(1, 3);
    // u_out = βV/(v_Rd,c·d), відстань від грані: 4c + 2πr = u_out
    expect(r.uOut / ((beta * V) / (vRdc * d))).toBeCloseTo(1, 3);
    expect(r.rOut / ((r.uOut - 4 * c) / (2 * Math.PI))).toBeCloseTo(1, 6);
    // наближене β (рис. 4.24)
    expect(punchCheck({ ...base, approx: true }).beta).toBe(1.15);
    // з арматурою 8Ø10 на периметр, s_r = 150: f_ywd,ef = 250 + 0.25·200 = 300 < 435
    const s = punchCheck({ ...base, rf: { d: 10, n: 8, sr: 150, rows: 4 } });
    const vRdcs = 0.75 * vRdc + 1.5 * (d / 150) * (8 * Math.PI * 25) * 300 / (u1 * d);
    expect(s.vRdcs).toBeCloseTo(vRdcs, 9);
    expect(s.rLast).toBeCloseTo(100 + 3 * 150, 9);
    // кругла (4.81): β = 1 + 0.6π·e/(D + 4d)
    const cr = punchCheck({ ...base, geom: { shape: "circle", cx: 500, cy: 500, edgeX: null, edgeY: null }, ex: 60, ey: 80 });
    expect(cr.beta).toBeCloseTo(1 + (0.6 * Math.PI * 100) / (500 + 800), 9);
    expect(cr.u0).toBeCloseTo(Math.PI * 500, 9);
  });

  it("крайня і кутова колони: (4.83) з k для c1/2c2, (4.85) β = u1/u1*, u0 за (4.93)", () => {
    const conc = rcConcrete("EN", "C30/37"), d = 200, c = 400, V = 300e3;
    const edge: PunchGeom = { shape: "rect", cx: c, cy: c, edgeX: { s: -1, e: 0 }, edgeY: null };
    // ексцентриситет усередину (від грані x = −…): e_x > 0; паралельно грані e_y = 50
    const r = punchCheck({ code: "EN", conc, geom: edge, V, ex: 150, ey: 50, d, rho: 0.008, h: 240, approx: false, rebar: "B500B" });
    const u1 = c + 2 * c + 2 * Math.PI * d, u1r = 2 * Math.min(1.5 * d, 0.5 * c) + c + 2 * Math.PI * d;
    const W1 = c * c / 4 + c * c + 4 * c * d + 8 * d * d + Math.PI * d * c;
    expect(r.type).toBe("edge");
    expect(r.u1r).toBeCloseTo(u1r, 6);
    expect(r.beta / (u1 / u1r + (punchK(0.5) * u1 * 50) / W1)).toBeCloseTo(1, 3);
    expect(r.u0).toBeCloseTo(Math.min(c + 3 * d, 3 * c), 9);
    const corner: PunchGeom = { shape: "rect", cx: c, cy: c, edgeX: { s: -1, e: 0 }, edgeY: { s: -1, e: 0 } };
    const k = punchCheck({ code: "EN", conc, geom: corner, V, ex: 80, ey: 80, d, rho: 0.008, h: 240, approx: false, rebar: "B500B" });
    expect(k.type).toBe("corner");
    expect(k.beta).toBeCloseTo((2 * c + Math.PI * d) / (2 * Math.min(1.5 * d, 0.5 * c) + Math.PI * d), 6);
    expect(k.u0).toBeCloseTo(Math.min(3 * d, 2 * c), 9);
    expect(punchCheck({ code: "EN", conc, geom: corner, V, ex: 0, ey: 0, d, rho: 0.008, h: 240, approx: true, rebar: "B500B" }).beta).toBe(1.5);
  });

  it("плита: верх над колоною за 8.4.1.2, вибір β, перевірки з поперечною арматурою, підказки", () => {
    const r = checkFlat(fl());
    const c = r.cols.find((x) => x.label === "B-2")!;
    expect(c.top.mx).toBeCloseTo((0.5 * c.top.Mx) / 1.5, 9);
    expect(r.M.tx).toBeCloseTo(Math.max(...r.cols.map((x) => x.top.mx)), 9);
    expect(r.approxOk).toBe(true);
    expect(c.p.beta).toBe(1.15);
    // прольоти 6 і 8 м (> 25 %) — β з розрахунку
    const u = checkFlat(fl({ sx: [6, 8, 6] }));
    expect(u.approxOk).toBe(false);
    expect(u.cols.every((x) => x.p.beta === x.p.betaFem)).toBe(true);
    // h = 220: продавлювання не проходить без арматури; з арматурою — інші перевірки
    expect(r.checks.find((x) => x.key === "punchC")!.ok).toBe(false);
    const w = checkFlat(fl({ punch: { d: 10, n: 12, sr: 125, rows: 5 } }));
    const ks = w.checks.map((x) => x.key);
    for (const kk of ["punchMax", "punchCs", "punchOut", "punchSr", "punchRows"]) expect(ks).toContain(kk);
    expect(w.checks.find((x) => x.key === "punchSr")!.util).toBeCloseTo(125 / (0.75 * c.p.d), 9);
    // підказка: найменше армування, що проходить
    expect(r.need.topY).toBeDefined();
  });
});
