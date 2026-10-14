import { describe, expect, it } from "vitest";
import { analyzeBeam } from "../src/analysis/beam";

const EI = 210000 * 19430000; // IPE 200
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe("analyzeBeam", () => {
  it("однопролетная, равномерная нагрузка", () => {
    const L = 6000, q = 10; // 10 кН/м
    const r = analyzeBeam({ spans: [L], supports: ["pin", "pin"], EI, loads: [{ type: "udl", q }] });
    expect(rel(r.Mmax, (q * L * L) / 8)).toBeLessThan(1e-6);
    expect(rel(r.Vabs, (q * L) / 2)).toBeLessThan(1e-6);
    expect(rel(r.spanDeflections[0].w, (5 * q * L ** 4) / (384 * EI))).toBeLessThan(1e-4);
    expect(rel(r.reactions[0].R, (q * L) / 2)).toBeLessThan(1e-6);
  });
  it("консоль, сила на конце", () => {
    const L = 2000, P = 5000;
    const r = analyzeBeam({ spans: [L], supports: ["fixed", "free"], EI, loads: [{ type: "point", P, x: L }] });
    expect(rel(r.Mmin, -P * L)).toBeLessThan(1e-6);
    expect(rel(r.spanDeflections[0].w, (P * L ** 3) / (3 * EI))).toBeLessThan(1e-6);
    expect(r.spanDeflections[0].Lref).toBe(2 * L);
    expect(rel(r.reactions[0].M, P * L)).toBeLessThan(1e-6);
  });
  it("защемленная с двух сторон, равномерная", () => {
    const L = 6000, q = 10;
    const r = analyzeBeam({ spans: [L], supports: ["fixed", "fixed"], EI, loads: [{ type: "udl", q }] });
    expect(rel(r.Mmin, (-q * L * L) / 12)).toBeLessThan(1e-6);
    expect(rel(r.Mmax, (q * L * L) / 24)).toBeLessThan(1e-4);
    expect(rel(r.spanDeflections[0].w, (q * L ** 4) / (384 * EI))).toBeLessThan(1e-4);
  });
  it("двухпролетная неразрезная, равномерная", () => {
    const L = 5000, q = 8;
    const r = analyzeBeam({ spans: [L, L], supports: ["pin", "pin", "pin"], EI, loads: [{ type: "udl", q }] });
    expect(rel(r.Mmin, (-q * L * L) / 8)).toBeLessThan(1e-6);
    expect(rel(r.reactions[1].R, 1.25 * q * L)).toBeLessThan(1e-6);
    expect(rel(r.Mmax, (9 / 128) * q * L * L)).toBeLessThan(1e-3);
  });
  it("сосредоточенная сила в середине пролета", () => {
    const L = 4000, P = 20000;
    const r = analyzeBeam({ spans: [L], supports: ["pin", "pin"], EI, loads: [{ type: "point", P, x: L / 2 }] });
    expect(rel(r.Mmax, (P * L) / 4)).toBeLessThan(1e-6);
    expect(rel(r.spanDeflections[0].w, (P * L ** 3) / (48 * EI))).toBeLessThan(1e-6);
  });
});

describe("Трапецієвидне навантаження, пружні та ковзні опори", () => {
  const EI = 2.1e5 * 8.356e7;
  it("трикутне навантаження 0→p на шарнірній балці: Mmax = pL²/(9√3)", () => {
    const L = 6000, p = 10;
    const r = analyzeBeam({ spans: [L], supports: ["pin", "pin"], EI, loads: [{ type: "udl", q: 0, q2: p }] }, 600);
    expect(r.Mmax).toBeCloseTo((p * L * L) / (9 * Math.sqrt(3)), -4);
    expect(r.reactions[0].R).toBeCloseTo((p * L) / 6, 1);
    expect(r.reactions[1].R).toBeCloseTo((p * L) / 3, 1);
  });
  it("трапеція = рівномірне + трикутне", () => {
    const L = 5000;
    const a = analyzeBeam({ spans: [L], supports: ["fixed", "pin"], EI, loads: [{ type: "udl", q: 2, q2: 6 }] });
    const b = analyzeBeam({ spans: [L], supports: ["fixed", "pin"], EI, loads: [{ type: "udl", q: 2 }, { type: "udl", q: 0, q2: 4 }] });
    expect(a.reactions[0].M).toBeCloseTo(b.reactions[0].M, 3);
    expect(a.Mmax).toBeCloseTo(b.Mmax, 3);
  });
  it("ковзна заделка — консоль навпаки: M = qL²/3 біля заделки", () => {
    const L = 4000, q = 5;
    const r = analyzeBeam({ spans: [L], supports: ["fixed", "slide"], EI, loads: [{ type: "udl", q }] });
    expect(Math.abs(r.reactions[0].M)).toBeCloseTo((q * L * L) / 3, -3);
    expect(r.reactions[0].R).toBeCloseTo(q * L, 1);
  });
  it("пружна опора посередині: дуже жорстка ≈ шарнір", () => {
    const L = 6000, q = 5;
    const sp = analyzeBeam({ spans: [L, L], supports: ["pin", "spring", "pin"], springs: [0, 1e9, 0], EI, loads: [{ type: "udl", q }] });
    expect(sp.reactions[1].R).toBeCloseTo(1.25 * q * L, 0);
    const soft = analyzeBeam({ spans: [L, L], supports: ["pin", "spring", "pin"], springs: [0, 1, 0], EI, loads: [{ type: "udl", q }] });
    expect(soft.reactions[1].R).toBeLessThan(0.1 * q * L);
  });
});
