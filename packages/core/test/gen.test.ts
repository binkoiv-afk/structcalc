import { describe, it, expect } from "vitest";
import { shapeProps, setCustomMaterials, setCustomSections, steelsFor, familySections } from "../src";

describe("генератор перерізів", () => {
  it("прямокутник 100×200", () => {
    const p = shapeProps("rect", { h: 200, b: 100 });
    expect(p.A).toBeCloseTo(20000, 6);
    expect(p.Iy).toBeCloseTo((100 * 200 ** 3) / 12, 0);
    expect(p.Wply).toBeCloseTo((100 * 200 ** 2) / 4, 0);
    expect(p.mass).toBeCloseTo(157, 3);
    expect(p.Sy).toBeCloseTo(100 * 100 * 50, 0);
  });
  it("труба 108×4: A = π(54² − 50²)", () => {
    const p = shapeProps("chs", { d: 108, t: 4 });
    expect(p.A / (Math.PI * (54 ** 2 - 50 ** 2))).toBeCloseTo(1, 3);
    expect(p.Iy / ((Math.PI / 4) * (54 ** 4 - 50 ** 4))).toBeCloseTo(1, 3);
  });
  it("несиметричний двотавр: центр ваги", () => {
    const d = { h: 500, b1: 200, tf1: 12, b2: 300, tf2: 16, tw: 8 };
    const p = shapeProps("iAsym", d);
    const A1 = 200 * 12, A2 = 300 * 16, Aw = (500 - 28) * 8;
    const zc = (A1 * (500 - 6) + A2 * 8 + Aw * (16 + 472 / 2)) / (A1 + A2 + Aw);
    expect(p.zc).toBeCloseTo(zc, 6);
    expect(p.yc).toBeCloseTo(150, 6);
  });
  it("рівнополичний кутик: головна вісь під 45°", () => {
    const p = shapeProps("angle", { h: 100, b: 100, t: 10 });
    expect(Math.abs(p.alpha)).toBeCloseTo(Math.PI / 4, 6);
    expect(p.I1 + p.I2).toBeCloseTo(p.Iy + p.Iz, 0);
  });
  it("C з відгином: площа = L·t", () => {
    const p = shapeProps("cLip", { h: 200, b: 70, c: 20, t: 2 });
    const L = 198 + 2 * 68 + 2 * 19;
    expect(p.A).toBeCloseTo(L * 2, 6);
  });
});

describe("свої матеріали і перерізи", () => {
  it("матеріал з'являється в обох нормах", () => {
    setCustomMaterials([{ id: "AW-6063 T6", E: 70000, fy: 160, fu: 195, gammaM: 1.1 }]);
    const d = steelsFor("DBN").find((x) => x.id === "AW-6063 T6")!;
    expect(d.strength(5)).toBeCloseTo(160 / 1.1, 6);
    expect(steelsFor("EN").find((x) => x.id === "AW-6063 T6")!.strength(5)).toBe(160);
    setCustomMaterials([]);
    expect(steelsFor("DBN").some((x) => x.custom)).toBe(false);
  });
  it("переріз з'являється в сімействі CUSTOM", () => {
    setCustomSections([{ name: "Б1", type: "weldedI", h: 600, b: 250, tw: 10, tf: 16 }]);
    expect(familySections("CUSTOM")[0].name).toBe("Б1");
    setCustomSections([{ name: "Б2", type: "rhs", h: 200, b: 100, tw: 0, tf: 0, t: 6 }]);
    expect(familySections("CUSTOM")[0].name).toBe("Б2");
  });
});
