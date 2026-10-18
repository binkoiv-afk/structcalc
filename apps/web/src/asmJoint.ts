// Зв'язок «Збірки» з модулем «Вузол»: зі стику, бази або вузла ферми — стан вузла із зусиллями всіх сполучень ULS;
// назад — використання вузла (для таблиці стиків) або змінені параметри бази.
import type { Assembly, AsmNode, AsmResult, CodeId, StackLayer } from "@structcalc/core";
import { CONCRETE_CLASSES, findSection } from "@structcalc/core";
import { jointInit, JointState } from "./JointModule";
import type { NodeState } from "./NodeModule";

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const ulsNames = (r: AsmResult) => r.combos.filter((c) => c.kind !== "SLS").map((c) => c.name);
const dir = (a: Assembly, from: string, to: string) => {
  const p = a.nodes.find((n) => n.id === from)!, q = a.nodes.find((n) => n.id === to)!;
  const d = [q.x - p.x, q.y - p.y, q.z - p.z], L = Math.hypot(d[0], d[1], d[2]) || 1;
  return d.map((v) => v / L);
};

/** Вид вузла для стику кінця стрижня (null — шаблону немає) */
export function jointKindOf(a: Assembly, member: string, end: "i" | "j"): JointState["kind"] | null {
  const m = a.members.find((x) => x.id === member);
  if (!m) return null;
  const ec = end === "i" ? m.endI : m.endJ, isI = findSection(m.family, m.size)?.kind === "I";
  if (ec.kind === "none") return null;
  // кінець на базі — деталізується як база колони
  if (a.nodes.find((n) => n.id === (end === "i" ? m.i : m.j))?.support === "base") return null;
  if (ec.kind === "weld") return ec.behaviour === "pin" && isI ? "finPlate" : "cantilever";
  if (ec.plane === "end") return isI ? "endPlate" : "flangeSplice";
  return isI ? "finPlate" : null;
}

/** Стик кінця стрижня → сталевий вузол із зусиллями біля вузла */
export function jointFromConn(a: Assembly, r: AsmResult, member: string, end: "i" | "j", code: CodeId): JointState | null {
  const kind = jointKindOf(a, member, end);
  const m = a.members.find((x) => x.id === member);
  if (!kind || !m) return null;
  const ec = end === "i" ? m.endI : m.endJ, node = end === "i" ? m.i : m.j;
  const j = jointInit(kind, code);
  j.bFam = m.family; j.bSize = m.size; j.bSteel = m.steel;
  // колона — вертикальний двотавр у тому ж вузлі
  const dm = dir(a, m.i, m.j);
  const col = Math.abs(dm[2]) > 0.9 ? undefined : a.members.find((x) => x.id !== m.id && (x.i === node || x.j === node) && Math.abs(dir(a, x.i, x.j)[2]) > 0.9 && findSection(x.family, x.size)?.kind === "I");
  if (col) { j.col = true; j.cFam = col.family; j.cSize = col.size; j.cSteel = col.steel; } else j.col = false;
  if (ec.d) j.p.d = ec.d;
  if (ec.boltClass) j.p.cls = ec.boltClass;
  if (ec.kf) j.p.kf = ec.kf;
  if (kind === "finPlate") {
    if (ec.tp) j.p.tp = ec.tp;
    // ребро — у межах прямої ділянки стінки, болтів скільки вміщується
    const s = findSection(m.family, m.size)!, hw = s.h - 2 * (s.dims.tf ?? 10) - 2 * (s.dims.r ?? 0) - 10;
    j.p.hp = Math.max(100, Math.min(j.p.hp, Math.floor(hw / 10) * 10));
    j.p.rows = Math.max(2, Math.min(j.p.rows, Math.floor((j.p.hp - 2 * j.p.e1) / j.p.p) + 1));
  }
  if (kind === "cantilever") j.p.lever = 0;
  const names = ulsNames(r);
  j.combos = r.uls.map((res, k) => {
    const f = res.members[m.id], at = end === "i" ? 0 : f.N.length - 1;
    // кінець j: балка йде від вузла в бік −x стрижня — дзеркально, M_y (розтяг верху) не змінюється
    const s = end === "i" ? 1 : -1, pin = ec.behaviour === "pin";
    return { name: names[k] ?? String(k + 1), N: r3(f.N[at] / 1e3), My: pin ? 0 : r3(f.My[at] / 1e6), Vz: r3(f.Vz[at] / 1e3), Vy: r3((s * f.Vy[at]) / 1e3), Mz: pin ? 0 : r3((s * f.Mz[at]) / 1e6) };
  });
  j.cMode = "manual";
  j.link = { member, end, node };
  return j;
}

/** Вузол ферми: пояс — два співвісні стрижні, решта (до 3) — решітка на фасонці */
export function gussetFromNode(a: Assembly, r: AsmResult, node: string, code: CodeId): JointState | null {
  const at = a.members.filter((m) => m.i === node || m.j === node);
  if (at.length < 3) return null;
  const out = (m: (typeof at)[number]) => (m.i === node ? dir(a, m.i, m.j) : dir(a, m.j, m.i));
  let chord: (typeof at)[number] | undefined, ex: number[] = [];
  for (const p of at) for (const q of at) {
    if (p === q || chord) continue;
    const u = out(p), v = out(q);
    if (u[0] * v[0] + u[1] * v[1] + u[2] * v[2] < -0.99) { chord = p; ex = u; }
  }
  if (!chord) return null;
  const web = at.filter((m) => m !== chord && Math.abs(out(m).reduce((s, v, k) => s + v * ex[k], 0)) < 0.999).slice(0, 3);
  if (!web.length) return null;
  const d1 = out(web[0]);
  const n = [ex[1] * d1[2] - ex[2] * d1[1], ex[2] * d1[0] - ex[0] * d1[2], ex[0] * d1[1] - ex[1] * d1[0]];
  let ez = [n[1] * ex[2] - n[2] * ex[1], n[2] * ex[0] - n[0] * ex[2], n[0] * ex[1] - n[1] * ex[0]];
  const nz = Math.hypot(ez[0], ez[1], ez[2]) || 1; ez = ez.map((v) => v / nz);
  const ang = (m: (typeof at)[number]) => { const d = out(m); return (Math.atan2(d[0] * ez[0] + d[1] * ez[1] + d[2] * ez[2], d[0] * ex[0] + d[1] * ex[1] + d[2] * ex[2]) * 180) / Math.PI; };
  // решітка — під поясом (кути від'ємні), як на кресленні
  const flip = web.filter((m) => ang(m) > 0).length > web.length / 2 ? -1 : 1;
  const j = jointInit("gusset", code);
  j.bFam = chord.family; j.bSize = chord.size; j.bSteel = chord.steel;
  const sc = findSection(chord.family, chord.size), tc = sc?.dims.tf ?? sc?.dims.t ?? 6;
  if (code === "DBN") j.p.kf = Math.min(j.p.kf, Math.max(4, Math.floor(1.2 * tc)));
  j.members = web.map((m) => {
    const s = findSection(m.family, m.size), t = s?.dims.t ?? s?.dims.tw ?? 5;
    return { fam: m.family, size: m.size, steel: m.steel, angle: Math.round(flip * ang(m)), Lw: 150, kf: code === "DBN" ? Math.min(6, Math.max(4, Math.floor(1.2 * t))) : 5, on: true };
  });
  const names = ulsNames(r);
  j.combos = r.uls.map((res, k) => {
    const c: Record<string, number | string> = { name: names[k] ?? String(k + 1) };
    web.forEach((m, q) => { const f = res.members[m.id]; c[`N${q + 1}`] = r3(f.N[m.i === node ? 0 : f.N.length - 1] / 1e3); });
    return c as unknown as JointState["combos"][number];
  });
  j.link = { member: chord.id, end: chord.i === node ? "i" : "j", node };
  return j;
}

/** База колони зі збірки → стан модуля «Вузол» (жорстка база) */
export function baseFromNode(a: Assembly, r: AsmResult, node: string): Partial<NodeState> | null {
  const n = a.nodes.find((x) => x.id === node), m = a.members.find((x) => x.i === node || x.j === node);
  if (!n?.base || !m) return null;
  const b = n.base, names = ulsNames(r);
  const conc = CONCRETE_CLASSES.find((c) => c.fck === b.concrete.fck)?.id ?? "C20/25";
  const inf = (v: number) => (Number.isFinite(v) ? String(v) : "");
  return {
    tmpl: "baseRigid", sel: "plate", family: m.family, size: m.size, pSteel: m.steel, lever: 0,
    L: b.plate.L, B: b.plate.B, t: b.plate.t, plSteel: b.plate.steel, chamfer: b.plate.chamfer ?? 0,
    ribs: !!(b.ribs.web ?? b.ribs.on), ribTips: !!b.ribs.tips, hr: b.ribs.hr, tr: b.ribs.tr, hr2: b.ribs.hr2 ?? Math.round(0.3 * b.ribs.hr),
    kf: b.weld.kf, proc: b.weld.process, milled: b.weld.milled,
    aType: b.anchors.type, ad: b.anchors.d, aSteel: b.anchors.steel, ahef: b.anchors.hef, anx: b.anchors.nx, any: b.anchors.ny, asx: b.anchors.sx, asy: b.anchors.sy,
    aTau: b.anchors.tauRk ?? 7, aNRkp: b.anchors.NRkp ? String(b.anchors.NRkp / 1e3) : "", aFree: !!b.anchors.points?.length, aPts: b.anchors.points ?? [],
    conc, cracked: b.concrete.cracked, reinf: b.concrete.reinforced ?? true, Lc: inf(b.concrete.Lc), Bc: inf(b.concrete.Bc), hc: b.concrete.h, grout: b.concrete.grout,
    friction: b.friction, stack: b.stack ?? (b.concrete.grout > 0 ? [{ mat: "grout", t: b.concrete.grout }] : []), ex: b.offset?.x ?? 0, ey: b.offset?.y ?? 0,
    cMode: "manual",
    combos: r.uls.map((res, k) => {
      const R = res.reactions[node] ?? [0, 0, 0, 0, 0, 0];
      return { name: names[k] ?? String(k + 1), N: r3(R[2] / 1e3), My: r3(R[4] / 1e6), Mz: r3(-R[3] / 1e6), Vz: r3(R[0] / 1e3), Vy: r3(R[1] / 1e3), T: r3(R[5] / 1e6) };
    }),
    asmLink: { node },
  };
}

/** Змінені в модулі «Вузол» параметри бази → назад у вузол збірки */
export function baseToAsm(s: NodeState, n: AsmNode): AsmNode {
  const fck = CONCRETE_CLASSES.find((c) => c.id === s.conc)?.fck ?? 20;
  const num = (v: string) => (v.trim() === "" ? Infinity : Number(v.replace(",", ".")));
  const stack: StackLayer[] = s.stack ?? [];
  return { ...n, base: { ...(n.base ?? {}),
    plate: { L: s.L, B: s.B, t: s.t, steel: s.plSteel, chamfer: s.chamfer },
    ribs: { web: s.ribs, tips: s.ribTips, hr: s.hr, tr: s.tr, hr2: s.hr2 },
    weld: { kf: s.kf, process: s.proc, milled: s.milled },
    anchors: { type: s.aType, d: s.ad, steel: s.aSteel, hef: s.ahef, nx: s.anx, ny: s.any, sx: s.asx, sy: s.asy, points: s.aFree && s.aPts.length ? s.aPts : undefined,
      tauRk: s.aTau, NRkp: s.aNRkp.trim() ? Number(s.aNRkp) * 1e3 : undefined },
    concrete: { fck, cracked: s.cracked, Lc: num(s.Lc), Bc: num(s.Bc), h: s.hc, grout: s.grout, reinforced: s.reinf },
    friction: s.friction, stack, offset: { x: s.ex, y: s.ey },
  } };
}
