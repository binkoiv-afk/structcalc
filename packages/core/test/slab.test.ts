import { describe, expect, it } from "vitest";
import { checkSlab, slabAs, slabFem } from "../src";
import type { SlabInput } from "../src";

// квадратна плита 6×6 м, h = 200, q = 10 кН/м² (тільки корисне, γ = 1), шарнір по контуру
const sl = (o: Partial<SlabInput> = {}): SlabInput => ({
  code: "EN", concrete: "C25/30", rebar: "B500B", lx: 6, ly: 6, h: 200, c: 20, edges: { x0: "pin", x1: "pin", y0: "pin", y1: "pin" },
  g: 0, q: 10, selfWeight: false, gammaG: 1, gammaQ: 1, botX: { d: 10, s: 150 }, botY: { d: 10, s: 150 }, topX: { d: 10, s: 200 }, topY: { d: 10, s: 200 }, ...o,
});
const a = 6000, q = 0.01, E = 30000, D = (E * 200 ** 3) / (12 * (1 - 0.04));
const mid = (r: { nx: number; ny: number }) => r.nx / 2 + (r.ny / 2) * (r.nx + 1);

describe("залізобетонна плита", () => {
  it("шарнір по контуру — Тимошенко (Кірхгоф): w = 0.00406·qa⁴/D, m_x = (1 + ν)·0.0368·qa², m_xy кута = 0.0325·qa²·(1 − ν)/0.7", () => {
    const r = slabFem(sl(), q, E), k = mid(r);
    expect(r.w[k] / ((0.00406 * q * a ** 4) / D)).toBeCloseTo(1, 1);
    expect(Math.abs(r.w[k] / ((0.00406 * q * a ** 4) / D) - 1)).toBeLessThan(0.01);
    expect(Math.abs(-r.m[k][0] / (1.2 * 0.0368 * q * a * a) - 1)).toBeLessThan(0.015);
    expect(Math.abs(Math.abs(r.m[0][2]) / ((0.0325 * 0.8) / 0.7 * q * a * a) - 1)).toBeLessThan(0.02);
  });

  it("защемлення по контуру: w = 0.00126·qa⁴/D, опорний m = −0.0513·qa², у центрі (1 + ν)/1.3·0.0231·qa²", () => {
    const i = sl({ edges: { x0: "fix", x1: "fix", y0: "fix", y1: "fix" } });
    const r = slabFem(i, q, E), k = mid(r), edge = r.ny / 2 * (r.nx + 1);
    expect(Math.abs(r.w[k] / ((0.00126 * q * a ** 4) / D) - 1)).toBeLessThan(0.03);
    expect(Math.abs(r.m[edge][0] / (0.0513 * q * a * a) - 1)).toBeLessThan(0.02);
    expect(Math.abs(-r.m[k][0] / ((1.2 / 1.3) * 0.0231 * q * a * a) - 1)).toBeLessThan(0.03);
    const s = checkSlab(i);
    expect(s.M.tx).toBeCloseTo(r.m[edge][0] / 1000 + Math.abs(r.m[edge][2]) / 1000, 6);
  });

  it("балочна плита (дві шарнірні грані, дві вільні): посередині m = ql²/8, робота «x»", () => {
    const s = checkSlab(sl({ ly: 18, edges: { x0: "pin", x1: "pin", y0: "free", y1: "free" } }));
    expect(s.kind).toBe("x");
    expect(Math.abs(s.field.mbx[mid(s.field)] / ((10 * 36) / 8) - 1)).toBeLessThan(0.02);
    // l2/l1 = 3 > 2 при опиранні по контуру — теж балочна в короткому напрямку
    expect(checkSlab(sl({ ly: 18 })).kind).toBe("x");
    // консоль (защемлена лише грань x = 0) — працює в x; момент у защемленні ql²/2
    const c = checkSlab(sl({ lx: 2, ly: 8, edges: { x0: "fix", x1: "free", y0: "free", y1: "free" } }));
    expect(c.kind).toBe("x");
    expect(Math.abs(c.field.mtx[(c.field.ny / 2) * (c.field.nx + 1)] / ((10 * 4) / 2) - 1)).toBeLessThan(0.03);
    expect(c.defl.l).toBe(4);
  });

  it("армування на 1 м, Вуд–Армер, конструювання 8.3 — вручну", () => {
    expect(slabAs({ d: 10, s: 150 })).toBeCloseTo((Math.PI * 25 * 1000) / 150, 9);
    const s = checkSlab(sl({ ly: 7, botX: { d: 12, s: 250 }, topX: { d: 8, s: 200 } }));
    const k = (key: string) => s.checks.filter((c) => c.key === key);
    // основний напрямок — x (коротший прольот): s ≤ min(3h; 400) = 400 → 250/400; низ y — допоміжний: 150/450
    expect(k("slSmain").some((c) => Math.abs(c.util - 250 / 400) < 1e-9)).toBe(true);
    expect(k("slSsec")[0].util).toBeCloseTo(150 / 450, 9);
    // 8.3.1.6: верх над шарнірною гранню — на 0.15·M прольоту
    // підказка: найменше армування верху x, за якого M_Rd ≥ M_Ed; для поставленого Ø8/200 — немає
    const f0 = checkSlab(sl({ edges: { x0: "fix", x1: "pin", y0: "pin", y1: "pin" }, topX: { d: 8, s: 300 } }));
    const nd = f0.need.topX!;
    const f1 = checkSlab(sl({ edges: { x0: "fix", x1: "pin", y0: "pin", y1: "pin" }, topX: nd }));
    expect(f1.rc.xNeg.neg!.MRd).toBeGreaterThanOrEqual(f1.M.tx);
    expect(f1.need.topX).toBeUndefined();
    expect(k("slFixX")[0].util).toBeCloseTo((0.15 * s.M.bx) / s.rc.xNeg.neg!.MRd, 9);
    // Вуд–Армер у кожному вузлі: низ = −m + |m_xy| ≥ 0
    const r = slabFem(sl({ ly: 7 }), s.wd / 1000, 31000);
    expect(s.M.bx).toBeCloseTo(Math.max(...r.m.map(([mx, , mxy]) => -mx + Math.abs(mxy))) / 1000, 3);
  });

  it("прогин: без тріщин множник ≈ (1 + φ)·I_c / I_I", () => {
    const s = checkSlab(sl({ q: 3 }));
    expect(s.defl.k).toBeLessThan(3);
    expect(s.defl.k).toBeGreaterThan(0.85 * 3);
    const big = checkSlab(sl({ q: 25, h: 160 }));
    expect(big.defl.k).toBeGreaterThan(3);
  });
});
