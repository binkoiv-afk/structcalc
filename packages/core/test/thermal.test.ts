import { describe, expect, it } from "vitest";
import { checkThermal, CLIMATES, dewPoint, psat } from "../src";
import type { ThermalInput } from "../src";

// стіна: штукатурка 20, цегла 510, мінвата 150, фасадна штукатурка 8 (зсередини назовні)
const wall = (o: Partial<ThermalInput> = {}): ThermalInput => ({
  code: "DBN", element: "wall", ti: 20, phii: 55, te: -22, zone: 1,
  layers: [{ mat: "limePlaster", d: 20 }, { mat: "claybrick", d: 510 }, { mat: "minwoolFacade", d: 150 }, { mat: "facadePlaster", d: 8 }], ...o,
});

describe("теплофізика", () => {
  it("тиск насичення і точка роси (ДСТУ EN ISO 13788, дод. E)", () => {
    expect(psat(20)).toBeCloseTo(2337, -1);
    expect(psat(0)).toBeCloseTo(610.5, 1);
    expect(psat(-10)).toBeCloseTo(259.4, 0);
    expect(dewPoint(0.55 * psat(20))).toBeCloseTo(10.7, 1);
    expect(dewPoint(psat(-7))).toBeCloseTo(-7, 6);
  });

  it("R_Σ = 1/8.7 + Σd/λ + 1/23, Δθ і θ_si — вручну", () => {
    const r = checkThermal(wall());
    const R = 1 / 8.7 + 0.02 / 0.81 + 0.51 / 0.81 + 0.15 / 0.041 + 0.008 / 0.7 + 1 / 23;
    expect(r.Rt).toBeCloseTo(R, 6);
    expect(r.dt).toBeCloseTo((42 / R) / 8.7, 6);
    expect(r.tsi).toBeCloseTo(20 - r.dt, 6);
    // R = 4.50 ≥ 4.0 — проходить, Δθ = 1.07 ≤ 4
    expect(r.checks.find((c) => c.key === "tR")!.util).toBeCloseTo(4 / R, 6);
    expect(r.checks.every((c) => c.util <= 1)).toBe(true);
    // температура на межі цегла/вата
    const R2 = 1 / 8.7 + 0.02 / 0.81 + 0.51 / 0.81;
    expect(r.layers[2].th1).toBeCloseTo(20 - (42 * R2) / R, 6);
  });

  it("EN ISO 6946: R_si = 0.13, R_se = 0.04; вентильований прошарок — зовнішні шари не враховуються, R_se = R_si", () => {
    const a = checkThermal(wall({ code: "EN", Umax: 0.28 }));
    expect(a.Rt).toBeCloseTo(0.13 + 0.02 / 0.81 + 0.51 / 0.81 + 0.15 / 0.041 + 0.008 / 0.7 + 0.04, 6);
    const v = checkThermal(wall({ code: "EN", layers: [{ mat: "claybrick", d: 380 }, { mat: "minwoolFacade", d: 100 }, { mat: "ventGap", d: 40 }, { mat: "aluminium", d: 2 }] }));
    expect(v.Rt).toBeCloseTo(0.13 + 0.38 / 0.81 + 0.1 / 0.041 + 0.13, 6);
    expect(v.endMa).toBe(0);
  });

  it("замкнений повітряний прошарок за табл. 8 EN ISO 6946", () => {
    const g = checkThermal(wall({ layers: [{ mat: "claybrick", d: 250 }, { mat: "airGap", d: 50 }, { mat: "claybrick", d: 120 }] }));
    expect(g.layers[1].R).toBeCloseTo(0.18, 6);
  });

  it("Глазер: потік у площину конденсації = δ0·(Δp/sd) зліва − справа (січень, Київ)", () => {
    // мінвата 100 мм під бітумною гідроізоляцією: конденсація на межі вата/бітум
    const i: ThermalInput = { code: "EN", element: "roof", ti: 20, phii: 55, te: -20, layers: [{ mat: "rc", d: 200 }, { mat: "minwoolRoof", d: 100 }, { mat: "bitumen", d: 4 }], climate: CLIMATES.kyiv };
    const r = checkThermal(i);
    expect(r.janPlanes.length).toBe(1);
    const te = -3.5, Rt = 0.1 + 0.2 / 2.04 + 0.1 / 0.042 + 0.004 / 0.17 + 0.04, Rc = 0.1 + 0.2 / 2.04 + 0.1 / 0.042;
    const thc = 20 - ((20 - te) * Rc) / Rt, pc = psat(thc);
    const pi = 0.55 * psat(20), pe = 0.84 * psat(te), sdi = 110 * 0.2 + 1 * 0.1, sde = 5e4 * 0.004;
    const g = 2e-10 * ((pi - pc) / sdi - (pc - pe) / sde) * 31 * 86400 * 1000;
    const k = r.janPlanes[0];
    expect(r.jan[k].th).toBeCloseTo(thc, 3);
    // у першому циклі (січень без накопичення) — перевіряємо через стан без попередньої вологи
    const one = checkThermal({ ...i, climate: CLIMATES.kyiv.map((c, m) => (m === 0 ? c : { te: 20, phie: 0 })) });
    expect(one.months[0].gc).toBeCloseTo(g, 0);
  });

  it("волога: без пароізоляції під сталевою обшивкою Δw вати багато разів перевищує допустиме; з пароізоляцією — немає конденсації", () => {
    const base: ThermalInput = { code: "DBN", element: "roof", ti: 20, phii: 55, te: -22, layers: [{ mat: "gypsumBoard", d: 12.5 }, { mat: "minwoolLight", d: 200 }, { mat: "steel", d: 0.7 }] };
    const a = checkThermal(base);
    expect(a.maxMa).toBeGreaterThan(100);
    expect(a.checks.find((c) => c.key === "tMoist")!.util).toBeGreaterThan(1);
    expect(a.layers[1].dw!).toBeGreaterThan(0);
    const b = checkThermal({ ...base, layers: [{ mat: "gypsumBoard", d: 12.5 }, { mat: "vaporBarrier", d: 0.2 }, { mat: "minwoolLight", d: 200 }, { mat: "steel", d: 0.7 }] });
    expect(b.maxMa).toBeLessThan(a.maxMa / 50);
  });

  it("стіна з газобетону без утеплення: конденсат за зиму висихає влітку", () => {
    const r = checkThermal({ code: "EN", element: "wall", ti: 20, phii: 55, te: -20, layers: [{ mat: "limePlaster", d: 15 }, { mat: "aerated400", d: 375 }, { mat: "facadePlaster", d: 10 }] });
    expect(r.endMa).toBe(0);
    expect(r.checks.find((c) => c.key === "tDry")!.util).toBe(0);
  });

  it("f_Rsi,min: φ_si = 80 % при 20 °C / 55 % → θ_si,min = 14.1 °C (EN ISO 13788, 5)", () => {
    const r = checkThermal(wall({ code: "EN", climate: CLIMATES.kyiv }));
    const thMin = dewPoint((0.55 * psat(20)) / 0.8);
    expect(thMin).toBeCloseTo(14.1, 1);
    expect(r.fRsiMin!).toBeCloseTo((thMin + 3.5) / 23.5, 6);
  });
});
