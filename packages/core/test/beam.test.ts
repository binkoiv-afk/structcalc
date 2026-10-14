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
