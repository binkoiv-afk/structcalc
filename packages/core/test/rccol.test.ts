import { describe, expect, it } from "vitest";
import { checkRc, checkRcColumn, rcConcrete, rcUls } from "../src";
import type { RcColInput, RcInput } from "../src";

// колона 400×400, 8Ø20 (кутові + по одному посередині кожної грані), хомути Ø8/250, захисний шар 30
const col = (o: Partial<RcColInput> = {}): RcColInput => ({
  code: "EN", concrete: "C30/37", rebar: "B500B", b: 400, h: 400, c: 30, bars: { d: 20, nb: 1, nh: 1 }, tie: { d: 8, s: 250, cls: "B500B" }, tieAll: true,
  L: 4, mux: 1, muy: 1, N: 2000, Mx1: 0, Mx2: 80, My1: 0, My2: 0, phi: 2, qp: 0.7, ...o,
});
const As8 = 8 * Math.PI * 100;

describe("залізобетонна колона", () => {
  it("центральний стиск і розтяг: N_Rd = f_cd·(A_c − A_s) + σ_s(ε_c2)·A_s; N_t = −f_yd·A_s", () => {
    const r = checkRcColumn(col());
    const Nmax = Math.max(...r.diag.x.map((p) => p.N)), Nmin = Math.min(...r.diag.x.map((p) => p.N));
    expect(Nmax / ((20 * (160000 - As8) + 400 * As8) / 1000)).toBeCloseTo(1, 3);
    expect(Nmin / ((-500 / 1.15) * As8 / 1000)).toBeCloseTo(1, 3);
    // кожен промінь дає точку (злам діаграми бетону при ε = 0 не зупиняє Ньютона)
    expect(r.diag.x.length).toBe(49);
    expect(r.diag.x.slice(1, -1).every((p) => p.M > 0)).toBe(true);
    // ДБН: ε_c1 = 1.69 ‰ → σ_s = 338 MPa
    const d = checkRcColumn(col({ code: "DBN", concrete: "C25/30", rebar: "A500C" }));
    expect(Math.max(...d.diag.x.map((p) => p.N)) / ((17 * (160000 - As8) + 0.00169 * 200000 * As8) / 1000)).toBeCloseTo(1, 3);
  });

  it("чистий згин збігається з модулем балки (той самий переріз 3Ø20 + 3Ø20)", () => {
    const r = checkRcColumn(col({ bars: { d: 20, nb: 1, nh: 0 } }));
    const bi: RcInput = { code: "EN", concrete: "C30/37", rebar: "B500B", b: 400, h: 400, c: 30, sw: { d: 8, legs: 2, s: 250, cls: "B500B" },
      bot: [{ n: 3, d: 20 }], top: [{ n: 3, d: 20 }], mode: "section", M: 1, V: 0, Mqp: 0 };
    const beam = rcUls(bi, rcConcrete("EN", "C30/37"), 0, false).MRd;
    const m0 = r.diag.x.find((p) => Math.abs(p.N) < 1e-6)!.M;
    expect(Math.abs(m0 / beam - 1)).toBeLessThan(0.02);
    expect(checkRc(bi).pos.MRd).toBeCloseTo(beam, 6);
  });

  it("косий згин квадратного перерізу (N = 0): показник a у (M_x/M_Rd)^a + (M_y/M_Rd)^a = 1 між 1 і 2 (EN 5.8.9 (5.39))", () => {
    const b = checkRcColumn(col({ N: 0, Mx1: 100, My1: 100, Mx2: 0, My2: 0 }));
    const u = checkRcColumn(col({ N: 0, Mx1: 100, My1: 0, Mx2: 0, My2: 0 }));
    const m = b.ends[0].lam * 100, mu = u.ends[0].lam * 100;
    const a = Math.log(0.5) / Math.log(m / mu);
    expect(a).toBeGreaterThanOrEqual(1);
    expect(a).toBeLessThanOrEqual(2);
  });

  it("гнучкість (6.7), (6.8), неточність (6.2), φ_ef (6.15) — вручну", () => {
    const r = checkRcColumn(col());
    const n = 2e6 / (160000 * 20), om = (As8 * 500 / 1.15) / (160000 * 20), phiEf = 2 * 0.7;
    expect(r.phiEf).toBeCloseTo(phiEf, 9);
    expect(r.ax.x.lam).toBeCloseTo(4000 / (400 / Math.sqrt(12)), 9);
    // M01 = 0 → r_m = 0, C = 1.7
    expect(r.ax.x.lamLim).toBeCloseTo((20 * (1 / (1 + 0.2 * phiEf)) * Math.sqrt(1 + 2 * om) * 1.7) / Math.sqrt(n), 9);
    // l = 4 м: α_h = 2/√4 = 1 → e_i = l0/400; l = 9 м: α_h = 2/3
    expect(r.ei.x).toBeCloseTo(10, 9);
    expect(checkRcColumn(col({ L: 9 })).ei.x).toBeCloseTo((2 / 3) * 9000 / 400, 9);
    // M0e = max(0.6·80 + 0.4·0; 0.4·80) = 48; подвійна кривина M01 = −40: max(48 − 16; 32) = 32
    expect(r.ax.x.M0e).toBeCloseTo(48, 9);
    expect(checkRcColumn(col({ Mx1: -40 })).ax.x.M0e).toBeCloseTo(32, 9);
    // 6.4.3: φ ≤ 2, λ ≤ 75, M0Eqp/N ≥ h → φ_ef = 0
    const c0 = checkRcColumn(col({ N: 100, Mx2: 150, My2: 150 }));
    expect(c0.creepIgnored).toBe(true);
    expect(c0.phiEf).toBe(0);
  });

  it("загальний метод: M при λ = 1 = M0 + N·u; між першим порядком і номінальною кривизною", () => {
    const r = checkRcColumn(col({ L: 6 }));
    const g = r.cases.find((c) => c.imp === "x")!;
    expect(g.M.x).toBeCloseTo(48 + 2000 * (r.ei.x + g.u.y) / 1000, 6);
    expect(g.u.y).toBeGreaterThan(0);
    expect(g.M.x).toBeLessThan(r.ax.x.MEdNc);
    // більша довжина — менший запас
    expect(checkRcColumn(col({ L: 8 })).gov.lamU).toBeLessThan(r.gov.lamU);
    // без повзучості — більший запас
    expect(checkRcColumn(col({ L: 6, phi: 0 })).gov.lamU).toBeGreaterThan(r.gov.lamU);
  });

  it("конструювання колони (8.5) — вручну", () => {
    const r = checkRcColumn(col({ tieAll: false, tie: { d: 6, s: 300, cls: "B500B" } }));
    const k = (key: string) => r.checks.find((c) => c.key === key)!;
    expect(k("colAsMin").util).toBeCloseTo(Math.max(0.1 * 2e6 / (500 / 1.15), 320) / As8, 9);
    expect(k("colAsMax").util).toBeCloseTo(As8 / 6400, 9);
    expect(k("colTieD").util).toBeCloseTo(6 / 6, 9);
    expect(k("colTieS").util).toBeCloseTo(300 / 400, 9);
    // середній стрижень грані: (400 − 2·(30 + 6 + 10))/2 = 154 мм від кутового
    expect(k("colTieFar").util).toBeCloseTo(154 / 150, 9);
    expect(r.checks.find((c) => c.key === "colTieFar" && c.ok)).toBeUndefined();
  });
});
