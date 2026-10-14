import { describe, expect, it } from "vitest";
import { checkBasePlate, platePanels } from "../src";
import type { BasePlateInput } from "../src";

const base = (o: Partial<BasePlateInput> = {}): BasePlateInput => ({
  code: "DBN", kind: "base",
  profile: { kind: "I", h: 200, b: 200, tw: 6.5, tf: 10 }, profileSteel: "C245",
  plate: { L: 400, B: 300, t: 20, steel: "C245" },
  ribs: { on: false, hr: 150, tr: 10 },
  weld: { kf: 6, process: "manual", milled: false },
  anchors: { type: "headed", d: 20, steel: "09Г2С", hef: 400, nx: 1, ny: 2, sx: 0, sy: 120 },
  concrete: { fck: 20, cracked: true, Lc: 800, Bc: 700, h: 600, grout: 0 },
  friction: true, combos: [{ name: "1", N: 500e3 }], ...o,
});

describe("опорна плита", () => {
  it("рівномірний відпір, консоль 100 мм", () => {
    const r = checkBasePlate(base());
    const c = r.combos[0];
    expect(c.sigC).toBeCloseTo(500e3 / (400 * 300), 1);
    const pb = c.checks.find((x) => x.key === "nodePlateBend")!;
    // M = 0.5·4.167·100² = 20833 Н·мм/мм; σ = 6M/t² = 312.5 МПа; Ry(C245, лист 20) = 235/1.025
    expect(pb.util).toBeCloseTo(312.5 / (235 / 1.025), 1);
    const br = c.checks.find((x) => x.key === "nodeBearing")!;
    const fjd = (2 / 3) * Math.sqrt((800 * 700) / (400 * 300)) * (20 / 1.5);
    expect(br.util).toBeCloseTo(4.1667 / fjd, 2);
  });
  it("ребра зменшують момент у плиті", () => {
    const a = checkBasePlate(base()).combos[0].checks.find((x) => x.key === "nodePlateBend")!.util;
    const b = checkBasePlate(base({ ribs: { on: true, hr: 150, tr: 10 } })).combos[0].checks.find((x) => x.key === "nodePlateBend")!.util;
    expect(b).toBeLessThan(a);
  });
  it("ділянка між полицями — β за Галеркіним", () => {
    const p = platePanels({ kind: "I", h: 200, b: 200, tw: 6.5, tf: 10 }, 200, 200, { on: false, hr: 0, tr: 0 }, 1);
    expect(p[0].coef).toBeCloseTo(0.06 + 0.014 * ((96.75 / 180 - 0.5) / 0.1), 4);
  });
  it("кронштейн: момент дає розтяг верхніх анкерів", () => {
    const r = checkBasePlate(base({
      kind: "bracket", lever: 500, profile: { kind: "RHS", h: 150, b: 100, tw: 5, tf: 5, A: 2336, Wy: 89000, Wz: 68000 },
      anchors: { type: "bonded", d: 16, steel: "5.8", hef: 125, nx: 2, ny: 2, sx: 220, sy: 100 },
      concrete: { fck: 25, cracked: true, Lc: Infinity, Bc: Infinity, h: 250, grout: 0 },
      plate: { L: 300, B: 200, t: 16, steel: "C245" }, combos: [{ name: "1", P: 10e3 }, { name: "2", P: 4e3, H: 3e3 }],
    }));
    const c = r.combos[0];
    expect(c.Ms).toBe(5e6);
    const top = c.forces.filter((a) => a.x > 0).reduce((s, a) => s + a.N, 0);
    expect(top).toBeGreaterThan(0);
    expect(c.forces.filter((a) => a.x < 0).every((a) => a.N < top)).toBe(true);
    expect(r.envelope.find((x) => x.key === "nodeRootNormal")!.combo).toBe("1");
    expect(r.combos[0].checks.find((x) => x.key === "nodeRootNormal")!.util).toBeCloseTo(5e6 / 89000 / (245 / 1.025), 2);
  });
});
