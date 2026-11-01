import { describe, expect, it } from "vitest";
import { checkLBracket, L_BRACKET_DEFAULT, BrInput } from "../src";

const inp: BrInput = { br: L_BRACKET_DEFAULT, mat: "S250GD+Z", fixed: true, Vk: 0.5, Hp: 1.0, Hs: 1.2, gG: 1.35, gQ: 1.5, nR: 2, FvRd: 1.8, NRdA: 2.0, VRdA: 3.0, dT: 100, xFix: 2.5, alphaG: 23e-6 };

describe("НВФ: Г-кронштейн", () => {
  it("плече, напруження в корені, анкери за статикою", () => {
    const r = checkLBracket(inp);
    expect(r.lever).toBeCloseTo(160 - 14.7 - 4, 9);
    const V = 1.35 * 0.5, M = V * r.lever; // кН·мм
    const sig = (1.8 * 1e3) / 280 + (M * 1e3) / ((2 * 140 * 140) / 6);
    expect(r.checks[0].util).toBeCloseTo(sig / 250, 6);
    // верхній анкер: F = M_w·120/(120² + 20²) + 1.8/2; m = 20 − 2 − 1.6, n = min(20, 1.25m); N = F(m + n)/n
    const Mw = V * (160 - 14.7), F = (Mw * 120) / (120 ** 2 + 20 ** 2) + 1.8 / 2, m = 16.4, n = 20;
    expect(r.anchor.Nt).toBeCloseTo((F * (m + n)) / n, 6);
    const leff = Math.min(70, 2 * Math.PI * m, 4 * m + 1.25 * n), Mpl = (0.25 * leff * 4 * 250) / 1e3;
    expect(r.checks.find((c) => c.key === "br_flange")!.util).toBeCloseTo(F / Math.min((2 * Mpl) / m, (Mpl + n * 2.0) / (m + n), 2.0), 6);
    expect(r.anchor.V).toBeCloseTo(V / 2, 9);
    // зминання заклепки Ø5 у листі 2 мм: α = 3.6√0.4 = 2.277 → 2.1
    expect(r.rivet.FbRd).toBeCloseTo((2.1 * 330 * 5 * 2) / 1.25 / 1000, 9);
  });
  it("M_cr консольної пластини, опорний режим — пази", () => {
    const r = checkLBracket({ ...inp, fixed: false });
    const E = 210000, G = 81000, L = r.lever;
    expect(r.Mcr).toBeCloseTo((4.013 * Math.sqrt(((E * 140 * 8) / 12) * ((G * 140 * 8) / 3))) / L / 1e6, 9);
    expect(r.cases[0].V).toBe(0);
    const s = r.checks.find((c) => c.key === "br_slot")!;
    expect(s.util).toBeCloseTo((23e-6 * 100 * 2500) / 7, 6);
  });
});
