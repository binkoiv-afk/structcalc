import { describe, it, expect } from "vitest";
import { checkBolts, checkFillet, weldShape, checkButt, checkAnchors, anchorTension, AnchorInput } from "../src";

const util = (r: { checks: { key: string; util: number }[] }, k: string) => r.checks.find((c) => c.key === k)!.util;

describe("болти ДБН", () => {
  it("зріз одного болта М20 5.6: Nbs = 210·314.16 = 65.97 кН", () => {
    const r = checkBolts({ code: "DBN", kind: "bearing", d: 20, boltClass: "5.6", shearPlanes: 1, tmin: 20, Ryn: 245, Run: 370,
      group: { rows: 1, cols: 1, px: 0, py: 0 }, a: 50, Fx: 50000, Fy: 0, M: 0, T: 0 });
    expect(util(r, "boltShear")).toBeCloseTo(50000 / (210 * Math.PI * 100), 3);
  });
});

describe("кутові шви ДБН", () => {
  it("два флангові шви 100 мм, kf 6, ручне: τf = 100000/(2·88·0.7·6)", () => {
    const r = checkFillet({ code: "DBN", segs: weldShape("flank2", { b: 100, h: 80 }), kf: 6, process: "manual", Run: 370, Ryn: 245,
      tmin: 8, tmax: 10, N: 0, Vy: 100000, Vz: 0, Mx: 0, My: 0, Mz: 0 });
    expect(util(r, "weldMetal")).toBeCloseTo(100000 / 176 / (0.7 * 6) / 180, 3);
    expect(util(r, "weldFusion")).toBeCloseTo(100000 / 176 / 6 / (0.45 * 370), 3);
  });
  it("згин з площини (16.4): контур 100×200, момент My", () => {
    // два горизонтальні 100 при z = ±100, два вертикальні 200 при y = ±50; Iy = 2·100·100² + 2·200³/12
    const Iy = 2 * 100 * 1e4 + (2 * 200 ** 3) / 12;
    const r = checkFillet({ code: "DBN", segs: weldShape("rect", { b: 100, h: 200 }), kf: 6, process: "manual", Run: 370, Ryn: 245,
      tmin: 8, tmax: 10, N: 0, Vy: 0, Vz: 0, Mx: 0, My: 10e6, Mz: 0 });
    expect(util(r, "weldMetal")).toBeCloseTo((10e6 * 100) / Iy / (0.7 * 6) / 180, 3);
  });
  it("EN спрощений метод: a = 4.2, S235", () => {
    const r = checkFillet({ code: "EN", segs: weldShape("trans2", { b: 100, h: 112 }), kf: 6, process: "manual", Run: 360, Ryn: 235,
      tmin: 8, tmax: 10, N: 100000, Vy: 0, Vz: 0, Mx: 0, My: 0, Mz: 0 });
    const leff = 2 * (112 - 2 * 4.2);
    expect(util(r, "weldEN")).toBeCloseTo(100000 / leff / ((360 / Math.sqrt(3) / (0.8 * 1.25)) * 4.2), 3);
  });
  it("стиковий шов без фізконтролю: Rwy = 0.85Ry", () => {
    const r = checkButt({ code: "DBN", t: 10, L: 220, Ry: 240, N: 300000, V: 0, M: 0 });
    expect(util(r, "buttNormal")).toBeCloseTo(300000 / (10 * 200) / (0.85 * 240), 3);
  });
});

const base: AnchorInput = {
  code: "EN", type: "mechanical", d: 16, hef: 100, steel: "8.8", fck: 20, cracked: true, h: 400,
  nx: 1, ny: 1, sx: 0, sy: 0, cxm: Infinity, cxp: Infinity, cym: Infinity, cyp: Infinity, bx: 150, by: 150,
  N: 10000, Mx: 0, My: 0, Vx: 0, Vy: 0, T: 0, NRkp: 40000, gammaInst: 1.2,
};

describe("анкери EN 1992-4", () => {
  it("конус: N⁰Rk,c = 7.7·√20·100^1.5 = 34.4 кН (табл. Würth)", () => {
    const r = checkAnchors(base);
    expect(util(r, "anchorCone")).toBeCloseTo(10000 / (7.7 * Math.sqrt(20) * 1000 / 1.8), 3);
  });
  it("конус біля краю c = 100: A = (100 + 150)·300, ψs = 0.7 + 0.3·100/150", () => {
    const r = checkAnchors({ ...base, cxp: 100 });
    const NRk = 7.7 * Math.sqrt(20) * 1000 * (250 * 300) / (300 * 300) * (0.7 + 0.3 * 100 / 150);
    expect(util(r, "anchorCone")).toBeCloseTo(10000 / (NRk / 1.8), 3);
  });
  it("крайове руйнування: закладний М16, c1 = 100, C25/30", () => {
    const r = checkAnchors({ ...base, type: "headed", fck: 25, N: 0, Vx: 5000, cxp: 100, gammaInst: 1.0 });
    const a = 0.1, b = 0.1 * (16 / 100) ** 0.2;
    const V0 = 1.7 * 16 ** a * 100 ** b * 5 * 100 ** 1.5;
    expect(util(r, "anchorEdge")).toBeCloseTo(5000 / (V0 / 1.5), 3);
  });
  it("жорстка плита: рівновага N, M", () => {
    const pts = [{ x: -100, y: -100 }, { x: 100, y: -100 }, { x: -100, y: 100 }, { x: 100, y: 100 }];
    const t = anchorTension(pts, 157, 300, 300, 20000, 0, 15e6, 30000);
    const T = t.F.reduce((a, b) => a + b, 0);
    expect(T - t.C).toBeCloseTo(20000, 0);
    const Mt = t.F.reduce((a, F, k) => a + F * pts[k].x, 0) - t.C * t.cx;
    expect(Mt / 1e6).toBeCloseTo(15, 2);
    expect(t.F[1]).toBeGreaterThan(5 * t.F[0]);
  });
  it("чистий відрив розподіляється порівну", () => {
    const pts = [{ x: -100, y: 0 }, { x: 100, y: 0 }];
    const t = anchorTension(pts, 157, 300, 150, 20000, 0, 0, 30000);
    expect(t.F[0]).toBeCloseTo(10000, 3);
    expect(t.C).toBe(0);
  });
  it("ДБН: сталь анкера 09Г2С М24, Rba = 245", () => {
    const r = checkAnchors({ ...base, code: "DBN", d: 24, steel: "09Г2С", N: 50000 });
    expect(util(r, "anchorSteelN")).toBeCloseTo(50000 / (245 * 353), 3);
  });
});
