import { describe, expect, it } from "vitest";
import { phiE, etaDBN, cDBN, checkMemberDBN, findSection } from "../src";

describe("ДБН В.2.6-198, розд. 10 — позацентровий стиск", () => {
  it("табл. Ж.3: вузлові значення та інтерполяція", () => {
    expect(phiE(2.0, 1.0)).toBeCloseTo(0.536, 6);
    expect(phiE(0.5, 0.1)).toBeCloseTo(0.967, 6);
    expect(phiE(14, 20)).toBeCloseTo(0.026, 6);
    expect(phiE(10, 10)).toBeCloseTo(0.049, 6);
    expect(phiE(2.25, 1.0)).toBeCloseTo((0.536 + 0.480) / 2, 6);
    expect(phiE(3.0, 3.25)).toBeCloseTo((0.260 + 0.238) / 2, 6);
  });
  it("табл. Ж.2, тип 5", () => {
    const s = findSection("IPE", "IPE 300")!;
    const { eta, type } = etaDBN(s, 1, 2);
    expect(type).toBe(5);
    const r = (s.b * s.dims.tf) / ((s.h - 2 * s.dims.tf) * s.dims.tw);
    expect(r).toBeGreaterThan(0.5); expect(r).toBeLessThan(1);
    const e05 = 1.75 - 0.1 - 0.02 * 4 * 2, e1 = 1.9 - 0.1 - 0.02 * 5 * 2;
    expect(eta).toBeCloseTo(e05 + (e1 - e05) * (r - 0.5) / 0.5, 6);
  });
  it("коефіцієнт c (10.9)–(10.11)", () => {
    expect(cDBN(1, 0.8, 0.5, 2, 0.9).c).toBeCloseTo(1 / 1.7, 6);
    expect(cDBN(10, 0.5, 0.3, 2, 0.8).c).toBeCloseTo(1 / (1 + 10 * 0.5 / 0.8), 6);
    const c7 = cDBN(7, 0.5, 0.3, 2, 0.8).c;
    const c5 = 1 / (1 + 0.9 * 5), c10 = 1 / (1 + 10 * 0.5 / 0.8);
    expect(c7).toBeCloseTo(c5 * (2 - 1.4) + c10 * (1.4 - 1), 6);
  });
  it("колона IPE 300: перевірки 10.6 і 10.8 присутні", () => {
    const s = findSection("IPE", "IPE 300")!;
    const r = checkMemberDBN({ code: "DBN", section: s, steel: "C245", NEd: 300e3, MEd: 30e6, buckling: { Lcr_y: 6000, Lcr_z: 3000 } });
    const inP = r.checks.find((c) => c.key === "stabilityInPlane")!;
    const outP = r.checks.find((c) => c.key === "stabilityOutPlane")!;
    expect(inP.util).toBeGreaterThan(0.2); expect(inP.util).toBeLessThan(1);
    expect(outP.util).toBeGreaterThan(inP.util * 0.5);
    expect(Number.isFinite(outP.util)).toBe(true);
  });
});

describe("Місцева стійкість (п. 8.3, 9.5)", () => {
  it("балка IPE 300 і колона HEB 200: перевірки стінки і полиці", () => {
    const ipe = findSection("IPE", "IPE 300")!;
    const b = checkMemberDBN({ code: "DBN", section: ipe, steel: "C245", MEd: 100e6 });
    const w = b.checks.find((c) => c.key === "localWeb")!;
    expect(w.util).toBeCloseTo(((300 - 2 * 10.7 - 30) / 7.1) * Math.sqrt((245 / 1.025) / 206000) / 3.5, 6);
    expect(b.checks.find((c) => c.key === "localFlange")!.util).toBeLessThan(1);
    const heb = findSection("HEB", "HEB 200")!;
    const c = checkMemberDBN({ code: "DBN", section: heb, steel: "C245", NEd: 800e3, buckling: { Lcr_y: 4000, Lcr_z: 4000 } });
    expect(c.checks.some((x) => x.key === "localWeb")).toBe(true);
    expect(c.checks.find((x) => x.key === "localFlange")!.util).toBeLessThan(1);
  });
});
