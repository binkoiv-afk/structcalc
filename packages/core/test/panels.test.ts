import { describe, expect, it } from "vitest";
import { panelLoads, solveFrame } from "../src";
import type { FrameMember, FrameModel } from "../src";

const sec = { A: 5381, Iy: 8356e4, Iz: 604e4, It: 20.1e4 };
const mem = (id: string, i: string, j: string): FrameMember => ({ id, i, j, sec, E: 206000, G: 79000, rel: { i: { my: true, mz: true }, j: { my: true, mz: true } } });
const box = (a: number, b: number): FrameModel => ({
  nodes: [
    { id: "1", x: 0, y: 0, z: 0, fix: { ux: true, uy: true, uz: true } }, { id: "2", x: a, y: 0, z: 0, fix: { uy: true, uz: true } },
    { id: "3", x: a, y: b, z: 0, fix: { uz: true } }, { id: "4", x: 0, y: b, z: 0, fix: { ux: true, uz: true } },
  ],
  members: [mem("e0", "1", "2"), mem("e1", "2", "3"), mem("e2", "3", "4"), mem("e3", "4", "1")],
});
const sumZ = (m: FrameModel, loads: ReturnType<typeof panelLoads>["byCase"], c: string) => {
  const r = solveFrame(m, [{ id: c, members: loads.get(c) ?? [] }])[c];
  return Object.values(r.reactions).reduce((s, v) => s + v[2], 0);
};

describe("вантажні панелі", () => {
  it("квадрат на 4 балки: конверт, трикутник на кожну балку, M = wL²/12", () => {
    const m = box(4000, 4000);
    const { byCase, info } = panelLoads(m, [{ id: "p", nodes: ["1", "2", "3", "4"], mode: "two" }], [{ panel: "p", case: "s", q: -0.001, dir: "gz" }]);
    expect(info[0].area).toBeCloseTo(16e6, -3);
    expect(sumZ(m, byCase, "s")).toBeCloseTo(16000, 0);
    const r = solveFrame(m, [{ id: "s", members: byCase.get("s")! }]).s;
    const M = Math.max(...r.members.e0.My.map(Math.abs));
    expect(M / ((0.001 * 2000 * 4000 ** 2) / 12)).toBeCloseTo(1, 1);
  });
  it("балочна плита: навантаження лише на краї 0 і 2, M = wL²/8", () => {
    const m = box(6000, 3000);
    const { byCase } = panelLoads(m, [{ id: "p", nodes: ["1", "2", "3", "4"], mode: "one", span: 0 }], [{ panel: "p", case: "s", q: -0.001, dir: "gz" }]);
    const r = solveFrame(m, [{ id: "s", members: byCase.get("s")! }]).s;
    expect(Math.max(...r.members.e1.My.map(Math.abs))).toBeLessThan(1);
    expect(Math.max(...r.members.e0.My.map(Math.abs)) / ((0.001 * 1500 * 6000 ** 2) / 8)).toBeCloseTo(1, 2);
  });
  it("частина панелі: половина площі — половина сили; нормаль і проєкція", () => {
    const m = box(4000, 4000);
    const { byCase } = panelLoads(m, [{ id: "p", nodes: ["1", "2", "3", "4"], mode: "two" }],
      [{ panel: "p", case: "h", q: -0.002, dir: "gz", region: { u0: 0, u1: 0.5, v0: 0, v1: 1 } }, { panel: "p", case: "n", q: -0.001, dir: "normal" }]);
    expect(sumZ(m, byCase, "h")).toBeCloseTo(16000, 0);
    expect(sumZ(m, byCase, "n")).toBeCloseTo(16000, 0); // нормаль панелі 1-2-3-4 = +Z, тиск −q діє вниз
  });
});
