import { describe, expect, it } from "vitest";
import { checkRc, rcConcrete } from "../src";
import type { RcInput } from "../src";

// балка 300×500, 4Ø20 знизу, хомути Ø8 у 2 гілки через 150, захисний шар 30
const beam = (o: Partial<RcInput> = {}): RcInput => ({
  code: "EN", concrete: "C30/37", rebar: "B500B", b: 300, h: 500, c: 30, sw: { d: 8, legs: 2, s: 150, cls: "B500B" },
  bot: [{ n: 4, d: 20 }], top: [], mode: "section", M: 150, V: 100, Mqp: 100, ...o,
});
const As = 4 * Math.PI * 100, d = 500 - 30 - 8 - 10;

describe("залізобетон", () => {
  it("EN: M_Rd прямокутника = парабола-прямокутник (α = 0.8095, β = 0.416)", () => {
    const r = checkRc(beam());
    expect(r.d).toBeCloseTo(d, 6);
    const F = As * 500 / 1.15, x = F / (0.8095 * 300 * 20), M = F * (d - 0.416 * x) / 1e6;
    expect(r.pos.MRd).toBeCloseTo(M, 0);
    expect(r.pos.state.eTop).toBeCloseTo(0.0035, 5);
  });

  it("ДБН: криволінійна діаграма (3.4) близька до рівномірного блоку λ = 0.8 (3.1.6.2)", () => {
    const r = checkRc(beam({ code: "DBN", concrete: "C20/25", rebar: "A500C", sw: { d: 8, legs: 2, s: 150, cls: "A240C" } }));
    const c = rcConcrete("DBN", "C20/25");
    expect(c.fcd).toBe(14.5);
    const F = As * 500 / 1.15, x = F / (0.8 * 300 * 14.5), M = F * (d - 0.4 * x) / 1e6;
    expect(Math.abs(r.pos.MRd / M - 1)).toBeLessThan(0.03);
    // A500C Ø20: γs = 1.15 (табл. 2.1)
    expect(r.fyd).toBeCloseTo(500 / 1.15, 6);
  });

  it("зріз EN 6.2.2 / 6.2.3 — вручну", () => {
    const r = checkRc(beam());
    const k = 1 + Math.sqrt(200 / d), rho = As / (300 * d);
    const vrdc = Math.max(0.12 * k * (100 * rho * 30) ** (1 / 3), 0.035 * k ** 1.5 * Math.sqrt(30)) * 300 * d / 1000;
    expect(r.shear.VRdc).toBeCloseTo(vrdc, 6);
    const Asw = 2 * Math.PI * 16, z = 0.9 * d;
    expect(r.shear.cot).toBeCloseTo(2.5, 6);
    expect(r.shear.VRds).toBeCloseTo((Asw / 150) * z * (500 / 1.15) * 2.5 / 1000, 6);
    expect(r.shear.VRdmax).toBeCloseTo(300 * z * 0.6 * (1 - 30 / 250) * 20 / 2.9 / 1000, 6);
  });

  it("тріщини EN 7.3.4: σ_s, s_r,max, w_k — вручну (φ = 2)", () => {
    const r = checkRc(beam());
    const Ecm = 22000 * (38 / 10) ** 0.3, aeL = 2e5 / (Ecm / 3), ae = 2e5 / Ecm, fctm = 0.3 * 30 ** (2 / 3);
    const x = (-aeL * As + Math.sqrt((aeL * As) ** 2 + 2 * 300 * aeL * As * d)) / 300;
    const I = 300 * x ** 3 / 3 + aeL * As * (d - x) ** 2, sig = aeL * 100e6 * (d - x) / I;
    expect(r.crack.x).toBeCloseTo(x, -1);
    expect(r.crack.sigmaS / sig).toBeCloseTo(1, 2);
    const hc = Math.min(2.5 * (500 - d), (500 - x) / 3, 250), rho = As / (300 * hc);
    const sr = 3.4 * 38 + 0.425 * 0.8 * 0.5 * 20 / rho, de = Math.max((sig - 0.4 * fctm * (1 + ae * rho) / rho) / 2e5, 0.6 * sig / 2e5);
    expect(r.crack.wk / (sr * de)).toBeCloseTo(1, 2);
  });

  it("прогин без тріщин = 5wL⁴/(384·E_c,eff·I_I); з тріщинами — більший", () => {
    const i = beam({ mode: "beam", L: 4, supports: "ss", g: 2, q: 0, selfWeight: false, phi: 2 });
    const r = checkRc(i);
    const Ecm = 22000 * 3.8 ** 0.3, Ec = Ecm / 3, aeL = 2e5 / Ec;
    const A = 300 * 500 + (aeL - 1) * As, yc = (300 * 500 * 250 + (aeL - 1) * As * d) / A;
    const I = 300 * 500 ** 3 / 12 + 300 * 500 * (250 - yc) ** 2 + (aeL - 1) * As * (d - yc) ** 2;
    expect(r.Mqp).toBeCloseTo(2 * 16 / 8, 6);
    expect(r.defl!.f / (5 * 2 * 4000 ** 4 / (384 * Ec * I))).toBeCloseTo(1, 2);
    const big = checkRc({ ...i, g: 30 });
    expect(big.defl!.f).toBeGreaterThan(15 * r.defl!.f);
  });

  it("защемлена балка: M⁻ = wL²/12 на верхній арматурі, M⁺ = wL²/24", () => {
    const r = checkRc(beam({ mode: "beam", L: 6, supports: "ff", g: 20, q: 10, top: [{ n: 3, d: 16 }] }));
    const w = 1.35 * (20 + 25 * 0.15) + 1.5 * 10;
    expect(r.MEdNeg).toBeCloseTo(w * 36 / 12, 6);
    expect(r.MEd).toBeCloseTo(w * 36 / 24, 6);
    expect(r.neg!.MRd).toBeGreaterThan(0);
    expect(r.neg!.MRd).toBeLessThan(r.pos.MRd);
  });

  it("центральний стиск ДБН: N_Rd = f_cd·A_c + ΣA_s·σ_s(ε_c1)", () => {
    const i = beam({ code: "DBN", concrete: "C20/25", rebar: "A400C", sw: { d: 8, legs: 2, s: 150, cls: "A240C" }, top: [{ n: 4, d: 20 }], M: 0, N: 1000, V: 0, Mqp: 0 });
    const r = checkRc(i);
    expect(r.pos.NRd).toBeCloseTo((14.5 * 300 * 500 + 2 * As * Math.min(400 / 1.1, 2e5 * 0.00165)) / 1000, 0);
  });

  it("підбір: недостатнє армування — підказує кількість стрижнів", () => {
    const r = checkRc(beam({ M: 300 }));
    expect(r.checks.find((c) => c.key === "rcM")!.util).toBeGreaterThan(1);
    expect(r.needBot!.n * r.needBot!.d ** 2).toBeGreaterThan(4 * 400);
    const ok = checkRc(beam({ M: 300, bot: [r.needBot!] }));
    expect(ok.checks.find((c) => c.key === "rcM")!.util).toBeLessThanOrEqual(1);
  });
});
