// Сталеві вузли примикання і стики (ребро, торцева плита, фланці, накладки, фасонка, столик, консоль):
// деталі → болти і шви → сполучення; креслення в трьох проєкціях, клік по деталі відкриває її картку.
// Вузол може бути самостійним або відкритим зі «Збірки» (зусилля всіх сполучень підставлені, результат повертається назад).
import { NumInput } from "./NumInput";
import { useMemo, useState } from "react";
import {
  BOLT_CLASSES, BOLT_DIAMETERS, Check, checkJoint, CodeId, familiesFor, familySections, findSection, gussetMembersDefault, JDim, JointKind, JointParams,
  JointResult, JPart, jointSpec, JExtra, NodeCombo, Section, steel, STEELS,
} from "@structcalc/core";
import { jointDefaults } from "@structcalc/core";
import { CheckList, pct, T, utilState } from "./Results";
import { FamilyOptions } from "./SectionModule";
import { casesToCombos, NodeCase } from "./NodeModule";

export type JCombo = NodeCombo & { N1?: number; N2?: number; N3?: number };
export interface JMember { fam: string; size: string; steel: string; angle: number; Lw: number; kf: number; on: boolean }
export interface JX { id: string; kind: "plate" | "profile"; axis: "x" | "y" | "z"; a: number; b: number; t: number; cx: number; cy: number; cz: number; fam?: string; size?: string; rot?: boolean; steel?: string; name?: string }
export interface JointLink { member: string; end: "i" | "j"; node: string }
export interface JointState {
  kind: JointKind;
  p: Omit<JointParams, "members">;
  members: JMember[];
  bFam: string; bSize: string; bSteel: string;
  col: boolean; cFam: string; cSize: string; cSteel: string; face: "flange" | "web";
  plSteel: string;
  /** зусилля у кН, кН·м */
  combos: JCombo[]; cMode: "manual" | "cases"; cases: NodeCase[];
  gammaC: number; gammaN: number;
  sel: string;
  link?: JointLink;
  /** свої деталі: пластини, ребра, профілі (у креслення і специфікацію) */
  extras?: JX[];
  obj?: string; elem?: string;
}
export interface JointReturn { member: string; end: "i" | "j"; kind: JointKind; util: number; ok: boolean; gov: string }

const MOM = new Set(["My", "Mz", "T"]);
const FK = ["N", "My", "Mz", "Vz", "Vy", "T", "P", "H", "Q", "N1", "N2", "N3"] as const;
const toKN = (c: JCombo): JCombo => {
  const o: Record<string, number | string> = { name: c.name };
  for (const k of FK) { const v = (c as unknown as Record<string, number | undefined>)[k]; if (v) o[k] = Math.round((v / (MOM.has(k) ? 1e6 : 1e3)) * 1000) / 1000; }
  return o as unknown as JCombo;
};
const toN = (c: JCombo): JCombo => {
  const o: Record<string, number | string> = { name: c.name };
  for (const k of FK) { const v = (c as unknown as Record<string, number | undefined>)[k]; if (v) o[k] = v * (MOM.has(k) ? 1e6 : 1e3); }
  return o as unknown as JCombo;
};

export const isJointKind = (k: string | null | undefined): k is JointKind =>
  !!k && ["finPlate", "endPlate", "flangeSplice", "coverSplice", "gusset", "beamSeat", "cantilever"].includes(k);

/** Типовий вузол заданого виду */
export function jointInit(kind: JointKind, code: CodeId): JointState {
  const d = jointDefaults(kind, code);
  const st = code === "DBN" ? "C245" : "S235";
  const { members: _m, ...p } = d.p;
  const members = kind === "gusset"
    ? gussetMembersDefault(findSection, code).map((m) => ({ fam: m.sec.family ?? "RHS_COLD", size: m.sec.name, steel: m.steel, angle: m.angle, Lw: m.Lw, kf: m.kf, on: m.on }))
    : [];
  return {
    kind, p, members, bFam: d.beam[0], bSize: d.beam[1], bSteel: st,
    col: !!d.column, cFam: d.column?.[0] ?? "HEB", cSize: d.column?.[1] ?? "HEB 300", cSteel: st, face: "flange",
    plSteel: st, combos: d.combos.map(toKN), cMode: "manual",
    cases: [{ label: "G", cat: "G", gf: code === "DBN" ? 1.1 : 1.35, ...halfOf(d.combos[0], 0.6) }, { label: "Q", cat: "Q", gf: code === "DBN" ? 1.2 : 1.5, ...halfOf(d.combos[0], 0.3) }],
    gammaC: 1, gammaN: 1, sel: kind === "gusset" ? "gusset" : kind === "coverSplice" ? "covers" : kind === "beamSeat" ? "seat" : kind === "cantilever" ? "beam" : "plate",
  };
}
function halfOf(c: JCombo, f: number): Partial<NodeCase> {
  const k = toKN(c), o: Record<string, number> = {};
  for (const key of FK) { const v = (k as unknown as Record<string, number | undefined>)[key]; if (v) o[key] = Math.round(v * f * 10) / 10; }
  return o;
}

const COLS: Record<JointKind, string[]> = {
  finPlate: ["N", "Vz"], endPlate: ["N", "My", "Vz", "Vy", "Mz"], flangeSplice: ["N", "My", "Vz", "Vy", "Mz"], coverSplice: ["N", "My", "Vz"],
  gusset: ["N1", "N2", "N3"], beamSeat: ["Vz"], cantilever: ["P", "H", "Q"],
};
const colsOf = (s: JointState) => (s.kind === "cantilever" && (s.link || s.combos.some((c) => c.My || c.N || c.Vz)) ? ["P", "H", "Q", "N", "My", "Vz"] : COLS[s.kind]);

// конструктивні вимоги (катети, довжини швів) не перекривають міцність, поки виконуються
const DETAIL = new Set(["weldKfMin", "weldKfMax", "weldAmin", "weldLmin", "weldLflank", "weldLong"]);
const baseKey = (k: string) => k.replace(/^j(W|Wg|Wr|Ws|F|Wb)_/, "");
function gov<C extends { key: string; util: number }>(cs: C[]): C | undefined {
  const pick = (l: C[]) => l.reduce<C | undefined>((a, b) => (!a || !(b.util <= a.util) ? b : a), undefined);
  const bad = cs.filter((c) => DETAIL.has(baseKey(c.key)) && !(c.util <= 1));
  return bad.length ? pick(bad) : pick(cs.filter((c) => !DETAIL.has(baseKey(c.key)))) ?? pick(cs);
}

/** До якої деталі відноситься перевірка (для підсвічування і карток) */
function partOf(kind: JointKind, c: Check): string {
  const k = c.key, m = /стрижень (\d)/.exec(c.clause);
  if (k.startsWith("jF_")) return "bolts";
  if (k.startsWith("jWb_")) return "webBolts";
  if (k.startsWith("jWg_")) return "welds";
  if (k.startsWith("jWr_")) return "rib";
  if (k.startsWith("jWs_")) return "seat";
  if (k.startsWith("jW_")) return kind === "gusset" && m ? `m${m[1]}` : "welds";
  if (k.startsWith("bolt") || k === "friction") return "bolts";
  if (["jPlateShear", "jPlateShearNet", "jPlateBend", "jBlockTear", "jTStubPlate"].includes(k)) return "plate";
  if (["jBeamWebShear", "jFlangeNet", "jCantRoot"].includes(k)) return "beam";
  if (k.startsWith("jTStubColumn") || k.startsWith("jColWeb")) return "column";
  if (k.startsWith("jCover")) return "covers";
  if (k === "jWebCover") return "webCovers";
  if (k.startsWith("jWhitmore") || k.startsWith("jGusset")) return "gusset";
  if (k.startsWith("jRib")) return "rib";
  return "";
}

// ---------------------------------------------------------------- креслення в трьох проєкціях

type Ax = "x" | "y" | "z";
type View = "front" | "top" | "side";
const VIEWS: Record<View, { u: Ax; v: Ax; d: Ax }> = { front: { u: "x", v: "z", d: "y" }, top: { u: "x", v: "y", d: "z" }, side: { u: "y", v: "z", d: "x" } };
const POLY_AX: Record<Ax, [Ax, Ax]> = { x: ["y", "z"], y: ["x", "z"], z: ["x", "y"] };
type Shape = { part: JPart; depth: number; poly?: [number, number][]; hole?: [number, number][]; rect?: [number, number, number, number]; lines: { a: [number, number]; b: [number, number]; hid?: boolean }[] };

function projectPart(pt: JPart, view: View): Shape {
  const V = VIEWS[view], pa = POLY_AX[pt.axis];
  if (pt.axis === V.d) return { part: pt, depth: pt.to, poly: pt.poly, hole: pt.hole, lines: [] };
  const w = pt.axis === V.u ? V.v : V.u, iw = pa.indexOf(w), id = pa.indexOf(V.d);
  const vals = pt.poly.map((q) => q[iw]), lo = Math.min(...vals), hi = Math.max(...vals);
  const depth = Math.max(...pt.poly.map((q) => q[id]));
  const edges = pt.cls.includes("bolt") || pt.poly.length > 12 ? [] : [...new Set(vals.map((x) => Math.round(x * 10) / 10))].filter((x) => x > lo + 0.05 && x < hi - 0.05);
  const holes = pt.hole ? [...new Set(pt.hole.map((q) => Math.round(q[iw] * 10) / 10))] : [];
  const seg = (x: number, hid?: boolean) => (pt.axis === V.u ? { a: [pt.from, x] as [number, number], b: [pt.to, x] as [number, number], hid } : { a: [x, pt.from] as [number, number], b: [x, pt.to] as [number, number], hid });
  const rect: [number, number, number, number] = pt.axis === V.u ? [pt.from, lo, pt.to, hi] : [lo, pt.from, hi, pt.to];
  return { part: pt, depth, rect, lines: [...edges.map((x) => seg(x)), ...(pt.hole && pt.hole.length <= 12 ? holes.map((x) => seg(x, true)) : [])] };
}

const VIEW_W = 320;
function JointView({ view, parts, dims, sel, onPick, utilOf, title, interactive }: {
  view: View; parts: JPart[]; dims: JDim[]; sel: string; onPick: (id: string) => void; utilOf: (id: string) => number | undefined; title: string; interactive: boolean;
}) {
  const shapes = parts.map((p) => projectPart(p, view)).sort((a, b) => a.depth - b.depth);
  const ds = dims.filter((d) => d.view === view);
  const us: number[] = [], vs: number[] = [];
  for (const s of shapes) {
    if (s.poly) for (const [u, v] of s.poly) { us.push(u); vs.push(v); }
    if (s.rect) { us.push(s.rect[0], s.rect[2]); vs.push(s.rect[1], s.rect[3]); }
  }
  for (const d of ds) { us.push(d.a[0], d.b[0]); vs.push(d.a[1], d.b[1]); }
  const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
  const pad = 22, W = VIEW_W;
  const H = Math.round(Math.max(170, Math.min(340, ((v1 - v0) / Math.max(1, u1 - u0)) * (W - 2 * pad) + 2 * pad)));
  const sc = Math.min((W - 2 * pad) / Math.max(1, u1 - u0), (H - 2 * pad) / Math.max(1, v1 - v0));
  const ox = (W - (u1 - u0) * sc) / 2, oy = (H - (v1 - v0) * sc) / 2;
  const X = (u: number) => ox + (u - u0) * sc, Y = (v: number) => H - oy - (v - v0) * sc;
  const pts = (l: [number, number][]) => l.map(([u, v]) => `${X(u).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const cls = (p: JPart) => {
    const u = utilOf(p.id);
    return `jp ${p.cls.split(" ").map((c) => `jp-${c}`).join(" ")} ${sel === p.id ? "on" : ""} ${u !== undefined && u > 1 + 1e-9 ? "bad" : ""}`;
  };
  return (
    <figure className="jview">
      <svg viewBox={`0 0 ${W} ${H}`} className="conn-scheme node-scheme joint-scheme" role="img" aria-label={view}>
        {shapes.map((s, k) => (
          <g key={k} className={`${cls(s.part)} ${interactive ? "pick" : ""}`} onClick={interactive ? () => onPick(s.part.id) : undefined}>
            {s.poly && <path d={`M${pts(s.poly)}Z${s.hole ? `M${pts(s.hole)}Z` : ""}`} fillRule="evenodd" />}
            {s.rect && <rect x={X(s.rect[0])} y={Y(s.rect[3])} width={Math.max(0.8, (s.rect[2] - s.rect[0]) * sc)} height={Math.max(0.8, (s.rect[3] - s.rect[1]) * sc)} />}
            {s.lines.map((l, j) => <line key={j} x1={X(l.a[0])} y1={Y(l.a[1])} x2={X(l.b[0])} y2={Y(l.b[1])} className={l.hid ? "hid" : "edge"} />)}
          </g>
        ))}
        {ds.map((d, k) => {
          const same = d.a[0] === d.b[0] && d.a[1] === d.b[1];
          const mx = (X(d.a[0]) + X(d.b[0])) / 2, my = (Y(d.a[1]) + Y(d.b[1])) / 2, vert = Math.abs(X(d.a[0]) - X(d.b[0])) < 1;
          return <g key={`d${k}`} className={`jdim ${interactive && d.part ? "pick" : ""}`} onClick={interactive && d.part ? () => onPick(d.part!) : undefined}>
            {!same && <line x1={X(d.a[0])} y1={Y(d.a[1])} x2={X(d.b[0])} y2={Y(d.b[1])} className="cs-dim" />}
            <text x={vert ? mx + 4 : mx} y={vert ? my : my - 4} textAnchor={vert ? "start" : "middle"} className="s-text small">{d.text}</text>
          </g>;
        })}
      </svg>
      <figcaption>{title}</figcaption>
    </figure>
  );
}

export function JointViews({ r, sel, onPick, utilOf, t, interactive = true }: { r: JointResult; sel: string; onPick: (id: string) => void; utilOf: (id: string) => number | undefined; t: T; interactive?: boolean }) {
  return (
    <div className="jviews">
      {(["front", "top", "side"] as View[]).map((v) => <JointView key={v} view={v} parts={r.parts} dims={r.dims} sel={sel} onPick={onPick} utilOf={utilOf} title={t(`jv_${v}`)} interactive={interactive} />)}
    </div>
  );
}

// ---------------------------------------------------------------- модуль

const num = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(",", ".")));
function Num({ id, label, v, on, step }: { id: string; label: string; v: number; on: (n: number) => void; step?: number }) {
  return <label><span className="lbl">{label}</span><NumInput id={id} step={step ?? 1} value={v} onChange={(e) => on(num(e.target.value))} /></label>;
}

const BEAM_SHAPES: Record<JointKind, string[]> = {
  finPlate: ["I"], endPlate: ["I"], flangeSplice: ["I", "RHS", "CHS"], coverSplice: ["I"], gusset: ["I", "RHS", "CHS"], beamSeat: ["I"], cantilever: ["I", "RHS", "CHS"],
};
const KIND_COLUMN: JointKind[] = ["finPlate", "endPlate", "beamSeat", "cantilever"];

export function JointModule({ code, s, set, t, back, onReturn }: {
  code: CodeId; s: JointState; set: (p: Partial<JointState>) => void; t: T; back: () => void; onReturn?: (r: JointReturn) => void;
}) {
  const [tab, setTab] = useState<"results" | "report">("results");
  const steels = STEELS.filter((x) => x.code === code);
  const okSteel = (id: string) => (steels.some((x) => x.id === id) ? id : steels[0].id);
  const kind = s.kind;
  // переклад ключів перевірок з префіксом деталі: jW_weldMetal → «Шви: метал шва»
  const tj: T = (k) => {
    const m = /^chk_j(W|Wg|Wr|Ws|F|Wb)_(.+)$/.exec(k);
    if (m) return `${t(`jpre_${m[1]}${m[1] === "W" && kind === "gusset" ? "m" : ""}`)} · ${t(`chk_${m[2]}`).replace(/^(Шов|Weld)[:\s]\s*/i, "")}`;
    return t(k);
  };
  const fams = familiesFor(kind === "gusset" || kind === "cantilever" || kind === "flangeSplice" ? "node" : "beam").filter((f) => !f.shape || BEAM_SHAPES[kind].includes(f.shape));
  const secOf = (fam: string, size: string, shapes: string[]): Section => {
    const l = (() => { try { return familySections(fam).filter((x) => shapes.includes(x.kind)); } catch { return []; } })();
    return l.find((x) => x.name === size) ?? l[Math.floor(l.length / 3)] ?? findSection("IPE", "IPE 300")!;
  };
  const beam = secOf(s.bFam, s.bSize, BEAM_SHAPES[kind]);
  const column = secOf(s.cFam, s.cSize, ["I"]);
  const hasCol = KIND_COLUMN.includes(kind) && s.col;
  const members = s.members.map((m) => ({ ...m, sec: secOf(m.fam, m.size, ["RHS", "CHS", "L", "C", "I"]) }));
  const xs = s.extras ?? [];
  const extras: JExtra[] = xs.map((x) => ({ id: x.id, kind: x.kind, axis: x.axis, a: x.a, b: x.b, t: x.t, c: [x.cx, x.cy, x.cz] as [number, number, number], rot: x.rot,
    sec: x.kind === "profile" ? secOf(x.fam ?? "RHS_COLD", x.size ?? "", ["I", "RHS", "CHS", "C", "L"]) : undefined }));
  const src = s.cMode === "cases" ? casesToCombos(s.cases as NodeCase[], code).map((x) => x.combo as JCombo) : s.combos;

  const calc = useMemo((): { r?: JointResult; err?: string } => {
    try {
      return { r: checkJoint({
        code, kind, beam, beamSteel: okSteel(s.bSteel), column: hasCol ? column : undefined, colSteel: okSteel(s.cSteel), colFace: s.face,
        plateSteel: okSteel(s.plSteel), p: { ...s.p, members: members.map((m) => ({ sec: m.sec, steel: okSteel(m.steel), angle: m.angle, Lw: m.Lw, kf: m.kf, on: m.on })) },
        combos: src.map(toN), gammaC: s.gammaC, gammaN: s.gammaN, extras,
      }) };
    } catch (e) { return { err: String((e as Error).message) }; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, s, beam, column]);
  const r = calc.r;
  const utilMap = useMemo(() => {
    const m = new Map<string, Check[]>();
    for (const c of r?.envelope ?? []) { const id = partOf(kind, c); if (!id) continue; m.set(id, [...(m.get(id) ?? []), c]); }
    return m;
  }, [r, kind]);
  const utilOf = (id: string) => { const l = utilMap.get(id); return l ? gov(l)?.util : undefined; };

  const P = s.p;
  const setP = (q: Partial<JointState["p"]>) => set({ p: { ...P, ...q } });
  const F = (key: keyof JointState["p"], step?: number) => (
    <Num key={key} id={`jp-${key}`} label={t(`jp_${key}`)} v={P[key] as number} step={step} on={(v) => setP({ [key]: v } as Partial<JointState["p"]>)} />
  );
  const Chk = (key: "friction" | "inner") => (
    <label key={key} className="wide chk"><input id={`jp-${key}`} type="checkbox" checked={P[key]} onChange={(e) => setP({ [key]: e.target.checked })} />{t(`jp_${key}`)}</label>
  );
  const steelSel = (id: string, v: string, on: (v: string) => void, lbl = "material") => (
    <label><span className="lbl">{t(lbl)}</span><select id={id} value={okSteel(v)} onChange={(e) => on(e.target.value)}>{steels.map((x) => <option key={x.id}>{x.id}</option>)}</select></label>
  );
  const secSel = (pre: string, fam: string, size: string, shapes: string[], famList: typeof fams, on: (fam: string, size: string) => void) => {
    const list = (() => { try { return familySections(fam).filter((x) => shapes.includes(x.kind)); } catch { return []; } })();
    return <>
      <label><span className="lbl">{t("family")}</span><select id={`${pre}-fam`} value={fam} onChange={(e) => { const l = familySections(e.target.value).filter((x) => shapes.includes(x.kind)); on(e.target.value, l[Math.floor(l.length / 3)]?.name ?? ""); }}>
        <FamilyOptions fams={famList} t={t} /></select></label>
      <label><span className="lbl">{t("size")}</span><select id={`${pre}-size`} value={list.some((x) => x.name === size) ? size : list[Math.floor(list.length / 3)]?.name} onChange={(e) => on(fam, e.target.value)}>{list.map((x) => <option key={x.name}>{x.name}</option>)}</select></label>
    </>;
  };
  const boltSel = <>
    <label><span className="lbl">{t("bo_d")}</span><select id="jp-d" value={P.d} onChange={(e) => setP({ d: Number(e.target.value) })}>{BOLT_DIAMETERS.map((x) => <option key={x} value={x}>M{x}</option>)}</select></label>
    <label><span className="lbl">{t("bo_class")}</span><select id="jp-cls" value={P.cls} onChange={(e) => setP({ cls: e.target.value })}>{Object.keys(BOLT_CLASSES).map((c) => <option key={c}>{c}</option>)}</select></label>
  </>;
  const colFams = familiesFor("beam").filter((f) => !f.shape || f.shape === "I");

  // ---- картки деталей
  type Card = { id: string; group: "part" | "joint"; title: string; sum: string; body: JSX.Element };
  const cards: Card[] = [];
  const beamTitle = t(kind === "gusset" ? "jc_chord" : kind === "cantilever" ? "jc_cant" : "jc_beam");
  cards.push({ id: "beam", group: "part", title: beamTitle, sum: `${beam.name} · ${okSteel(s.bSteel)}${kind === "cantilever" ? ` · a = ${P.lever}` : ""}`, body: <div className="grid2">
    {secSel("jb", s.bFam, beam.name, BEAM_SHAPES[kind], fams, (f, z) => set({ bFam: f, bSize: z }))}
    {steelSel("jb-st", s.bSteel, (v) => set({ bSteel: v }))}
    {kind === "cantilever" && F("lever")}
    {(kind === "finPlate" || kind === "beamSeat" || kind === "coverSplice") && F("gap")}
  </div> });
  if (KIND_COLUMN.includes(kind)) cards.push({ id: "column", group: "part", title: t("jc_column"), sum: s.col ? `${column.name} · ${t(`jface_${s.face}`)}` : t("jc_noColumn"), body: <div className="grid2">
    <label className="wide chk"><input id="jc-on" type="checkbox" checked={s.col} onChange={(e) => set({ col: e.target.checked })} />{t("jc_hasColumn")}</label>
    {s.col && <>
      {secSel("jc", s.cFam, column.name, ["I"], colFams, (f, z) => set({ cFam: f, cSize: z }))}
      {steelSel("jc-st", s.cSteel, (v) => set({ cSteel: v }))}
      <label><span className="lbl">{t("jc_face")}</span><select id="jc-face" value={s.face} onChange={(e) => set({ face: e.target.value as JointState["face"] })}>{(["flange", "web"] as const).map((f) => <option key={f} value={f}>{t(`jface_${f}`)}</option>)}</select></label>
    </>}
    {s.col && s.face === "flange" && (kind === "endPlate" || kind === "cantilever") && <>
      <label className="wide chk"><input id="jp-colStiff" type="checkbox" checked={!!P.colStiff} onChange={(e) => setP({ colStiff: e.target.checked, tsc: P.tsc ?? 12 })} />{t("jp_colStiff")}</label>
      {P.colStiff && <Num id="jp-tsc" label={t("jp_tsc")} v={P.tsc ?? 12} on={(v) => setP({ tsc: v })} />}
    </>}
    {!s.col && <p className="hint wide">{t("jc_noColumnHint")}</p>}
  </div> });
  const plSel = steelSel("jpl-st", s.plSteel, (v) => set({ plSteel: v }));
  if (kind === "finPlate") cards.push({ id: "plate", group: "part", title: t("jc_fin"), sum: `${P.hp}×${P.bp}×${P.tp} · ${okSteel(s.plSteel)}`, body: <div className="grid2">{F("tp")}{F("hp")}{F("bp")}{plSel}</div> });
  if (kind === "endPlate" || kind === "flangeSplice") cards.push({ id: "plate", group: "part", title: t(kind === "endPlate" ? "jc_endPlate" : "jc_flanges"), sum: `${Math.round(beam.h + 2 * P.ext)}×${P.bp}×${P.tp} · ${okSteel(s.plSteel)}`, body: <div className="grid2">{F("tp")}{F("bp")}{F("ext", 5)}{plSel}<p className="hint wide">{t("jc_extHint")}</p></div> });
  if (kind === "coverSplice") {
    cards.push({ id: "covers", group: "part", title: t("jc_covers"), sum: `t = ${P.tcf}${P.inner ? ` + ${t("jc_inner")}` : ""} · ${okSteel(s.plSteel)}`, body: <div className="grid2">{F("tcf")}{F("lcf", 10)}{Chk("inner")}{plSel}</div> });
    cards.push({ id: "webCovers", group: "part", title: t("jc_webCovers"), sum: `2 × t = ${P.tcw}`, body: <div className="grid2">{F("tcw")}{F("hcw", 10)}</div> });
  }
  if (kind === "gusset") {
    cards.push({ id: "gusset", group: "part", title: t("jc_gusset"), sum: `${P.lg}×${P.hg}×${P.tg} · ${okSteel(s.plSteel)}`, body: <div className="grid2">{F("tg")}{F("hg", 10)}{F("lg", 10)}{F("cfree", 5)}{plSel}<p className="hint wide">{t("jc_gussetHint")}</p></div> });
    members.forEach((m, k) => {
      const up = (q: Partial<JMember>) => set({ members: s.members.map((x, j) => (j === k ? { ...x, ...q } : x)) });
      cards.push({ id: `m${k + 1}`, group: "part", title: `${t("jc_member")} ${k + 1}`, sum: m.on ? `${m.sec.name} · ${m.angle}° · N${k + 1}` : t("jc_off"), body: <div className="grid2">
        <label className="wide chk"><input id={`jm${k}-on`} type="checkbox" checked={m.on} onChange={(e) => up({ on: e.target.checked })} />{t("jc_memberOn")}</label>
        {secSel(`jm${k}`, m.fam, m.sec.name, ["RHS", "CHS", "L", "C", "I"], familiesFor("column"), (f, z) => up({ fam: f, size: z }))}
        {steelSel(`jm${k}-st`, m.steel, (v) => up({ steel: v }))}
        <Num id={`jm${k}-a`} label={t("jc_angle")} v={m.angle} step={5} on={(v) => up({ angle: v })} />
        <Num id={`jm${k}-lw`} label={t("jc_Lw")} v={m.Lw} step={10} on={(v) => up({ Lw: v })} />
        <Num id={`jm${k}-kf`} label={t("w_kf")} v={m.kf} on={(v) => up({ kf: v })} />
        <p className="hint wide">{t("jc_angleHint")}</p>
      </div> });
    });
  }
  if (kind === "beamSeat") {
    cards.push({ id: "seat", group: "part", title: t("jc_seat"), sum: `${P.bs}×${P.hs}×${P.ts} · k_f ${P.kf}`, body: <div className="grid2">{F("ts")}{F("bs", 10)}{F("hs", 10)}{F("kf")}{F("kV", 0.05)}{plSel}<p className="hint wide">{t("jc_seatHint")}</p></div> });
    cards.push({ id: "rib", group: "part", title: t("jc_rib"), sum: `${P.br}×${P.tr} · a = ${P.ar}`, body: <div className="grid2">{F("tr")}{F("br", 10)}{F("ar", 5)}{F("kf2")}</div> });
  }
  // ---- болти і шви
  if (kind === "finPlate") cards.push({ id: "bolts", group: "joint", title: t("jc_bolts"), sum: `${P.rows * P.cols} × M${P.d} ${P.cls}`, body: <div className="grid2">{boltSel}{F("rows")}{F("cols")}{F("p", 5)}{F("pc", 5)}{F("e1", 5)}{Chk("friction")}</div> });
  if (kind === "endPlate" || kind === "flangeSplice") cards.push({ id: "bolts", group: "joint", title: t("jc_bolts"), sum: `${r?.values.find((v) => v.k.startsWith("Рядів"))?.v.split(" / ")[1] ?? "—"} × M${P.d} ${P.cls}`, body: <div className="grid2">
    {boltSel}{F("g", 5)}{F("e1", 5)}{F("rowsIn")}{F("ef", 5)}{F("p", 5)}{Chk("friction")}<p className="hint wide">{t("jc_rowsHint")}</p></div> });
  if (kind === "coverSplice") {
    cards.push({ id: "bolts", group: "joint", title: t("jc_flangeBolts"), sum: `2 × 2 × ${P.nbf * P.nlf} × M${P.d} ${P.cls}`, body: <div className="grid2">{boltSel}{F("nbf")}{F("nlf")}{F("pf", 5)}{F("g", 5)}{F("e1", 5)}{Chk("friction")}</div> });
    cards.push({ id: "webBolts", group: "joint", title: t("jc_webBolts"), sum: `2 × ${P.nrw * P.ncw} × M${P.d}`, body: <div className="grid2">{F("nrw")}{F("ncw")}{F("pw", 5)}{F("pcw", 5)}</div> });
  }
  if (kind !== "beamSeat") cards.push({ id: "welds", group: "joint", title: t(kind === "gusset" ? "jc_wGusset" : kind === "finPlate" ? "jc_wFin" : "jc_wProfile"), sum: `k_f = ${P.kf}${kind === "endPlate" || kind === "flangeSplice" || kind === "cantilever" ? ` / ${P.kf2}` : ""}`, body: <div className="grid2">
    {F("kf")}{(kind === "endPlate" || kind === "flangeSplice" || kind === "cantilever") && F("kf2")}
    {kind === "gusset" && <p className="hint wide">{t("jc_wMembersHint")}</p>}</div> });

  // ---- свої деталі
  const bh = beam.h, btw = beam.dims.tw ?? beam.dims.t ?? 8;
  const addExtra = (k: "plate" | "rib" | "profile") => {
    const ids = xs.map((x) => x.id); let n = 1; while (ids.includes(`x${n}`)) n++;
    const id = `x${n}`;
    const x: JX = k === "plate" ? { id, kind: "plate", axis: "z", a: 200, b: 160, t: 10, cx: 150, cy: 0, cz: -bh / 2 - 5 }
      : k === "rib" ? { id, kind: "plate", axis: "y", a: 80, b: Math.round(bh - 2 * (beam.dims.tf ?? 10)), t: 8, cx: 250, cy: btw / 2 + 4, cz: 0 }
      : { id, kind: "profile", axis: "z", a: 400, b: 0, t: 0, cx: 300, cy: 0, cz: -bh / 2 - 200, fam: "RHS_COLD", size: "80×80×4" };
    set({ extras: [...xs, { ...x, steel: s.plSteel, name: `${t(`jx_add_${k}`)} ${n}` }], sel: id });
  };
  const AXN = { x: ["y", "z"], y: ["x", "z"], z: ["x", "y"] } as const;
  xs.forEach((x, k) => {
    const up = (q: Partial<JX>) => set({ extras: xs.map((e, j) => (j === k ? { ...e, ...q } : e)) });
    const [u, v] = AXN[x.axis];
    const sec = extras[k].sec;
    const sum = x.kind === "plate" ? `${x.a}×${x.b}×${x.t} · ⊥${x.axis}` : `${sec?.name ?? ""} · L = ${x.a} · ∥${x.axis}`;
    cards.push({ id: x.id, group: "part", title: x.name || `${t(x.kind === "plate" ? "jx_plate" : "jx_profile")} ${x.id}`, sum, body: <div className="grid2">
      <label className="wide"><span className="lbl">{t("jx_name")}</span><input id={`${x.id}-name`} value={x.name ?? ""} placeholder={`${t(x.kind === "plate" ? "jx_plate" : "jx_profile")} ${x.id}`} onChange={(e) => up({ name: e.target.value })} /></label>
      <label className="wide"><span className="lbl">{t(x.kind === "plate" ? "jx_normal" : "jx_axis")}</span><select id={`${x.id}-ax`} value={x.axis} onChange={(e) => up({ axis: e.target.value as JX["axis"] })}>
        {(["x", "y", "z"] as const).map((a) => <option key={a} value={a}>{t(`jx_${x.kind === "plate" ? "n" : "a"}_${a}`)}</option>)}</select></label>
      {x.kind === "plate" ? <>
        <Num id={`${x.id}-a`} label={`${t("jx_size")} ${u}, mm`} v={x.a} step={10} on={(n) => up({ a: Math.max(1, n) })} />
        <Num id={`${x.id}-b`} label={`${t("jx_size")} ${v}, mm`} v={x.b} step={10} on={(n) => up({ b: Math.max(1, n) })} />
        <Num id={`${x.id}-t`} label={t("jp_tp")} v={x.t} on={(n) => up({ t: Math.max(1, n) })} />
      </> : <>
        {secSel(x.id, x.fam ?? "RHS_COLD", sec?.name ?? "", ["I", "RHS", "CHS", "C", "L"], familiesFor("column"), (f, z) => up({ fam: f, size: z }))}
        <Num id={`${x.id}-a`} label={t("jx_len")} v={x.a} step={10} on={(n) => up({ a: Math.max(1, n) })} />
        <label className="chk"><input id={`${x.id}-rot`} type="checkbox" checked={!!x.rot} onChange={(e) => up({ rot: e.target.checked })} />{t("jx_rot")}</label>
      </>}
      {steelSel(`${x.id}-st`, x.steel ?? s.plSteel, (v2) => up({ steel: v2 }))}
      <Num id={`${x.id}-cx`} label="x, mm" v={x.cx} step={10} on={(n) => up({ cx: n })} />
      <Num id={`${x.id}-cy`} label="y, mm" v={x.cy} step={5} on={(n) => up({ cy: n })} />
      <Num id={`${x.id}-cz`} label="z, mm" v={x.cz} step={10} on={(n) => up({ cz: n })} />
      <p className="hint wide">{t("jx_hint")}</p>
      <button className="ghost danger wide" id={`${x.id}-del`} onClick={() => set({ extras: xs.filter((_, j) => j !== k), sel: "" })}>{t("np_remove")}</button>
    </div> });
  });
  const spec = r ? jointSpec(r.parts, extras) : [];
  const specName = (id: string) => (id === "colStiff" ? t("jp_colStiff") : id === "webBolts" ? t("jc_webBolts") : cards.find((c) => c.id === id)?.title ?? id);
  const specMass = spec.reduce((a, x) => a + x.mass, 0);
  const specTable = r && (
    <table className="conn-values"><thead><tr><th>{t("jx_part")}</th><th>{t("jx_dims")}</th><th>{t("jx_n")}</th><th>{t("jx_mass")}</th></tr></thead>
      <tbody>{spec.map((x, k) => <tr key={k}><td>{specName(x.id)}</td><td className="mono">{x.size}</td><td className="mono">{x.n}</td><td className="mono">{x.mass > 0 ? x.mass.toFixed(1) : "—"}</td></tr>)}
        <tr><td><b>{t("jx_total")}</b></td><td /><td /><td className="mono"><b>{specMass.toFixed(1)}</b></td></tr></tbody></table>
  );

  const open = (id: string) => set({ sel: s.sel === id ? "" : id });
  const card = (x: Card) => {
    const u = utilOf(x.id);
    return (
      <div key={x.id} className={`part ${s.sel === x.id ? "open" : ""}`}>
        <button className="part-head" id={`part-${x.id}`} onClick={() => open(x.id)}>
          <span className={`part-dot ${x.group}`} /><span className="part-title">{x.title}</span>
          <span className="part-sum">{x.sum}{u !== undefined && <b className={`jutil ${utilState(u)}`}>{pct(u)}</b>}</span>
        </button>
        {s.sel === x.id && <div className="part-body">{x.body}</div>}
      </div>
    );
  };

  // ---- сполучення
  const cols = colsOf(s);
  const colLbl = (c: string) => t(c === "N" ? "jcol_N" : `nl_${c}`);
  const setCombo = (k: number, q: Partial<JCombo>) => set({ combos: s.combos.map((c, j) => (j === k ? { ...c, ...q } : c)) });
  const val = (c: JCombo | NodeCase, col: string) => (c as unknown as Record<string, unknown>)[col] as number | undefined;
  const loads = (
    <div className="combo-table">
      <table>
        <thead><tr><th>№</th>{cols.map((c) => <th key={c}>{colLbl(c)}</th>)}<th /></tr></thead>
        <tbody>{s.combos.map((c, k) => (
          <tr key={k}>
            <td><input id={`jcn${k}`} className="cname" value={c.name} onChange={(e) => setCombo(k, { name: e.target.value })} /></td>
            {cols.map((col) => <td key={col}><NumInput id={`jc${col}${k}`} value={val(c, col) ?? ""} placeholder="0" onChange={(e) => setCombo(k, { [col]: e.target.value === "" ? undefined : num(e.target.value) })} /></td>)}
            <td>{s.combos.length > 1 && <button className="ghost xbtn" aria-label="remove" onClick={() => set({ combos: s.combos.filter((_, j) => j !== k) })}>×</button>}</td>
          </tr>))}
        </tbody>
      </table>
      <button id="jaddcombo" className="ghost" onClick={() => set({ combos: [...s.combos, { name: String(s.combos.length + 1) }] })}>+ {t("nl_add")}</button>
      <p className="hint">{t(`jl_hint_${kind}`)}</p>
    </div>
  );
  const GFk = (cat: string) => (code === "DBN" ? { G: 1.1, L: 1.2, Q: 1.4, A: 1 } : { G: 1.35, L: 1.5, Q: 1.5, A: 1 })[cat as "G"] ?? 1;
  const setCase = (k: number, q: Partial<NodeCase>) => set({ cases: s.cases.map((c, j) => (j === k ? { ...c, ...q } : c)) });
  const gen = s.cMode === "cases" ? casesToCombos(s.cases as NodeCase[], code) : [];
  const casesTable = (
    <div className="combo-table">
      <table>
        <thead><tr><th>{t("nl_case")}</th><th>{t("nl_cat")}</th><th>γ_f</th>{cols.map((c) => <th key={c}>{colLbl(c)}</th>)}<th /></tr></thead>
        <tbody>{s.cases.map((c, k) => (
          <tr key={k}>
            <td><input id={`jkl${k}`} className="cname" value={c.label} onChange={(e) => setCase(k, { label: e.target.value })} /></td>
            <td><select id={`jkc${k}`} value={c.cat} onChange={(e) => setCase(k, { cat: e.target.value as NodeCase["cat"], gf: GFk(e.target.value) })}>{["G", "L", "Q", "A"].map((x) => <option key={x}>{x}</option>)}</select></td>
            <td><NumInput id={`jkg${k}`} step={0.05} value={c.gf ?? GFk(c.cat)} onChange={(e) => setCase(k, { gf: num(e.target.value) })} /></td>
            {cols.map((col) => <td key={col}><NumInput id={`jk${col}${k}`} value={val(c, col) ?? ""} placeholder="0" onChange={(e) => setCase(k, { [col]: e.target.value === "" ? undefined : num(e.target.value) } as Partial<NodeCase>)} /></td>)}
            <td>{s.cases.length > 1 && <button className="ghost xbtn" aria-label="remove" onClick={() => set({ cases: s.cases.filter((_, j) => j !== k) })}>×</button>}</td>
          </tr>))}
        </tbody>
      </table>
      <button id="jaddcase" className="ghost" onClick={() => set({ cases: [...s.cases, { label: `Q${s.cases.length + 1}`, cat: "Q", gf: GFk("Q") }] })}>+ {t("nl_addCase")}</button>
      <p className="hint">{t("nl_casesHint")}</p>
      <details className="gen-list"><summary>{t("nl_generated")}: {gen.length}</summary>
        <ol>{gen.map((g) => <li key={g.combo.name}><b>{g.combo.name}</b> {g.text}</li>)}</ol>
      </details>
    </div>
  );

  // ---- результати
  const g = r ? gov(r.envelope) : undefined;
  const maxU = g?.util ?? 0;
  const st = r ? utilState(maxU) : "ok";
  const title = `${t(`nt_${kind}`)} · ${beam.name}`;
  const sub = cards.filter((c) => c.id !== "beam").map((c) => c.sum).slice(0, 3).join(" · ");
  const summary = r && (
    <div className={`summary ${st}`}>
      <div className="summary-main"><div className="eyebrow">{t("nd_node")}</div><div className="profile">{title}</div><div className="meta">{sub}</div></div>
      <div className="summary-util"><div className="eyebrow">{t("rep_maxutil")}</div><div className="big">{pct(maxU)}</div><div className={`pill ${st}`}>{maxU <= 1 + 1e-9 ? t("ok") : t("fail")}</div></div>
      {g && <div className="summary-gov"><div className="eyebrow">{t("governing")}</div><div>{tj(`chk_${g.key}`)}</div><div className="meta">{t("nl_combo")} {g.combo}</div></div>}
    </div>
  );
  const envelopeList = r && <CheckList checks={r.envelope.map((c) => ({ ...c, clause: `${c.clause} · ${t("nl_combo")} ${c.combo}` }))} t={tj} />;
  const comboTable = r && (
    <table className="conn-values combo-res"><thead><tr><th>{t("nl_combo")}</th>{cols.map((c) => <th key={c}>{colLbl(c)}</th>)}<th>{t("rep_maxutil")}</th></tr></thead>
      <tbody>{r.combos.map((c, k) => {
        const u = gov(c.checks)?.util ?? 0;
        return <tr key={k} className={utilState(u)}><td>{c.name}</td>{cols.map((col) => <td key={col} className="mono">{val(src[k], col) ?? 0}</td>)}<td className="mono">{pct(u)}</td></tr>;
      })}</tbody></table>
  );
  // ---- що змінити: для кожної перевірки, що не проходить, — порада і (де можна) виправлення одним кліком
  type Adv = { key: string; text: string; fix?: Partial<JointState["p"]> };
  const nextD = BOLT_DIAMETERS.find((d) => d > P.d);
  const advice: Adv[] = [];
  const fixSteel = new Map<string, string>();
  for (const c of r?.envelope ?? []) {
    if (c.util <= 1 + 1e-9) continue;
    const pre = /^j(W|Wg|Wr|Ws|F|Wb)_/.exec(c.key)?.[1], k = baseKey(c.key);
    const fill = (txt: string) => txt.replace("{d}", String(P.d)).replace("{dn}", String(nextD ?? P.d)).replace("{cls}", P.cls).replace("{tp}", String(P.tp)).replace("{kf}", String(pre === "Wr" ? P.kf2 : P.kf));
    let id = "", fix: Adv["fix"];
    if (k === "boltShear" || k === "boltBearing" || k === "friction") { id = k === "boltBearing" ? "bearing" : "boltShear"; fix = k === "boltBearing" ? (kind === "finPlate" ? { tp: P.tp + 2 } : undefined) : nextD ? { d: nextD } : undefined; }
    else if (k === "boltTension" || k === "boltShearTension") { id = "boltTension"; fix = P.cls !== "10.9" ? { cls: "10.9" } : nextD ? { d: nextD } : undefined; }
    else if (k === "jTStubPlate" || k === "jPunchPlate" || k.startsWith("jPlate") || k === "jBlockTear") { id = k === "jBlockTear" ? "blockTear" : "plateThicker"; fix = { tp: P.tp + (kind === "finPlate" ? 2 : 4) }; }
    else if (k === "jTStubColumn" || k === "jPunchColumn") id = "colFlange";
    else if (k === "jColWebPanel") id = "colPanel";
    else if (k === "jColWebComp") { id = P.colStiff ? "colStiffThicker" : "colStiff"; fix = P.colStiff ? { tsc: (P.tsc ?? 12) + 4 } : { colStiff: true, tsc: 12 }; }
    else if (["weldMetal", "weldFusion", "weldEN"].includes(k)) { id = pre === "W" && kind === "gusset" ? "weldMember" : "weldUp"; fix = pre === "Wr" ? { kf2: P.kf2 + 1 } : pre === "W" && kind === "gusset" ? undefined : pre === "W" && kind !== "finPlate" ? { kf: P.kf + 1, kf2: P.kf2 + 1 } : { kf: P.kf + 1 }; }
    else if (k === "weldKfMax") id = "weldKfMax";
    else if (k === "weldKfMin" || k === "weldAmin") { id = "weldKfMin"; fix = pre === "Wr" ? { kf2: P.kf2 + 1 } : pre === "W" && kind === "gusset" ? undefined : { kf: P.kf + 1 }; }
    else if (k === "weldLmin" || k === "weldLflank" || k === "weldLong") id = k;
    else if (k === "jBeamWebShear" || k === "jFlangeNet") id = "beamHoles";
    else if (k === "jCantRoot") id = "cantRoot";
    else if (k === "jCoverNet" || k === "jCoverGross") { id = "covers"; fix = { tcf: P.tcf + 4 }; }
    else if (k === "jWebCover") { id = "webCover"; fix = { tcw: P.tcw + 2 }; }
    else if (k === "jWhitmore" || k === "jGussetBuck" || k === "jGussetSec") { id = k === "jGussetBuck" ? "gussetBuck" : "gusset"; fix = { tg: P.tg + 2 }; }
    else if (k.startsWith("jRib")) { id = "rib"; fix = { tr: P.tr + 4 }; }
    else id = "generic";
    const key = `${id}|${pre ?? ""}`;
    // товща плита, якої сталь не має в сортаменті, — разом з найближчою сталлю, що її має
    if (fix?.tp) {
      const ok = (sid: string, th: number) => { try { return Number.isFinite(steel(sid).yieldChar(th, "sheet")); } catch { return false; } };
      if (!ok(okSteel(s.plSteel), fix.tp)) { const alt = steels.find((x) => ok(x.id, fix!.tp!)); if (alt) fixSteel.set(key, alt.id); }
    }
    if (!advice.some((x) => x.key === key)) advice.push({ key, text: `${tj(`chk_${c.key}`)} — ${fill(t(`adv_${id}`))}`, fix });
  }
  const adviceList = advice.length > 0 && (
    <ul className="compat advice">{advice.map((x) => <li key={x.key} className="bad"><span className="cmp-ic">→</span><span>{x.text}</span>
      {x.fix && <button className="ghost adv-fix" id={`fix-${x.key.replace("|", "-")}`} onClick={() => { const st2 = fixSteel.get(x.key); set({ p: { ...P, ...x.fix! }, ...(st2 ? { plSteel: st2 } : {}) }); }}>{t("adv_apply")}{fixSteel.get(x.key) ? ` · ${fixSteel.get(x.key)}` : ""}</button>}</li>)}</ul>
  );
  const notes = r && r.notes.length > 0 && <ul className="compat">{r.notes.map((n) => <li key={n} className="warn"><span className="cmp-ic">!</span><span>{t(`jn_${n}`)}</span></li>)}</ul>;
  const pick = (id: string) => set({ sel: id === "colStiff" ? "column" : id === "column" && !KIND_COLUMN.includes(kind) ? s.sel : id });

  return (
    <main className="layout node">
      <aside className="inputs">
        <button className="ghost kind-back" onClick={back}>← {t("nd_change")}</button>
        {s.link && <div className="jlink">
          <div>{t("jl_fromAsm")}: <b>{t("asm_member")} {s.link.member}</b> · {t("asm_node")} {s.link.node}</div>
          {onReturn && r && <button id="jreturn" className="primary" onClick={() => onReturn({ member: s.link!.member, end: s.link!.end, kind, util: maxU, ok: maxU <= 1 + 1e-9, gov: g ? tj(`chk_${g.key}`) : "" })}>
            ← {t("jl_return")} · {pct(maxU)}</button>}
          <p className="hint">{t("jl_linkHint")}</p>
        </div>}
        <fieldset><legend><span className="step">1</span>{t("nd_parts")}</legend>
          <div className="parts">{cards.filter((c) => c.group === "part").map(card)}</div>
          <div className="add-row">
            {(["plate", "rib", "profile"] as const).map((k) => <button key={k} id={`jadd-${k}`} className="ghost add-part" onClick={() => addExtra(k)}>+ {t(`jx_add_${k}`)}</button>)}
          </div>
        </fieldset>
        <fieldset><legend><span className="step">2</span>{t("nd_joints")}</legend>
          <div className="parts">{cards.filter((c) => c.group === "joint").map(card)}</div>
        </fieldset>
        <fieldset><legend><span className="step">3</span>{t("nd_loads")}</legend>
          <div className="seg wide" role="group">
            <button id="jcm-manual" className={s.cMode !== "cases" ? "on" : ""} onClick={() => set({ cMode: "manual" })}>{t("nl_manual")}</button>
            <button id="jcm-cases" className={s.cMode === "cases" ? "on" : ""} onClick={() => set({ cMode: "cases" })}>{t("nl_fromCases")}</button>
          </div>
          {s.cMode === "cases" ? casesTable : loads}
        </fieldset>
        {code === "DBN" && (
          <details className="adv"><summary>{t("advanced")}<span className="adv-hint">γc, γn</span></summary>
            <div className="adv-group"><div className="grid2">
              <Num id="jgc" label={t("gammaC")} v={s.gammaC} step={0.05} on={(v) => set({ gammaC: v })} />
              <Num id="jgn" label={t("gammaN")} v={s.gammaN} step={0.05} on={(v) => set({ gammaN: v })} />
            </div></div></details>
        )}
      </aside>
      <section className="output">
        <div className="tabs" role="tablist">
          {(["results", "report"] as const).map((k) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{t(`tab_${k}`)}</button>)}
        </div>
        {calc.err && <p className="error">{calc.err.startsWith("steelThk:") ? t("err_steelThk").replace("{s}", calc.err.split(":")[1]).replace("{t}", calc.err.split(":")[2]) : calc.err}</p>}
        {r && tab === "results" && (
          <div className="results">
            {summary}
            <div className="panel"><h3>{t("scheme")}</h3>
              <JointViews r={r} sel={s.sel} onPick={pick} utilOf={utilOf} t={t} />
              <p className="hint">{t("jv_hint")}</p>
            </div>
            {adviceList && <div className="panel"><h3>{t("adv_title")}</h3>{adviceList}<p className="hint">{t("adv_hint")}</p></div>}
            {notes && <div className="panel"><h3>{t("jn_title")}</h3>{notes}</div>}
            <div className="panel"><h3>{t("nl_byCombo")}</h3>{comboTable}</div>
            <div className="panel"><h3>{t("jx_spec")}</h3>{specTable}<p className="hint">{t("jx_specHint")}</p></div>
            {r.values.length > 0 && <div className="panel"><h3>{t("conn_values")}</h3>
              <table className="conn-values"><tbody>{r.values.map((v) => <tr key={v.k}><td>{v.k}</td><td className="mono">{v.v}</td></tr>)}</tbody></table></div>}
            <div className="panel"><h3>{t("nl_envelope")}</h3>{envelopeList}</div>
          </div>
        )}
        {r && tab === "report" && (
          <div className="report-wrap">
            <div className="report-tools">
              <input id="jobj" placeholder={t("objPlaceholder")} value={s.obj ?? ""} onChange={(e) => set({ obj: e.target.value })} />
              <input id="jelem" placeholder={t("connPlaceholder")} value={s.elem ?? ""} onChange={(e) => set({ elem: e.target.value })} />
              <button className="primary" onClick={() => window.print()}>{t("print")}</button>
            </div>
            <article className="report">
              <header className="rep-head">
                <h1>{t("nd_repTitle")}: {t(`nt_${kind}`).toLowerCase()}</h1>
                <dl>
                  <div><dt>{t("rep_object")}</dt><dd>{s.obj || "—"}</dd></div>
                  <div><dt>{t("rep_element")}</dt><dd>{s.elem || (s.link ? `${t("asm_member")} ${s.link.member} · ${t("asm_node")} ${s.link.node}` : "—")}</dd></div>
                  <div><dt>{t("rep_code")}</dt><dd>{code === "DBN" ? "ДБН В.2.6-198:2014; EN 1993-1-8 (T-елементи, вирив блоку)" : "EN 1993-1-8; EN 1993-1-1"}</dd></div>
                  <div><dt>{t("rep_date")}</dt><dd>{new Date().toLocaleDateString()}</dd></div>
                </dl>
              </header>
              <h2>{t("rep_summary")}</h2>
              {summary}
              <div className="rep-scheme"><JointViews r={r} sel="" onPick={() => undefined} utilOf={() => undefined} t={t} interactive={false} /></div>
              <h2>{t("nd_parts")}</h2>
              <table className="conn-values"><tbody>{cards.map((x) => <tr key={x.id}><td>{x.title}</td><td className="mono">{x.sum}</td></tr>)}</tbody></table>
              <h2>{t("jx_spec")}</h2>
              {specTable}
              {notes && <><h2>{t("jn_title")}</h2>{notes}</>}
              <h2>{t("nl_byCombo")}</h2>
              {comboTable}
              <h2>{t("rep_checks")}</h2>
              {envelopeList}
              <p className="disclaimer">{t("disclaimer")}</p>
            </article>
          </div>
        )}
        <p className="disclaimer">{t("disclaimer")}</p>
      </section>
    </main>
  );
}
