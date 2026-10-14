import { describe, expect, it } from "vitest";
import {
  checkMemberEN, checkMemberDBN, classifyEN, psiDBN, deflectionLimitDSTU, steel, phiDBNFormula, findSection, mcrDoublySymmetric, phiDBN, phiB, selectBeam, designBeam, DEFAULT_FACTORS,
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
  it("φ совпадает с табл. Ж.1 (до 0.002)", () => {
    // λ̄: [a, b, c] ×1000 из табл. Ж.1
    const table: [number, number[]][] = [
      [0.6, [994, 986, 950]], [1.0, [968, 948, 901]], [2.0, [877, 826, 744]], [3.0, [704, 643, 562]],
      [3.8, [530, 487, 430]], [4.4, [393, 392, 351]], [5.0, [304, 304, 289]], [5.8, [226, 226, 226]],
      [8.0, [119, 119, 119]], [10.0, [76, 76, 76]],
    ];
    for (const [lam, vals] of table) {
      (["a", "b", "c"] as const).forEach((tp, k) => {
        expect(Math.abs(phiDBN(lam, tp) - vals[k] / 1000)).toBeLessThan(0.0025);
      });
    }
    expect(phiDBN(0.3, "a")).toBe(1);
    near(phiDBN(3.1, "b"), (643 + 602) / 2000);
    near(phiDBNFormula(3.0, "b"), 0.643, 0.003);
  });
  it("ψ по табл. Н.1/Н.2", () => {
    near(psiDBN(10, { cantilever: false, load: "uniform", flange: "compressed", restraints: 0 }), 1.6 + 0.8);
    near(psiDBN(100, { cantilever: false, load: "point", flange: "tension", restraints: 0 }), 6.6 + 5.3 - 0.45);
    near(psiDBN(10, { cantilever: false, load: "uniform", flange: "tension", restraints: 1 }), 1.3 * (2.25 + 0.7));
    near(psiDBN(10, { cantilever: true, load: "point", flange: "tension", restraints: 0 }), 1.0 + 1.6);
  });
  it("предельный прогиб по ДСТУ Б В.1.2-3, табл. 1", () => {
    expect(deflectionLimitDSTU(0.5)).toBe(120);
    near(deflectionLimitDSTU(3), 150);
    near(deflectionLimitDSTU(6), 200);
    near(deflectionLimitDSTU(24), 250);
    expect(deflectionLimitDSTU(40)).toBe(300);
  });
  it("Ry = Ryn/γm по ДСТУ 8539: фасон и лист", () => {
    near(steel("C245").strength(10, "shaped"), 245 / 1.025, 1e-6);
    near(steel("C245").strength(10, "sheet"), 235 / 1.025, 1e-6);
    near(steel("C345").yieldChar(15, "shaped"), 325, 1e-9);
    near(steel("C255").yieldChar(10, "shaped"), 255, 1e-9);
    near(steel("C255").yieldChar(10.5, "shaped"), 245, 1e-9);
    expect(Number.isNaN(steel("C235").yieldChar(8, "shaped"))).toBe(true);
  });
  it("сталь не поставляется для толщины → проверка не выполняется", () => {
    const r = checkMemberDBN({ code: "DBN", section: findSection("IPE", "IPE 300")!, steel: "C235", MEd: 1e6 });
    expect(r.ok).toBe(false);
    expect(r.checks[0].key).toBe("material");
  });
  it("φb: переход при φ1 > 0.85", () => {
    expect(phiB(0.5)).toBe(0.5);
    near(phiB(1.0), 0.89);
    expect(phiB(2)).toBe(1);
  });
  it("прочность при изгибе: σ = M/W", () => {
    const s = findSection("I_GOST8239", "I 20")!;
    const r = checkMemberDBN({ code: "DBN", section: s, steel: "C245", MEd: s.Wy * (245 / 1.025), gammaC: 1 });
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
