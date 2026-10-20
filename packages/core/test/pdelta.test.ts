import { describe, expect, it } from "vitest";
import { analyzeAssembly, asmTemplate, axialForces, frameBuckling, frameSecondOrder, solveFrame } from "../src";
import type { FrameMember, FrameModel, FrameNode } from "../src";

const E = 206000, G = 79000;
const sec = { A: 5381, Iy: 8356e4, Iz: 604e4, It: 20.1e4 }; // IPE 300
const mem = (id: string, i: string, j: string, o: Partial<FrameMember> = {}): FrameMember => ({ id, i, j, sec, E, G, rho: 7850, ...o });
const fixAll = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true } as const;

/** вертикальна колона висотою H з n елементів; base — закріплення низу, top — верху */
function column(H: number, n: number, base: FrameNode["fix"], top?: FrameNode["fix"]): FrameModel {
  const nodes: FrameNode[] = Array.from({ length: n + 1 }, (_, k) => ({ id: `n${k}`, x: 0, y: 0, z: (H * k) / n }));
  nodes[0].fix = base; if (top) nodes[n].fix = top;
  return { nodes, members: Array.from({ length: n }, (_, k) => mem(`m${k}`, `n${k}`, `n${k + 1}`)) };
}

describe("деформована схема і стійкість", () => {
  it("шарнірна колона (Ейлер): α_cr·P = π²EI_z/L²", () => {
    const L = 6000, P = 100e3;
    const m = column(L, 6, { ux: true, uy: true, uz: true, rz: true }, { ux: true, uy: true });
    const lc = { id: "p", nodal: [{ node: "n6", F: [0, 0, -P, 0, 0, 0] }] };
    const N = axialForces(solveFrame(m, [lc]).p);
    const [b] = frameBuckling(m, [N], 2);
    expect(b[0].alpha * P / (Math.PI ** 2 * E * sec.Iz / L ** 2)).toBeCloseTo(1, 2);
    // друга форма — сильна вісь або друга хвиля слабкої: min(4·N_z, N_y)
    expect(b[1].alpha * P / Math.min(4 * Math.PI ** 2 * E * sec.Iz / L ** 2, Math.PI ** 2 * E * sec.Iy / L ** 2)).toBeCloseTo(1, 1);
  });
  it("консоль: N_cr = π²EI/(4L²) (стрижень ділиться на частини)", () => {
    const L = 4000, P = 50e3;
    const m = column(L, 1, fixAll);
    const lc = { id: "p", nodal: [{ node: "n1", F: [0, 0, -P, 0, 0, 0] }] };
    const [b] = frameBuckling(m, [axialForces(solveFrame(m, [lc]).p)]);
    const r = b[0].alpha * P / (Math.PI ** 2 * E * sec.Iz / (4 * L * L));
    expect(r).toBeGreaterThan(1); expect(r).toBeLessThan(1.002);
  });
  it("розтяг не втрачає стійкості", () => {
    const m = column(4000, 2, fixAll);
    const lc = { id: "p", nodal: [{ node: "n2", F: [0, 0, 50e3, 0, 0, 0] }] };
    expect(frameBuckling(m, [axialForces(solveFrame(m, [lc]).p)])[0]).toEqual([]);
  });
  it("консоль P + H: зміщення і момент біля основи — точний розв'язок (tan kL)", () => {
    const L = 4000, H = 2e3, Ncr = Math.PI ** 2 * E * sec.Iz / (4 * L * L), P = 0.5 * Ncr;
    const k = Math.sqrt(P / (E * sec.Iz)), kL = k * L;
    for (const n of [1, 4]) {
      const m = column(L, n, fixAll);
      const lc = { id: "p", nodal: [{ node: `n${n}`, F: [0, H, -P, 0, 0, 0] }] }; // Y — слабка вісь (I_z)
      const so = frameSecondOrder(m, lc);
      expect(so.converged).toBe(true);
      const d = Math.abs(so.res.u[`n${n}`][1]), dEx = (H * (Math.tan(kL) - kL)) / (P * k);
      const M0 = Math.abs(so.res.members.m0.Mz[0]), Mex = (H * Math.tan(kL)) / k;
      expect(d / dEx).toBeGreaterThan(0.995); expect(d / dEx).toBeLessThan(1.01);
      expect(M0 / Mex).toBeGreaterThan(0.99); expect(M0 / Mex).toBeLessThan(1.01);
      // перший порядок — помітно менше
      expect(Math.abs(solveFrame(m, [lc]).p.u[`n${n}`][1]) / dEx).toBeLessThan(0.55);
    }
  });
  it("шарнірна балка-колона, q поперек і стиск P: M_mid = q/k²·(sec(kL/2) − 1) — стрижень ділиться на частини, P-δ у моментах", () => {
    const L = 6000, q = 5, Ncr = Math.PI ** 2 * E * sec.Iz / L ** 2, P = 0.4 * Ncr, k = Math.sqrt(P / (E * sec.Iz));
    const m: FrameModel = { nodes: [{ id: "a", x: 0, y: 0, z: 0, fix: { ux: true, uy: true, uz: true, rx: true } }, { id: "b", x: L, y: 0, z: 0, fix: { uy: true, uz: true } }], members: [mem("1", "a", "b")] };
    const lc = { id: "p", nodal: [{ node: "b", F: [-P, 0, 0, 0, 0, 0] }], members: [{ member: "1", kind: "dist" as const, dir: "gy" as const, w1: q }] };
    const so = frameSecondOrder(m, lc);
    const f = so.res.members["1"], mid = f.x.findIndex((x) => Math.abs(x - L / 2) < 1e-6);
    const Mex = (q / (k * k)) * (1 / Math.cos((k * L) / 2) - 1);
    expect(Math.abs(f.Mz[mid]) / Mex).toBeGreaterThan(0.99);
    expect(Math.abs(f.Mz[mid]) / Mex).toBeLessThan(1.01);
    expect(Math.abs(f.Mz[mid]) / (q * L * L / 8)).toBeGreaterThan(1.5);
  });
  it("за критичною силою — втрата стійкості", () => {
    const L = 4000, Ncr = Math.PI ** 2 * E * sec.Iz / (4 * L * L);
    const m = column(L, 4, fixAll);
    expect(() => frameSecondOrder(m, { id: "p", nodal: [{ node: "n4", F: [100, 0, -1.2 * Ncr, 0, 0, 0] }] })).toThrow(/instability/);
  });
  it("рама з початковим нахилом φ: горизонтальні сили φ·V у напрямку зміщення", () => {
    const m: FrameModel = { nodes: [{ id: "a", x: 0, y: 0, z: 0, fix: fixAll }, { id: "b", x: 0, y: 0, z: 3000 }, { id: "c", x: 5000, y: 0, z: 3000 }, { id: "d", x: 5000, y: 0, z: 0, fix: fixAll }],
      members: [mem("c1", "a", "b"), mem("r", "b", "c"), mem("c2", "d", "c")] };
    const lc = { id: "p", nodal: [{ node: "b", F: [0, 0, -200e3, 0, 0, 0] }, { node: "c", F: [0, 0, -200e3, 0, 0, 0] }] };
    const so = frameSecondOrder(m, lc, { phi: 1 / 200 });
    const R = so.res.reactions;
    expect(R.a[0] + R.d[0]).toBeCloseTo(-400e3 / 200, 0); // ΣH = φ·ΣV
    expect(Math.abs(so.res.u.b[0])).toBeGreaterThan(0.1);
  });
});

describe("рама: α_cr проти наближення Горна і збірка", () => {
  it("портальна рама: α_cr ≈ (H/V)·(h/δ_H) (EN 1993-1-1, 5.2.1(4)B), ±15 %", () => {
    const h = 4000, V = 300e3, plane = { uy: true, rx: true, rz: true }; // плоска рама XZ
    const sq = { sec: { ...sec, Iz: sec.Iy } }; // без бічної форми з площини
    const m: FrameModel = { nodes: [{ id: "a", x: 0, y: 0, z: 0, fix: fixAll }, { id: "b", x: 0, y: 0, z: h, fix: plane }, { id: "c", x: 6000, y: 0, z: h, fix: plane }, { id: "d", x: 6000, y: 0, z: 0, fix: fixAll }],
      members: [mem("c1", "a", "b", sq), mem("r", "b", "c", sq), mem("c2", "d", "c", sq)] };
    const lc = { id: "v", nodal: [{ node: "b", F: [0, 0, -V, 0, 0, 0] }, { node: "c", F: [0, 0, -V, 0, 0, 0] }] };
    const [[b]] = frameBuckling(m, [axialForces(solveFrame(m, [lc]).v)]);
    const H = 0.01 * 2 * V;
    const rH = solveFrame(m, [{ id: "h", nodal: [{ node: "b", F: [H, 0, 0, 0, 0, 0] }] }]).h;
    const horne = (H / (2 * V)) * (h / rH.u.b[0]);
    expect(b.alpha / horne).toBeGreaterThan(0.85); expect(b.alpha / horne).toBeLessThan(1.15);
    expect(Math.abs(b.phi.b[0])).toBeGreaterThan(0.9); // форма — бічне зміщення
  });
  it("збірка: α_cr для всіх шаблонів, 2-й порядок не зменшує зусиль у рамі", () => {
    for (const t of ["canopy", "truss", "portal", "bracket", "platform"] as const) {
      const a = asmTemplate(t, "EN");
      const r1 = analyzeAssembly(a), r2 = analyzeAssembly({ ...a, secondOrder: { on: true } });
      expect(r1.stability!.min).toBeGreaterThan(1);
      expect(r2.stability!.on).toBe(true);
      expect(r2.maxUtil).toBeGreaterThan(r1.maxUtil - 1e-3);
      if (t === "portal") expect(r2.maxUtil).toBeGreaterThan(r1.maxUtil * 1.01);
    }
  });
});
