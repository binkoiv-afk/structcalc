import { describe, expect, it } from "vitest";
import { analyzeAssembly, ASM_TEMPLATES, asmTemplate, betaDBN, findSection, frameModes, rhoCQC, rhoDBN, sdEN } from "../src";
import type { Assembly } from "../src";

describe("сейсміка", () => {
  it("β(T) за табл. 6.7: неперервний, межі 0.8…2.5", () => {
    expect(betaDBN(0.05, "II")).toBeCloseTo(1.75, 6);
    expect(betaDBN(0.3, "I")).toBe(2.5);
    expect(betaDBN(1.0, "II")).toBeCloseTo(1.8, 6);
    expect(betaDBN(2.0, "III")).toBeCloseTo(1.5, 6);
    expect(betaDBN(10, "I")).toBe(0.8);
    for (const s of ["I", "II", "III"] as const) for (const T of [0.4, 0.6, 1.2]) expect(Math.abs(betaDBN(T - 1e-6, s) - betaDBN(T + 1e-6, s))).toBeLessThan(0.02);
  });
  it("кореляція форм: табл. 6.9 і CQC", () => {
    expect(rhoDBN(0.95)).toBeCloseTo(0.8, 6);
    expect(rhoDBN(0.85)).toBe(0);
    expect(rhoCQC(1, 1)).toBeCloseTo(1, 6);
    expect(rhoCQC(1, 0.5)).toBeLessThan(0.05);
  });
  it("EN 1998-1: плато 2.5·a_g·S/q і нижня межа β·a_g", () => {
    const s = { on: true, dirs: { x: true, y: false, z: false }, agR: 0.2, ground: "C" as const, q: 2 };
    expect(sdEN(0.4, s)).toBeCloseTo((0.2 * 1.15 * 2.5) / 2, 6);
    expect(sdEN(10, s)).toBeCloseTo(0.2 * 0.2, 6);
  });
  it("власні коливання консолі з масою на кінці: T = 2π√(m·L³/3EI)", () => {
    const I = 1e7, E = 210000, L = 3000;
    const nodes = [{ id: "a", x: 0, y: 0, z: 0, fix: { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true } }, ...Array.from({ length: 6 }, (_, k) => ({ id: `n${k + 1}`, x: 0, y: 0, z: (L * (k + 1)) / 6 }))];
    const members = Array.from({ length: 6 }, (_, k) => ({ id: `m${k}`, i: k ? `n${k}` : "a", j: `n${k + 1}`, sec: { A: 5000, Iy: I, Iz: 2 * I, It: 1e6 }, E, G: 81000 }));
    const r = frameModes({ nodes, members }, [{ lc: { id: "G", nodal: [{ node: "n6", F: [0, 0, -9810, 0, 0, 0] }] }, c: 1 }], 4);
    const T = 2 * Math.PI * Math.sqrt(1 / ((3 * E * I) / L ** 3));
    expect(r.modes[0].T).toBeCloseTo(T, 4);
    expect(r.modes[0].meff[0] + r.modes[0].meff[1]).toBeCloseTo(1, 6);
  });
  it("власні коливання консолі з розподіленою масою: T₁ = 2π/1.875²·√(m·L⁴/EI)", () => {
    const I = 2e7, E = 210000, L = 4000, A = 8000, rho = 7850;
    const n = 20;
    const nodes = [{ id: "a", x: 0, y: 0, z: 0, fix: { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true } }, ...Array.from({ length: n }, (_, k) => ({ id: `n${k + 1}`, x: (L * (k + 1)) / n, y: 0, z: 0 }))];
    const members = Array.from({ length: n }, (_, k) => ({ id: `m${k}`, i: k ? `n${k}` : "a", j: `n${k + 1}`, sec: { A, Iy: I, Iz: 3 * I, It: 1e6 }, E, G: 81000, rho }));
    const r = frameModes({ nodes, members }, [{ lc: { id: "G", selfWeight: 1 }, c: 1 }], 3);
    const mlin = (rho * 1e-12) * A; // т/мм
    const T = ((2 * Math.PI) / 1.875 ** 2) * Math.sqrt((mlin * L ** 4) / (E * I));
    // зосереджені маси у вузлах — похибка дискретизації < 2 %
    const Tz = r.modes.find((m) => Math.abs(m.phi.n20[2]) > Math.abs(m.phi.n20[1]))!.T;
    expect(Math.abs(Tz / T - 1)).toBeLessThan(0.02);
  });
  it("стояк з масою вгорі: поперечна сила в основі V = m·k1·k2·a0·β(T)·g, і в реакціях те саме", () => {
    const a: Assembly = {
      code: "DBN",
      nodes: [{ id: "1", x: 0, y: 0, z: 0, support: "fixed" }, { id: "2", x: 0, y: 0, z: 4000 }],
      members: [{ id: "c", i: "1", j: "2", family: "HEA", size: "HEA 200", steel: "C245", endI: { kind: "weld", behaviour: "rigid", kf: 8 }, endJ: { kind: "none" } } as never],
      panels: [], panelLoads: [],
      cases: [{ id: "G", label: "G", cat: "G", gf: 1.1, nodal: [{ node: "2", F: [0, 0, -50e3, 0, 0, 0] }] }],
      seismic: { on: true, dirs: { x: true, y: false, z: false }, a0: 0.2, intensity: 8, soil: "II", k1: 0.25, k2: 1 },
    };
    const r = analyzeAssembly(a), s = r.seismic!;
    const m = (50e3 * 1.1 * 0.95) / 9810, T = s.modes.find((x) => x.meff[0] > 0.5)!.T;
    const s0 = findSection("HEA", "HEA 200")!;
    // T = 2π√(m·L³/3EI) по осі x (згин відносно сильної або слабкої осі — залежно від орієнтації)
    const Ts = [s0.Iy, s0.Iz].map((I) => 2 * Math.PI * Math.sqrt(m / ((3 * 210000 * I) / 4000 ** 3)));
    expect(Ts.some((x) => Math.abs(x / T - 1) < 0.01)).toBe(true);
    const V = m * 0.25 * 0.2 * betaDBN(T, "II") * 9810;
    expect(s.Vbase[0]).toBeCloseTo(V, -1);
    const e = r.uls[r.combos.filter((c) => c.kind !== "SLS").findIndex((c) => c.name === "E+")];
    // у сполученні E+: горизонтальна реакція = V (статична частина без горизонтальних сил)
    expect(Math.abs(e.reactions["1"][0])).toBeCloseTo(V, -1);
    expect(s.drift.length).toBe(1);
    expect(r.combos.some((c) => c.kind === "SEIS")).toBe(true);
  });
  for (const k of ASM_TEMPLATES) it(`шаблон «${k}» із сейсмікою: модальна маса ≥ 85 % і скінченні результати`, () => {
    for (const code of ["DBN", "EN"] as const) {
      const a = asmTemplate(k, code);
      a.seismic = { on: true, dirs: { x: true, y: true, z: false }, a0: 0.2, intensity: 8, soil: "II", agR: 0.2, ground: "B", q: 2 };
      const r = analyzeAssembly(a), s = r.seismic!;
      expect(Number.isFinite(r.maxUtil)).toBe(true);
      for (const d of [0, 1]) if (s.Mtot[d] > 0) expect(s.sum[d]).toBeGreaterThanOrEqual(0.85);
    }
  });
});
