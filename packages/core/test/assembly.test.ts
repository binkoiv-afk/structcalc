import { describe, expect, it } from "vitest";
import { analyzeAssembly, ASM_TEMPLATES, asmTemplate, panelLoads, solveFrame, toFrame } from "../src";

describe("збірка", () => {
  for (const k of ASM_TEMPLATES) it(`шаблон «${k}» рахується повністю`, () => {
    const r = analyzeAssembly(asmTemplate(k, "DBN"));
    expect(r.combos.length).toBeGreaterThan(1);
    expect(Number.isFinite(r.maxUtil)).toBe(true);
    expect(r.members.every((m) => m.checks.length > 0)).toBe(true);
    expect(r.conns.length).toBeGreaterThan(0);
    const e = analyzeAssembly(asmTemplate(k, "EN"));
    expect(Number.isFinite(e.maxUtil)).toBe(true);
  });
  it("ферма: зусилля в нижньому поясі посередині ≈ M/H", () => {
    const a = asmTemplate("truss", "DBN");
    const { model } = toFrame(a);
    const r = solveFrame(model, [{ id: "S", nodal: a.cases[1].nodal }]).S;
    const P = 9000, d = 2000, H = 1500;
    const N = Math.max(r.members["Н3"].N[0], r.members["Н4"].N[0]);
    // переріз у 3-й панелі: моменти відносно вузла верхнього поясу t2 — M(2d) = 4Pd
    expect(N / ((4 * P * d) / H)).toBeCloseTo(1, 1);
  });
  it("навіс: сніг на проєкцію збирається повністю, бази перевіряються", () => {
    const a = asmTemplate("canopy", "DBN");
    const { model } = toFrame(a);
    const pl = panelLoads(model, a.panels, a.panelLoads).byCase.get("S")!;
    const r = solveFrame(model, [{ id: "S", members: pl }]).S;
    const Rz = Object.values(r.reactions).reduce((s, v) => s + v[2], 0);
    expect(Rz).toBeCloseTo(1.2e-3 * 6000 * 4000, 0);
    const res = analyzeAssembly(a);
    expect(res.supports.length).toBe(4);
    expect(res.supports.every((s) => s.result && Number.isFinite(s.result.maxUtil))).toBe(true);
  });
});
