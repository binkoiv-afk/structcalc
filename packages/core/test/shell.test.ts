import { describe, expect, it } from "vitest";
import { solveFrame, type FrameModel, type FrameNode, type LoadCase } from "../src/analysis/frame3d";
import type { ShellElement } from "../src/analysis/shell";

const E = 210000, nu = 0.3;
function plate(a: number, b: number, nx: number, ny: number, t: number, fixEdge: (x: number, y: number) => FrameNode["fix"] | undefined) {
  const nodes: FrameNode[] = [], shells: ShellElement[] = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const x = (a * i) / nx, y = (b * j) / ny;
    nodes.push({ id: `${i}_${j}`, x, y, z: 0, fix: fixEdge(x, y) });
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++)
    shells.push({ id: `e${i}_${j}`, nodes: [`${i}_${j}`, `${i + 1}_${j}`, `${i + 1}_${j + 1}`, `${i}_${j + 1}`], t, E, nu, rho: 7850 });
  return { nodes, members: [], shells } as FrameModel;
}
const onEdge = (a: number, b: number) => (x: number, y: number) => x < 1e-6 || y < 1e-6 || Math.abs(x - a) < 1e-6 || Math.abs(y - b) < 1e-6;

describe("оболонка МІТЦ4 + QM6", () => {
  const a = 1000, q = 0.01;
  const pressure = (m: FrameModel): LoadCase => ({ id: "q", shellLoads: m.shells!.map((e) => ({ shell: e.id, q: -q, dir: "gz" as const })) });
  it("шарнірно оперта квадратна плита: w = 0.00406 qa⁴/D, M = 0.0479 qa²", () => {
    for (const t of [10, 1]) {
      const edge = onEdge(a, a);
      const m = plate(a, a, 16, 16, t, (x, y) => (edge(x, y) ? { ux: true, uy: true, uz: true } : undefined));
      const r = solveFrame(m, [pressure(m)])["q"];
      const D = (E * t ** 3) / (12 * (1 - nu * nu));
      const w = -r.u["8_8"][2];
      expect(w / ((0.00406 * q * a ** 4) / D)).toBeCloseTo(1, 1);
      expect(Math.abs(w / ((0.00406 * q * a ** 4) / D) - 1)).toBeLessThan(0.02);
      // момент у центрі — середнє з 4 елементів біля центру
      const mc = ["e7_7", "e8_7", "e7_8", "e8_8"].map((id) => r.shells![id].corner[[2, 3, 0, 1][["e7_7", "e8_7", "e8_8", "e7_8"].indexOf(id)]][3]);
      const mx = mc.reduce((s, v) => s + v, 0) / 4;
      expect(Math.abs(Math.abs(mx) / (0.0479 * q * a * a) - 1)).toBeLessThan(0.04);
      // рівновага
      const Rz = Object.values(r.reactions).reduce((s, v) => s + v[2], 0);
      expect(Rz / (q * a * a)).toBeCloseTo(1, 4);
    }
  });
  it("защемлена плита: w = 0.00126 qa⁴/D", () => {
    const t = 10, edge = onEdge(a, a);
    const m = plate(a, a, 16, 16, t, (x, y) => (edge(x, y) ? { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true } : undefined));
    const r = solveFrame(m, [pressure(m)])["q"];
    const D = (E * t ** 3) / (12 * (1 - nu * nu));
    expect(Math.abs(-r.u["8_8"][2] / ((0.00126 * q * a ** 4) / D) - 1)).toBeLessThan(0.03);
  });
  it("консоль-стінка в площині (мембрана з несумісними модами): δ = PL³/3EI + PL/κGA", () => {
    const L = 1000, h = 200, t = 10, P = 1000;
    const m = plate(L, h, 10, 2, t, (x) => (x < 1e-6 ? { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true } : undefined));
    const lc: LoadCase = { id: "p", nodal: ["10_0", "10_1", "10_2"].map((n, k) => ({ node: n, F: [0, k === 1 ? P / 2 : P / 4, 0, 0, 0, 0] })) };
    const r = solveFrame(m, [lc])["p"];
    const I = (t * h ** 3) / 12, G = E / (2 * (1 + nu));
    const ex = (P * L ** 3) / (3 * E * I) + (P * L) / ((5 / 6) * G * h * t);
    expect(Math.abs(r.u["10_1"][1] / ex - 1)).toBeLessThan(0.04);
  });
  it("плита на балках: сума реакцій = навантаження + власна вага", () => {
    const t = 8;
    const m = plate(2000, 1000, 8, 4, t, () => undefined);
    // балки по краях, опори в кутах
    const sec = { A: 1000, Iy: 2e6, Iz: 1e6, It: 1e5 };
    const edgeIds = (pred: (i: number, j: number) => boolean) => m.nodes.filter((n) => { const [i, j] = n.id.split("_").map(Number); return pred(i, j); }).map((n) => n.id);
    const chain = (ids: string[], tag: string) => ids.slice(1).map((id, k) => ({ id: `${tag}${k}`, i: ids[k], j: id, sec, E, G: 81000, rho: 7850 }));
    m.members = [
      ...chain(edgeIds((i, j) => j === 0), "s"), ...chain(edgeIds((i, j) => j === 4), "n"),
      ...chain(edgeIds((i, j) => i === 0).sort((x, y) => Number(x.split("_")[1]) - Number(y.split("_")[1])), "w"),
      ...chain(edgeIds((i, j) => i === 8).sort((x, y) => Number(x.split("_")[1]) - Number(y.split("_")[1])), "e"),
    ];
    for (const id of ["0_0", "8_0", "8_4", "0_4"]) m.nodes.find((n) => n.id === id)!.fix = { ux: true, uy: true, uz: true };
    const lc: LoadCase = { id: "g", selfWeight: 1, shellLoads: m.shells!.map((e) => ({ shell: e.id, q: -0.002, dir: "gz" as const })) };
    const r = solveFrame(m, [lc])["g"];
    const Rz = Object.values(r.reactions).reduce((s, v) => s + v[2], 0);
    const W = 0.002 * 2e6 + 7850e-9 * 9.81 * t * 2e6 + m.members.reduce((s, b) => s + 1000 * 7850e-9 * 9.81 * (b.id.startsWith("s") || b.id.startsWith("n") ? 250 : 250), 0);
    expect(Rz / W).toBeCloseTo(1, 4);
  });
});
