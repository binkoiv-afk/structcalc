import { describe, expect, it } from "vitest";
import { familySections, FAMILIES, findSection, iAsymSection, iSection } from "../src";

const near = (v: number, ref: number, tol = 0.02) => expect(Math.abs(v / ref - 1)).toBeLessThan(tol);

describe("сортамент", () => {
  it("усі сімейства будуються без помилок", () => {
    for (const f of FAMILIES) for (const s of familySections(f.id)) { expect(s.A).toBeGreaterThan(0); expect(Number.isFinite(s.Iy)).toBe(true); }
  });
  it("UPN 200 за каталогом: A = 32.2 см², Iy = 1910 см⁴", () => {
    const s = findSection("UPN", "UPN 200")!;
    near(s.A / 100, 32.2, 0.04); near(s.Iy / 1e4, 1910, 0.04); // ухил полиць не враховано
  });
  it("кутик ГОСТ 8509 L100×10: A = 19.24 см², Ix = 179.5 см⁴", () => {
    const s = findSection("L_GOST8509", "L100×10")!;
    near(s.A / 100, 19.24); near(s.Iy / 1e4, 179.46);
  });
  it("20Б1 ГОСТ 26020: A ≈ 28.5 см², Ix ≈ 1943 см⁴", () => {
    const s = findSection("I_G26020_B", "20Б1")!;
    near(s.A / 100, 28.49, 0.03); near(s.Iy / 1e4, 1943, 0.03);
  });
  it("несиметричний двотавр: при однакових полицях = симетричний", () => {
    const a = iAsymSection("a", 400, 200, 12, 200, 12, 8, 0), b = iSection("b", 400, 200, 8, 12, 0, { fabrication: "welded" });
    near(a.A, b.A, 1e-6); near(a.Iy, b.Iy, 1e-6); near(a.Iz, b.Iz, 1e-6);
  });
  it("несиметричний двотавр: центр ваги зміщений до більшої полиці, W_min < W_max", () => {
    const s = iAsymSection("a", 400, 150, 10, 300, 20, 8, 6);
    // площі: 1500 + 6000 + 370·8 = 10460 (+ галтелі) мм²
    near(s.A, 1500 + 6000 + 370 * 8 + 4 * (1 - Math.PI / 4) * 36, 0.001);
    const ymax = Math.max(...s.loops.flatMap((l) => l.map((p) => p.y))), ymin = Math.min(...s.loops.flatMap((l) => l.map((p) => p.y)));
    expect(Math.abs(ymin)).toBeLessThan(ymax); // нижня полиця більша — центр ваги ближче до низу
    expect(s.approx).toBe("mono");
  });
});
