import { describe, expect, it } from "vitest";
import { checkFree, findSection } from "../src";
import type { FreeInput } from "../src";

// кронштейн: опорна плита (нормаль x), вертикальне ребро на двох швах, консольна пластина на 4 болтах; сила вниз на кінці
const base = (): FreeInput => ({
  code: "DBN",
  parts: [
    { id: "S", kind: "plate", axis: "x", a: 300, b: 400, t: 20, c: [-10, 0, 0], steel: "C245", role: "support" },
    { id: "R", kind: "plate", axis: "y", a: 200, b: 200, t: 12, c: [100, 0, 0], steel: "C245", role: "free" },
    { id: "L", kind: "plate", axis: "y", a: 300, b: 150, t: 10, c: [300, 11, 0], steel: "C245", role: "load" },
  ],
  conns: [
    { id: "W1", a: "S", b: "R", kind: "weld", n: "x", o: [0, 0, 0], kf: 6, segs: [{ u1: -6, v1: -100, u2: -6, v2: 100 }, { u1: 6, v1: -100, u2: 6, v2: 100 }] },
    { id: "B1", a: "R", b: "L", kind: "bolts", n: "y", o: [160, 6, 0], rows: 2, cols: 2, pu: 70, pv: 80, d: 16, cls: "5.6" },
  ],
  at: [420, 11, 0],
  combos: [{ name: "1", Fz: -20e3 }],
});

describe("вільний вузол", () => {
  it("ланцюжок: кожен зв'язок передає всю силу і момент від неї", () => {
    const r = checkFree(base());
    const w = r.combos[0].forces.find((x) => x.conn === "W1")!, b = r.combos[0].forces.find((x) => x.conn === "B1")!;
    // шов: нормаль x → (u, v) = (y, z); V_z = 20 кН, момент навколо y = F·(420 − 0)
    expect(Math.abs(w.Vv)).toBeCloseTo(20e3, 0);
    expect(Math.abs(w.Mu)).toBeCloseTo(20e3 * 420, -2);
    // болти: нормаль y → (u, v) = (z, x); зріз 20 кН по u, кручення групи = F·(420 − 160)
    expect(Math.abs(b.Vu)).toBeCloseTo(20e3, 0);
    expect(Math.abs(b.Mn)).toBeCloseTo(20e3 * 260, -2);
    expect(r.envelope.length).toBeGreaterThan(4);
    for (const c of r.envelope) expect(Number.isFinite(c.util)).toBe(true);
  });

  it("два однакові паралельні зв'язки ділять силу навпіл", () => {
    const i = base();
    i.conns.push({ ...i.conns[0], id: "W2", o: [0, 0, 0] });
    const r = checkFree(i);
    const w1 = r.combos[0].forces.find((x) => x.conn === "W1")!, w2 = r.combos[0].forces.find((x) => x.conn === "W2")!;
    expect(w1.Vv).toBeCloseTo(w2.Vv, 3);
    expect(Math.abs(w1.Vv)).toBeCloseTo(10e3, 0);
  });

  it("незакріплена деталь — механізм", () => {
    const i = base();
    i.conns = [i.conns[1]];
    expect(() => checkFree(i)).toThrow("free:mechanism");
  });

  it("профіль як деталь і креслення", () => {
    const i = base();
    i.parts[1] = { id: "R", kind: "profile", axis: "x", a: 200, b: 0, t: 0, c: [100, 0, 0], sec: findSection("RHS_COLD", "100×100×5")!, steel: "C245", role: "free" };
    const r = checkFree(i);
    expect(r.parts.some((p) => p.cls === "weld")).toBe(true);
    expect(r.parts.filter((p) => p.cls === "bolt").length).toBe(4);
  });
});
