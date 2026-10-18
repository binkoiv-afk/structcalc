import { describe, expect, it } from "vitest";
import { JOINT_KINDS, checkJoint, findSection, gussetMembersDefault, jointDefaults } from "../src";
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
});
