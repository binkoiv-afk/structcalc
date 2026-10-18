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
  it("навіс з покрівлею-пластиною: та сама сума реакцій, стрижні поділені й зібрані назад", () => {
    const a = asmTemplate("canopy", "DBN");
    const lp = analyzeAssembly(a);
    const b = { ...a, panels: a.panels.map((p) => ({ ...p, kind: "plate" as const, t: 4 })), cases: a.cases.map((c) => ({ ...c, selfWeight: false })) };
    const la = { ...a, cases: a.cases.map((c) => ({ ...c, selfWeight: false })) };
    const ra = analyzeAssembly(la), rb = analyzeAssembly(b);
    const sumZ = (r: typeof ra, k: number) => Object.values(r.uls[k].reactions).reduce((s, v) => s + v[2], 0);
    for (let k = 0; k < ra.uls.length; k++) expect(sumZ(rb, k) / sumZ(ra, k)).toBeCloseTo(1, 3);
    // стрижень по краю пластини знову один, з усіма станціями
    expect(Object.keys(rb.uls[0].members).sort()).toEqual(Object.keys(lp.uls[0].members).sort());
    expect(rb.uls[0].members["b1"].x.at(-1)).toBeCloseTo(6000, 3);
    expect(rb.plates.length).toBe(1);
    expect(rb.plates[0].smax).toBeGreaterThan(0);
  });
  it("площадка: лист-оболонка перевіряється, рівновага з власною вагою", () => {
    const a = asmTemplate("platform", "EN");
    const r = analyzeAssembly(a);
    expect(r.plates.length).toBe(2);
    expect(r.plates.every((p) => p.util > 0.05 && p.util < 1)).toBe(true);
    // загруження Q окремо: 3 кПа × 6 м²
    const only = analyzeAssembly({ ...a, cases: a.cases.map((c) => ({ ...c, selfWeight: false })), panelLoads: a.panelLoads.filter((l) => l.case === "L") });
    const k = only.combos.filter((c) => c.kind !== "SLS").findIndex((c) => c.factors.L > 0 && !c.factors.G && !c.factors.E);
    const kk = k >= 0 ? k : only.combos.filter((c) => c.kind !== "SLS").findIndex((c) => c.factors.L > 0);
    const c = only.combos.filter((x) => x.kind !== "SLS")[kk];
    const Rz = Object.values(only.uls[kk].reactions).reduce((s, v) => s + v[2], 0);
    expect(Rz / (c.factors.L * 3e-3 * 6e6)).toBeCloseTo(1, 3);
  });
});
