import { describe, expect, it } from "vitest";
import { beamHinged, checkCurtainWall, cpeWall, cwLimit, CwInput, chiAl } from "../src";

const base: CwInput = {
  code: "EN", a: 1.5, edge: false, scheme: "single", spans: [3.6], c: 0.3, hang: true, panes: [1.2, 2.4],
  wP: 1.0, wS: -1.2, wPt: 1.1, wSt: -1.3, gW: 1.5, gG: 1.35, glass: [6, 6], ab: 100, e: 20, e0: 10,
  alloy: "6060-T66", mullion: { Ix: 423.85, Iy: 44.37, Wx: 47.6, Wy: 17.7, A: 9.0, tw: 2.2, D: 150 },
  transom: { Ix: 89.41, Iy: 25.59, Wx: 12, Wy: 10, A: 5, tw: 2, D: 79, Am: 30, tt: 2 },
  insert: { I: 0, W: 0, fy: 235 }, limit: "2015", custDiv: 300, custCap: 15,
};

describe("фасад СРС: стояк", () => {
  it("балка з шарнірами: однопрогінна і двопрогінна — точні формули", () => {
    const s = beamHinged([0, 6], [], 6, 1, 1000);
    const mid = s.pts.reduce((a, p) => (Math.abs(p.x - 3) < Math.abs(a.x - 3) ? p : a));
    expect(mid.M).toBeCloseTo(4.5, 6);
    expect(mid.w).toBeCloseTo((5 * 6 ** 4) / (384 * 1000), 8);
    const t = beamHinged([0, 4, 8], [], 8, 2, 1000);
    const sup = t.pts.find((p) => Math.abs(p.x - 4) < 1e-9)!;
    expect(sup.M).toBeCloseTo(-(2 * 16) / 8, 6);
    expect(t.reactions.map((r) => r.R)).toEqual([expect.closeTo(0.375 * 8, 6), expect.closeTo(1.25 * 8, 6), expect.closeTo(0.375 * 8, 6)]);
  });
  it("ланцюг Гербера: шарнір M = 0, рівновага, консольний момент за статикою", () => {
    const H = 3.6, c = 0.6, q = 1.5;
    const g = beamHinged([0, H, 2 * H, 3 * H, 4 * H], [H + c, 2 * H + c, 3 * H + c], 4 * H, q, 500);
    for (const h of [H + c, 2 * H + c, 3 * H + c]) expect(g.pts.find((p) => Math.abs(p.x - h) < 1e-9)!.M).toBeCloseTo(0, 6);
    expect(g.reactions.reduce((s, r) => s + r.R, 0)).toBeCloseTo(q * 4 * H, 6);
    // верхній шматок 3H+c…4H спирається на кронштейн 4H і шарнір: V = q(H − c)/2; кронштейн 3H: M = −(q c²/2 + V c)
    const V = (q * (H - c)) / 2, M3 = g.pts.find((p) => Math.abs(p.x - 3 * H) < 1e-9)!.M;
    expect(M3).toBeCloseTo(-(q * c * c / 2 + V * c), 6);
  });
  it("перевірки: межі EN 13830, χ, вкладиш, сума реакцій", () => {
    expect(cwLimit("2015", 3000)).toBe(15);
    expect(cwLimit("2015", 4500)).toBe(20);
    expect(cwLimit("2015", 8000)).toBe(32);
    expect(cwLimit("2003", 4500)).toBe(15);
    expect(chiAl(0.05)).toBe(1);
    expect(chiAl(1)).toBeCloseTo(1 / (0.5 * (1 + 0.2 * 0.9 + 1) + Math.sqrt((0.5 * 2.18) ** 2 - 1)), 9);
    const r = checkCurtainWall(base);
    expect(r.q).toBeCloseTo(1.2 * 1.5, 9);
    expect(r.Mmax).toBeCloseTo((1.8 * 3.6 ** 2) / 8, 4);
    expect(r.reactions.reduce((s, x) => s + x.R, 0)).toBeCloseTo(1.8 * 3.6, 6);
    expect(r.Gstorey).toBeCloseTo(1.5 * 3.6 * 0.012 * 25, 9);
    const w = (5 * 1.8 * 3.6 ** 4) / (384 * (70000 * 423.85) / 1e5) * 1000;
    expect(r.defl[0].w).toBeCloseTo(w, 3);
    const ins = checkCurtainWall({ ...base, insert: { I: 200, W: 30, fy: 235 } });
    expect(ins.shareAl).toBeCloseTo(70000 * 423.85 / (70000 * 423.85 + 210000 * 200), 9);
    expect(ins.checks.some((c) => c.key === "cw_mInsert")).toBe(true);
    const stand = checkCurtainWall({ ...base, hang: false });
    expect(stand.checks[0].key).toBe("cw_mBuck");
  });
});

describe("фасад СРС: ригель і вітер", () => {
  it("ригель: трикутник (h ≥ L) → q0L²/12; вага скла на підкладках", () => {
    const r = checkCurtainWall({ ...base, panes: [2.0, 2.0] });
    const mid = r.transoms[1]; // між двома панелями
    const q0 = (1.3 * 1.5) / 2;
    expect(mid.Mx).toBeCloseTo(2 * (q0 * 1.5 ** 2) / 12, 6);
    expect(mid.My).toBeCloseTo((1.5 * 2 * 0.012 * 25) / 2 * 0.1, 6);
    expect(r.transoms[2].G).toBe(0); // верхній ригель скла не несе
  });
  it("c_pe за площею (рис. 7.2) і табл. 7.1", () => {
    expect(cpeWall("A", 1, 1).cpe).toBe(-1.4);
    expect(cpeWall("A", 1, 10).cpe).toBe(-1.2);
    expect(cpeWall("A", 1, 5).cpe).toBeCloseTo(-1.4 + 0.2 * Math.log10(5), 9);
    expect(cpeWall("D", 0.625, 20).c10).toBeCloseTo(0.75, 9);
  });
});
