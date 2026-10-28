import { afterEach, describe, expect, it } from "vitest";
import { annex, ANNEXES, buildCombinations, checkRc, checkSlab, punchCheck, rcConcrete, setAnnex } from "../src";
import type { RcInput, SlabInput } from "../src";

afterEach(() => setAnnex("EU"));

// балка 300×500, 3Ø20 знизу, хомути Ø8/200; V = 250 кН (потрібні хомути)
const beam = (o: Partial<RcInput> = {}): RcInput => ({
  code: "EN", concrete: "C30/37", rebar: "B500B", b: 300, h: 500, c: 30, sw: { d: 8, legs: 2, s: 200, cls: "B500B" },
  bot: [{ n: 3, d: 20 }], top: [{ n: 2, d: 12 }], mode: "section", M: 100, V: 250, ...o,
});

describe("національні додатки EN", () => {
  it("усі країни мають повний набір параметрів; рекомендовані = EU", () => {
    for (const a of Object.values(ANNEXES)) {
      expect(a.e1990.gG).toBeGreaterThan(1);
      expect(a.e1993.gM0).toBeGreaterThan(0);
      expect(a.e1992.slabS(200).main).toBeGreaterThan(0);
    }
    for (const id of ["UA", "MD"] as const) {
      setAnnex(id);
      expect(rcConcrete("EN", "C30/37").fcd).toBeCloseTo(20, 9);
      expect(annex().e1992.beta).toEqual([1.15, 1.4, 1.5]);
    }
  });

  it("PN-EN: γ_c = 1.4, (6.10a) і (6.10b) з ξ = 0.85, cot θ ≤ 2.0", () => {
    setAnnex("PL");
    expect(rcConcrete("EN", "C30/37").fcd).toBeCloseTo(30 / 1.4, 9);
    const c = buildCombinations([{ cat: "G" }, { cat: "Q" }], { code: "EN", gammaG: 1.35, gammaQ: 1.5 }).filter((x) => x.kind === "ULS").map((x) => x.factors);
    expect(c).toContainEqual([1.35, 0.7 * 1.5]);
    expect(c.some((f) => Math.abs(f[0] - 0.85 * 1.35) < 1e-9 && f[1] === 1.5)).toBe(true);
    expect(checkRc(beam()).shear.cot).toBeLessThanOrEqual(2.0 + 1e-9);
  });

  it("DIN EN: α_cc = 0.85; C_Rd,c = 0.15/γ_c, v_min з κ1 за d, k1 = 0.12; ν1 = 0.75·ν2; cot θ (6.7aDE); ρ_w,min = 0.16·f_ctm/f_yk", () => {
    setAnnex("DE");
    const conc = rcConcrete("EN", "C30/37");
    expect(conc.fcd).toBeCloseTo((0.85 * 30) / 1.5, 9);
    const v = annex().e1992.vRdc;
    // d = 450: κ1 = 0.0525; d = 700: 0.045; d = 900: 0.0375
    expect(v({ k: 1.5, rho: 0, fck: 30, d: 450, sigCp: 0, member: "beam" })).toBeCloseTo((0.0525 / 1.5) * 1.5 ** 1.5 * Math.sqrt(30), 9);
    expect(v({ k: 1.5, rho: 0, fck: 30, d: 700, sigCp: 0, member: "beam" })).toBeCloseTo((0.045 / 1.5) * 1.5 ** 1.5 * Math.sqrt(30), 9);
    expect(v({ k: 1.5, rho: 0, fck: 30, d: 900, sigCp: 0, member: "beam" })).toBeCloseTo((0.0375 / 1.5) * 1.5 ** 1.5 * Math.sqrt(30), 9);
    expect(v({ k: 1.6, rho: 0.01, fck: 30, d: 450, sigCp: 1, member: "beam" })).toBeCloseTo(0.1 * 1.6 * 30 ** (1 / 3) + 0.12, 9);
    // продавлювання середньої колони: 0.18/γc·(0.1·u0/d + 0.6) при u0/d < 4
    expect(v({ k: 1.6, rho: 0.01, fck: 30, d: 450, sigCp: 0, member: "punch", u0d: 3 })).toBeCloseTo(0.12 * 0.9 * 1.6 * 30 ** (1 / 3), 9);
    expect(annex().e1992.nu1(30)).toBeCloseTo(0.75, 9);
    expect(annex().e1992.nu1(60)).toBeCloseTo(0.75 * (1.1 - 60 / 500), 9);
    const r = checkRc(beam());
    const z = 0.9 * r.d, VRdcc = 0.5 * 0.48 * 30 ** (1 / 3) * 300 * z;
    expect(r.shear.cot).toBeLessThanOrEqual(Math.min(3, 1.2 / (1 - VRdcc / 250e3)) + 0.011);
    expect(r.shear.rhoWmin).toBeCloseTo((0.16 * conc.fctm) / 500, 12);
    // продавлювання: β середньої 1.10; перевірка біля колони 1.4·v_Rd,c
    const p = punchCheck({ code: "EN", conc, geom: { shape: "rect", cx: 400, cy: 400, edgeX: null, edgeY: null }, V: 600e3, ex: 0, ey: 0, d: 200, rho: 0.008, h: 240, approx: true, rebar: "B500B" });
    expect(p.beta).toBe(1.1);
    expect(p.maxMode).toBe("u1x1.4");
    expect(p.vRdMax).toBeCloseTo(1.4 * p.vRdc, 12);
  });

  it("NF EN: v_min = 0.34/γ_c·√f_ck для смуги плити, 0.053/γ_c·k^1.5·√f_ck для балки", () => {
    setAnnex("FR");
    const v = annex().e1992.vRdc;
    expect(v({ k: 2, rho: 0, fck: 25, d: 150, sigCp: 0, member: "slab" })).toBeCloseTo((0.34 / 1.5) * 5, 9);
    expect(v({ k: 2, rho: 0, fck: 25, d: 150, sigCp: 0, member: "beam" })).toBeCloseTo((0.053 / 1.5) * 2 ** 1.5 * 5, 9);
  });

  it("SR EN: крок стрижнів плит 2h ≤ 250 / 3h ≤ 350", () => {
    setAnnex("RO");
    const i: SlabInput = { code: "EN", concrete: "C25/30", rebar: "B500B", lx: 4, ly: 6, h: 160, c: 20, edges: { x0: "pin", x1: "pin", y0: "pin", y1: "pin" },
      g: 1, q: 2, botX: { d: 10, s: 300 }, botY: { d: 8, s: 300 }, topX: { d: 8, s: 200 }, topY: { d: 8, s: 200 } };
    const s = checkSlab(i).checks.filter((c) => c.key === "slSmain");
    expect(s[0].util).toBeCloseTo(300 / 250, 9);
  });
});
