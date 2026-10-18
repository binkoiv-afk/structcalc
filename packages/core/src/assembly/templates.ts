// Шаблони збірок для швидкого старту: навіс на 4 стійках, ферма, рама, кронштейн з підкосом.
// Усе — звичайна збірка: після вибору шаблону кожен вузол, стрижень, стик і навантаження змінюються.

import type { CodeId } from "../codes/types";
import type { Assembly, AsmMember, AsmNode, EndConn } from "./assembly";
import type { BasePlateInput } from "../joints/basePlate";

export type AsmTemplate = "canopy" | "truss" | "portal" | "bracket" | "platform";
export const ASM_TEMPLATES: AsmTemplate[] = ["canopy", "truss", "portal", "bracket", "platform"];

const weld = (kf = 5, behaviour: EndConn["behaviour"] = "rigid"): EndConn => ({ behaviour, kind: "weld", kf });
const bolts = (d = 16, rows = 1, cols = 2): EndConn => ({ behaviour: "pin", kind: "bolts", d, rows, cols, px: 3 * d, py: 3 * d, tp: 8, plane: "web", edge: 2 * d });

export function basePlateDefaults(code: CodeId): Omit<BasePlateInput, "code" | "kind" | "profile" | "profileSteel" | "combos"> {
  return {
    plate: { L: 300, B: 300, t: 20, steel: code === "DBN" ? "C245" : "S235" },
    ribs: { web: false, tips: false, hr: 150, tr: 10 },
    weld: { kf: 5, process: "manual", milled: false },
    anchors: { type: "headed", d: 20, steel: code === "DBN" ? "09Г2С" : "5.6", hef: 400, nx: 2, ny: 2, sx: 220, sy: 220 },
    concrete: { fck: 20, cracked: true, Lc: 600, Bc: 600, h: 800, grout: 30, reinforced: true },
    friction: true,
  };
}

export function asmTemplate(k: AsmTemplate, code: CodeId): Assembly {
  const st = code === "DBN" ? "C245" : "S235";
  const m = (id: string, i: string, j: string, family: string, size: string, endI: EndConn, endJ: EndConn, o: Partial<AsmMember> = {}): AsmMember =>
    ({ id, i, j, family, size, steel: st, endI, endJ, ...o });
  const gf = code === "DBN" ? { G: 1.1, S: 1.14, W: 1.4 } : { G: 1.35, S: 1.5, W: 1.5 };
  if (k === "canopy") {
    // навіс 6 × 4 м, висота 3 м, покрівля на 4 балках (конверт), стійки на базах
    const L = 6000, B = 4000, H = 3000;
    const nodes: AsmNode[] = [
      { id: "1", x: 0, y: 0, z: 0, support: "base", base: basePlateDefaults(code) }, { id: "2", x: L, y: 0, z: 0, support: "base", base: basePlateDefaults(code) },
      { id: "3", x: L, y: B, z: 0, support: "base", base: basePlateDefaults(code) }, { id: "4", x: 0, y: B, z: 0, support: "base", base: basePlateDefaults(code) },
      { id: "5", x: 0, y: 0, z: H }, { id: "6", x: L, y: 0, z: H }, { id: "7", x: L, y: B, z: H }, { id: "8", x: 0, y: B, z: H },
    ];
    const col = (id: string, a: string, b: string) => m(id, a, b, "RHS_COLD", "120×120×5", weld(5), weld(5));
    const beam = (id: string, a: string, b: string, size: string) => m(id, a, b, "RHS_COLD", size, weld(5), weld(5));
    return {
      code, nodes,
      members: [col("c1", "1", "5"), col("c2", "2", "6"), col("c3", "3", "7"), col("c4", "4", "8"),
        beam("b1", "5", "6", "160×160×5"), beam("b2", "6", "7", "120×120×5"), beam("b3", "7", "8", "160×160×5"), beam("b4", "8", "5", "120×120×5")],
      panels: [{ id: "roof", nodes: ["5", "6", "7", "8"], mode: "two", mass: 25 }],
      panelLoads: [
        { panel: "roof", case: "S", q: -1.2e-3, dir: "gz", projected: true },
        { panel: "roof", case: "W", q: 0.5e-3, dir: "normal" },
      ],
      cases: [
        { id: "G", label: "G", cat: "G", gf: gf.G, selfWeight: true },
        { id: "S", label: "S", cat: "Q", gf: gf.S },
        { id: "W", label: "W", cat: "Q", gf: gf.W, members: [{ member: "c1", kind: "dist", dir: "gx", w1: 0.3 }, { member: "c4", kind: "dist", dir: "gx", w1: 0.3 }] },
      ],
    };
  }
  if (k === "truss") {
    // ферма 12 м, висота 1.5 м, 6 панелей, стрижні на фасонках (шарнірно)
    const L = 12000, H = 1500, n = 6, d = L / n;
    const nodes: AsmNode[] = [];
    for (let q = 0; q <= n; q++) nodes.push({ id: `b${q}`, x: q * d, y: 0, z: 0, support: q === 0 ? "pinned" : q === n ? "roller" : "none" });
    for (let q = 0; q <= n; q++) nodes.push({ id: `t${q}`, x: q * d, y: 0, z: H });
    const members: AsmMember[] = [];
    const kf = code === "EN" ? 5 : 4;
    const ch = (a: string, b: string, id: string) => members.push(m(id, a, b, "RHS_COLD", "120×80×4", weld(kf, "rigid"), weld(kf, "rigid")));
    for (let q = 0; q < n; q++) { ch(`b${q}`, `b${q + 1}`, `Н${q + 1}`); ch(`t${q}`, `t${q + 1}`, `В${q + 1}`); }
    for (let q = 0; q <= n; q++) members.push(m(`С${q}`, `b${q}`, `t${q}`, "RHS_COLD", "60×60×4", weld(kf, "pin"), weld(kf, "pin")));
    for (let q = 0; q < n; q++) {
      const [a, b] = q < n / 2 ? [`t${q}`, `b${q + 1}`] : [`b${q}`, `t${q + 1}`];
      members.push(m(`Р${q + 1}`, a, b, "RHS_COLD", "80×80×4", weld(kf, "pin"), weld(kf, "pin")));
    }
    // з площини ферма розкріплена зв'язками: усі вузли закріплені від зміщення по y
    for (const x of nodes) x.fix = { ...(x.fix ?? {}), uy: true };
    const Pg = 4000, Ps = 9000;
    const tops = nodes.filter((x) => x.id.startsWith("t")).map((x) => x.id);
    return {
      code, nodes,
      members, panels: [], panelLoads: [],
      cases: [
        { id: "G", label: "G", cat: "G", gf: gf.G, selfWeight: true, nodal: tops.map((t, q) => ({ node: t, F: [0, 0, -(q === 0 || q === n ? Pg / 2 : Pg), 0, 0, 0] })) },
        { id: "S", label: "S", cat: "Q", gf: gf.S, nodal: tops.map((t, q) => ({ node: t, F: [0, 0, -(q === 0 || q === n ? Ps / 2 : Ps), 0, 0, 0] })) },
      ],
    };
  }
  if (k === "portal") {
    const L = 12000, H = 5000;
    const endPlate: EndConn = { behaviour: "rigid", kind: "bolts", d: 24, rows: 6, cols: 2, px: 110, py: 90, tp: 25, plane: "end", boltClass: "8.8", edge: 50 };
    return {
      code,
      // шарнірні опори рами; жорсткі вузли ригель–колона на торцевих плитах
      // з площини рама розкріплена зв'язками у вузлах 2 і 3
      nodes: [{ id: "1", x: 0, y: 0, z: 0, support: "pinned" }, { id: "2", x: 0, y: 0, z: H, fix: { uy: true } }, { id: "3", x: L, y: 0, z: H, fix: { uy: true } }, { id: "4", x: L, y: 0, z: 0, support: "pinned" }],
      members: [m("К1", "1", "2", "HEA", "HEA 260", weld(8, "pin"), weld(10)), m("Р1", "2", "3", "IPE", "IPE 400", endPlate, endPlate, { mu: { y: 1, z: 0.25 } }),
        m("К2", "4", "3", "HEA", "HEA 260", weld(8, "pin"), weld(10))],
      panels: [], panelLoads: [],
      cases: [
        { id: "G", label: "G", cat: "G", gf: gf.G, selfWeight: true, members: [{ member: "Р1", kind: "dist", dir: "gz", w1: -3 }] },
        { id: "S", label: "S", cat: "Q", gf: gf.S, members: [{ member: "Р1", kind: "dist", dir: "gz", w1: -7 }] },
        { id: "W", label: "W", cat: "Q", gf: gf.W, members: [{ member: "К1", kind: "dist", dir: "gx", w1: 2.4 }, { member: "К2", kind: "dist", dir: "gx", w1: 1.5 }] },
      ],
    };
  }
  if (k === "platform") {
    // площадка 3 × 2 м: рифлений лист t = 8 мм — пластина-оболонка, що працює разом з балками; стійки на базах
    const L = 3000, B = 2000, H = 1500;
    const kw = code === "EN" ? 5 : 4;
    const bp = () => ({ ...basePlateDefaults(code), weld: { ...basePlateDefaults(code).weld, kf: kw }, plate: { ...basePlateDefaults(code).plate, L: 250, B: 250, t: 16 }, anchors: { ...basePlateDefaults(code).anchors, d: 16, sx: 170, sy: 170, hef: 250 } });
    const nodes: AsmNode[] = [
      { id: "1", x: 0, y: 0, z: 0, support: "base", base: bp() }, { id: "2", x: L, y: 0, z: 0, support: "base", base: bp() },
      { id: "3", x: L, y: B, z: 0, support: "base", base: bp() }, { id: "4", x: 0, y: B, z: 0, support: "base", base: bp() },
      { id: "5", x: 0, y: 0, z: H }, { id: "6", x: L, y: 0, z: H }, { id: "7", x: L, y: B, z: H }, { id: "8", x: 0, y: B, z: H },
      { id: "9", x: L / 2, y: 0, z: H }, { id: "10", x: L / 2, y: B, z: H },
    ];
    const col = (id: string, a: string, b: string) => m(id, a, b, "RHS_COLD", "100×100×4", weld(kw), weld(kw));
    const beam = (id: string, a: string, b: string, size: string, beta = 0) => m(id, a, b, "RHS_COLD", size, weld(kw), weld(kw), { beta });
    return {
      code, nodes,
      members: [col("c1", "1", "5"), col("c2", "2", "6"), col("c3", "3", "7"), col("c4", "4", "8"),
        beam("b1", "5", "9", "120×80×4"), beam("b2", "9", "6", "120×80×4"), beam("b3", "7", "10", "120×80×4"), beam("b4", "10", "8", "120×80×4"),
        beam("b5", "6", "7", "120×80×4"), beam("b6", "8", "5", "120×80×4"), beam("b7", "9", "10", "100×100×4")],
      panels: [
        { id: "П1", nodes: ["5", "9", "10", "8"], mode: "two", kind: "plate", t: 8, steel: st, mass: 0 },
        { id: "П2", nodes: ["9", "6", "7", "10"], mode: "two", kind: "plate", t: 8, steel: st, mass: 0 },
      ],
      panelLoads: [
        { panel: "П1", case: "L", q: -3e-3, dir: "gz" }, { panel: "П2", case: "L", q: -3e-3, dir: "gz" },
        // зосереджене навантаження від обладнання на частині листа 0.5 × 0.5 м
        { panel: "П2", case: "E", q: -8e-3, dir: "gz", region: { u0: 0.33, u1: 0.67, v0: 0.375, v1: 0.625 } },
      ],
      cases: [
        { id: "G", label: "G", cat: "G", gf: gf.G, selfWeight: true },
        { id: "L", label: "Q", cat: "Q", gf: code === "DBN" ? 1.2 : 1.5 },
        { id: "E", label: "E", cat: "Q", gf: code === "DBN" ? 1.2 : 1.5 },
      ],
    };
  }
  // кронштейн з підкосом на стіні: міні-ферма, кріплення до стіни шарнірне, стрижні на болтах
  return {
    code,
    nodes: [{ id: "A", x: 0, y: 0, z: 0, support: "fixed" }, { id: "B", x: 0, y: 0, z: -900, support: "pinned" }, { id: "C", x: 1500, y: 0, z: 0 }],
    // верхній стрижень — на торцевій плиті до стіни (жорстко), підкіс і вузол C — на болтах (шарнір)
    members: [m("1", "A", "C", "RHS_COLD", "100×50×4", { behaviour: "rigid", kind: "bolts", d: 12, rows: 2, cols: 2, px: 90, py: 110, tp: 10, plane: "end", edge: 30 }, bolts(12, 1, 2), { mu: { y: 1, z: 2 } }),
      m("2", "B", "C", "RHS_COLD", "60×60×3", bolts(12, 1, 2), bolts(12, 1, 2))],
    panels: [], panelLoads: [],
    cases: [
      { id: "G", label: "G", cat: "G", gf: gf.G, selfWeight: true, nodal: [{ node: "C", F: [0, 0, -3000, 0, 0, 0] }] },
      { id: "S", label: "S", cat: "Q", gf: gf.S, nodal: [{ node: "C", F: [0, 0, -4000, 0, 0, 0] }] },
      { id: "W", label: "W", cat: "Q", gf: gf.W, nodal: [{ node: "C", F: [0, 800, 0, 0, 0, 0] }] },
    ],
  };
}
