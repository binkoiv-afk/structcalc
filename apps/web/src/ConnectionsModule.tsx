import { useMemo, useState } from "react";
import {
  ANCHOR_STEELS, AnchorType, BOLT_CLASSES, BOLT_DIAMETERS, checkAnchors, checkBolts, checkButt, checkFillet, checkScrews, CodeId,
  CONCRETE_CLASSES, ConnResult, STEELS, WELD_PROCESSES, WeldProcess, WeldShape, weldShape, weldGroupProps,
} from "@structcalc/core";
import { CheckList, governing, pct, T, utilState } from "./Results";

export type ConnKind = "fillet" | "butt" | "bolts" | "friction" | "rivets" | "screws" | "anchors";
export const KINDS: ConnKind[] = ["fillet", "butt", "bolts", "friction", "rivets", "screws", "anchors"];

export interface ConnState {
  kind: ConnKind | null;
  steel: string; t1: number; t2: number; gammaC: number; gammaN: number; obj: string; elem: string;
  // кутові шви
  wShape: WeldShape; wb: number; wh: number; wtf: number; wtw: number; kf: number; wProc: WeldProcess;
  wN: number; wVy: number; wVz: number; wMx: number; wMy: number; wMz: number;
  // стиковий
  bL: number; bN: number; bV: number; bM: number; bCtrl: boolean; bRunOff: boolean;
  // болти / фрикційні / заклепки
  d: number; bClass: string; accA: boolean; planes: number; rows: number; cols: number; px: number; py: number; ea: number; e2: number;
  Fx: number; Fy: number; Mb: number; Tb: number; mu: number; fur: number;
  // саморези
  sd: number; sdw: number; sFvRk: number; sFtRk: number; se1: number; sn: number; sV: number; sT: number;
  // анкери
  aType: AnchorType; ad: number; ahef: number; aSteel: string; aConc: string; aCracked: boolean; ah: number;
  anx: number; any: number; asx: number; asy: number; acxm: string; acxp: string; acym: string; acyp: string; abx: number; aby: number;
  aN: number; aMx: number; aMy: number; aVx: number; aVy: number; aT: number; aStandoff: number; aNRkp: string; aTau: number; aTauU: number;
  aCcrSp: string; aHmin: string; aGinst: string; aEdgeReinf: boolean; aDh: string;
}

export const initialConn: ConnState = {
  kind: null, steel: "C245", t1: 10, t2: 10, gammaC: 1, gammaN: 1, obj: "", elem: "",
  wShape: "lines2v", wb: 120, wh: 200, wtf: 10, wtw: 6, kf: 6, wProc: "manual", wN: 0, wVy: 0, wVz: 80, wMx: 0, wMy: 8, wMz: 0,
  bL: 200, bN: 200, bV: 0, bM: 0, bCtrl: false, bRunOff: false,
  d: 20, bClass: "5.6", accA: false, planes: 1, rows: 2, cols: 2, px: 70, py: 70, ea: 40, e2: 40, Fx: 120, Fy: 0, Mb: 0, Tb: 0, mu: 0.42, fur: 400,
  sd: 5.5, sdw: 14, sFvRk: 4500, sFtRk: 0, se1: 20, sn: 4, sV: 3, sT: 1.5,
  aType: "bonded", ad: 16, ahef: 125, aSteel: "5.8", aConc: "C25/30", aCracked: true, ah: 300,
  anx: 2, any: 2, asx: 200, asy: 200, acxm: "", acxp: "300", acym: "", acyp: "", abx: 300, aby: 300,
  aN: 15, aMx: 0, aMy: 5, aVx: 10, aVy: 0, aT: 0, aStandoff: 0, aNRkp: "", aTau: 7, aTauU: 12, aCcrSp: "", aHmin: "", aGinst: "", aEdgeReinf: false, aDh: "",
};

/** выбор типа: подставляет типовые толщины (саморезы — тонкий лист) */
export function pickKind(s: ConnState, k: ConnKind): Partial<ConnState> {
  if (k === "screws") return s.t1 > 3 ? { kind: k, t1: 0.7, t2: 2 } : { kind: k };
  return k !== "anchors" && s.t1 < 3 ? { kind: k, t1: 10, t2: 10 } : { kind: k };
}

const num = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(",", ".")));
const edge = (v: string) => (v.trim() === "" ? Infinity : num(v));
const opt = (v: string) => (v.trim() === "" ? undefined : num(v));

export const CONN_ICONS: Record<ConnKind, JSX.Element> = {
  fillet: <><path d="M6 36h36M24 36V8" strokeWidth="3" /><path d="M18 36l6-6 6 6z" className="fillicon" /></>,
  butt: <><path d="M4 22h18M26 22h18M4 30h18M26 30h18" strokeWidth="3" /><path d="M22 18l2 4 2-4M22 34l2-4 2 4" /></>,
  bolts: <><path d="M6 16h36M6 32h36" strokeWidth="3" /><path d="M16 10v28M32 10v28" strokeWidth="4" /></>,
  friction: <><path d="M6 16h36M6 32h36" strokeWidth="3" /><path d="M16 10v28M32 10v28" strokeWidth="4" /><path d="M10 24h28" strokeDasharray="3 3" /></>,
  rivets: <><path d="M6 18h36M6 30h36" strokeWidth="3" /><circle cx="16" cy="12" r="4" /><circle cx="32" cy="12" r="4" /><path d="M16 16v18M32 16v18" strokeWidth="3" /></>,
  screws: <><path d="M6 20h36M6 26h36" strokeWidth="2.5" /><path d="M24 8v32M20 30l8-3M20 35l8-3" /><path d="M18 8h12" strokeWidth="3" /></>,
  anchors: <><path d="M4 18h40" strokeWidth="3" /><path d="M4 18v24h40V18" strokeDasharray="2 3" /><path d="M16 10v24M32 10v24" strokeWidth="3" /><path d="M12 34h8M28 34h8" strokeWidth="3" /></>,
};

function Num({ id, label, v, on, step, ph }: { id: string; label: string; v: number | string; on: (s: string) => void; step?: number; ph?: string }) {
  return <label><span className="lbl">{label}</span><input id={id} type="number" step={step ?? 1} placeholder={ph} value={v} onChange={(e) => on(e.target.value)} /></label>;
}

function ConnSummary({ r, t, title, sub }: { r: ConnResult; t: T; title: string; sub: string }) {
  const g = governing(r.checks);
  const st = utilState(r.maxUtil);
  return (
    <div className={`summary ${st}`}>
      <div className="summary-main"><div className="eyebrow">{t("conn_type")}</div><div className="profile">{title}</div><div className="meta">{sub}</div></div>
      <div className="summary-util"><div className="eyebrow">{t("rep_maxutil")}</div><div className="big">{pct(r.maxUtil)}</div><div className={`pill ${st}`}>{r.ok ? t("ok") : t("fail")}</div></div>
      {g && <div className="summary-gov"><div className="eyebrow">{t("governing")}</div><div>{t(`chk_${g.key}`)}</div></div>}
    </div>
  );
}

function Values({ r }: { r: ConnResult }) {
  return <table className="conn-values"><tbody>{r.values.map((v) => <tr key={v.k}><td>{v.k}</td><td className="mono">{v.v}</td></tr>)}</tbody></table>;
}

/** Схема групи кріплень у плані: плита, кріплення, відстані, сили. */
function GroupScheme({ nx, ny, sx, sy, ex, ey, d, Fx, Fy, edges, forces, plate }: {
  nx: number; ny: number; sx: number; sy: number; ex: number; ey: number; d: number; Fx: number; Fy: number;
  edges?: { xm: number; xp: number; ym: number; yp: number }; forces?: number[]; plate?: { bx: number; by: number };
}) {
  const W = (nx - 1) * sx, H = (ny - 1) * sy;
  const px = plate ? plate.bx : W + 2 * ex, py = plate ? plate.by : H + 2 * ey;
  const fin = (v: number) => (Number.isFinite(v) ? v : Math.max(px, py) * 0.35);
  const ex0 = edges ? fin(edges.xm) : 0, ex1 = edges ? fin(edges.xp) : 0, ey0 = edges ? fin(edges.ym) : 0, ey1 = edges ? fin(edges.yp) : 0;
  const L = Math.min(-px / 2, -W / 2 - ex0) - 30, R = Math.max(px / 2, W / 2 + ex1) + 30;
  const B = Math.min(-py / 2, -H / 2 - ey0) - 30, Tp = Math.max(py / 2, H / 2 + ey1) + 30;
  const vw = R - L, vh = Tp - B;
  const s = 300 / Math.max(vw, vh);
  const X = (x: number) => (x - L) * s + 10, Y = (y: number) => (Tp - y) * s + 10;
  const fmax = forces ? Math.max(...forces, 1e-9) : 1;
  const pts: { x: number; y: number; k: number }[] = [];
  let k = 0;
  for (let a = 0; a < nx; a++) for (let b = 0; b < ny; b++) pts.push({ x: (a - (nx - 1) / 2) * sx, y: (b - (ny - 1) / 2) * sy, k: k++ });
  const Fm = Math.hypot(Fx, Fy);
  return (
    <svg viewBox={`0 0 ${vw * s + 20} ${vh * s + 20}`} className="conn-scheme" role="img" aria-label="scheme">
      {edges && (
        <rect x={X(Number.isFinite(edges.xm) ? -W / 2 - edges.xm : L)} y={Y(Number.isFinite(edges.yp) ? H / 2 + edges.yp : Tp)}
          width={(Math.min(Number.isFinite(edges.xp) ? W / 2 + edges.xp : R, R) - Math.max(Number.isFinite(edges.xm) ? -W / 2 - edges.xm : L, L)) * s}
          height={(Math.min(Number.isFinite(edges.yp) ? H / 2 + edges.yp : Tp, Tp) - Math.max(Number.isFinite(edges.ym) ? -H / 2 - edges.ym : B, B)) * s}
          className="cs-concrete" />
      )}
      <rect x={X(-px / 2)} y={Y(py / 2)} width={px * s} height={py * s} className="cs-plate" />
      {pts.map((p) => {
        const f = forces?.[p.k] ?? 0;
        return <g key={p.k}>
          <circle cx={X(p.x)} cy={Y(p.y)} r={Math.max(3, (d / 2) * s)} className={forces ? (f > 0 ? "cs-anchor t" : "cs-anchor") : "cs-hole"} style={forces && f > 0 ? { opacity: 0.35 + 0.65 * f / fmax } : undefined} />
          {forces && f > 0 && <text x={X(p.x) + 8} y={Y(p.y) - 6} className="s-text small">{(f / 1000).toFixed(1)}</text>}
        </g>;
      })}
      {nx > 1 && <text x={X(0)} y={Y(-py / 2) + 13} className="s-text small" textAnchor="middle">{nx - 1}×{sx}</text>}
      {ny > 1 && <text x={X(px / 2) + 4} y={Y(0) + 4} className="s-text small">{ny - 1}×{sy}</text>}
      {Fm > 0 && (
        <g>
          <line x1={X(0)} y1={Y(0)} x2={X(0) + (Fx / Fm) * 60} y2={Y(0) - (Fy / Fm) * 60} className="cs-load" markerEnd="url(#garr)" />
          <defs><marker id="garr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" className="s-load-fill" /></marker></defs>
        </g>
      )}
    </svg>
  );
}

function WeldScheme({ shape, b, h, tf, tw, kf }: { shape: WeldShape; b: number; h: number; tf: number; tw: number; kf: number }) {
  const segs = weldShape(shape, { b, h, tf, tw });
  const p = weldGroupProps(segs, 0);
  const m = Math.max(b, h) * 0.65;
  const s = 260 / (2 * m);
  const X = (y: number) => 150 + y * s, Y = (z: number) => 140 - z * s;
  return (
    <svg viewBox="0 0 300 280" className="conn-scheme" role="img" aria-label="scheme">
      {(shape === "iProfile" || shape === "rhs") && (
        shape === "rhs"
          ? <rect x={X(-b / 2)} y={Y(h / 2)} width={b * s} height={h * s} className="cs-plate" />
          : <path d={`M${X(-b / 2)} ${Y(h / 2)}h${b * s}v${tf * s}h${-(b - tw) / 2 * s}v${(h - 2 * tf) * s}h${(b - tw) / 2 * s}v${tf * s}h${-b * s}v${-tf * s}h${(b - tw) / 2 * s}v${-(h - 2 * tf) * s}h${-(b - tw) / 2 * s}z`} className="cs-plate" />
      )}
      {segs.map((q, i) => <line key={i} x1={X(q.y1)} y1={Y(q.z1)} x2={X(q.y2)} y2={Y(q.z2)} className="cs-weld" strokeWidth={Math.max(3, kf * s)} />)}
      <circle cx={X(p.yc)} cy={Y(p.zc)} r={3} className="cs-node" />
      <line x1={X(-m * 0.95)} x2={X(m * 0.95)} y1={Y(p.zc)} y2={Y(p.zc)} className="cs-axis" />
      <line x1={X(p.yc)} x2={X(p.yc)} y1={Y(-m * 0.95)} y2={Y(m * 0.95)} className="cs-axis" />
      <text x={X(m * 0.95) - 10} y={Y(p.zc) - 6} className="s-text small">y</text>
      <text x={X(p.yc) + 6} y={Y(m * 0.95) + 12} className="s-text small">z</text>
    </svg>
  );
}

export function ConnectionsModule({ code, s, set, t }: { code: CodeId; s: ConnState; set: (p: Partial<ConnState>) => void; t: T }) {
  const [tab, setTab] = useState<"results" | "report">("results");
  const steels = STEELS.filter((x) => x.code === code);
  const steel = steels.find((x) => x.id === s.steel) ?? steels[0];
  const tmin = Math.min(s.t1, s.t2), tmax = Math.max(s.t1, s.t2);
  const Ryn = steel.yieldChar(tmax), Run = steel.ultimate(tmax), Ry = steel.strength(tmax);

  // фрикційні: ДБН — сталь 40Х «селект»; EN — лише попередньо напружені класи 8.8 / 10.9
  const fricClass = s.kind !== "friction" ? undefined : code === "DBN" ? "40X" : ["8.8", "10.9"].includes(s.bClass) ? s.bClass : "10.9";
  const calc = useMemo((): { r?: ConnResult; err?: string; forces?: number[] } => {
    try {
      const kN = 1000, kNm = 1e6;
      switch (s.kind) {
        case "fillet":
          return { r: checkFillet({ code, segs: weldShape(s.wShape, { b: s.wb, h: s.wh, tf: s.wtf, tw: s.wtw }), kf: s.kf, process: s.wProc, Run, Ryn, tmin, tmax,
            N: s.wN * kN, Vy: s.wVy * kN, Vz: s.wVz * kN, Mx: s.wMx * kNm, My: s.wMy * kNm, Mz: s.wMz * kNm, gammaC: s.gammaC, gammaN: s.gammaN }) };
        case "butt":
          return { r: checkButt({ code, t: tmin, L: s.bL, runOff: s.bRunOff, physicalControl: s.bCtrl, Ry, N: s.bN * kN, V: s.bV * kN, M: s.bM * kNm, gammaC: s.gammaC, gammaN: s.gammaN }) };
        case "bolts": case "friction": case "rivets": {
          const kind = s.kind === "bolts" ? "bearing" : s.kind === "friction" ? "friction" : "rivet";
          return { r: checkBolts({ code, kind, d: s.d, boltClass: fricClass ?? s.bClass, accuracyA: s.accA, shearPlanes: s.planes, tmin,
            Ryn, Run, group: { rows: s.rows, cols: s.cols, px: s.px, py: s.py }, a: s.ea, e2: s.e2,
            Fx: s.Fx * kN, Fy: s.Fy * kN, M: s.Mb * kNm, T: s.Tb * kN, mu: s.mu, fur: s.fur, gammaC: s.gammaC, gammaN: s.gammaN }) };
        }
        case "screws":
          return { r: checkScrews({ d: s.sd, t: s.t1, t1: s.t2, fu: Run, fu1: Run, dw: s.sdw, FvRk: s.sFvRk, FtRk: s.sFtRk || undefined, e1: s.se1, n: s.sn, V: s.sV * kN, T: s.sT * kN }) };
        case "anchors": {
          const fck = CONCRETE_CLASSES.find((c) => c.id === s.aConc)?.fck ?? 25;
          const r = checkAnchors({ code, type: s.aType, d: s.ad, hef: s.ahef, steel: s.aSteel, fck, cracked: s.aCracked, h: s.ah,
            nx: s.anx, ny: s.any, sx: s.asx, sy: s.asy, cxm: edge(s.acxm), cxp: edge(s.acxp), cym: edge(s.acym), cyp: edge(s.acyp), bx: s.abx, by: s.aby,
            N: s.aN * kN, Mx: s.aMx * kNm, My: s.aMy * kNm, Vx: s.aVx * kN, Vy: s.aVy * kN, T: s.aT * kNm, standoff: s.aStandoff,
            NRkp: opt(s.aNRkp) !== undefined ? opt(s.aNRkp)! * kN : undefined, tauRk: s.aTau, tauRkUcr: s.aTauU,
            ccrSp: opt(s.aCcrSp), hmin: opt(s.aHmin), gammaInst: opt(s.aGinst), edgeReinf: s.aEdgeReinf, dh: opt(s.aDh), gammaN: s.gammaN });
          return { r, forces: r.forces.map((q) => q.N) };
        }
      }
      return {};
    } catch (e) { return { err: String((e as Error).message) }; }
  }, [code, s, Run, Ryn, Ry, tmin, tmax, fricClass]);

  if (!s.kind) {
    return (
      <main className="home">
        <h1 className="home-title">{t("conn_pick")}</h1>
        <p className="home-sub">{t("conn_pick_sub")}</p>
        <div className="cards">
          {KINDS.map((k) => (
            <button key={k} id={`conn-${k}`} className="card" onClick={() => set(pickKind(s, k))}>
              <svg viewBox="0 0 48 48" className="card-icon" aria-hidden="true">{CONN_ICONS[k]}</svg>
              <span className="card-title">{t(`conn_${k}`)}</span>
              <span className="card-desc">{t(`conn_${k}_d`)}</span>
            </button>
          ))}
        </div>
      </main>
    );
  }

  const kind = s.kind;
  const steelSel = (
    <label className="wide"><span className="lbl">{t("material")}</span>
      <select id="nsteel" value={steel.id} onChange={(e) => set({ steel: e.target.value })}>{steels.map((x) => <option key={x.id}>{x.id}</option>)}</select>
    </label>
  );
  const thick = (l1: string, l2: string) => <>
    <Num id="nt1" label={l1} v={s.t1} on={(v) => set({ t1: num(v) })} />
    <Num id="nt2" label={l2} v={s.t2} on={(v) => set({ t2: num(v) })} />
  </>;
  const factors = code === "DBN" && kind !== "screws" && (
    <details className="adv">
      <summary>{t("advanced")}<span className="adv-hint">γc, γn</span></summary>
      <div className="adv-group"><div className="grid2">
        {kind !== "anchors" && <Num id="ngc" label={t("gammaC")} v={s.gammaC} step={0.05} on={(v) => set({ gammaC: num(v) })} />}
        <Num id="ngn" label={t("gammaN")} v={s.gammaN} step={0.05} on={(v) => set({ gammaN: num(v) })} />
      </div></div>
    </details>
  );

  let form: JSX.Element, scheme: JSX.Element | null = null, sub = "";
  if (kind === "fillet") {
    const shapes: WeldShape[] = ["lines2v", "flank2", "trans2", "channel", "rect", "rhs", "iProfile"];
    form = <>
      <fieldset><legend><span className="step">1</span>{t("conn_geom")}</legend><div className="grid2">
        <label className="wide"><span className="lbl">{t("w_shape")}</span>
          <select id="wshape" value={s.wShape} onChange={(e) => set({ wShape: e.target.value as WeldShape })}>{shapes.map((x) => <option key={x} value={x}>{t(`ws_${x}`)}</option>)}</select>
        </label>
        <Num id="wb" label={t("w_b")} v={s.wb} on={(v) => set({ wb: num(v) })} />
        <Num id="wh" label={t("w_h")} v={s.wh} on={(v) => set({ wh: num(v) })} />
        {s.wShape === "iProfile" && <><Num id="wtf" label="t_f, mm" v={s.wtf} on={(v) => set({ wtf: num(v) })} /><Num id="wtw" label="t_w, mm" v={s.wtw} on={(v) => set({ wtw: num(v) })} /></>}
        <Num id="wkf" label={t("w_kf")} v={s.kf} on={(v) => set({ kf: num(v) })} />
        {code === "DBN" && <label><span className="lbl">{t("w_proc")}</span>
          <select id="wproc" value={s.wProc} onChange={(e) => set({ wProc: e.target.value as WeldProcess })}>{WELD_PROCESSES.map((x) => <option key={x} value={x}>{t(`wp_${x}`)}</option>)}</select></label>}
      </div></fieldset>
      <fieldset><legend><span className="step">2</span>{t("col_forces")}</legend><div className="grid2">
        <Num id="wvz" label={t("w_Vz")} v={s.wVz} on={(v) => set({ wVz: num(v) })} />
        <Num id="wvy" label={t("w_Vy")} v={s.wVy} on={(v) => set({ wVy: num(v) })} />
        <Num id="wn" label={t("w_N")} v={s.wN} on={(v) => set({ wN: num(v) })} />
        <Num id="wmx" label={t("w_Mx")} v={s.wMx} on={(v) => set({ wMx: num(v) })} />
        <Num id="wmy" label={t("w_My")} v={s.wMy} on={(v) => set({ wMy: num(v) })} />
        <Num id="wmz" label={t("w_Mz")} v={s.wMz} on={(v) => set({ wMz: num(v) })} />
      </div><p className="hint">{t("w_hint")}</p></fieldset>
      <fieldset><legend><span className="step">3</span>{t("conn_mat")}</legend><div className="grid2">{steelSel}{thick(t("w_t1"), t("w_t2"))}</div></fieldset>
    </>;
    scheme = <WeldScheme shape={s.wShape} b={s.wb} h={s.wh} tf={s.wtf} tw={s.wtw} kf={s.kf} />;
    sub = `k_f = ${s.kf} mm · ${t(`ws_${s.wShape}`)}`;
  } else if (kind === "butt") {
    form = <>
      <fieldset><legend><span className="step">1</span>{t("conn_geom")}</legend><div className="grid2">
        <Num id="bl" label={t("b_L")} v={s.bL} on={(v) => set({ bL: num(v) })} />
        <span />
        <label className="wide chk"><input id="brun" type="checkbox" checked={s.bRunOff} onChange={(e) => set({ bRunOff: e.target.checked })} />{t("b_runoff")}</label>
        {code === "DBN" && <label className="wide chk"><input id="bctrl" type="checkbox" checked={s.bCtrl} onChange={(e) => set({ bCtrl: e.target.checked })} />{t("b_ctrl")}</label>}
      </div></fieldset>
      <fieldset><legend><span className="step">2</span>{t("col_forces")}</legend><div className="grid2">
        <Num id="bn" label={t("b_N")} v={s.bN} on={(v) => set({ bN: num(v) })} />
        <Num id="bv" label={t("b_V")} v={s.bV} on={(v) => set({ bV: num(v) })} />
        <Num id="bm" label={t("b_M")} v={s.bM} on={(v) => set({ bM: num(v) })} />
      </div></fieldset>
      <fieldset><legend><span className="step">3</span>{t("conn_mat")}</legend><div className="grid2">{steelSel}{thick(t("w_t1"), t("w_t2"))}</div></fieldset>
    </>;
    sub = `t = ${tmin} mm · l = ${s.bL} mm`;
  } else if (kind === "bolts" || kind === "friction" || kind === "rivets") {
    const classes = kind === "friction" ? (code === "DBN" ? [] : ["8.8", "10.9"]) : Object.keys(BOLT_CLASSES);
    form = <>
      <fieldset><legend><span className="step">1</span>{t("conn_geom")}</legend><div className="grid2">
        <label><span className="lbl">{t("bo_d")}</span>
          <select id="bd" value={s.d} onChange={(e) => set({ d: Number(e.target.value) })}>{BOLT_DIAMETERS.map((x) => <option key={x} value={x}>{kind === "rivets" ? "" : "M"}{x}</option>)}</select></label>
        {kind === "rivets"
          ? <Num id="bfur" label="f_ur, MPa" v={s.fur} on={(v) => set({ fur: num(v) })} />
          : classes.length > 0
            ? <label><span className="lbl">{t("bo_class")}</span><select id="bclass" value={fricClass ?? s.bClass} onChange={(e) => set({ bClass: e.target.value })}>{classes.map((c) => <option key={c}>{c}</option>)}</select></label>
            : <label><span className="lbl">{t("bo_class")}</span><input disabled value="40Х «селект»" /></label>}
        <Num id="bcols" label={t("bo_cols")} v={s.cols} on={(v) => set({ cols: Math.max(1, Math.round(num(v))) })} />
        <Num id="brows" label={t("bo_rows")} v={s.rows} on={(v) => set({ rows: Math.max(1, Math.round(num(v))) })} />
        <Num id="bpx" label={t("bo_px")} v={s.px} on={(v) => set({ px: num(v) })} />
        <Num id="bpy" label={t("bo_py")} v={s.py} on={(v) => set({ py: num(v) })} />
        <Num id="bea" label={t("bo_a")} v={s.ea} on={(v) => set({ ea: num(v) })} />
        <Num id="bplanes" label={t("bo_planes")} v={s.planes} on={(v) => set({ planes: Math.max(1, Math.round(num(v))) })} />
      </div></fieldset>
      <fieldset><legend><span className="step">2</span>{t("col_forces")}</legend><div className="grid2">
        <Num id="bfx" label={t("bo_Fx")} v={s.Fx} on={(v) => set({ Fx: num(v) })} />
        <Num id="bfy" label={t("bo_Fy")} v={s.Fy} on={(v) => set({ Fy: num(v) })} />
        <Num id="bmb" label={t("bo_M")} v={s.Mb} on={(v) => set({ Mb: num(v) })} />
        <Num id="btb" label={t("bo_T")} v={s.Tb} on={(v) => set({ Tb: num(v) })} />
      </div></fieldset>
      <fieldset><legend><span className="step">3</span>{t("conn_mat")}</legend><div className="grid2">{steelSel}{thick(t("bo_t1"), t("bo_t2"))}</div>
        <p className="hint">{t("bo_tminHint")}</p></fieldset>
      <details className="adv">
        <summary>{t("advanced")}<span className="adv-hint">{t("bo_advHint")}</span></summary>
        <div className="adv-group"><div className="grid2">
          <Num id="be2" label={t("bo_e2")} v={s.e2} on={(v) => set({ e2: num(v) })} />
          {kind === "friction" && <Num id="bmu" label="μ" v={s.mu} step={0.01} on={(v) => set({ mu: num(v) })} />}
          {code === "DBN" && kind === "bolts" && <label className="wide chk"><input id="bacc" type="checkbox" checked={s.accA} onChange={(e) => set({ accA: e.target.checked })} />{t("bo_accA")}</label>}
          {code === "DBN" && <Num id="ngc" label={t("gammaC")} v={s.gammaC} step={0.05} on={(v) => set({ gammaC: num(v) })} />}
          {code === "DBN" && <Num id="ngn" label={t("gammaN")} v={s.gammaN} step={0.05} on={(v) => set({ gammaN: num(v) })} />}
        </div></div>
      </details>
    </>;
    scheme = <GroupScheme nx={s.cols} ny={s.rows} sx={s.px} sy={s.py} ex={s.ea} ey={s.e2} d={s.d + 2} Fx={s.Fx} Fy={s.Fy} />;
    sub = `${s.cols * s.rows} × ${kind === "rivets" ? "⌀" : "M"}${s.d}${kind === "rivets" ? "" : ` · ${fricClass === "40X" ? "40Х" : fricClass ?? s.bClass}`}`;
  } else if (kind === "screws") {
    form = <>
      <fieldset><legend><span className="step">1</span>{t("conn_geom")}</legend><div className="grid2">
        <Num id="sd" label={t("sc_d")} v={s.sd} step={0.1} on={(v) => set({ sd: num(v) })} />
        <Num id="sn" label={t("sc_n")} v={s.sn} on={(v) => set({ sn: Math.max(1, Math.round(num(v))) })} />
        <Num id="sdw" label={t("sc_dw")} v={s.sdw} on={(v) => set({ sdw: num(v) })} />
        <Num id="se1" label={t("sc_e1")} v={s.se1} on={(v) => set({ se1: num(v) })} />
      </div></fieldset>
      <fieldset><legend><span className="step">2</span>{t("col_forces")}</legend><div className="grid2">
        <Num id="sv" label={t("sc_V")} v={s.sV} step={0.1} on={(v) => set({ sV: num(v) })} />
        <Num id="st" label={t("sc_T")} v={s.sT} step={0.1} on={(v) => set({ sT: num(v) })} />
      </div></fieldset>
      <fieldset><legend><span className="step">3</span>{t("conn_mat")}</legend><div className="grid2">{steelSel}
        <Num id="nt1" label={t("sc_t")} v={s.t1} step={0.1} on={(v) => set({ t1: num(v) })} />
        <Num id="nt2" label={t("sc_t1")} v={s.t2} step={0.1} on={(v) => set({ t2: num(v) })} />
        <Num id="sfv" label={t("sc_FvRk")} v={s.sFvRk} on={(v) => set({ sFvRk: num(v) })} />
        <Num id="sft" label={t("sc_FtRk")} v={s.sFtRk} on={(v) => set({ sFtRk: num(v) })} />
      </div><p className="hint">{t("sc_hint")}</p></fieldset>
    </>;
    sub = `${s.sn} × ⌀${s.sd}`;
  } else {
    const types: AnchorType[] = ["headed", "mechanical", "bonded"];
    form = <>
      <fieldset><legend><span className="step">1</span>{t("an_anchor")}</legend><div className="grid2">
        <label className="wide"><span className="lbl">{t("an_type")}</span>
          <select id="atype" value={s.aType} onChange={(e) => set({ aType: e.target.value as AnchorType })}>{types.map((x) => <option key={x} value={x}>{t(`at_${x}`)}</option>)}</select></label>
        <label><span className="lbl">{t("bo_d")}</span><select id="ad" value={s.ad} onChange={(e) => set({ ad: Number(e.target.value) })}>{BOLT_DIAMETERS.map((x) => <option key={x} value={x}>M{x}</option>)}</select></label>
        <Num id="ahef" label={t("an_hef")} v={s.ahef} on={(v) => set({ ahef: num(v) })} />
        <label><span className="lbl">{t("an_steel")}</span><select id="asteel" value={s.aSteel} onChange={(e) => set({ aSteel: e.target.value })}>{ANCHOR_STEELS.map((x) => <option key={x.id}>{x.id}</option>)}</select></label>
        {s.aType === "bonded" && <Num id="atau" label={t("an_tau")} v={s.aTau} step={0.5} on={(v) => set({ aTau: num(v) })} />}
        {s.aType === "mechanical" && <Num id="anrkp" label={t("an_NRkp")} v={s.aNRkp} ph="ETA" on={(v) => set({ aNRkp: v })} />}
      </div></fieldset>
      <fieldset><legend><span className="step">2</span>{t("an_layout")}</legend><div className="grid2">
        <Num id="anx" label={t("bo_cols")} v={s.anx} on={(v) => set({ anx: Math.max(1, Math.round(num(v))) })} />
        <Num id="any" label={t("bo_rows")} v={s.any} on={(v) => set({ any: Math.max(1, Math.round(num(v))) })} />
        <Num id="asx" label="s_x, mm" v={s.asx} on={(v) => set({ asx: num(v) })} />
        <Num id="asy" label="s_y, mm" v={s.asy} on={(v) => set({ asy: num(v) })} />
        <Num id="abx" label={t("an_bx")} v={s.abx} on={(v) => set({ abx: num(v) })} />
        <Num id="aby" label={t("an_by")} v={s.aby} on={(v) => set({ aby: num(v) })} />
        <Num id="acxm" label={t("an_cxm")} v={s.acxm} ph="∞" on={(v) => set({ acxm: v })} />
        <Num id="acxp" label={t("an_cxp")} v={s.acxp} ph="∞" on={(v) => set({ acxp: v })} />
        <Num id="acym" label={t("an_cym")} v={s.acym} ph="∞" on={(v) => set({ acym: v })} />
        <Num id="acyp" label={t("an_cyp")} v={s.acyp} ph="∞" on={(v) => set({ acyp: v })} />
      </div><p className="hint">{t("an_edgeHint")}</p></fieldset>
      <fieldset><legend><span className="step">3</span>{t("col_forces")}</legend><div className="grid2">
        <Num id="an" label={t("an_N")} v={s.aN} on={(v) => set({ aN: num(v) })} />
        <Num id="avx" label="V_x, kN" v={s.aVx} on={(v) => set({ aVx: num(v) })} />
        <Num id="amy" label={t("an_My")} v={s.aMy} on={(v) => set({ aMy: num(v) })} />
        <Num id="avy" label="V_y, kN" v={s.aVy} on={(v) => set({ aVy: num(v) })} />
        <Num id="amx" label={t("an_Mx")} v={s.aMx} on={(v) => set({ aMx: num(v) })} />
        <Num id="at" label={t("an_T")} v={s.aT} on={(v) => set({ aT: num(v) })} />
      </div></fieldset>
      <fieldset><legend><span className="step">4</span>{t("an_concrete")}</legend><div className="grid2">
        <label><span className="lbl">{t("an_class")}</span><select id="aconc" value={s.aConc} onChange={(e) => set({ aConc: e.target.value })}>{CONCRETE_CLASSES.map((x) => <option key={x.id}>{x.id}</option>)}</select></label>
        <Num id="ah" label={t("an_h")} v={s.ah} on={(v) => set({ ah: num(v) })} />
        <label className="wide chk"><input id="acr" type="checkbox" checked={s.aCracked} onChange={(e) => set({ aCracked: e.target.checked })} />{t("an_cracked")}</label>
      </div></fieldset>
      <details className="adv">
        <summary>{t("advanced")}<span className="adv-hint">{t("an_advHint")}</span></summary>
        <div className="adv-group"><div className="grid2">
          {s.aType === "bonded" && <Num id="atauu" label={t("an_tauU")} v={s.aTauU} step={0.5} on={(v) => set({ aTauU: num(v) })} />}
          {s.aType === "headed" && <Num id="adh" label={t("an_dh")} v={s.aDh} ph={String(Math.round(1.9 * s.ad))} on={(v) => set({ aDh: v })} />}
          <Num id="accr" label="c_cr,sp, mm" v={s.aCcrSp} ph={String((s.aType === "headed" ? 1.5 : 2) * s.ahef)} on={(v) => set({ aCcrSp: v })} />
          <Num id="ahmin" label="h_min, mm" v={s.aHmin} ph={String(Math.max(100, 2 * s.ahef))} on={(v) => set({ aHmin: v })} />
          <Num id="aginst" label="γ_inst" v={s.aGinst} ph={s.aType === "headed" ? "1.0" : "1.2"} on={(v) => set({ aGinst: v })} />
          <Num id="aso" label={t("an_standoff")} v={s.aStandoff} on={(v) => set({ aStandoff: num(v) })} />
          <label className="wide chk"><input id="aer" type="checkbox" checked={s.aEdgeReinf} onChange={(e) => set({ aEdgeReinf: e.target.checked })} />{t("an_edgeReinf")}</label>
          {code === "DBN" && <Num id="ngn" label={t("gammaN")} v={s.gammaN} step={0.05} on={(v) => set({ gammaN: num(v) })} />}
        </div></div>
      </details>
    </>;
    scheme = <GroupScheme nx={s.anx} ny={s.any} sx={s.asx} sy={s.asy} ex={0} ey={0} d={s.ad} Fx={s.aVx} Fy={s.aVy}
      edges={{ xm: edge(s.acxm), xp: edge(s.acxp), ym: edge(s.acym), yp: edge(s.acyp) }} forces={calc.forces} plate={{ bx: s.abx, by: s.aby }} />;
    sub = `${s.anx * s.any} × M${s.ad} · h_ef = ${s.ahef} · ${s.aConc}`;
  }

  const r = calc.r;
  const title = t(`conn_${kind}`);
  const normRef = kind === "anchors" ? "EN 1992-4 (ДСТУ-Н Б EN 1992-4)" + (code === "DBN" ? "; ДБН В.2.6-198, 7.7" : "")
    : kind === "screws" ? "EN 1993-1-3" : kind === "rivets" ? "EN 1993-1-8, 3" : code === "DBN" ? "ДБН В.2.6-198:2014, розд. 16" : kind === "fillet" || kind === "butt" ? "EN 1993-1-8, 4" : "EN 1993-1-8, 3";

  return (
    <main className="layout">
      <aside className="inputs">
        <button className="ghost kind-back" onClick={() => set({ kind: null })}>← {t("conn_change")}</button>
        {form}
        {kind !== "bolts" && kind !== "friction" && kind !== "rivets" && kind !== "anchors" && factors}
      </aside>
      <section className="output">
        <div className="tabs" role="tablist">
          {(["results", "report"] as const).map((k) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{t(`tab_${k}`)}</button>
          ))}
        </div>
        {calc.err && <p className="error">{calc.err}</p>}
        {r && tab === "results" && (
          <div className="results">
            <ConnSummary r={r} t={t} title={title} sub={sub} />
            <div className={`panel ${scheme ? "two-col" : ""}`}>
              {scheme && <div><h3>{t("scheme")}</h3>{scheme}{kind === "anchors" && <p className="hint">{t("an_schemeHint")}</p>}</div>}
              <div><h3>{t("conn_values")}</h3><Values r={r} /></div>
            </div>
            <div className="panel"><h3>{t("results")}</h3><CheckList checks={r.checks} t={t} /></div>
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
                <h1>{t("rep_titleConn")}: {title.toLowerCase()}</h1>
                <dl>
                  <div><dt>{t("rep_object")}</dt><dd>{s.obj || "—"}</dd></div>
                  <div><dt>{t("rep_element")}</dt><dd>{s.elem || "—"}</dd></div>
                  <div><dt>{t("rep_code")}</dt><dd>{normRef}</dd></div>
                  <div><dt>{t("rep_date")}</dt><dd>{new Date().toLocaleDateString()}</dd></div>
                </dl>
              </header>
              <h2>{t("rep_summary")}</h2>
              <ConnSummary r={r} t={t} title={title} sub={sub} />
              {scheme && <div className="rep-scheme">{scheme}</div>}
              <h2>{t("conn_values")}</h2>
              <Values r={r} />
              <h2>{t("rep_checks")}</h2>
              <CheckList checks={r.checks} t={t} />
              <p className="disclaimer">{t("disclaimer")}</p>
            </article>
          </div>
        )}
        <p className="disclaimer">{t("disclaimer")}</p>
      </section>
    </main>
  );
}
