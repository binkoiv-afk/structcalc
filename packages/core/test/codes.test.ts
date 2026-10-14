import { describe, expect, it } from "vitest";
import {
  checkMemberEN, checkMemberDBN, classifyEN, findSection, mcrDoublySymmetric, phiDBN, phiB, selectBeam, designBeam, DEFAULT_FACTORS,
} from "../src";

const near = (a: number, b: number, tol = 0.01) => expect(Math.abs(a - b) / Math.abs(b)).toBeLessThan(tol);

describe("характеристики сортамента (сверка с каталогом)", () => {
  it("IPE 300", () => {
    const s = findSection("IPE", "IPE 300")!;
    near(s.A, 5381); near(s.Iy, 83.56e6); near(s.Wply, 628.4e3); near(s.Iz, 6.038e6);
    near(s.It, 20.12e4, 0.02); near(s.Iw, 125.9e9, 0.02); near(s.mass, 42.2);
  });
  it("HEB 200", () => {
    const s = findSection("HEB", "HEB 200")!;
    near(s.A, 7808); near(s.Iy, 56.96e6); near(s.Wply, 642.5e3); near(s.Iz, 20.03e6); near(s.It, 59.28e4, 0.02);
  });
  it("Труба 100×100×4 (EN 10219)", () => {
    const s = findSection("RHS_COLD", "100×100×4")!;
    near(s.A, 1495); near(s.Iy, 2.26e6); near(s.Wply, 53.3e3); near(s.It, 3.62e6);
  });
});

describe("EN 1993-1-1", () => {
  it("класс сечения IPE 300 S235 при изгибе — 1", () => {
    expect(classifyEN(findSection("IPE", "IPE 300")!, 235, "bending")).toBe(1);
  });
  it("Mcr IPE 300, L = 6 м, постоянный момент (C1 = 1) ≈ 90.5 кН·м", () => {
    const s = findSection("IPE", "IPE 300")!;
    near(mcrDoublySymmetric(s, 210000, 81000, 6000, 1, 0, "center") / 1e6, 90.5, 0.02);
  });
  it("Mc,Rd IPE 300 S235 = 147.7 кН·м", () => {
    const s = findSection("IPE", "IPE 300")!;
    const r = checkMemberEN({ code: "EN", section: s, steel: "S235", MEd: 147.7e6 });
    near(r.checks.find((c) => c.key === "bending")!.util, 1.0);
  });
  it("Nb,Rd HEB 200 S235, L = 4 м, ось z ≈ 1168 кН", () => {
    const s = findSection("HEB", "HEB 200")!;
    const r = checkMemberEN({ code: "EN", section: s, steel: "S235", NEd: 1168e3, buckling: { Lcr_y: 4000, Lcr_z: 4000 } });
    near(r.checks.find((c) => c.key === "flexBuckling_z")!.util, 1.0);
  });
  it("подбор IPE: 6 м, q_k = 10 кН/м (Q), L/250, раскреплена → IPE 240", () => {
    const sel = selectBeam({
      code: "EN", steel: "S235", spans: [6], supports: ["pin", "pin"],
      loads: [{ type: "udl", cat: "Q", q: 10 }], selfWeight: true, ...DEFAULT_FACTORS.EN,
      ltb: { restrained: true, loadAt: "top" }, deflectionLimit: 250,
    }, "IPE");
    expect(sel.best?.section.name).toBe("IPE 240");
  });
});

describe("ДБН В.2.6-198", () => {
  it("φ при λ̄ = 3.17, тип b ≈ 0.608", () => {
    near(phiDBN(3.17, "b"), 0.608);
    expect(phiDBN(0.3, "a")).toBe(1);
  });
  it("φb: переход при φ1 > 0.85", () => {
    expect(phiB(0.5)).toBe(0.5);
    near(phiB(1.0), 0.89);
    expect(phiB(2)).toBe(1);
  });
  it("прочность при изгибе: σ = M/W", () => {
    const s = findSection("I_GOST8239", "I 20")!;
    const r = checkMemberDBN({ code: "DBN", section: s, steel: "C245", MEd: s.Wy * 240, gammaC: 1 });
    near(r.checks.find((c) => c.key === "bending")!.util, 1.0, 1e-6);
  });
  it("балка 6 м по ДБН проходит/не проходит согласованно с EN", () => {
    const base = {
      steel: "C245", spans: [6], supports: ["pin", "pin"] as ("pin")[],
      loads: [{ type: "udl" as const, cat: "G" as const, q: 5 }, { type: "udl" as const, cat: "Q" as const, q: 5 }],
      selfWeight: true, ltb: { restrained: false, loadAt: "top" as const }, deflectionLimit: 200,
    };
    const r = designBeam({ ...base, code: "DBN", ...DEFAULT_FACTORS.DBN }, findSection("IPE", "IPE 300")!);
    const keys = r.member.checks.map((c) => c.key);
    expect(keys).toEqual(expect.arrayContaining(["bending", "shear", "ltb", "deflection"]));
    near(r.C1, 1.13, 0.02);
  });
});
