import { describe, expect, it } from "vitest";
import { buildCombinations, designBeam, findSection } from "../src";

describe("Сполучення навантажень", () => {
  it("ДБН 4.18: ψt1 = 1 для основного за впливом, ψt2 = 0.9, ψt3 = 0.7; ψl2 = 0.95", () => {
    const loads = [{ cat: "G" as const }, { cat: "Q" as const, label: "q1" }, { cat: "Q" as const, label: "q2" }, { cat: "Q" as const, label: "q3" }, { cat: "L" as const }, { cat: "L" as const }];
    const c = buildCombinations(loads, { code: "DBN", gammaG: 1.1, gammaQ: 1.2, influence: [0, 1, 3, 2, 1, 2] });
    const full = c.find((x) => x.kind === "ULS" && x.factors.every((f) => f > 0) && x.factors[0] === 1.1)!;
    expect(full.factors[2]).toBeCloseTo(1.2, 9); // найбільший вплив
    expect(full.factors[3]).toBeCloseTo(0.9 * 1.2, 9);
    expect(full.factors[1]).toBeCloseTo(0.7 * 1.2, 9);
    expect(full.factors[5]).toBeCloseTo(1.2, 9);
    expect(full.factors[4]).toBeCloseTo(0.95 * 1.2, 9);
    expect(c.some((x) => x.kind === "ULS" && x.factors[0] === 0.9)).toBe(true); // сприятлива постійна
  });
  it("взаємовиключні в одній групі не входять разом", () => {
    const c = buildCombinations([{ cat: "G" }, { cat: "Q", group: "w" }, { cat: "Q", group: "w" }], { code: "DBN", gammaG: 1.1, gammaQ: 1.3 });
    expect(c.some((x) => x.factors[1] > 0 && x.factors[2] > 0)).toBe(false);
    expect(c.filter((x) => x.kind === "ULS").length).toBe(6); // (нема, w1, w2) × (G несприятл., сприятл.)
  });
  it("EN 1990 6.10: провідна 1.5, супутня 1.5·ψ0", () => {
    const c = buildCombinations([{ cat: "G" }, { cat: "Q", psi0: 0.5 }, { cat: "Q", psi0: 0.7 }], { code: "EN", gammaG: 1.35, gammaQ: 1.5, influence: [0, 2, 1] });
    const full = c.find((x) => x.kind === "ULS" && x.factors[0] === 1.35 && x.factors[1] > 0 && x.factors[2] > 0)!;
    expect(full.factors[1]).toBeCloseTo(1.5, 9);
    expect(full.factors[2]).toBeCloseTo(1.05, 9);
  });
  it("балка: два короткочасні — другий з ψ = 0.9", () => {
    const sec = findSection("IPE", "IPE 300")!;
    const r = designBeam({
      code: "DBN", steel: "C245", spans: [6], supports: ["pin", "pin"], selfWeight: false, gammaG: 1.1, gammaQ: 1.3,
      loads: [{ type: "udl", cat: "G", q: 2 }, { type: "udl", cat: "Q", q: 5 }, { type: "udl", cat: "Q", q: 3 }],
      ltb: { restrained: true, loadAt: "top" }, deflectionLimit: 0,
    }, sec);
    expect(r.uls.Mmax / 1e6).toBeCloseTo(((2 * 1.1 + 5 * 1.3 + 0.9 * 3 * 1.3) * 36) / 8, 3);
    expect(r.combos[r.govern.M].text).toContain("1.17");
  });
});
