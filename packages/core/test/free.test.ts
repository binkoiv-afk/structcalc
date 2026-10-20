import { describe, expect, it } from "vitest";
import { checkFree, findSection } from "../src";
import type { FreeInput } from "../src";

// кронштейн: опорна плита (нормаль x), вертикальне ребро на двох швах, консольна пластина на 4 болтах; сила вниз на кінці
const base = (): FreeInput => ({
  code: "DBN",
  parts: [
    { id: "S", kind: "plate", axis: "x", a: 300, b: 400, t: 20, c: [-10, 0, 0], steel: "C245", role: "support" },
    { id: "R", kind: "plate", axis: "y", a: 200, b: 200, t: 12, c: [100, 0, 0], steel: "C245", role: "free" },
    { id: "L", kind: "plate", axis: "y", a: 380, b: 150, t: 10, c: [260, 11, 0], steel: "C245", role: "load" },
  ],
  conns: [
    { id: "W1", a: "S", b: "R", kind: "weld", n: "x", o: [0, 0, 0], kf: 6, segs: [{ u1: -6, v1: -100, u2: -6, v2: 100 }, { u1: 6, v1: -100, u2: 6, v2: 100 }] },
    { id: "B1", a: "R", b: "L", kind: "bolts", n: "y", o: [135, 6, 0], rows: 2, cols: 2, pu: 70, pv: 60, d: 16, cls: "5.6" },
  ],
  at: [420, 11, 0],
  combos: [{ name: "1", Fz: -20e3 }],
});

describe("вільний вузол", () => {
  it("ланцюжок: кожен зв'язок передає всю силу і момент від неї", () => {
    const r = checkFree(base());
    const w = r.combos[0].forces.find((x) => x.conn === "W1")!, b = r.combos[0].forces.find((x) => x.conn === "B1")!;
    // шов: нормаль x → (u, v) = (y, z); V_z = 20 кН, момент навколо y = F·(420 − 0)
    expect(Math.abs(w.Vv)).toBeCloseTo(20e3, 0);
    expect(Math.abs(w.Mu)).toBeCloseTo(20e3 * 420, -2);
    // болти: нормаль y → (u, v) = (z, x); зріз 20 кН по u, кручення групи = F·(420 − 135)
    expect(Math.abs(b.Vu)).toBeCloseTo(20e3, 0);
    expect(Math.abs(b.Mn)).toBeCloseTo(20e3 * 285, -2);
    expect(r.envelope.length).toBeGreaterThan(4);
    for (const c of r.envelope) expect(Number.isFinite(c.util)).toBe(true);
  });

  it("два однакові паралельні зв'язки ділять силу навпіл", () => {
    const i = base();
    i.conns.push({ ...i.conns[0], id: "W2", o: [0, 0, 0] });
    const r = checkFree(i);
    const w1 = r.combos[0].forces.find((x) => x.conn === "W1")!, w2 = r.combos[0].forces.find((x) => x.conn === "W2")!;
    expect(w1.Vv).toBeCloseTo(w2.Vv, 3);
    expect(Math.abs(w1.Vv)).toBeCloseTo(10e3, 0);
  });

  it("незакріплена деталь — механізм", () => {
    const i = base();
    i.conns = [i.conns[1]];
    expect(() => checkFree(i)).toThrow("free:mechanism");
  });

  it("профіль як деталь і креслення", () => {
    const i = base();
    i.parts[1] = { id: "R", kind: "profile", axis: "x", a: 200, b: 0, t: 0, c: [100, 0, 0], sec: findSection("RHS_COLD", "100×100×5")!, steel: "C245", role: "free" };
    const r = checkFree(i);
    expect(r.parts.some((p) => p.cls === "weld")).toBe(true);
    expect(r.parts.filter((p) => p.cls === "bolt").length).toBe(4);
  });

  // консольна пластина 300×100×10, приварена торцем, сила з площини на кінці: σ = 6·F·L/(b·t²) = 90 МПа
  const cant = (Fy: number, Fz: number): FreeInput => ({
    code: "EN",
    parts: [
      { id: "S", kind: "plate", axis: "x", a: 300, b: 300, t: 20, c: [-10, 0, 0], steel: "S235", role: "support" },
      { id: "L", kind: "plate", axis: "y", a: 300, b: 100, t: 10, c: [150, 0, 0], steel: "S235", role: "load" },
    ],
    conns: [{ id: "W", a: "S", b: "L", kind: "weld", n: "x", o: [0, 0, 0], kf: 5, segs: [{ u1: -5, v1: -50, u2: -5, v2: 50 }, { u1: 5, v1: -50, u2: 5, v2: 50 }] }],
    at: [300, 0, 0],
    combos: [{ name: "1", Fy, Fz }],
  });
  const sub = (r: ReturnType<typeof checkFree>, key: string) => r.envelope.find((c) => c.key === key)!;
  const sigOf = (x: string, k = "σ_ef") => Number(x.match(new RegExp(`${k} = ([-\\d.]+)`))![1]);

  it("переріз пластини біля шва і МСЕ — консоль із площини", () => {
    const r = checkFree(cant(500, 0));
    expect(sigOf(sub(r, "jFreeSec").subst)).toBeCloseTo(90, 0);
    // у першій точці Гаусса від опори — трохи менше за 90 (момент спадає, поперечна деформація)
    const fe = sub(r, "jFreePlate").util * 235;
    expect(fe).toBeGreaterThan(75);
    expect(fe).toBeLessThan(92);
  });

  it("переріз пластини біля шва — згин у площині: σ = 6·F·L/(t·b²)", () => {
    const r = checkFree(cant(0, 2000));
    expect(Number(sub(r, "jFreeSec").subst.match(/σ = ([\d.]+)/)![1])).toBeCloseTo(36, 0);
  });

  it("згин пластини між двома групами болтів — між балкою із защемленням і шарнірною", () => {
    // пластина 400×100×10 на двох парах болтів у прольоті 360, сила 2 кН посередині: шарнір 108 МПа, защемлення 54 МПа
    const r = checkFree({
      code: "EN",
      parts: [
        // опори — профілі (без контакту): чисто шарнірні опори для порівняння з балкою
        { id: "S1", kind: "profile", axis: "y", a: 100, b: 0, t: 0, c: [-180, 0, -30], sec: findSection("RHS_COLD", "60×60×4")!, steel: "S235", role: "support" },
        { id: "S2", kind: "profile", axis: "y", a: 100, b: 0, t: 0, c: [180, 0, -30], sec: findSection("RHS_COLD", "60×60×4")!, steel: "S235", role: "support" },
        { id: "L", kind: "plate", axis: "z", a: 400, b: 100, t: 10, c: [0, 0, 0], steel: "S235", role: "load" },
      ],
      conns: [
        { id: "B1", a: "S1", b: "L", kind: "bolts", n: "z", o: [-180, 0, 0], rows: 2, cols: 1, pv: 60, d: 12, cls: "8.8" },
        { id: "B2", a: "S2", b: "L", kind: "bolts", n: "z", o: [180, 0, 0], rows: 2, cols: 1, pv: 60, d: 12, cls: "8.8" },
      ],
      at: [0, 0, 5],
      combos: [{ name: "1", Fz: -2000 }],
    });
    // головки болтів затискають пластину — опори частково защемлені: між FL/8 (защемлення) і FL/4 (шарнір)
    const fe = sub(r, "jFreePlate").util * 235;
    expect(fe).toBeGreaterThan(0.7 * 54);
    expect(fe).toBeLessThan(115);
    // кожна група — половина сили
    for (const f of r.combos[0].forces) expect(Math.abs(f.N)).toBeCloseTo(1000, 0);
    const p = r.plates.find((x) => x.part === "L")!;
    expect(p.util.length).toBe(p.nu * p.nv);
    // біля опор напруження менші, ніж посередині
    const row = Math.floor(p.nv / 2) * p.nu;
    expect(p.util[row]).toBeLessThan(p.util[row + Math.floor(p.nu / 2)]);
  });

  it("переріз профілю біля шва: σ = M/W_y", () => {
    const i = cant(0, -2000);
    const sec = findSection("RHS_COLD", "100×100×5")!;
    i.parts[1] = { id: "L", kind: "profile", axis: "x", a: 300, b: 0, t: 0, c: [150, 0, 0], sec, steel: "S235", role: "load" };
    i.conns[0] = { ...i.conns[0], segs: [{ u1: -50, v1: -50, u2: 50, v2: -50 }, { u1: 50, v1: -50, u2: 50, v2: 50 }, { u1: 50, v1: 50, u2: -50, v2: 50 }, { u1: -50, v1: 50, u2: -50, v2: -50 }] };
    const r = checkFree(i);
    expect(Number(sub(r, "jFreeSec").subst.match(/σ = ([\d.]+)/)![1])).toBeCloseTo((2000 * 300) / sec.Wy, 0);
    expect(r.plates.length).toBe(0);
  });

  // Т-заглушка: фланець на двох болтах до опорної плити, відрив силою посередині
  const tstub = (t: number, Fz: number, Fx = 0, mu = 0): FreeInput => ({
    code: "EN", mu,
    parts: [
      { id: "S", kind: "plate", axis: "z", a: 300, b: 200, t: 20, c: [0, 0, -10], steel: "S235", role: "support" },
      { id: "L", kind: "plate", axis: "z", a: 200, b: 100, t, c: [0, 0, t / 2], steel: "S235", role: "load" },
    ],
    conns: [{ id: "B", a: "S", b: "L", kind: "bolts", n: "z", o: [0, 0, 0], rows: 1, cols: 2, pu: 120, d: 16, cls: "8.8" }],
    at: [0, 0, t],
    combos: [{ name: "1", Fz, Fx }],
  });

  it("контакт: підважування збільшує розтяг болтів, тим більше, чим тонший фланець", () => {
    const T = [8, 12, 20].map((t) => checkFree(tstub(t, 20e3)).combos[0].forces[0]);
    for (const f of T) {
      expect(f.N).toBeCloseTo(20e3, -1);
      // рівновага: 2·T ≈ F + сила контакту (болти не рівно, тому ≥)
      expect(f.Tmax!).toBeGreaterThan(10e3);
      expect(2 * f.Tmax!).toBeGreaterThanOrEqual(20e3 + f.Fc! - 1);
    }
    expect(T[0].Tmax!).toBeGreaterThan(T[1].Tmax!);
    expect(T[1].Tmax!).toBeGreaterThan(T[2].Tmax!);
    expect(T[0].Fc!).toBeGreaterThan(T[2].Fc!);
  });

  it("контакт: притискання — стиск іде в контакт, болти не стискаються", () => {
    const f = checkFree(tstub(12, -20e3)).combos[0].forces[0];
    expect(Math.abs(f.Fc! - 20e3)).toBeLessThan(1e3);
    expect(f.Tmax!).toBeLessThan(500);
  });

  it("тертя в контакті зменшує зріз болтів, без тертя зріз — весь на болтах", () => {
    const a = checkFree(tstub(12, -20e3, 3e3)).combos[0].forces[0], b = checkFree(tstub(12, -20e3, 3e3, 0.3)).combos[0].forces[0];
    expect(Math.abs(a.bolt!.Vu)).toBeCloseTo(3e3, -1);
    // μ·F_c = 6 кН > 3 кН — зсув повністю на терті
    expect(Math.abs(b.bolt!.Vu)).toBeLessThan(300);
    expect(Math.abs(b.Vu)).toBeCloseTo(3e3, -1);
  });
});
