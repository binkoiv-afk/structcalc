import { describe, expect, it } from "vitest";
import { combineFrame, solveFrame } from "../src";
import type { FrameMember, FrameModel } from "../src";

const E = 206000, G = 79000;
const sec = { A: 5381, Iy: 8356e4, Iz: 604e4, It: 20.1e4 }; // IPE 300
const mem = (id: string, i: string, j: string, o: Partial<FrameMember> = {}): FrameMember => ({ id, i, j, sec, E, G, rho: 7850, ...o });
const pin = { ux: true, uy: true, uz: true, rx: true } as const;
const fixAll = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true } as const;

describe("просторова рама — ручні розв'язки", () => {
  it("шарнірна балка, рівномірне навантаження: M = wL²/8, f = 5wL⁴/384EI", () => {
    const m: FrameModel = { nodes: [{ id: "a", x: 0, y: 0, z: 0, fix: pin }, { id: "b", x: 6000, y: 0, z: 0, fix: { uy: true, uz: true } }], members: [mem("1", "a", "b")] };
    const r = solveFrame(m, [{ id: "q", members: [{ member: "1", kind: "dist", dir: "gz", w1: -10 }] }]).q;
    const f = r.members["1"], mid = f.x.findIndex((x) => Math.abs(x - 3000) < 1e-6);
    expect(f.My[mid]).toBeCloseTo(-10 * 6000 ** 2 / 8, -2);
    expect(f.disp[mid][2] / (-5 * 10 * 6000 ** 4 / (384 * E * sec.Iy))).toBeCloseTo(1, 2); // 41 станція — похибка ~0.05 %
    expect(r.reactions.a[2] + r.reactions.b[2]).toBeCloseTo(60000, 3);
    expect(f.Vz[0]).toBeCloseTo(-30000, 2); // dM_y/dx = V_z
  });
  it("зосереджена сила посередині: M = PL/4; шарнір кінця = те саме, що шарнірна опора", () => {
    const m: FrameModel = { nodes: [{ id: "a", x: 0, y: 0, z: 0, fix: fixAll }, { id: "b", x: 6000, y: 0, z: 0, fix: fixAll }],
      members: [mem("1", "a", "b", { rel: { i: { my: true, mz: true }, j: { my: true, mz: true } } })] };
    const r = solveFrame(m, [{ id: "p", members: [{ member: "1", kind: "point", dir: "gz", P: -20000, a: 3000 }] }]).p;
    expect(Math.min(...r.members["1"].My)).toBeCloseTo(-20000 * 6000 / 4, -2);
    expect(Math.abs(r.reactions.a[4])).toBeLessThan(1);
  });
  it("консоль вздовж Y, сила на кінці: f = PL³/3EI, M = PL", () => {
    const m: FrameModel = { nodes: [{ id: "a", x: 0, y: 0, z: 0, fix: fixAll }, { id: "b", x: 0, y: 3000, z: 0 }], members: [mem("1", "a", "b")] };
    const r = solveFrame(m, [{ id: "p", nodal: [{ node: "b", F: [0, 0, -5000, 0, 0, 0] }] }]).p;
    expect(r.u.b[2]).toBeCloseTo(-5000 * 3000 ** 3 / (3 * E * sec.Iy), 4);
    expect(Math.abs(r.reactions.a[3])).toBeCloseTo(5000 * 3000, -1);
    expect(r.members["1"].My[0]).toBeCloseTo(5000 * 3000, -1); // розтяг зверху біля закріплення
  });
  it("β = 90°: згин стає відносно слабкої осі", () => {
    const m: FrameModel = { nodes: [{ id: "a", x: 0, y: 0, z: 0, fix: fixAll }, { id: "b", x: 3000, y: 0, z: 0 }], members: [mem("1", "a", "b", { beta: 90 })] };
    const r = solveFrame(m, [{ id: "p", nodal: [{ node: "b", F: [0, 0, -5000, 0, 0, 0] }] }]).p;
    expect(r.u.b[2]).toBeCloseTo(-5000 * 3000 ** 3 / (3 * E * sec.Iz), 3);
  });
  it("Г-подібна консоль у плані: кручення першої ділянки T = P·L₂", () => {
    const m: FrameModel = { nodes: [{ id: "a", x: 0, y: 0, z: 0, fix: fixAll }, { id: "b", x: 2000, y: 0, z: 0 }, { id: "c", x: 2000, y: 1500, z: 0 }],
      members: [mem("1", "a", "b"), mem("2", "b", "c")] };
    const r = solveFrame(m, [{ id: "p", nodal: [{ node: "c", F: [0, 0, -1000, 0, 0, 0] }] }]).p;
    expect(Math.abs(r.members["1"].T[0])).toBeCloseTo(1000 * 1500, -1);
    expect(Math.abs(r.members["1"].My[0])).toBeCloseTo(1000 * 2000, -1);
    // прогин кінця: згин двох ділянок + поворот від кручення першої
    const w = 1000 * 2000 ** 3 / (3 * E * sec.Iy) + 1000 * 1500 ** 3 / (3 * E * sec.Iy) + (1000 * 1500 * 2000 / (G * sec.It)) * 1500;
    expect(-r.u.c[2]).toBeCloseTo(w, 1);
  });
  it("плоска ферма з шарнірних стрижнів: зусилля за рівновагою вузла", () => {
    const tr = { i: { my: true, mz: true }, j: { my: true, mz: true } };
    const m: FrameModel = {
      nodes: [{ id: "a", x: 0, y: 0, z: 0, fix: { ux: true, uy: true, uz: true } }, { id: "b", x: 4000, y: 0, z: 0, fix: { uy: true, uz: true } }, { id: "c", x: 2000, y: 0, z: 1500, fix: { uy: true } }],
      members: [mem("ab", "a", "b", { rel: tr }), mem("ac", "a", "c", { rel: tr }), mem("bc", "b", "c", { rel: tr })] };
    const r = solveFrame(m, [{ id: "p", nodal: [{ node: "c", F: [0, 0, -10000, 0, 0, 0] }] }]).p;
    // діагональ: N = −P/(2 sinα), sinα = 1500/2500; затяжка: N = P/(2 tanα)
    expect(r.members.ac.N[0]).toBeCloseTo(-10000 / (2 * 0.6), 1);
    expect(r.members.ab.N[0]).toBeCloseTo(10000 / (2 * 0.75), 1);
  });
  it("власна вага і комбінація: сума реакцій = сумі навантажень", () => {
    const m: FrameModel = { nodes: [{ id: "a", x: 0, y: 0, z: 0, fix: fixAll }, { id: "b", x: 0, y: 0, z: 3000 }, { id: "c", x: 4000, y: 0, z: 3000 }, { id: "d", x: 4000, y: 0, z: 0, fix: fixAll }],
      members: [mem("1", "a", "b"), mem("2", "b", "c"), mem("3", "d", "c")] };
    const res = solveFrame(m, [{ id: "g", selfWeight: 1 }, { id: "w", nodal: [{ node: "b", F: [3000, 0, 0, 0, 0, 0] }] }]);
    const c = combineFrame(res, { g: 1.1, w: 1.4 });
    const W = 5381 * 7850e-9 * 9.81 * (3000 + 4000 + 3000);
    expect(c.reactions.a[2] + c.reactions.d[2]).toBeCloseTo(1.1 * W, 2);
    expect(c.reactions.a[0] + c.reactions.d[0]).toBeCloseTo(-1.4 * 3000, 2);
  });
  it("механізм: незакріплений вузол дає зрозумілу помилку", () => {
    const m: FrameModel = { nodes: [{ id: "a", x: 0, y: 0, z: 0, fix: pin }, { id: "b", x: 3000, y: 0, z: 0 }], members: [mem("1", "a", "b", { rel: { j: { my: true, mz: true } } })] };
    expect(() => solveFrame(m, [{ id: "p" }])).toThrow(/mechanism/);
  });
});
