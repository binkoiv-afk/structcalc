import { describe, expect, it } from "vitest";
import { checkBasePlate, comboToPlate, jointCompat, pairRisk, stackEffect } from "../src";
import type { BasePlateInput } from "../src";

const base = (o: Partial<BasePlateInput> = {}): BasePlateInput => ({
  code: "DBN", kind: "base",
  profile: { kind: "I", h: 200, b: 200, tw: 6.5, tf: 10 }, profileSteel: "C245",
  plate: { L: 400, B: 300, t: 20, steel: "C245" },
  ribs: { on: false, hr: 150, tr: 10 },
  weld: { kf: 6, process: "manual", milled: false },
  anchors: { type: "headed", d: 20, steel: "09Г2С", hef: 400, nx: 1, ny: 2, sx: 0, sy: 120 },
  concrete: { fck: 20, cracked: true, Lc: 800, Bc: 700, h: 600, grout: 0 },
  friction: true, combos: [{ name: "1", N: 200e3, Vz: 30e3 }], ...o,
});
const bracket = (o: Partial<BasePlateInput> = {}) => base({
  kind: "bracket", lever: 500, profile: { kind: "RHS", h: 150, b: 100, tw: 5, tf: 5, A: 2336, Wy: 89000, Wz: 68000 },
  anchors: { type: "bonded", d: 16, steel: "5.8", hef: 125, nx: 2, ny: 2, sx: 220, sy: 100, tauRk: 7 },
  concrete: { fck: 25, cracked: true, Lc: Infinity, Bc: Infinity, h: 250, grout: 0 }, friction: false, combos: [{ name: "1", P: 5e3 }], ...o,
});
const chk = (r: ReturnType<typeof checkBasePlate>, key: string) => r.combos[0].checks.filter((x) => x.key === key);

describe("пакет і сумісність матеріалів", () => {
  it("гальванічні пари за середовищем", () => {
    expect(pairRisk("aluminium", "stainless", "dry")).toBe(0);
    expect(pairRisk("aluminium", "stainless", "outdoor")).toBe(1);
    expect(pairRisk("galv", "aluminium", "outdoor")).toBe(0);
    expect(pairRisk("carbon", "carbon", "aggressive")).toBe(0);
  });
  it("малий анод: оцинкований анкер у нержавійній плиті — недопустимо, нержавійний в алюмінієвій — допустимо", () => {
    const c = { env: "outdoor" as const, profile: "stainless" as const, plate: "stainless" as const, welded: true, stack: [], base: "concrete" as const };
    expect(jointCompat({ ...c, anchors: "galv" }).some((n) => n.key === "galvanic" && n.level === "bad")).toBe(true);
    const al = { ...c, profile: "aluminium" as const, plate: "aluminium" as const, anchors: "stainless" as const };
    expect(jointCompat(al).some((n) => n.key === "galvanic")).toBe(false);
    expect(jointCompat({ ...al, anchorsIsolated: true }).some((n) => n.key === "galvanic")).toBe(false);
  });
  it("алюмінієвий профіль не приварюється до сталевої плити", () => {
    const n = jointCompat({ env: "dry", profile: "aluminium", plate: "carbon", anchors: "carbon", welded: true, stack: [], base: "concrete" });
    expect(n.find((x) => x.key === "weldAlSteel")?.level).toBe("bad");
  });
  it("алюміній на бетоні — потрібна ізоляція; прокладка EPDM її дає", () => {
    const c = { env: "outdoor" as const, profile: "aluminium" as const, plate: "aluminium" as const, anchors: "stainless" as const, welded: true, base: "concrete" as const };
    expect(jointCompat({ ...c, stack: [] }).some((n) => n.key === "alAlkaline")).toBe(true);
    expect(jointCompat({ ...c, stack: [{ mat: "epdm", t: 5 }] }).some((n) => n.key === "alAlkaline")).toBe(false);
  });
  it("піддатливий шар: плече зсуву через пакет, α_M = 1, без тертя", () => {
    const e = stackEffect([{ mat: "epdm", t: 6 }, { mat: "grout", t: 30 }], 20);
    expect(e.standoff).toBe(36); expect(e.alphaM).toBe(1); expect(e.frictionOk).toBe(false);
    const g = stackEffect([{ mat: "grout", t: 8 }], 20);
    expect(g.standoff).toBe(0); expect(g.alphaM).toBe(2);
  });
  it("прокладка EPDM погіршує анкери і перевіряється на зминання", () => {
    const a = checkBasePlate(base());
    const b = checkBasePlate(base({ stack: [{ mat: "epdm", t: 6 }] }));
    expect(b.maxUtil).toBeGreaterThan(a.maxUtil);
    const lb = chk(b, "nodeLayerBearing")[0];
    expect(lb.util).toBeCloseTo(b.combos[0].sigC / 3, 3);
    // менша прокладка — більший тиск
    const c = checkBasePlate(base({ stack: [{ mat: "epdm", t: 6, L: 200, B: 300 }] }));
    expect(chk(c, "nodeLayerBearing")[0].util).toBeCloseTo(2 * lb.util, 3);
  });
  it("утеплювач під плитою — не несучий", () => {
    const r = checkBasePlate(base({ stack: [{ mat: "mineralWool", t: 50 }], compat: { env: "dry", profile: "carbon", plate: "carbon", anchors: "carbon" } }));
    expect(chk(r, "nodeLayerBearing")[0].ok).toBe(false);
    expect(r.compat.some((n) => n.key === "insulationBearing")).toBe(true);
  });
  it("зміщена колона: N дає момент на плиті", () => {
    const i = base({ offset: { x: 50, y: 0 }, combos: [{ name: "1", N: 100e3, Vy: 10e3 }] });
    const z = comboToPlate(i, i.combos[0]);
    expect(z.Ms).toBeCloseTo(-100e3 * 50, 0);
    expect(z.T).toBeCloseTo(50 * 10e3, 0);
  });
  it("кронштейн: бічне зміщення сили дає кручення анкерів і кореня", () => {
    const a = checkBasePlate(bracket());
    const b = checkBasePlate(bracket({ loadPoint: { x: 0, y: 150 } }));
    expect(b.combos[0].T).toBeCloseTo(150 * 5e3, 0);
    const va = Math.max(...a.combos[0].forces.map((q) => q.V)), vb = Math.max(...b.combos[0].forces.map((q) => q.V));
    expect(vb).toBeGreaterThan(va);
    expect(chk(b, "nodeRootReduced")[0].util).toBeGreaterThan(chk(a, "nodeRootReduced")[0].util);
  });
  it("зрізані кути плити зменшують l_eff Т-елемента", () => {
    const i = { combos: [{ name: "1", N: -60e3 }], anchors: { type: "headed" as const, d: 20, steel: "09Г2С", hef: 400, nx: 2, ny: 2, sx: 320, sy: 260 } };
    const a = chk(checkBasePlate(base(i)), "nodePlateTension")[0].util;
    const b = chk(checkBasePlate(base({ ...i, plate: { L: 400, B: 300, t: 20, steel: "C245", chamfer: 60 } })), "nodePlateTension")[0].util;
    expect(b).toBeGreaterThan(a);
  });
});
