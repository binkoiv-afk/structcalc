import { describe, expect, it } from "vitest";
import { climateEN, skZone, vb0Zone, windNational, windEN } from "../src";

describe("сніг і вітер за національними додатками", () => {
  it("Німеччина: s_k за зоною і висотою, змішаний профіль q_p", () => {
    const de = climateEN("DE")!;
    expect(skZone(de, "2", 300)).toBeCloseTo(0.89, 2);
    expect(skZone(de, "2", 0)).toBe(0.85); // мінімум
    expect(skZone(de, "1a", 0)).toBeCloseTo(0.81, 2);
    expect(vb0Zone(de, "2", 0)).toBe(25);
    const w = windNational(de, { vb: 25, z: 10, terrain: "DE-B", cpe: 1 });
    expect(w.qp).toBeCloseTo(1.7 * 0.625 * 625, 1);
    expect(windNational(de, { vb: 25, z: 5, terrain: "DE-B", cpe: 1 }).qp).toBeCloseTo(1.5 * 390.625, 1);
  });
  it("Франція: Δs1 за висотою, категорія IIIa", () => {
    const fr = climateEN("FR")!;
    expect(skZone(fr, "B1", 150)).toBe(0.55);
    expect(skZone(fr, "B1", 600)).toBeCloseTo(1.0, 2);
    expect(skZone(fr, "E", 1200)).toBeCloseTo(1.4 + 8.4 - 4.8, 2);
    const w = windNational(fr, { vb: 24, z: 10, terrain: "IIIa", cpe: 1 });
    const kr = 0.19 * (0.2 / 0.05) ** 0.07, cr = kr * Math.log(10 / 0.2), Iv = 1 / Math.log(10 / 0.2);
    expect(w.qp).toBeCloseTo((1 + 7 * Iv) * 0.625 * (cr * 24) ** 2, 3);
  });
  it("Польща: зона 5 (Закопане ≈ 3.11 кН/м² на 900 м); без країни — EN", () => {
    const pl = climateEN("PL")!;
    expect(skZone(pl, "5", 900)).toBeCloseTo(3.11, 2);
    expect(skZone(pl, "1", 100)).toBe(0.7);
    const a = windNational(undefined, { vb: 25, z: 10, terrain: "II", cpe: 0.8 });
    expect(a.w).toBeCloseTo(windEN({ vb: 25, z: 10, terrain: "II", cpe: 0.8 }).w, 6);
  });
});
