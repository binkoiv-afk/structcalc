import { describe, expect, it } from "vitest";
import { JOINT_KINDS, checkJoint, findSection, gussetMembersDefault, jointDefaults, jointSpec } from "../src";
import type { CodeId, JointInput, JointKind } from "../src";

function input(kind: JointKind, code: CodeId, o: Partial<JointInput["p"]> = {}): JointInput {
  const d = jointDefaults(kind, code);
  const st = code === "DBN" ? "C245" : "S235";
  const p = { ...d.p, ...o };
  if (kind === "gusset") p.members = gussetMembersDefault(findSection, code);
  return {
    code, kind, beam: findSection(...d.beam)!, beamSteel: st,
    column: d.column ? findSection(...d.column) : undefined, colSteel: st, colFace: "flange",
    plateSteel: st, p, combos: d.combos,
  };
}

describe("сталеві вузли", () => {
  for (const code of ["DBN", "EN"] as CodeId[]) for (const kind of JOINT_KINDS) {
    it(`${kind} · ${code}: типовий вузол рахується`, () => {
      const r = checkJoint(input(kind, code));
      expect(r.envelope.length).toBeGreaterThan(3);
      for (const c of r.envelope) expect(Number.isFinite(c.util), `${c.key} ${c.clause}`).toBe(true);
      expect(r.maxUtil).toBeGreaterThan(0.05);
      expect(r.parts.length).toBeGreaterThan(2);
      for (const pt of r.parts) for (const [u, v] of pt.poly) expect(Number.isFinite(u) && Number.isFinite(v)).toBe(true);
    });
  }

  it("фланець: зусилля верхнього ряду = M·d/Σd² (два ряди)", () => {
    const i = input("flangeSplice", "EN", { ext: 0, rowsIn: 1 });
    i.combos = [{ name: "1", My: 100e6 }];
    const r = checkJoint(i);
    const ts = r.envelope.find((c) => c.key === "jTStubPlate")!;
    const h = i.beam.h, tf = i.beam.dims.tf!, z = h / 2 - tf - i.p.ef, zc = -(h - tf) / 2;
    const d1 = z - zc, d2 = -z - zc;
    const F1 = (100e6 * d1) / (d1 * d1 + d2 * d2);
    expect(ts.subst).toContain((F1 / 1000).toFixed(1));
  });

  it("фінплита: більший зріз → більше використання, лінійно", () => {
    const a = input("finPlate", "DBN"), b = input("finPlate", "DBN");
    a.combos = [{ name: "1", Vz: 50e3 }]; b.combos = [{ name: "1", Vz: 100e3 }];
    const ua = checkJoint(a).envelope.find((c) => c.key === "jPlateShear")!.util;
    const ub = checkJoint(b).envelope.find((c) => c.key === "jPlateShear")!.util;
    expect(ub / ua).toBeCloseTo(2, 6);
  });

  it("фасонка: стиснутий стрижень перевіряється на стійкість", () => {
    const r = checkJoint(input("gusset", "DBN"));
    expect(r.envelope.some((c) => c.key === "jGussetBuck")).toBe(true);
    expect(r.parts.some((p) => p.id === "m1")).toBe(true);
  });

  it("ребра колони: стиск стінки менший, примітка про стійкість зникає", () => {
    const a = checkJoint(input("endPlate", "DBN")), b = checkJoint(input("endPlate", "DBN", { colStiff: true, tsc: 12 }));
    const ca = a.envelope.find((c) => c.key === "jColWebComp")!, cb = b.envelope.find((c) => c.key === "jColWebComp")!;
    expect(cb.util).toBeLessThan(ca.util);
    expect(cb.notes ?? []).not.toContain("colWebNoBuckling");
    expect(b.parts.filter((p) => p.id === "colStiff").length).toBe(4);
  });

  it("специфікація: 8 болтів торцевої плити, маса плити = ρ·V", () => {
    const i = input("endPlate", "EN"), r = checkJoint(i);
    const sp = jointSpec(r.parts);
    const bolts = sp.filter((x) => x.kind === "bolt").reduce((a, x) => a + x.n, 0);
    expect(bolts).toBe(8);
    const pl = sp.find((x) => x.id === "plate")!;
    const hp = i.beam.h + 2 * i.p.ext;
    expect(pl.mass).toBeCloseTo(hp * i.p.bp * i.p.tp * 7.85e-6, 3);
  });

  it("свої деталі: пластина і профіль з'являються на кресленні й у специфікації", () => {
    const i = input("finPlate", "DBN");
    const sec = findSection("RHS_COLD", "80×80×4")!;
    i.extras = [{ id: "x1", kind: "plate", axis: "x", a: 100, b: 200, t: 10, c: [50, 0, 0] }, { id: "x2", kind: "profile", axis: "y", a: 300, b: 0, t: 0, c: [100, 0, -300], sec }];
    const r = checkJoint(i);
    expect(r.parts.some((p) => p.id === "x1") && r.parts.some((p) => p.id === "x2")).toBe(true);
    const sp = jointSpec(r.parts, i.extras);
    expect(sp.find((x) => x.id === "x1")!.mass).toBeCloseTo(100 * 200 * 10 * 7.85e-6, 4);
    expect(sp.find((x) => x.id === "x2")!.mass).toBeCloseTo(sec.A * 300 * 7.85e-6, 4);
  });
});
