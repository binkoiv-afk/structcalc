// 3D-вид збірки (SVG, ортогональна проєкція): обертання, масштаб, вибір і перетягування вузлів у площинних видах,
// навантаження, деформована схема, епюри, кольори за використанням.
import { useMemo, useRef, useState } from "react";
import { bracePoints, shellVonMises } from "@structcalc/core";
import type { Assembly, AsmResult, FrameResult, Vec3 } from "@structcalc/core";
import { utilState } from "./Results";

export type ViewKind = "3d" | "xz" | "yz" | "xy";
export type Pick = { kind: "node" | "member" | "panel"; id: string } | null;
export type ShowMode = "none" | "util" | "My" | "Mz" | "N" | "def";

const VIEWS: Record<ViewKind, { yaw: number; pitch: number }> = { "3d": { yaw: -32, pitch: 24 }, xz: { yaw: 0, pitch: 0 }, yz: { yaw: 90, pitch: 0 }, xy: { yaw: 0, pitch: 90 } };

export interface AsmViewProps {
  asm: Assembly;
  res?: AsmResult;
  /** результати сполучення для епюр і деформацій */
  combo?: FrameResult;
  sel: Pick;
  onPick: (p: Pick) => void;
  /** перетягування вузла (лише площинні види) */
  onMoveNode?: (id: string, p: Vec3) => void;
  /** клік по порожньому місцю в площинному виді — точка у світових координатах */
  onPlace?: (p: Vec3) => void;
  view: ViewKind;
  show: ShowMode;
  loadsOf?: string;
  marks?: string[];
  interactive?: boolean;
  t: (k: string) => string;
}

export function AsmView({ asm, res, combo, sel, onPick, onMoveNode, onPlace, view, show, loadsOf, marks = [], interactive = true, t }: AsmViewProps) {
  const W = 640, H = 440;
  const [rot, setRot] = useState<{ yaw: number; pitch: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<{ kind: "rot" | "pan" | "node"; x0: number; y0: number; id?: string; yaw0?: number; pitch0?: number; px0?: number; py0?: number; moved?: boolean } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const ang = view === "3d" && rot ? rot : VIEWS[view];
  const ψ = (ang.yaw * Math.PI) / 180, θ = (ang.pitch * Math.PI) / 180;
  const right: Vec3 = [Math.cos(ψ), Math.sin(ψ), 0];
  const up: Vec3 = [-Math.sin(ψ) * Math.sin(θ), Math.cos(ψ) * Math.sin(θ), Math.cos(θ)];
  const fwd: Vec3 = [-Math.sin(ψ) * Math.cos(θ), Math.cos(ψ) * Math.cos(θ), -Math.sin(θ)];
  const P = useMemo(() => new Map(asm.nodes.map((n) => [n.id, [n.x, n.y, n.z] as Vec3])), [asm.nodes]);
  const pts = [...P.values()];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const box = pts.length ? {
    u0: Math.min(...pts.map((p) => dot(p, right))), u1: Math.max(...pts.map((p) => dot(p, right))),
    v0: Math.min(...pts.map((p) => dot(p, up))), v1: Math.max(...pts.map((p) => dot(p, up))),
  } : { u0: -1000, u1: 1000, v0: -1000, v1: 1000 };
  const size = Math.max(box.u1 - box.u0, box.v1 - box.v0, 500);
  const k = (Math.min((W - 120) / Math.max(box.u1 - box.u0, 1), (H - 120) / Math.max(box.v1 - box.v0, 1), 2) || 0.1) * zoom;
  const cu = (box.u0 + box.u1) / 2, cv = (box.v0 + box.v1) / 2;
  const S = (p: Vec3) => ({ x: W / 2 + (dot(p, right) - cu) * k + pan.x, y: H / 2 - (dot(p, up) - cv) * k + pan.y, d: dot(p, fwd) });
  const model = Math.max(...pts.map((p) => Math.hypot(...p)), 1000);

  // ---- деформації й епюри
  const defScale = useMemo(() => {
    if (!combo) return 0;
    let mx = 0;
    for (const m of Object.values(combo.members)) for (const d of m.disp) mx = Math.max(mx, Math.hypot(...d));
    for (const u of Object.values(combo.u)) mx = Math.max(mx, Math.hypot(u[0], u[1], u[2]));
    return mx > 1e-9 ? (0.06 * size) / mx : 0;
  }, [combo, size]);
  const diagScale = useMemo(() => {
    if (!combo || (show !== "My" && show !== "Mz" && show !== "N")) return 0;
    let mx = 0;
    for (const m of Object.values(combo.members)) for (const v of m[show]) mx = Math.max(mx, Math.abs(v));
    return mx > 1e-9 ? (0.08 * size) / mx : 0;
  }, [combo, show, size]);

  const memberAxes = (a: Vec3, b: Vec3, beta = 0): [Vec3, Vec3, Vec3] => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const x: Vec3 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L, (b[2] - a[2]) / L];
    const ref: Vec3 = Math.abs(x[2]) > 0.999 ? [1, 0, 0] : [0, 0, 1];
    const d = dot(ref, x);
    const zr: Vec3 = [ref[0] - d * x[0], ref[1] - d * x[1], ref[2] - d * x[2]], zl = Math.hypot(...zr);
    let z: Vec3 = [zr[0] / zl, zr[1] / zl, zr[2] / zl];
    let y: Vec3 = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    if (beta) {
      const c = Math.cos((beta * Math.PI) / 180), s = Math.sin((beta * Math.PI) / 180);
      [y, z] = [[c * y[0] + s * z[0], c * y[1] + s * z[1], c * y[2] + s * z[2]], [-s * y[0] + c * z[0], -s * y[1] + c * z[1], -s * y[2] + c * z[2]]];
    }
    return [x, y, z];
  };

  // ---- події
  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!interactive) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (view === "3d") setDrag({ kind: "rot", x0: e.clientX, y0: e.clientY, yaw0: ang.yaw, pitch0: ang.pitch });
    else setDrag({ kind: "pan", x0: e.clientX, y0: e.clientY, px0: pan.x, py0: pan.y });
  };
  const scr = (e: React.PointerEvent) => {
    const svg = svgRef.current, ctm = svg?.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: q.x, y: q.y };
  };
  const toWorld = (sx: number, sy: number, keep: Vec3): Vec3 => {
    const du = (sx - W / 2 - pan.x) / k + cu, dv = -(sy - H / 2 - pan.y) / k + cv;
    // точка на площині виду, що проходить через keep
    const dk = dot(keep, fwd);
    return [right[0] * du + up[0] * dv + fwd[0] * dk, right[1] * du + up[1] * dv + fwd[1] * dk, right[2] * du + up[2] * dv + fwd[2] * dk];
  };
  const snap = (v: number) => Math.round(v / 50) * 50;
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (drag.kind === "rot") setRot({ yaw: (drag.yaw0 ?? 0) - dx * 0.4, pitch: Math.max(-89, Math.min(89, (drag.pitch0 ?? 0) + dy * 0.4)) });
    else if (drag.kind === "pan") setPan({ x: (drag.px0 ?? 0) + dx, y: (drag.py0 ?? 0) + dy });
    else if (drag.kind === "node" && drag.id && onMoveNode) {
      const p0 = P.get(drag.id)!, q = scr(e), w = toWorld(q.x, q.y, p0);
      onMoveNode(drag.id, w.map((v, i) => (Math.abs(fwd[i]) > 0.99 ? p0[i] : snap(v))) as Vec3);
    }
  };
  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag && !drag.moved && drag.kind !== "node") {
      // клік по фону: зняти вибір або поставити точку
      if (onPlace && view !== "3d") {
        const q = scr(e), w = toWorld(q.x, q.y, [0, 0, 0]);
        onPlace(w.map((v, i) => (Math.abs(fwd[i]) > 0.99 ? 0 : snap(v))) as Vec3);
      } else onPick(null);
    }
    setDrag(null);
  };
  const onWheel = (e: React.WheelEvent) => { if (!interactive) return; setZoom((z) => Math.max(0.2, Math.min(8, z * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))); };
  const startNode = (id: string) => (e: React.PointerEvent) => {
    if (!interactive) return;
    e.stopPropagation();
    onPick({ kind: "node", id });
    if (view !== "3d" && onMoveNode) setDrag({ kind: "node", x0: e.clientX, y0: e.clientY, id });
  };

  // ---- об'єкти з глибиною
  type Item = { d: number; el: JSX.Element };
  const items: Item[] = [];
  const isSel = (kind: string, id: string) => sel?.kind === kind && sel.id === id;
  const plateRes = new Map(res?.plates.map((x) => [x.panel, x]) ?? []);
  for (const p of asm.panels) {
    const c = p.nodes.map((id) => P.get(id)).filter(Boolean) as Vec3[];
    if (c.length < 3) continue;
    const pr = p.kind === "plate" ? plateRes.get(p.id) : undefined;
    if (pr) {
      // пластина: сітка елементів, колір — σ_ef / R вибраного сполучення
      const pick = (e: React.PointerEvent) => { e.stopPropagation(); if (interactive) onPick({ kind: "panel", id: p.id }); };
      const on = isSel("panel", p.id);
      const def = show === "def" && combo && defScale;
      const at = (i: number, j: number): Vec3 => {
        const q = pr.pts[i][j], u = def ? combo!.u[pr.ids[i][j]] : undefined;
        return u ? [q[0] + u[0] * defScale, q[1] + u[1] * defScale, q[2] + u[2] * defScale] : q;
      };
      pr.elems.forEach((row, i) => row.forEach((eid, j) => {
        const s4 = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)].map(S), d = s4.reduce((a, q) => a + q.d, 0) / 4;
        const sf = combo?.shells?.[eid];
        const u = sf && show === "util" ? Math.max(...sf.gp.map((g) => shellVonMises(g, pr.t))) / pr.R : undefined;
        items.push({ d: d + 1e6, el: <polygon key={`pe${eid}`} points={s4.map((q) => `${q.x},${q.y}`).join(" ")}
          className={`av-pe ${u !== undefined ? utilState(u) : ""} ${on ? "on" : ""}`} style={u !== undefined ? { fillOpacity: 0.18 + 0.67 * Math.min(1, u) } : undefined} onPointerDown={pick} /> });
      }));
      if (show === "util") {
        const s = c.map(S);
        const g = { x: s.reduce((a, q) => a + q.x, 0) / s.length, y: s.reduce((a, q) => a + q.y, 0) / s.length };
        items.push({ d: -1e9, el: <text key={`pu${p.id}`} x={g.x} y={g.y} className={`av-txt ${utilState(pr.util)}`} textAnchor="middle">{Math.round(pr.util * 100)}%</text> });
      }
      continue;
    }
    const s = c.map(S), d = s.reduce((a, q) => a + q.d, 0) / s.length;
    items.push({ d: d + 1e6, el: <polygon key={`p${p.id}`} points={s.map((q) => `${q.x},${q.y}`).join(" ")} className={`av-panel ${p.kind === "plate" ? "plate" : ""} ${isSel("panel", p.id) ? "on" : ""}`}
      onPointerDown={(e) => { e.stopPropagation(); if (interactive) onPick({ kind: "panel", id: p.id }); }} /> });
  }
  const mUtil = new Map(res?.members.map((m) => [m.member, m.util]) ?? []);
  for (const m of asm.members) {
    const a = P.get(m.i), b = P.get(m.j);
    if (!a || !b) continue;
    const sa = S(a), sb = S(b), d = (sa.d + sb.d) / 2;
    const u = mUtil.get(m.id);
    const cls = `av-member ${show === "util" && u !== undefined ? utilState(u) : ""} ${isSel("member", m.id) ? "on" : ""}`;
    const g: JSX.Element[] = [
      <line key="hit" x1={sa.x} y1={sa.y} x2={sb.x} y2={sb.y} className="av-hit" onPointerDown={(e) => { e.stopPropagation(); if (interactive) onPick({ kind: "member", id: m.id }); }} />,
      <line key="l" x1={sa.x} y1={sa.y} x2={sb.x} y2={sb.y} className={cls} />,
    ];
    // кінці: шарнір — кружок, жорстко — квадрат
    for (const [end, sp, sq] of [[m.endI, sa, sb], [m.endJ, sb, sa]] as const) {
      const L = Math.hypot(sq.x - sp.x, sq.y - sp.y) || 1, f = Math.min(10, L * 0.2) / L;
      const x = sp.x + (sq.x - sp.x) * f, y = sp.y + (sq.y - sp.y) * f;
      g.push(end.behaviour === "pin"
        ? <circle key={`e${g.length}`} cx={x} cy={y} r={3.2} className="av-pin" />
        : <rect key={`e${g.length}`} x={x - 2.6} y={y - 2.6} width={5.2} height={5.2} className={`av-rigid k-${end.kind}`} />);
    }
    // точки раскріплення (прогони, зв'язки) — хрестики
    bracePoints(asm, m).forEach((bp, k) => { const q = S(bp.P); g.push(<path key={`br${k}`} className="av-brace" d={`M${q.x - 3.5} ${q.y - 3.5}l7 7M${q.x + 3.5} ${q.y - 3.5}l-7 7`} />); });
    if (show === "util" && u !== undefined) g.push(<text key="u" x={(sa.x + sb.x) / 2 + 4} y={(sa.y + sb.y) / 2 - 4} className={`av-txt ${utilState(u)}`}>{Math.round(u * 100)}%</text>);
    else if (marks.includes("ids")) g.push(<text key="id" x={(sa.x + sb.x) / 2 + 4} y={(sa.y + sb.y) / 2 - 4} className="av-txt">{m.id}</text>);
    // епюри
    const mf = combo?.members[m.id];
    if (mf && diagScale && (show === "My" || show === "Mz" || show === "N")) {
      const ax = memberAxes(a, b, m.beta);
      // M_y > 0 — розтягнуті волокна +z: епюра з боку розтягнутих волокон; M_z > 0 — розтягнуто −y; N — уздовж z
      const dirv = show === "My" ? ax[2] : show === "Mz" ? ([-ax[1][0], -ax[1][1], -ax[1][2]] as Vec3) : ax[2];
      const vals = mf[show];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const poly = mf.x.map((x, q) => {
        const base: Vec3 = [a[0] + ax[0][0] * x, a[1] + ax[0][1] * x, a[2] + ax[0][2] * x];
        const o = vals[q] * diagScale;
        return S([base[0] + dirv[0] * o, base[1] + dirv[1] * o, base[2] + dirv[2] * o]);
      });
      const path = `M${sa.x},${sa.y} ` + poly.map((q) => `L${q.x},${q.y}`).join(" ") + ` L${sb.x},${sb.y}`;
      g.push(<path key="dg" d={path} className={`av-diag ${show}`} />);
      const im = vals.reduce((bi, v, q) => (Math.abs(v) > Math.abs(vals[bi]) ? q : bi), 0);
      if (Math.abs(vals[im]) > 1e-6 && L > 0) {
        const unit = show === "N" ? 1e3 : 1e6;
        g.push(<text key="dv" x={poly[im].x + 3} y={poly[im].y - 3} className="av-txt dg">{(vals[im] / unit).toFixed(show === "N" ? 1 : 2)}</text>);
      }
    }
    if (mf && defScale && show === "def") {
      const poly = mf.disp.map((dd, q) => {
        const x = mf.x[q], L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        const base: Vec3 = [a[0] + ((b[0] - a[0]) * x) / L, a[1] + ((b[1] - a[1]) * x) / L, a[2] + ((b[2] - a[2]) * x) / L];
        return S([base[0] + dd[0] * defScale, base[1] + dd[1] * defScale, base[2] + dd[2] * defScale]);
      });
      g.push(<polyline key="df" points={poly.map((q) => `${q.x},${q.y}`).join(" ")} className="av-def" />);
    }
    items.push({ d, el: <g key={`m${m.id}`}>{g}</g> });
  }
  // навантаження вибраного загруження
  const arrows: JSX.Element[] = [];
  const lc = asm.cases.find((c) => c.id === loadsOf);
  const arrow = (from: Vec3, to: Vec3, key: string, label?: string) => {
    const a = S(from), b = S(to);
    arrows.push(<g key={key} className="av-load"><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} markerEnd="url(#avarr)" />{label && <text x={a.x + 3} y={a.y - 3} className="av-txt ld">{label}</text>}</g>);
  };
  if (lc) {
    const Lr = 0.12 * size;
    for (const nl of lc.nodal ?? []) {
      const p = P.get(nl.node);
      if (!p) continue;
      const F: Vec3 = [nl.F[0] ?? 0, nl.F[1] ?? 0, nl.F[2] ?? 0], fm = Math.hypot(...F);
      if (fm < 1e-9) continue;
      arrow([p[0] - (F[0] / fm) * Lr, p[1] - (F[1] / fm) * Lr, p[2] - (F[2] / fm) * Lr], p, `n${nl.node}${arrows.length}`, `${(fm / 1000).toFixed(1)} kN`);
    }
    for (const ml of lc.members ?? []) {
      const m = asm.members.find((x) => x.id === ml.member), a = m && P.get(m.i), b = m && P.get(m.j);
      if (!a || !b || ml.kind !== "dist" || !ml.dir.startsWith("g")) continue;
      const v: Vec3 = ml.dir === "gx" ? [1, 0, 0] : ml.dir === "gy" ? [0, 1, 0] : [0, 0, 1], sg = Math.sign(ml.w1) || 1;
      for (let q = 1; q < 6; q++) {
        const p: Vec3 = [a[0] + ((b[0] - a[0]) * q) / 6, a[1] + ((b[1] - a[1]) * q) / 6, a[2] + ((b[2] - a[2]) * q) / 6];
        arrow([p[0] - v[0] * sg * Lr * 0.5, p[1] - v[1] * sg * Lr * 0.5, p[2] - v[2] * sg * Lr * 0.5], p, `ml${ml.member}${q}${arrows.length}`, q === 3 ? `${Math.abs(ml.w1).toFixed(2)} kN/m` : undefined);
      }
    }
    for (const pl of asm.panelLoads.filter((x) => x.case === lc.id)) {
      const p = asm.panels.find((x) => x.id === pl.panel);
      const c = p?.nodes.map((id) => P.get(id)).filter(Boolean) as Vec3[] | undefined;
      if (!c || c.length < 3) continue;
      const g: Vec3 = [c.reduce((s, q) => s + q[0], 0) / c.length, c.reduce((s, q) => s + q[1], 0) / c.length, c.reduce((s, q) => s + q[2], 0) / c.length];
      let v: Vec3 = pl.dir === "gx" ? [1, 0, 0] : pl.dir === "gy" ? [0, 1, 0] : [0, 0, 1];
      if (pl.dir === "normal") {
        const e1: Vec3 = [c[1][0] - c[0][0], c[1][1] - c[0][1], c[1][2] - c[0][2]], e2: Vec3 = [c[c.length - 1][0] - c[0][0], c[c.length - 1][1] - c[0][1], c[c.length - 1][2] - c[0][2]];
        const n: Vec3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], nl = Math.hypot(...n);
        v = [n[0] / nl, n[1] / nl, n[2] / nl];
      }
      // центр навантаженої частини панелі
      const rg = pl.region ?? { u0: 0, u1: 1, v0: 0, v1: 1 };
      const Q4 = c.length === 3 ? [c[0], c[1], c[2], c[2]] : c;
      const X = (u: number, v: number): Vec3 => [0, 1, 2].map((k) => Q4[0][k] * (1 - u) * (1 - v) + Q4[1][k] * u * (1 - v) + Q4[2][k] * u * v + Q4[3][k] * (1 - u) * v) as Vec3;
      const sg = Math.sign(pl.q) || 1;
      const offs = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
      void g;
      offs.forEach(([fu, fv], q) => {
        const p = X(rg.u0 + (rg.u1 - rg.u0) * fu, rg.v0 + (rg.v1 - rg.v0) * fv);
        arrow([p[0] - v[0] * sg * Lr * 0.6, p[1] - v[1] * sg * Lr * 0.6, p[2] - v[2] * sg * Lr * 0.6], p, `pl${pl.panel}${q}${arrows.length}`, q === 0 ? `${(Math.abs(pl.q) * 1000).toFixed(2)} kPa` : undefined);
      });
    }
  }
  // вузли та опори
  const nodesEl = asm.nodes.map((n) => {
    const s = S([n.x, n.y, n.z]);
    const on = isSel("node", n.id), mk = marks.includes(`n:${n.id}`);
    const sup = n.support && n.support !== "none" ? (
      n.support === "fixed" || n.support === "base"
        ? <g className="av-sup"><rect x={s.x - 9} y={s.y + 4} width={18} height={n.support === "base" ? 4 : 3} />{n.support === "base" && <path d={`M${s.x - 6} ${s.y + 8}v6M${s.x + 6} ${s.y + 8}v6`} />}<path d={`M${s.x - 9} ${s.y + 8}l-3 4M${s.x - 3} ${s.y + 8}l-3 4M${s.x + 3} ${s.y + 8}l-3 4M${s.x + 9} ${s.y + 8}l-3 4`} /></g>
        : <g className="av-sup"><path d={`M${s.x} ${s.y + 3} l-7 10 h14 z`} />{n.support === "roller" && <path d={`M${s.x - 8} ${s.y + 16} h16`} />}</g>
    ) : n.fix && Object.values(n.fix).some(Boolean) ? <path d={`M${s.x - 6} ${s.y + 6} h12`} className="av-sup brace" /> : null;
    return (
      <g key={`n${n.id}`} className={`av-node ${on ? "on" : ""} ${mk ? "mark" : ""}`} onPointerDown={startNode(n.id)}>
        {sup}
        <circle cx={s.x} cy={s.y} r={on || mk ? 6 : 4.2} />
        {(marks.includes("ids") || on) && <text x={s.x + 7} y={s.y - 6} className="av-txt nid">{n.id}</text>}
      </g>
    );
  });
  // осі
  const axO = { x: 46, y: H - 40 };
  const axis = (v: Vec3, lbl: string) => {
    const x = axO.x + dot(v, right) * 26, y = axO.y - dot(v, up) * 26;
    return <g key={lbl}><line x1={axO.x} y1={axO.y} x2={x} y2={y} className="av-axis" /><text x={x + (x - axO.x) * 0.25} y={y + (y - axO.y) * 0.25 + 4} className="av-txt ax" textAnchor="middle">{lbl}</text></g>;
  };
  items.sort((a, b) => b.d - a.d);
  void model;
  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className={`asm-view ${drag?.kind === "rot" ? "rotating" : ""}`} role="img" aria-label={t("asm_view")}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setDrag(null)} onWheel={onWheel}>
      <defs><marker id="avarr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" className="av-arrhead" /></marker></defs>
      <rect x={0} y={0} width={W} height={H} className="av-bg" />
      {items.map((x) => x.el)}
      {arrows}
      {nodesEl}
      {axis([1, 0, 0], "X")}{axis([0, 1, 0], "Y")}{axis([0, 0, 1], "Z")}
      {interactive && (view !== "3d" || rot || zoom !== 1 || pan.x || pan.y) ? (
        <g className="av-reset" onPointerDown={(e) => { e.stopPropagation(); setRot(null); setZoom(1); setPan({ x: 0, y: 0 }); }}>
          <rect x={W - 34} y={8} width={26} height={22} rx={5} /><text x={W - 21} y={23} textAnchor="middle">⟲</text>
        </g>) : null}
    </svg>
  );
}
