// Конструктор вузла: шаблон → деталі (форма, розміри, матеріал) → стики (шви, анкери) → сполучення навантажень.
// Деталі вибираються кліком на схемі або у списку; відкрита лише одна картка, щоб не плутатися у вводі.
import { useMemo, useState } from "react";
import {
  ANCHOR_STEELS, AnchorType, BOLT_DIAMETERS, checkBasePlate, CodeId, CONCRETE_CLASSES, FAMILIES, familySections, findSection,
  chsSection, iSection, NodeCombo, NodeProfile, NodeResult, rhsSection, Section, STEELS, WELD_PROCESSES, WeldProcess,
} from "@structcalc/core";
import { CheckList, pct, T, utilState } from "./Results";

export type NodeTmpl = "baseHinged" | "baseRigid" | "bracket";
const READY: NodeTmpl[] = ["baseHinged", "baseRigid", "bracket"];
const SOON = ["beamSeat", "finPlate", "endPlate", "flangeSplice", "coverSplice", "gusset", "cantilever"];
type PartId = "profile" | "plate" | "ribs" | "anchors" | "concrete";
type JointId = "wProfile" | "wRib" | "anchorJ";

export interface NodeState {
  tmpl: NodeTmpl | null; sel: PartId | JointId | "loads";
  family: string; size: string; pSteel: string; lever: number;
  /** профіль вручну (family = MANUAL): форма і розміри, мм; RHS/CHS: t = ptw, CHS: d = ph */
  pShape: "I" | "RHS" | "CHS"; ph: number; pb: number; ptw: number; ptf: number;
  L: number; B: number; t: number; plSteel: string;
  /** ribs — ребра по осі стінки, ribTips — по краях полиць (для труби — поперечні) */
  ribs: boolean; ribTips: boolean; hr: number; tr: number;
  kf: number; proc: WeldProcess; milled: boolean;
  aType: AnchorType; ad: number; aSteel: string; ahef: number; anx: number; any: number; asx: number; asy: number; aTau: number; aNRkp: string;
  /** вільна розстановка анкерів: координати від центра плити, мм (x — вздовж L) */
  aFree: boolean; aPts: { x: number; y: number }[];
  conc: string; cracked: boolean; reinf: boolean; Lc: string; Bc: string; hc: number; grout: number; friction: boolean;
  combos: NodeCombo[]; gammaC: number; gammaN: number; obj: string; elem: string;
}

export const initialNode: NodeState = {
  tmpl: null, sel: "profile", family: "HEB", size: "HEB 300", pSteel: "C245", lever: 0,
  pShape: "I", ph: 300, pb: 250, ptw: 10, ptf: 16,
  L: 650, B: 460, t: 40, plSteel: "C255", ribs: true, ribTips: false, hr: 300, tr: 16, kf: 10, proc: "manual", milled: false,
  aType: "headed", ad: 30, aSteel: "09Г2С", ahef: 700, anx: 2, any: 2, asx: 560, asy: 340, aTau: 7, aNRkp: "", aFree: false, aPts: [],
  conc: "C20/25", cracked: true, reinf: true, Lc: "1400", Bc: "1100", hc: 1200, grout: 40, friction: true,
  combos: [{ name: "1", N: 500, My: 80, Vz: 30 }, { name: "2", N: 150, My: 90, Vz: 35 }], gammaC: 1, gammaN: 1, obj: "", elem: "",
};

/** Типові параметри шаблону */
export function pickTmpl(s: NodeState, k: NodeTmpl, code: CodeId): Partial<NodeState> {
  const st = code === "DBN" ? "C245" : "S235";
  const base = { tmpl: k, sel: "profile" as const, pSteel: st, plSteel: st };
  if (k === "baseHinged") return { ...base, family: "HEB", size: "HEB 200", lever: 0, L: 360, B: 380, t: 25, ribs: false, ribTips: false, aFree: false, kf: 6, milled: false, reinf: true,
    aType: "headed", ad: 20, aSteel: code === "DBN" ? "09Г2С" : "5.6", ahef: 500, anx: 1, any: 2, asx: 0, asy: 290,
    conc: "C20/25", cracked: true, Lc: "800", Bc: "800", hc: 800, grout: 30, friction: true, combos: [{ name: "1", N: 600, Vz: 20 }, { name: "2", N: -40, Vz: 8 }] };
  if (k === "baseRigid") return { ...base, ...pickRest(initialNode), plSteel: code === "DBN" ? "C255" : "S235", aSteel: code === "DBN" ? "09Г2С" : "5.6" };
  return { ...base, family: "RHS_COLD", size: "180×100×6", lever: 1200, L: 340, B: 200, t: 22, ribs: false, ribTips: false, aFree: false, kf: 5, milled: false,
    aType: "bonded", ad: 16, aSteel: "5.8", ahef: 160, anx: 2, any: 2, asx: 260, asy: 120, aTau: 7,
    conc: "C20/25", cracked: true, reinf: false, Lc: "", Bc: "", hc: 250, grout: 0, friction: false,
    combos: [{ name: "1", P: 8 }, { name: "2", P: 3, H: 2, Q: 1 }] };
  function pickRest(o: NodeState): Partial<NodeState> {
    const { tmpl: _a, sel: _b, obj: _c, elem: _d, gammaC: _e, gammaN: _f, ...rest } = o;
    return rest;
  }
}

const num = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(",", ".")));
const inf = (v: string) => (v.trim() === "" ? Infinity : num(v));

export const NODE_ICONS: Record<string, JSX.Element> = {
  baseHinged: <><path d="M24 4v26" strokeWidth="4" /><path d="M10 30h28" strokeWidth="3" /><path d="M24 30v12" strokeWidth="2" /><path d="M4 36h40" strokeDasharray="2 3" /></>,
  baseRigid: <><path d="M24 4v26" strokeWidth="4" /><path d="M8 30h32" strokeWidth="3" /><path d="M24 14l-10 16M24 14l10 16" strokeWidth="1.5" /><path d="M12 30v12M36 30v12" strokeWidth="2" /><path d="M4 36h40" strokeDasharray="2 3" /></>,
  bracket: <><path d="M6 4v40" strokeDasharray="2 3" /><path d="M12 10v28" strokeWidth="3" /><path d="M12 22h30" strokeWidth="4" /><path d="M8 14h8M8 34h8" strokeWidth="2" /><path d="M40 26v10" className="arr" /></>,
  beamSeat: <><path d="M24 4v40" strokeWidth="4" /><path d="M4 16h40" strokeWidth="4" /></>,
  finPlate: <><path d="M10 4v40" strokeWidth="4" /><path d="M10 24h32" strokeWidth="4" /><rect x="12" y="18" width="10" height="12" /></>,
  endPlate: <><path d="M10 4v40" strokeWidth="4" /><path d="M14 12v24" strokeWidth="3" /><path d="M14 24h28" strokeWidth="4" /></>,
  flangeSplice: <><path d="M4 24h17M27 24h17" strokeWidth="4" /><path d="M22 10v28M26 10v28" strokeWidth="3" /></>,
  coverSplice: <><path d="M4 24h18M26 24h18" strokeWidth="4" /><path d="M12 19h24M12 29h24" strokeWidth="2.5" /></>,
  gusset: <><path d="M4 36h40" strokeWidth="3" /><path d="M24 36L12 12M24 36L36 12" strokeWidth="3" /><path d="M16 36l4-12h8l4 12z" /></>,
  cantilever: <><path d="M6 4v40" strokeWidth="4" /><path d="M6 14h34" strokeWidth="4" /><path d="M6 30L40 14" strokeWidth="1.5" /></>,
};

function Num({ id, label, v, on, step, ph }: { id: string; label: string; v: number | string; on: (s: string) => void; step?: number; ph?: string }) {
  return <label><span className="lbl">{label}</span><input id={id} type="number" step={step ?? 1} placeholder={ph} value={v} onChange={(e) => on(e.target.value)} /></label>;
}

const NODE_FAMILIES = ["HEB", "HEA", "IPE", "I_GOST8239", "RHS_COLD", "CHS_COLD", "CUSTOM", "MANUAL"];
const nodeKind = (x: Section) => x.kind === "I" || x.kind === "RHS" || x.kind === "CHS";

function toProfile(sec: Section): NodeProfile {
  if (sec.kind === "RHS") return { kind: "RHS", h: sec.h, b: sec.b, tw: sec.dims.t, tf: sec.dims.t, A: sec.A, Wy: sec.Wy, Wz: sec.Wz, Avz: sec.Avz };
  if (sec.kind === "CHS") return { kind: "CHS", h: sec.h, b: sec.h, tw: sec.dims.t, tf: sec.dims.t, A: sec.A, Wy: sec.Wy, Wz: sec.Wz, Avz: sec.Avz };
  return { kind: "I", h: sec.h, b: sec.b, tw: sec.dims.tw ?? 6, tf: sec.dims.tf ?? 10, A: sec.A, Wy: sec.Wy, Wz: sec.Wz, Avz: sec.Avz };
}

type Pt2 = { x: number; y: number };
type DimKey = "L" | "B" | "t" | "hr" | "lever" | "asx" | "asy" | "ahef";
type Edit = { key: DimKey; view: 0 | 1; x: number; y: number; v: number } | null;

/** Схема вузла: вигляд збоку і план (для кронштейна — фасад плити на стіні).
 *  Клік по деталі відкриває її картку; анкери і краї плити перетягуються; розміри на кресленні правляться кліком. */
function NodeScheme({ s, p, r, combo, onPick, sel, set, pts, interactive = true }: {
  s: NodeState; p: NodeProfile; r?: NodeResult; combo: number; onPick: (id: PartId | JointId) => void; sel: string;
  set: (p: Partial<NodeState>) => void; pts: Pt2[]; interactive?: boolean;
}) {
  const [edit, setEdit] = useState<Edit>(null);
  // під час перетягування масштаб плану зафіксовано (m), інакше зміна L/B «тікає» від курсора
  const [drag, setDrag] = useState<{ kind: "anchor"; k: number; m: number } | { kind: "L" | "B"; m: number } | null>(null);
  const [hot, setHot] = useState<number | null>(null);
  const br = s.tmpl === "bracket";
  const forces = r?.combos[combo]?.forces ?? [];
  const fmax = Math.max(1e-9, ...forces.map((q) => q.N));
  const cls = (id: string, base: string) => `${base} pick ${sel === id ? "on" : ""}`;
  const W = 300, H = 260, PW = 300, PH = 290;
  const ribWeb = s.ribs, ribTips = s.ribTips;
  const anyRib = ribWeb || ribTips;
  const arrow = <defs><marker id="narr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0,0 L10,5 L0,10 z" className="s-load-fill" /></marker></defs>;
  // розмірний ярлик: клік відкриває поле вводу поверх креслення
  const chip = (key: DimKey, view: 0 | 1, x0: number, y0c: number, label: string, v: number) => {
    const hw = label.length * 3.3 + 5, vw = view === 0 ? W : PW, vh = view === 0 ? H : PH;
    const x = Math.max(hw + 2, Math.min(vw - hw - 2, x0)), y = Math.max(11, Math.min(vh - 8, y0c));
    return (
    <g className={interactive ? "dim-chip" : ""} onClick={interactive ? (e) => { e.stopPropagation(); setEdit({ key, view, x, y, v }); } : undefined}>
      <rect x={x - label.length * 3.3 - 5} y={y - 9} width={label.length * 6.6 + 10} height={15} rx={4} className="dim-bg" />
      <text x={x} y={y + 2} className="s-text small dim-txt" textAnchor="middle">{label}</text>
    </g>
    );
  };
  const xsGrid: number[] = [...new Set(pts.map((q) => Math.round(q.x)))].sort((a, b) => a - b);

  // ---- вигляд збоку
  let side: JSX.Element;
  if (!br) {
    const LcR = inf(s.Lc);
    const Lc = Math.min(Number.isFinite(LcR) ? LcR : s.L * 1.6, s.L * 1.6);
    const colH = Math.max(1.6 * p.h, anyRib ? 1.4 * s.hr : 0, 300);
    const below = s.grout + Math.min(s.hc, s.ahef + 150);
    const sc = Math.min((W - 20) / Math.max(Lc, s.L), (H - 30) / (colH + s.t + below));
    const cx = W / 2, y0 = 15 + colH * sc;
    const yc = y0 + (s.t + s.grout) * sc;
    const ha = p.kind === "CHS" ? p.h / 2 : p.h / 2;
    side = (
      <svg viewBox={`0 0 ${W} ${H}`} className="conn-scheme node-scheme" role="img" aria-label="elevation">
        {arrow}
        <rect x={cx - (Lc / 2) * sc} y={yc} width={Lc * sc} height={(H - 5 - yc)} className={cls("concrete", "cs-concrete")} onClick={() => onPick("concrete")} />
        <rect x={cx - (s.L / 2) * sc} y={y0} width={s.L * sc} height={Math.max(2, s.t * sc)} className={cls("plate", "cs-plate")} onClick={() => onPick("plate")} />
        {xsGrid.map((x, k) => <line key={k} x1={cx + x * sc} x2={cx + x * sc} y1={y0 - 8} y2={Math.min(H - 8, yc + s.ahef * sc)} className={cls("anchorJ", "cs-anchorline")} onClick={() => onPick("anchors")} />)}
        <g className={cls("profile", "")} onClick={() => onPick("profile")}>
          <rect x={cx - ha * sc} y={y0 - colH * sc} width={p.h * sc} height={colH * sc} className="cs-member" />
          {p.kind !== "CHS" && <>
            <line x1={cx - (p.h / 2 - p.tf) * sc} x2={cx - (p.h / 2 - p.tf) * sc} y1={y0 - colH * sc} y2={y0} className="cs-flange" />
            <line x1={cx + (p.h / 2 - p.tf) * sc} x2={cx + (p.h / 2 - p.tf) * sc} y1={y0 - colH * sc} y2={y0} className="cs-flange" />
          </>}
        </g>
        {anyRib && [-1, 1].map((sg) => (
          <path key={sg} d={`M${cx + sg * ha * sc} ${y0 - s.hr * sc} L${cx + sg * (s.L / 2 - 15) * sc} ${y0 - 0.3 * s.hr * sc} V${y0} H${cx + sg * ha * sc}z`} className={cls("ribs", "cs-rib")} onClick={() => onPick("ribs")} />
        ))}
        <line x1={cx - ha * sc - 3} x2={cx + ha * sc + 3} y1={y0 - 2} y2={y0 - 2} className={cls("wProfile", "cs-weld")} strokeWidth={4} onClick={() => onPick("wProfile")} />
        <line x1={cx} x2={cx} y1={2} y2={14} className="cs-load" markerEnd="url(#narr)" />
        <text x={cx + 6} y={12} className="s-text small">N, M, V</text>
        {chip("t", 0, cx - (s.L / 2) * sc - 26, y0 + 3, `t ${s.t}`, s.t)}
        {anyRib && chip("hr", 0, cx + (s.L / 2) * sc + 2 > W - 40 ? W - 34 : cx + (s.L / 2) * sc + 22, y0 - s.hr * sc * 0.6, `hr ${s.hr}`, s.hr)}
        {chip("ahef", 0, cx + (xsGrid[xsGrid.length - 1] ?? 0) * sc + 30, Math.min(H - 16, yc + s.ahef * sc * 0.6), `hef ${s.ahef}`, s.ahef)}
      </svg>
    );
  } else {
    // кронштейн: стіна праворуч, плита на грані стіни, консоль ліворуч з силою P на кінці
    const wallT = Math.min(s.hc, s.ahef + 120);
    const sc = Math.min((W - 30) / (s.lever + s.t + wallT), (H - 40) / Math.max(s.L * 1.3, p.h * 1.5));
    const xw = W - 10 - wallT * sc, yc = H / 2;
    const xp = xw - s.t * sc, xt = xp - s.lever * sc;
    side = (
      <svg viewBox={`0 0 ${W} ${H}`} className="conn-scheme node-scheme" role="img" aria-label="elevation">
        {arrow}
        <rect x={xw} y={8} width={wallT * sc} height={H - 16} className={cls("concrete", "cs-concrete")} onClick={() => onPick("concrete")} />
        <rect x={xp} y={yc - (s.L / 2) * sc} width={Math.max(2, s.t * sc)} height={s.L * sc} className={cls("plate", "cs-plate")} onClick={() => onPick("plate")} />
        {xsGrid.map((x, k) => <line key={k} x1={xp - 6} x2={xw + s.ahef * sc} y1={yc - x * sc} y2={yc - x * sc} className={cls("anchorJ", "cs-anchorline")} onClick={() => onPick("anchors")} />)}
        <g className={cls("profile", "")} onClick={() => onPick("profile")}>
          <rect x={xt} y={yc - (p.h / 2) * sc} width={s.lever * sc} height={p.h * sc} className="cs-member" />
          {p.kind !== "CHS" && <>
            <line x1={xt} x2={xp} y1={yc - (p.h / 2 - p.tf) * sc} y2={yc - (p.h / 2 - p.tf) * sc} className="cs-flange" />
            <line x1={xt} x2={xp} y1={yc + (p.h / 2 - p.tf) * sc} y2={yc + (p.h / 2 - p.tf) * sc} className="cs-flange" />
          </>}
        </g>
        <line x1={xp - 2} x2={xp - 2} y1={yc - (p.h / 2) * sc - 3} y2={yc + (p.h / 2) * sc + 3} className={cls("wProfile", "cs-weld")} strokeWidth={4} onClick={() => onPick("wProfile")} />
        <line x1={xt + 2} x2={xt + 2} y1={yc - (p.h / 2) * sc - 34} y2={yc - (p.h / 2) * sc - 2} className="cs-load" markerEnd="url(#narr)" />
        <text x={xt + 8} y={yc - (p.h / 2) * sc - 24} className="s-text small">P</text>
        <line x1={xt} x2={xp} y1={yc + (p.h / 2) * sc + 14} y2={yc + (p.h / 2) * sc + 14} className="cs-dim" />
        {chip("lever", 0, (xt + xp) / 2, yc + (p.h / 2) * sc + 28, `e ${s.lever}`, s.lever)}
        {chip("t", 0, xp - 22, yc + (s.L / 2) * sc + 12, `t ${s.t}`, s.t)}
        {chip("ahef", 0, xw + (wallT * sc) / 2, H - 18, `hef ${s.ahef}`, s.ahef)}
      </svg>
    );
  }

  // ---- план плити (кронштейн: вісь x плити вертикальна, верх = розтяг від P)
  const m = drag?.m ?? Math.max(s.L, s.B) * 1.3;
  const ps = 240 / m;
  const CX = 145, CY = 135;
  const PX = (x: number, y: number) => (br ? CX + y * ps : CX + x * ps);
  const PY = (x: number, y: number) => (br ? CY - x * ps : CY - y * ps);
  const toPlate = (sx: number, sy: number): Pt2 => (br ? { x: (CY - sy) / ps, y: (sx - CX) / ps } : { x: (sx - CX) / ps, y: (CY - sy) / ps });
  const rect = (x0: number, y0r: number, x1: number, y1: number, className: string, onClick?: () => void) => {
    const xa = [PX(x0, y0r), PX(x1, y1)], ya = [PY(x0, y0r), PY(x1, y1)];
    return <rect x={Math.min(...xa)} y={Math.min(...ya)} width={Math.abs(xa[1] - xa[0])} height={Math.abs(ya[1] - ya[0])} className={className} onClick={onClick} />;
  };
  const svgPt = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = e.currentTarget, ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return toPlate(q.x, q.y);
  };
  const snap = (v: number, st: number) => Math.round(v / st) * st;
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const q = svgPt(e);
    if (!q) return;
    if (drag.kind === "anchor") {
      const np = pts.map((a, k) => (k === drag.k ? { x: clamp(snap(q.x, 5), s.L / 2), y: clamp(snap(q.y, 5), s.B / 2) } : a));
      set({ aFree: true, aPts: np });
    } else if (drag.kind === "L") set({ L: Math.min(Math.max(snap(2 * Math.abs(q.x), 10), Math.ceil(p.h / 10) * 10 + 20), drag.m * 1.5) });
    else set({ B: Math.min(Math.max(snap(2 * Math.abs(q.y), 10), Math.ceil(p.b / 10) * 10 + 20), drag.m * 1.5) });
  };
  // ручки країв плити: L — у напрямку x плити, B — у напрямку y
  const hL = { x: PX(s.L / 2, 0), y: PY(s.L / 2, 0) }, hB = { x: PX(0, s.B / 2), y: PY(0, s.B / 2) };
  // розміри: базa — L по горизонталі, B по вертикалі; кронштейн — навпаки
  const left = PX(br ? 0 : -s.L / 2, br ? -s.B / 2 : 0), right = PX(br ? 0 : s.L / 2, br ? s.B / 2 : 0);
  const top = PY(br ? s.L / 2 : 0, br ? 0 : s.B / 2), bot = PY(br ? -s.L / 2 : 0, br ? 0 : -s.B / 2);
  const grid = !s.aFree;
  const ax = [...new Set(pts.map((q) => q.x))].sort((a, b) => a - b), ay = [...new Set(pts.map((q) => q.y))].sort((a, b) => a - b);
  const plan = (
    <svg viewBox={`0 0 ${PW} ${PH}`} className={`conn-scheme node-scheme ${drag ? "dragging" : ""}`} role="img" aria-label="plan"
      onPointerMove={interactive ? onMove : undefined} onPointerUp={() => setDrag(null)} onPointerLeave={() => setDrag(null)}>
      {rect(-s.L / 2, -s.B / 2, s.L / 2, s.B / 2, cls("plate", "cs-plate"), () => onPick("plate"))}
      {p.kind === "I" ? <g className={cls("profile", "")} onClick={() => onPick("profile")}>
        {rect(-p.h / 2, -p.b / 2, -p.h / 2 + p.tf, p.b / 2, "cs-member")}
        {rect(p.h / 2 - p.tf, -p.b / 2, p.h / 2, p.b / 2, "cs-member")}
        {rect(-p.h / 2, -p.tw / 2, p.h / 2, p.tw / 2, "cs-member")}
      </g> : p.kind === "RHS" ? <g className={cls("profile", "")} onClick={() => onPick("profile")}>
        {rect(-p.h / 2, -p.b / 2, p.h / 2, p.b / 2, "cs-member")}
        {rect(-p.h / 2 + p.tf, -p.b / 2 + p.tw, p.h / 2 - p.tf, p.b / 2 - p.tw, "cs-hollow")}
      </g> : <g className={cls("profile", "")} onClick={() => onPick("profile")}>
        <circle cx={PX(0, 0)} cy={PY(0, 0)} r={(p.h / 2) * ps} className="cs-member" />
        <circle cx={PX(0, 0)} cy={PY(0, 0)} r={Math.max(1, (p.h / 2 - p.tw) * ps)} className="cs-hollow" />
      </g>}
      {ribWeb && <g onClick={() => onPick("ribs")}>
        {rect(p.h / 2, -s.tr / 2, s.L / 2, s.tr / 2, cls("ribs", "cs-rib"))}
        {rect(-s.L / 2, -s.tr / 2, -p.h / 2, s.tr / 2, cls("ribs", "cs-rib"))}
      </g>}
      {ribTips && <g onClick={() => onPick("ribs")}>
        {p.kind === "CHS" ? <>
          {rect(-s.tr / 2, p.b / 2, s.tr / 2, s.B / 2, cls("ribs", "cs-rib"))}
          {rect(-s.tr / 2, -s.B / 2, s.tr / 2, -p.b / 2, cls("ribs", "cs-rib"))}
        </> : [-1, 1].flatMap((sy) => [-1, 1].map((sx) => (
          <g key={`${sx}${sy}`}>{rect(sx * p.h / 2, sy * (p.b / 2 - s.tr / 2) - s.tr / 2, sx * s.L / 2, sy * (p.b / 2 - s.tr / 2) + s.tr / 2, cls("ribs", "cs-rib"))}</g>
        )))}
      </g>}
      {pts.map((q, k) => {
        const f = forces[k]?.N ?? 0;
        return <g key={k} className="pick anchor-g" onPointerDown={interactive ? (e) => { e.preventDefault(); setDrag({ kind: "anchor", k, m }); setHot(k); onPick("anchors"); } : undefined}>
          <circle cx={PX(q.x, q.y)} cy={PY(q.x, q.y)} r={Math.max(5, (s.ad / 2 + 3) * ps)} className={`cs-anchor ${f > 0 ? "t" : ""} ${hot === k && (sel === "anchorJ") ? "on" : ""}`} style={f > 0 ? { opacity: 0.35 + 0.65 * f / fmax } : undefined} />
          {f > 0 && <text x={PX(q.x, q.y) + 7} y={PY(q.x, q.y) - 7} className="s-text small">{(f / 1000).toFixed(1)}</text>}
        </g>;
      })}
      {/* розміри плити */}
      <line x1={left} x2={right} y1={bot + 14} y2={bot + 14} className="cs-dim" />
      <line x1={right + 14} x2={right + 14} y1={top} y2={bot} className="cs-dim" />
      {chip(br ? "B" : "L", 1, (left + right) / 2, bot + 15, `${br ? "B" : "L"} ${br ? s.B : s.L}`, br ? s.B : s.L)}
      {chip(br ? "L" : "B", 1, Math.min(PW - 26, right + 36), (top + bot) / 2, `${br ? "L" : "B"} ${br ? s.L : s.B}`, br ? s.L : s.B)}
      {/* кроки анкерів (сітка) */}
      {grid && ax.length > 1 && chip("asx", 1, br ? left - 32 : (PX(ax[0], 0) + PX(ax[1], 0)) / 2, br ? (PY(ax[0], 0) + PY(ax[1], 0)) / 2 : top - 22, `sx ${s.asx}`, s.asx)}
      {grid && ay.length > 1 && chip("asy", 1, br ? (PX(0, ay[0]) + PX(0, ay[1])) / 2 : left - 32, br ? top - 22 : (PY(0, ay[0]) + PY(0, ay[1])) / 2, `sy ${s.asy}`, s.asy)}
      {interactive && <>
        <rect x={hL.x - 5} y={hL.y - 5} width={10} height={10} className="handle" onPointerDown={(e) => { e.preventDefault(); setDrag({ kind: "L", m }); }} />
        <rect x={hB.x - 5} y={hB.y - 5} width={10} height={10} className="handle" onPointerDown={(e) => { e.preventDefault(); setDrag({ kind: "B", m }); }} />
      </>}
      <text x={6} y={14} className="s-text small">{br ? "↑ x" : "x →"}</text>
    </svg>
  );
  const commit = (v: string) => {
    if (!edit) return;
    const n = num(v);
    if (Number.isFinite(n) && n > 0) set({ [edit.key]: n } as Partial<NodeState>);
    setEdit(null);
  };
  const overlay = (view: 0 | 1, vw: number, vh: number) => edit && edit.view === view && (
    <input className="dim-input" type="number" autoFocus defaultValue={edit.v}
      style={{ left: `${(edit.x / vw) * 100}%`, top: `${(edit.y / vh) * 100}%` }}
      onKeyDown={(e) => { if (e.key === "Enter") commit((e.target as HTMLInputElement).value); if (e.key === "Escape") setEdit(null); }}
      onBlur={(e) => commit(e.target.value)} />
  );
  return (
    <div className="node-views">
      <div className="view-wrap">{side}{overlay(0, W, H)}</div>
      <div className="view-wrap">{plan}{overlay(1, PW, PH)}</div>
    </div>
  );
}

const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));

export function NodeModule({ code, s, set, t }: { code: CodeId; s: NodeState; set: (p: Partial<NodeState>) => void; t: T }) {
  const [tab, setTab] = useState<"results" | "report">("results");
  const [combo, selCombo] = useState(0);
  const steels = STEELS.filter((x) => x.code === code);
  const fams = NODE_FAMILIES.filter((f) => f === "MANUAL" || FAMILIES.some((x) => x.id === f));
  const family = fams.includes(s.family) ? s.family : "HEB";
  const manual = family === "MANUAL";
  const sizes = manual ? [] : familySections(family).filter(nodeKind);
  const sec = useMemo(() => {
    if (!manual) return findSection(family, s.size) ?? sizes[0] ?? findSection("HEB", "HEB 200")!;
    const h = Math.max(s.ph, 20), b = Math.max(s.pb, 20), tw = Math.max(s.ptw, 1), tf = Math.max(s.ptf, 1);
    try {
      if (s.pShape === "RHS") return rhsSection(`□${h}×${b}×${tw}`, h, b, Math.min(tw, b / 2 - 1), { fabrication: "cold" });
      if (s.pShape === "CHS") return chsSection(`Ø${h}×${tw}`, h, Math.min(tw, h / 2 - 1));
      return iSection(`I ${h}×${b}×${tw}×${tf}`, h, b, Math.min(tw, b - 1), Math.min(tf, h / 2 - 1), 0, { fabrication: "welded" });
    } catch { return findSection("HEB", "HEB 200")!; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manual, family, s.size, s.pShape, s.ph, s.pb, s.ptw, s.ptf]);
  const prof = toProfile(sec);
  // анкери: вільні координати або сітка
  const grid: { x: number; y: number }[] = [];
  for (let a = 0; a < s.anx; a++) for (let b = 0; b < s.any; b++) grid.push({ x: (a - (s.anx - 1) / 2) * s.asx, y: (b - (s.any - 1) / 2) * s.asy });
  const pts = s.aFree && s.aPts.length ? s.aPts : grid;
  const br = s.tmpl === "bracket";
  const kN = 1000, kNm = 1e6;

  const calc = useMemo((): { r?: NodeResult; err?: string } => {
    if (!s.tmpl) return {};
    try {
      const fck = CONCRETE_CLASSES.find((c) => c.id === s.conc)?.fck ?? 20;
      const combos = s.combos.map((c) => br
        ? { name: c.name, P: (c.P ?? 0) * kN, H: (c.H ?? 0) * kN, Q: (c.Q ?? 0) * kN }
        : { name: c.name, N: (c.N ?? 0) * kN, My: (c.My ?? 0) * kNm, Mz: (c.Mz ?? 0) * kNm, Vz: (c.Vz ?? 0) * kN, Vy: (c.Vy ?? 0) * kN });
      return { r: checkBasePlate({
        code, kind: br ? "bracket" : "base", profile: prof, profileSteel: s.pSteel, lever: s.lever,
        plate: { L: s.L, B: s.B, t: s.t, steel: s.plSteel }, ribs: { web: s.ribs, tips: s.ribTips, hr: s.hr, tr: s.tr },
        weld: { kf: s.kf, process: s.proc, milled: s.milled },
        anchors: { type: s.aType, d: s.ad, steel: s.aSteel, hef: s.ahef, nx: s.anx, ny: s.any, sx: s.asx, sy: s.asy, points: pts,
          tauRk: s.aTau, NRkp: s.aNRkp.trim() ? num(s.aNRkp) * kN : undefined },
        concrete: { fck, cracked: s.cracked, Lc: inf(s.Lc), Bc: inf(s.Bc), h: s.hc, grout: s.grout, reinforced: s.reinf },
        friction: s.friction, gammaC: s.gammaC, gammaN: s.gammaN, combos,
      }) };
    } catch (e) { return { err: String((e as Error).message) }; }
  }, [code, s, sec, br]);

  if (!s.tmpl) {
    return (
      <main className="home">
        <h1 className="home-title">{t("nd_pick")}</h1>
        <p className="home-sub">{t("nd_pick_sub")}</p>
        <div className="cards">
          {[...READY, ...SOON].map((k) => {
            const ready = (READY as string[]).includes(k);
            return (
              <button key={k} id={`node-${k}`} className={`card ${ready ? "" : "soon"}`} disabled={!ready} onClick={() => set(pickTmpl(s, k as NodeTmpl, code))}>
                <svg viewBox="0 0 48 48" className="card-icon" aria-hidden="true">{NODE_ICONS[k]}</svg>
                <span className="card-title">{t(`nt_${k}`)}</span>
                <span className="card-desc">{t(`nt_${k}_d`)}</span>
                {!ready && <span className="card-soon">{t("soon")}</span>}
              </button>
            );
          })}
        </div>
      </main>
    );
  }

  const r = calc.r;
  const ci = r ? Math.min(combo, r.combos.length - 1) : 0;
  const steelSel = (id: string, v: string, on: (v: string) => void) => (
    <label><span className="lbl">{t("material")}</span><select id={id} value={steels.some((x) => x.id === v) ? v : steels[0].id} onChange={(e) => on(e.target.value)}>{steels.map((x) => <option key={x.id}>{x.id}</option>)}</select></label>
  );
  const types: AnchorType[] = ["headed", "mechanical", "bonded"];

  // ---- картки деталей і стиків
  const parts: { id: PartId | JointId; group: "part" | "joint"; title: string; sum: string; body: JSX.Element; remove?: () => void; show: boolean }[] = [
    { id: "profile", group: "part", title: t(br ? "np_bracket" : "np_column"), sum: `${sec.name} · ${s.pSteel}${br ? ` · e = ${s.lever}` : ""}`, show: true, body: <div className="grid2">
      <label><span className="lbl">{t("family")}</span><select id="nfam" value={family} onChange={(e) => { const f = e.target.value; if (f === "MANUAL") { set({ family: f, pShape: prof.kind, ph: prof.h, pb: prof.b, ptw: prof.tw, ptf: prof.tf }); return; } const l = familySections(f).filter(nodeKind); set({ family: f, size: l[Math.floor(l.length / 3)]?.name ?? "" }); }}>
        {fams.map((f) => <option key={f} value={f}>{f === "CUSTOM" ? t("fam_CUSTOM") : f === "MANUAL" ? t("np_manual") : f.replace("_COLD", "").replace("I_GOST8239", "ГОСТ 8239")}</option>)}</select></label>
      {manual
        ? <label><span className="lbl">{t("np_shape")}</span><select id="npshape" value={s.pShape} onChange={(e) => set({ pShape: e.target.value as NodeState["pShape"] })}>{(["I", "RHS", "CHS"] as const).map((k) => <option key={k} value={k}>{t(`nps_${k}`)}</option>)}</select></label>
        : <label><span className="lbl">{t("size")}</span><select id="nsize" value={sec.name} onChange={(e) => set({ size: e.target.value })}>{sizes.map((x) => <option key={x.name}>{x.name}</option>)}</select></label>}
      {manual && <>
        <Num id="nph" label={s.pShape === "CHS" ? "d, mm" : "h, mm"} v={s.ph} on={(v) => set({ ph: num(v) })} />
        {s.pShape !== "CHS" && <Num id="npb" label="b, mm" v={s.pb} on={(v) => set({ pb: num(v) })} />}
        <Num id="nptw" label={s.pShape === "I" ? "t_w, mm" : "t, mm"} v={s.ptw} on={(v) => set({ ptw: num(v) })} />
        {s.pShape === "I" && <Num id="nptf" label="t_f, mm" v={s.ptf} on={(v) => set({ ptf: num(v) })} />}
      </>}
      {steelSel("npst", s.pSteel, (v) => set({ pSteel: v }))}
      {br && <Num id="nlever" label={t("np_lever")} v={s.lever} on={(v) => set({ lever: num(v) })} />}
    </div> },
    { id: "plate", group: "part", title: t("np_plate"), sum: `${s.L}×${s.B}×${s.t} · ${s.plSteel}`, show: true, body: <div className="grid2">
      <Num id="npl" label={t(br ? "np_Lv" : "np_L")} v={s.L} on={(v) => set({ L: num(v) })} />
      <Num id="nplb" label={t("np_B")} v={s.B} on={(v) => set({ B: num(v) })} />
      <Num id="npt" label={t("np_t")} v={s.t} on={(v) => set({ t: num(v) })} />
      {steelSel("nplst", s.plSteel, (v) => set({ plSteel: v }))}
    </div> },
    { id: "ribs", group: "part", title: t("np_ribs"), sum: `${(s.ribs ? 2 : 0) + (s.ribTips ? (prof.kind === "CHS" ? 2 : 4) : 0)} × ${s.hr}×${s.tr}`, show: s.ribs || s.ribTips, remove: () => set({ ribs: false, ribTips: false, sel: "plate" }), body: <div className="grid2">
      <label className="wide chk"><input id="nribw" type="checkbox" checked={s.ribs} onChange={(e) => set({ ribs: e.target.checked })} />{t(prof.kind === "CHS" ? "np_ribX" : "np_ribWeb")}</label>
      <label className="wide chk"><input id="nribt" type="checkbox" checked={s.ribTips} onChange={(e) => set({ ribTips: e.target.checked })} />{t(prof.kind === "CHS" ? "np_ribY" : "np_ribTips")}</label>
      <Num id="nhr" label={t("np_hr")} v={s.hr} on={(v) => set({ hr: num(v) })} />
      <Num id="ntr" label={t("np_tr")} v={s.tr} on={(v) => set({ tr: num(v) })} />
      <p className="hint wide">{t("np_ribsHint")}</p>
    </div> },
    { id: "concrete", group: "part", title: t(br ? "np_wall" : "np_found"), sum: `${s.conc} · h = ${s.hc}`, show: true, body: <div className="grid2">
      <label><span className="lbl">{t("an_class")}</span><select id="nconc" value={s.conc} onChange={(e) => set({ conc: e.target.value })}>{CONCRETE_CLASSES.map((x) => <option key={x.id}>{x.id}</option>)}</select></label>
      <Num id="nhc" label={t(br ? "np_hw" : "np_hc")} v={s.hc} on={(v) => set({ hc: num(v) })} />
      <Num id="nlc" label={t(br ? "np_Lcw" : "np_Lc")} v={s.Lc} ph="∞" on={(v) => set({ Lc: v })} />
      <Num id="nbc" label={t(br ? "np_Bcw" : "np_Bc")} v={s.Bc} ph="∞" on={(v) => set({ Bc: v })} />
      {!br && <Num id="ngr" label={t("np_grout")} v={s.grout} on={(v) => set({ grout: num(v) })} />}
      <label className="wide chk"><input id="ncr" type="checkbox" checked={s.cracked} onChange={(e) => set({ cracked: e.target.checked })} />{t("an_cracked")}</label>
      <label className="wide chk"><input id="nreinf" type="checkbox" checked={s.reinf} onChange={(e) => set({ reinf: e.target.checked })} />{t("np_reinf")}</label>
      <p className="hint wide">{t("np_concHint")}</p>
    </div> },
    { id: "wProfile", group: "joint", title: t(br ? "nj_wBracket" : "nj_wColumn"), sum: `${t("nj_weld")} k_f = ${s.kf}`, show: true, body: <div className="grid2">
      <Num id="nkf" label={t("w_kf")} v={s.kf} on={(v) => set({ kf: num(v) })} />
      {code === "DBN" && <label><span className="lbl">{t("w_proc")}</span><select id="nproc" value={s.proc} onChange={(e) => set({ proc: e.target.value as WeldProcess })}>{WELD_PROCESSES.map((x) => <option key={x} value={x}>{t(`wp_${x}`)}</option>)}</select></label>}
      {!br && <label className="wide chk"><input id="nmill" type="checkbox" checked={s.milled} onChange={(e) => set({ milled: e.target.checked })} />{t("nj_milled")}</label>}
      <p className="hint wide">{t(p_kindHint(prof))}</p>
    </div> },
    { id: "wRib", group: "joint", title: t("nj_wRib"), sum: `${t("nj_weld")} k_f = ${s.kf}`, show: s.ribs || s.ribTips, body: <p className="hint">{t("nj_wRibHint")}</p> },
    { id: "anchorJ", group: "joint", title: t(br ? "nj_anchorsW" : "nj_anchors"), sum: `${pts.length} × M${s.ad} · ${t(`at_${s.aType}`)}`, show: true, body: <div className="grid2">
      <label className="wide"><span className="lbl">{t("an_type")}</span><select id="natype" value={s.aType} onChange={(e) => set({ aType: e.target.value as AnchorType })}>{types.map((x) => <option key={x} value={x}>{t(`at_${x}`)}</option>)}</select></label>
      <label><span className="lbl">{t("bo_d")}</span><select id="nad" value={s.ad} onChange={(e) => set({ ad: Number(e.target.value) })}>{BOLT_DIAMETERS.map((x) => <option key={x} value={x}>M{x}</option>)}</select></label>
      <label><span className="lbl">{t("an_steel")}</span><select id="nast" value={s.aSteel} onChange={(e) => set({ aSteel: e.target.value })}>{ANCHOR_STEELS.map((x) => <option key={x.id}>{x.id}</option>)}</select></label>
      <Num id="nahef" label={t("an_hef")} v={s.ahef} on={(v) => set({ ahef: num(v) })} />
      {s.aType === "bonded" && <Num id="natau" label={t("an_tau")} v={s.aTau} step={0.5} on={(v) => set({ aTau: num(v) })} />}
      {s.aType === "mechanical" && <Num id="nanrkp" label={t("an_NRkp")} v={s.aNRkp} ph="ETA" on={(v) => set({ aNRkp: v })} />}
      <div className="seg wide" role="group">
        <button id="agrid" className={!s.aFree ? "on" : ""} onClick={() => set({ aFree: false })}>{t("nj_grid")}</button>
        <button id="afree" className={s.aFree ? "on" : ""} onClick={() => set({ aFree: true, aPts: s.aFree && s.aPts.length ? s.aPts : grid })}>{t("nj_free")}</button>
      </div>
      {!s.aFree ? <>
        <Num id="nanx" label={t(br ? "nj_nxV" : "nj_nx")} v={s.anx} on={(v) => set({ anx: Math.max(1, Math.round(num(v))) })} />
        <Num id="nany" label={t(br ? "nj_nyV" : "nj_ny")} v={s.any} on={(v) => set({ any: Math.max(1, Math.round(num(v))) })} />
        <Num id="nasx" label={t(br ? "nj_sxV" : "nj_sx")} v={s.asx} on={(v) => set({ asx: num(v) })} />
        <Num id="nasy" label={t(br ? "nj_syV" : "nj_sy")} v={s.asy} on={(v) => set({ asy: num(v) })} />
      </> : <div className="wide apts">
        <div className="apts-head"><span>№</span><span>x, mm</span><span>y, mm</span><span /></div>
        {pts.map((q, k) => (
          <div key={k} className="apts-row">
            <span>{k + 1}</span>
            <input id={`apx${k}`} type="number" value={q.x} onChange={(e) => set({ aPts: pts.map((a, j) => (j === k ? { ...a, x: num(e.target.value) } : a)) })} />
            <input id={`apy${k}`} type="number" value={q.y} onChange={(e) => set({ aPts: pts.map((a, j) => (j === k ? { ...a, y: num(e.target.value) } : a)) })} />
            {pts.length > 1 ? <button className="ghost xbtn" aria-label="remove" onClick={() => set({ aPts: pts.filter((_, j) => j !== k) })}>×</button> : <span />}
          </div>))}
        <button id="addanchor" className="ghost" onClick={() => set({ aPts: [...pts, { x: 0, y: 0 }] })}>+ {t("nj_addAnchor")}</button>
      </div>}
      <p className="hint wide">{t(br ? "nj_dragHintV" : "nj_dragHint")}</p>
      {!br && <label className="wide chk"><input id="nfric" type="checkbox" checked={s.friction} onChange={(e) => set({ friction: e.target.checked })} />{t("nj_friction")}</label>}
    </div> },
  ];
  const open = (id: PartId | JointId | "loads") => set({ sel: s.sel === id ? ("" as NodeState["sel"]) : id });
  const pick = (id: PartId | JointId) => set({ sel: id === "anchors" ? "anchorJ" : id });

  const cols: (keyof NodeCombo)[] = br ? ["P", "H", "Q"] : ["N", "My", "Vz", "Mz", "Vy"];
  const setCombo = (k: number, p: Partial<NodeCombo>) => set({ combos: s.combos.map((c, j) => (j === k ? { ...c, ...p } : c)) });
  const loads = (
    <div className="combo-table">
      <table>
        <thead><tr><th>№</th>{cols.map((c) => <th key={c}>{t(`nl_${c}`)}</th>)}<th /></tr></thead>
        <tbody>{s.combos.map((c, k) => (
          <tr key={k}>
            <td><input id={`cn${k}`} className="cname" value={c.name} onChange={(e) => setCombo(k, { name: e.target.value })} /></td>
            {cols.map((col) => <td key={col}><input id={`c${col}${k}`} type="number" value={(c[col] as number | undefined) ?? ""} placeholder="0" onChange={(e) => setCombo(k, { [col]: e.target.value === "" ? undefined : num(e.target.value) })} /></td>)}
            <td>{s.combos.length > 1 && <button className="ghost xbtn" aria-label="remove" onClick={() => set({ combos: s.combos.filter((_, j) => j !== k) })}>×</button>}</td>
          </tr>))}
        </tbody>
      </table>
      <button id="addcombo" className="ghost" onClick={() => set({ combos: [...s.combos, { name: String(s.combos.length + 1) }] })}>+ {t("nl_add")}</button>
      <p className="hint">{t(br ? "nl_hintBr" : "nl_hint")}</p>
    </div>
  );

  const card = (x: (typeof parts)[number]) => (
    <div key={x.id} className={`part ${s.sel === x.id ? "open" : ""}`}>
      <button className="part-head" id={`part-${x.id}`} onClick={() => open(x.id)}>
        <span className={`part-dot ${x.group}`} /><span className="part-title">{x.title}</span><span className="part-sum">{x.sum}</span>
      </button>
      {s.sel === x.id && <div className="part-body">{x.body}{x.remove && <button className="ghost danger" onClick={x.remove}>{t("np_remove")}</button>}</div>}
    </div>
  );

  const summaryTitle = `${t(`nt_${s.tmpl}`)} · ${sec.name}`;
  const summarySub = `${s.L}×${s.B}×${s.t} · ${pts.length}×M${s.ad} · ${s.conc}`;
  const cur = r?.combos[ci];
  const st = r ? utilState(r.maxUtil) : "ok";
  const gov = r ? r.envelope.reduce((a, b) => (!(b.util <= a.util) ? b : a), r.envelope[0]) : undefined;
  const envelopeList = r && <CheckList checks={r.envelope.map((c) => ({ ...c, clause: `${c.clause} · ${t("nl_combo")} ${c.combo}` }))} t={t} />;
  const summary = r && (
    <div className={`summary ${st}`}>
      <div className="summary-main"><div className="eyebrow">{t("nd_node")}</div><div className="profile">{summaryTitle}</div><div className="meta">{summarySub}</div></div>
      <div className="summary-util"><div className="eyebrow">{t("rep_maxutil")}</div><div className="big">{pct(r.maxUtil)}</div><div className={`pill ${st}`}>{r.ok ? t("ok") : t("fail")}</div></div>
      {gov && <div className="summary-gov"><div className="eyebrow">{t("governing")}</div><div>{t(`chk_${gov.key}`)}</div><div className="meta">{t("nl_combo")} {gov.combo}</div></div>}
    </div>
  );
  const comboTable = r && (
    <table className="conn-values combo-res"><thead><tr><th>{t("nl_combo")}</th><th>N_c</th><th>M</th><th>V</th><th>σ_c</th><th>{t("rep_maxutil")}</th></tr></thead>
      <tbody>{r.combos.map((c, k) => (
        <tr key={k} className={`${k === ci ? "on" : ""} ${utilState(c.maxUtil)}`} onClick={() => selCombo(k)}>
          <td>{c.name}</td><td className="mono">{(c.Nc / kN).toFixed(1)}</td><td className="mono">{(Math.hypot(c.Ms, c.Mw) / kNm).toFixed(2)}</td>
          <td className="mono">{(Math.hypot(c.Vs, c.Vw) / kN).toFixed(1)}</td><td className="mono">{c.sigC.toFixed(2)}</td><td className="mono">{pct(c.maxUtil)}</td>
        </tr>))}</tbody></table>
  );

  return (
    <main className="layout node">
      <aside className="inputs">
        <button className="ghost kind-back" onClick={() => set({ tmpl: null })}>← {t("nd_change")}</button>
        <fieldset><legend><span className="step">1</span>{t("nd_parts")}</legend>
          <div className="parts">{parts.filter((x) => x.group === "part" && x.show).map(card)}</div>
          {!s.ribs && !s.ribTips && <button id="addribs" className="ghost add-part" onClick={() => set({ ribs: true, sel: "ribs" })}>+ {t("np_addRibs")}</button>}
        </fieldset>
        <fieldset><legend><span className="step">2</span>{t("nd_joints")}</legend>
          <div className="parts">{parts.filter((x) => x.group === "joint" && x.show).map(card)}</div>
        </fieldset>
        <fieldset><legend><span className="step">3</span>{t("nd_loads")}</legend>{loads}</fieldset>
        {code === "DBN" && (
          <details className="adv"><summary>{t("advanced")}<span className="adv-hint">γc, γn</span></summary>
            <div className="adv-group"><div className="grid2">
              <Num id="ngc" label={t("gammaC")} v={s.gammaC} step={0.05} on={(v) => set({ gammaC: num(v) })} />
              <Num id="ngn" label={t("gammaN")} v={s.gammaN} step={0.05} on={(v) => set({ gammaN: num(v) })} />
            </div></div></details>
        )}
      </aside>
      <section className="output">
        <div className="tabs" role="tablist">
          {(["results", "report"] as const).map((k) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{t(`tab_${k}`)}</button>)}
        </div>
        {calc.err && <p className="error">{calc.err}</p>}
        {r && tab === "results" && (
          <div className="results">
            {summary}
            <div className="panel"><h3>{t("scheme")}</h3>
              <NodeScheme s={s} p={prof} r={r} combo={ci} onPick={pick} sel={s.sel} set={set} pts={pts} />
              <p className="hint">{t("nd_schemeHint")}</p>
            </div>
            <div className="panel"><h3>{t("nl_byCombo")}</h3>{comboTable}<p className="hint">{t("nl_byComboHint")}</p></div>
            {cur && <div className="panel"><h3>{t("conn_values")} · {t("nl_combo")} {cur.name}</h3>
              <table className="conn-values"><tbody>{cur.values.map((v) => <tr key={v.k}><td>{v.k}</td><td className="mono">{v.v}</td></tr>)}</tbody></table></div>}
            <div className="panel"><h3>{t("nl_envelope")}</h3>{envelopeList}</div>
          </div>
        )}
        {r && tab === "report" && (
          <div className="report-wrap">
            <div className="report-tools">
              <input id="nobj" placeholder={t("objPlaceholder")} value={s.obj} onChange={(e) => set({ obj: e.target.value })} />
              <input id="nelem" placeholder={t("connPlaceholder")} value={s.elem} onChange={(e) => set({ elem: e.target.value })} />
              <button className="primary" onClick={() => window.print()}>{t("print")}</button>
            </div>
            <article className="report">
              <header className="rep-head">
                <h1>{t("nd_repTitle")}: {t(`nt_${s.tmpl}`).toLowerCase()}</h1>
                <dl>
                  <div><dt>{t("rep_object")}</dt><dd>{s.obj || "—"}</dd></div>
                  <div><dt>{t("rep_element")}</dt><dd>{s.elem || "—"}</dd></div>
                  <div><dt>{t("rep_code")}</dt><dd>{code === "DBN" ? "ДБН В.2.6-198:2014; EN 1992-4; EN 1993-1-8, 6.2.5–6.2.6" : "EN 1993-1-8; EN 1992-4; EN 1992-1-1"}</dd></div>
                  <div><dt>{t("rep_date")}</dt><dd>{new Date().toLocaleDateString()}</dd></div>
                </dl>
              </header>
              <h2>{t("rep_summary")}</h2>
              {summary}
              <div className="rep-scheme"><NodeScheme s={s} p={prof} r={r} combo={r.governing} onPick={() => undefined} sel="" set={() => undefined} pts={pts} interactive={false} /></div>
              <h2>{t("nd_parts")}</h2>
              <table className="conn-values"><tbody>{parts.filter((x) => x.show).map((x) => <tr key={x.id}><td>{x.title}</td><td className="mono">{x.sum}</td></tr>)}</tbody></table>
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

function p_kindHint(p: NodeProfile) {
  return p.kind === "I" ? "nj_wHintI" : p.kind === "CHS" ? "nj_wHintCHS" : "nj_wHintRHS";
}
