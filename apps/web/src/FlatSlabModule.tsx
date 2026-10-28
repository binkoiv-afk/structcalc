// Безбалочна плита: спочатку сітка колон і навантаження → колони → товщина і матеріали → армування і продавлювання.
// Результат: карти моментів і прогину на плані, колони за використанням на продавлювання, подробиці обраної колони з контурами.
import { useEffect, useMemo, useState } from "react";
import { NumInput } from "./NumInput";
import { BAR_DIAMETERS, checkFlat, CodeId, FlatColumn, FlatInput, FlatResult, punchPerimeter, RC_REBARS, rcConcretes, slabAs, SlabBars } from "@structcalc/core";
import { CheckList, pct, T, utilState, enNorms } from "./Results";

type Layer = "botX" | "botY" | "topX" | "topY";
type Field = "mbx" | "mby" | "mtx" | "mty" | "w";
export interface FlatState {
  sx: string; sy: string; ov: number;
  colShape: "rect" | "circle"; cx: number; cy: number; Hb: number; Ha: number;
  g: number; q: number; selfWeight: boolean;
  h: number; c: number; concrete: string; rebar: string;
  botX: SlabBars; botY: SlabBars; topX: SlabBars; topY: SlabBars;
  punchOn: boolean; pd: number; pn: number; psr: number; prows: number; beta: "auto" | "fem";
  gammaG: string; gammaQ: string; psi2: number; phi: number; exp: string; wlim: number; deflN: number;
  field: Field; sel: string; obj: string; elem: string;
}
export const initialFlat: FlatState = {
  sx: "6 6 6", sy: "6 6", ov: 0.4, colShape: "rect", cx: 400, cy: 400, Hb: 3.3, Ha: 3.3,
  g: 2, q: 3, selfWeight: true, h: 260, c: 25, concrete: "C30/35", rebar: "A500C",
  botX: { d: 12, s: 200 }, botY: { d: 12, s: 200 }, topX: { d: 16, s: 150 }, topY: { d: 16, s: 150 },
  punchOn: false, pd: 10, pn: 12, psr: 150, prows: 4, beta: "auto",
  gammaG: "", gammaQ: "", psi2: 0.3, phi: 2, exp: "XC1", wlim: 0.4, deflN: 0, field: "mbx", sel: "", obj: "", elem: "",
};
const EXPOSURE: [string, number][] = [["X0", 0.4], ["XC1", 0.4], ["XC2", 0.3], ["XC3", 0.3], ["XC4", 0.3], ["XD1", 0.3], ["XS1", 0.3]];
const num = (v: string) => (v.trim() === "" ? 0 : Number(v));
const f = (v: number, n = 2) => (Number.isFinite(v) ? (Math.abs(v) < 0.5 * 10 ** -n ? 0 : v).toFixed(n) : "—");
const SPACINGS = [100, 125, 150, 175, 200, 250, 300];

/** «6 6 7.2», «3×6», «2*6 7.5» → прольоти; null — помилка */
export function parseSpans(s: string): number[] | null {
  const out: number[] = [];
  for (const tok of s.replace(/,/g, ".").split(/[\s;]+/).filter(Boolean)) {
    const m = tok.match(/^(\d+)\s*[x×*хХ]\s*(\d+(?:\.\d+)?)$/);
    const reps = m ? Number(m[1]) : 1, v = Number(m ? m[2] : tok);
    if (!Number.isFinite(v) || v < 1.5 || v > 15 || reps < 1) return null;
    for (let k = 0; k < reps; k++) out.push(v);
  }
  return out.length && out.length <= 8 ? out : null;
}

const STATE_CLS = { ok: "fs-ok", warn: "fs-warn", fail: "fs-fail" } as const;

/** План: карта поля на нерівномірній сітці, колони за продавлюванням, осі й прольоти */
function FlatPlan({ s, r, sx, sy, t, mrd, sel, onSel, topMrd }: {
  s: FlatState; r: FlatResult; sx: number[]; sy: number[]; t: T; mrd?: number; sel?: string; onSel?: (l: string) => void; topMrd?: { x: number; y: number };
}) {
  const fd = r.field, W = 520, H = 400, pad = 40;
  const xmin = fd.xs[0], xmax = fd.xs[fd.xs.length - 1], ymin = fd.ys[0], ymax = fd.ys[fd.ys.length - 1];
  const sc = Math.min((W - 2 * pad) / (xmax - xmin), (H - 2 * pad) / (ymax - ymin));
  const ox = (W - (xmax - xmin) * sc) / 2, oy = (H + (ymax - ymin) * sc) / 2;
  const X = (x: number) => ox + (x - xmin) * sc, Y = (y: number) => oy - (y - ymin) * sc;
  const vals = fd[s.field], nx = fd.xs.length - 1, ny = fd.ys.length - 1, id = (a: number, b: number) => b * (nx + 1) + a;
  let vmax = 0, kmax = -1;
  vals.forEach((v, k) => { if (v > vmax) { vmax = v; kmax = k; } });
  const cells: JSX.Element[] = [];
  for (let b = 0; b < ny; b++) for (let a = 0; a < nx; a++) {
    const v = (vals[id(a, b)] + vals[id(a + 1, b)] + vals[id(a + 1, b + 1)] + vals[id(a, b + 1)]) / 4;
    const over = mrd !== undefined && v > mrd + 1e-9;
    cells.push(<rect key={`${a}-${b}`} x={X(fd.xs[a])} y={Y(fd.ys[b + 1])} width={(fd.xs[a + 1] - fd.xs[a]) * sc + 0.3} height={(fd.ys[b + 1] - fd.ys[b]) * sc + 0.3}
      className={over ? "sl-over" : "sl-cell"} fillOpacity={over ? 0.85 : vmax > 0 ? 0.06 + 0.8 * (v / vmax) : 0} />);
  }
  const AX = [0], AY = [0];
  sx.forEach((v) => AX.push(AX[AX.length - 1] + v)); sy.forEach((v) => AY.push(AY[AY.length - 1] + v));
  const LET = "ABCDEFGHJKLMNPRSTUVWXYZ";
  const cw = (s.cx / 1000) * sc, ch = ((s.colShape === "circle" ? s.cx : s.cy) / 1000) * sc;
  const topField = s.field === "mtx" || s.field === "mty";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="rc-svg fs-plan" role="img" aria-label="flat slab plan">
      <rect x={X(xmin)} y={Y(ymax)} width={(xmax - xmin) * sc} height={(ymax - ymin) * sc} className="sl-slab" />
      {cells}
      <rect x={X(xmin)} y={Y(ymax)} width={(xmax - xmin) * sc} height={(ymax - ymin) * sc} className="fs-outline" />
      {AX.map((x, j) => <g key={`ax${j}`}><line x1={X(x)} y1={Y(ymax) - 12} x2={X(x)} y2={Y(ymin) + 4} className="fs-axis" /><text x={X(x)} y={Y(ymax) - 16} className="rc-t mid">{j + 1}</text></g>)}
      {AY.map((y, j) => <g key={`ay${j}`}><line x1={X(xmin) - 12} y1={Y(y)} x2={X(xmax) + 4} y2={Y(y)} className="fs-axis" /><text x={X(xmin) - 20} y={Y(y) + 4} className="rc-t mid">{LET[j]}</text></g>)}
      {sx.map((v, j) => <text key={`dx${j}`} x={(X(AX[j]) + X(AX[j + 1])) / 2} y={Y(ymin) + 16} className="rc-t mid">{v}</text>)}
      {sy.map((v, j) => <text key={`dy${j}`} x={X(xmax) + 16} y={(Y(AY[j]) + Y(AY[j + 1])) / 2 + 4} className="rc-t mid">{v}</text>)}
      {r.cols.map((c) => {
        const st = utilState(c.p.util), px = X(c.x), py = Y(c.y);
        const topBad = topMrd && (c.top.mx > topMrd.x + 1e-9 || c.top.my > topMrd.y + 1e-9);
        const shape = s.colShape === "circle"
          ? <circle cx={px} cy={py} r={Math.max(4, cw / 2)} className={`fs-col ${STATE_CLS[st]}`} />
          : <rect x={px - Math.max(4, cw / 2)} y={py - Math.max(4, ch / 2)} width={Math.max(8, cw)} height={Math.max(8, ch)} className={`fs-col ${STATE_CLS[st]}`} />;
        return (
          <g key={c.label} id={`fs-col-${c.label}`} className={`fs-colg ${onSel ? "click" : ""} ${sel === c.label ? "sel" : ""}`} onClick={onSel ? () => onSel(c.label) : undefined}>
            {sel === c.label && <circle cx={px} cy={py} r={Math.max(cw, ch) / 2 + 9} className="fs-selring" />}
            {topField && topBad && <rect x={px - 13} y={py - 13} width={26} height={26} className="fs-topbad" />}
            {shape}
            <text x={px + Math.max(6, cw / 2) + 2} y={py - 6} className="rc-t fs-cl">{pct(c.p.util)}</text>
            <title>{`${c.label}: ${t(`fs_type_${c.p.type}`)}, V = ${f(c.V, 1)} kN, β = ${f(c.p.beta, 2)}, ${pct(c.p.util)}`}</title>
          </g>
        );
      })}
      {kmax >= 0 && vmax > 0 && (() => {
        const a = kmax % (nx + 1), b = Math.floor(kmax / (nx + 1)), px = X(fd.xs[a]), py = Y(fd.ys[b]);
        return <g><circle cx={px} cy={py} r={3.5} className="rc-dot" /><text x={W - 8} y={H - 8} textAnchor="end" className="rc-t">● max {f(vmax, 1)} {s.field === "w" ? "mm" : "kN·m/m"}</text></g>;
      })()}
      <path d={`M${12},${H - 12} h22 M${12},${H - 12} v-22`} className="rc-axis" />
      <text x={36} y={H - 8} className="rc-t">x</text><text x={8} y={H - 38} className="rc-t">y</text>
    </svg>
  );
}

/** Колона з контурами: u0, u1 (2d), u_out, ряди поперечної арматури; краї плити */
function PunchView({ c, s }: { c: FlatColumn; s: FlatState }) {
  const p = c.p, g = c.geom, rf = s.punchOn ? { s0: 0.5 * p.d, sr: s.psr, rows: s.prows } : null;
  const rMax = Math.max(2 * p.d, p.rOut, rf ? rf.s0 + (rf.rows - 1) * rf.sr : 0) + 0.3 * p.d;
  const hx = g.cx / 2 + rMax, hy = (g.shape === "circle" ? g.cx : g.cy) / 2 + rMax;
  const W = 300, H = 300, sc = Math.min((W - 30) / (2 * hx), (H - 30) / (2 * hy));
  const P = ([x, y]: [number, number]) => `${W / 2 + x * sc},${H / 2 - y * sc}`;
  const path = (r: number) => { const pts = punchPerimeter(g, r).pts; return "M" + pts.map(P).join(" L"); };
  const ex = g.edgeX ? g.edgeX.s * (g.cx / 2 + g.edgeX.e) : null, ey = g.edgeY ? g.edgeY.s * ((g.shape === "circle" ? g.cx : g.cy) / 2 + g.edgeY.e) : null;
  const cyy = g.shape === "circle" ? g.cx : g.cy;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="rc-svg fs-punch" role="img" aria-label="punching perimeters">
      {ex !== null && <rect x={ex > 0 ? W / 2 + ex * sc : 0} y={0} width={ex > 0 ? W - (W / 2 + ex * sc) : W / 2 + ex * sc} height={H} className="fs-void" />}
      {ey !== null && <rect x={0} y={ey > 0 ? 0 : H / 2 - ey * sc} width={W} height={ey > 0 ? H / 2 - ey * sc : H - (H / 2 - ey * sc)} className="fs-void" />}
      {rf && Array.from({ length: rf.rows }, (_, k) => <path key={k} d={path(rf.s0 + k * rf.sr)} className="fs-rfrow" />)}
      {p.rOut > 0 && <path d={path(p.rOut)} className="fs-uout" />}
      <path d={path(2 * p.d)} className="fs-u1" />
      {g.shape === "circle" ? <circle cx={W / 2} cy={H / 2} r={(g.cx / 2) * sc} className="fs-colv" />
        : <rect x={W / 2 - (g.cx / 2) * sc} y={H / 2 - (cyy / 2) * sc} width={g.cx * sc} height={cyy * sc} className="fs-colv" />}
      <text x={6} y={14} className="rc-t">{c.label}</text>
      <text x={W - 6} y={14} className="rc-t" textAnchor="end">2d = {f(2 * p.d, 0)} mm</text>
    </svg>
  );
}

export function FlatSlabModule({ code, s, set, t }: { code: CodeId; s: FlatState; set: (p: Partial<FlatState>) => void; t: T }) {
  const [tab, setTab] = useState<"results" | "report">("results");
  const concs = rcConcretes(code), rebars = RC_REBARS[code];
  const conc = concs.some((c) => c.id === s.concrete) ? s.concrete : code === "DBN" ? "C30/35" : "C30/37";
  const rebar = rebars.some((r) => r.id === s.rebar) ? s.rebar : code === "DBN" ? "A500C" : "B500B";
  const sx = parseSpans(s.sx), sy = parseSpans(s.sy);
  const input: FlatInput | null = useMemo(() => (!sx || !sy ? null : {
    code, concrete: conc, rebar, sx, sy, ov: s.ov, h: s.h, c: s.c, colShape: s.colShape, cx: s.cx, cy: s.colShape === "circle" ? s.cx : s.cy, Hb: s.Hb, Ha: s.Ha,
    g: s.g, q: s.q, selfWeight: s.selfWeight, gammaG: s.gammaG.trim() ? num(s.gammaG) : undefined, gammaQ: s.gammaQ.trim() ? num(s.gammaQ) : undefined, psi2: s.psi2,
    botX: s.botX, botY: s.botY, topX: s.topX, topY: s.topY, punch: s.punchOn ? { d: s.pd, n: s.pn, sr: s.psr, rows: s.prows } : undefined,
    beta: s.beta, phi: s.phi, wlim: s.wlim, deflN: s.deflN,
  }), [code, s, conc, rebar, s.sx, s.sy]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = JSON.stringify(input);
  const [calc, setCalc] = useState<{ r?: FlatResult; err?: string; key?: string; sx?: number[]; sy?: number[] }>({});
  useEffect(() => {
    if (!input) return;
    const id = setTimeout(() => { try { setCalc({ r: checkFlat(input), key, sx: input.sx, sy: input.sy }); } catch (e) { setCalc({ err: String((e as Error).message), key }); } }, 120);
    return () => clearTimeout(id);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const busy = !!input && calc.key !== key, r = calc.r;
  const g = r?.checks.reduce<FlatResult["checks"][number] | undefined>((b, c) => (!b || c.util > b.util ? c : b), undefined);
  const st = r ? utilState(r.maxUtil) : "ok";
  const mrdOf = (fl: Field) => !r ? undefined : fl === "mbx" ? r.rc.x.pos.MRd : fl === "mby" ? r.rc.y.pos.MRd : undefined;
  const topMrd = r ? { x: r.rc.xNeg.neg?.MRd ?? 0, y: r.rc.yNeg.neg?.MRd ?? 0 } : undefined;
  const selCol = r ? r.cols.find((c) => c.label === s.sel) ?? r.cols.reduce((m, c) => (c.p.util > m.p.util ? c : m), r.cols[0]) : undefined;

  const barsRow = (k: Layer) => {
    const b = s[k];
    return (
      <div key={k} className="sl-bars">
        <span className="sl-bl">{t(`sl_${k}`)}</span>
        <select id={`fs-${k}-d`} aria-label="Ø" value={b.d} onChange={(e) => set({ [k]: { ...b, d: Number(e.target.value) } } as Partial<FlatState>)}>
          <option value={0}>—</option>{BAR_DIAMETERS.filter((d) => d >= 6 && d <= 25).map((d) => <option key={d} value={d}>Ø{d}</option>)}
        </select>
        <select id={`fs-${k}-s`} aria-label={t("rc_s")} value={SPACINGS.includes(b.s) ? b.s : ""} disabled={!b.d} onChange={(e) => set({ [k]: { ...b, s: Number(e.target.value) } } as Partial<FlatState>)}>
          {SPACINGS.map((x) => <option key={x} value={x}>/{x}</option>)}{!SPACINGS.includes(b.s) && <option value="">/{b.s}</option>}
        </select>
        <span className="sl-as mono">{b.d ? `${f(slabAs(b), 0)}` : "0"}</span>
      </div>
    );
  };

  const summary = r && (
    <div className={`summary ${st}`}>
      <div className="summary-main"><div className="eyebrow">{t("mod_flat")} · {conc} · {rebar}</div>
        <div className="profile">{(calc.sx ?? []).join("+")} × {(calc.sy ?? []).join("+")} m · h = {s.h}</div>
        <div className="meta">{s.colShape === "circle" ? `⌀${s.cx}` : `${s.cx}×${s.cy}`} · q_d = {f(r.wd)} kN/m²</div></div>
      <div className="summary-util"><div className="eyebrow">{t("rep_maxutil")}</div><div className="big">{pct(r.maxUtil)}</div><div className={`pill ${st}`}>{r.maxUtil <= 1 + 1e-9 ? t("ok") : t("fail")}</div></div>
      {g && <div className="summary-gov"><div className="eyebrow">{t("governing")}</div><div>{t(`chk_${g.key}`)}</div></div>}
    </div>
  );
  const table = r && (
    <table className="rep-table sl-tab"><thead><tr><th></th><th>M_Ed, kN·m/m</th><th>M_Rd, kN·m/m</th><th>A_s, mm²/m</th></tr></thead><tbody>
      {([["botX", r.M.bx, r.rc.x.pos.MRd, r.As.bx], ["botY", r.M.by, r.rc.y.pos.MRd, r.As.by], ["topX", r.M.tx, r.rc.xNeg.neg?.MRd ?? 0, r.As.tx], ["topY", r.M.ty, r.rc.yNeg.neg?.MRd ?? 0, r.As.ty]] as const).map(([k, m, mr, as]) => (
        <tr key={k} className={m > mr + 1e-9 ? "sl-bad" : ""}><td>{t(`sl_${k}`)}</td><td className="mono">{f(m)}</td><td className="mono">{f(mr)}</td><td className="mono">{f(as, 0)}</td></tr>
      ))}
      <tr><td>{t("sl_loads")}</td><td className="mono" colSpan={3}>q_d = {f(r.wd)}; q_qp = {f(r.wqp)} kN/m² ({t("rc_self").replace("+ ", "")}: {f(r.selfW)})</td></tr>
      <tr><td>{t("sl_defl")}</td><td className="mono" colSpan={3}>{f(r.defl.el, 1)} × {f(r.defl.k, 2)} = {f(r.defl.f, 1)} ≤ {f(r.defl.flim, 1)} mm (l = {f(r.defl.l)} m)</td></tr>
    </tbody></table>
  );
  const colTable = r && (
    <div className="fs-scroll"><table className="rep-table fs-ctab"><thead><tr>
      <th>{t("fs_col_lbl")}</th><th>{t("fs_col_type")}</th><th>V_Ed, kN</th><th>β</th><th>v_Ed / v_Rd,c, MPa</th><th>m_t,x / m_t,y</th><th>%</th>
    </tr></thead><tbody>
      {r.cols.map((c) => (
        <tr key={c.label} className={`${c.p.util > 1 + 1e-9 ? "sl-bad" : ""} ${selCol?.label === c.label ? "fs-selrow" : ""}`} onClick={() => set({ sel: c.label })}>
          <td>{c.label}</td><td>{t(`fs_type_${c.p.type}`)}</td><td className="mono">{f(c.V, 1)}</td><td className="mono">{f(c.p.beta, 3)}</td>
          <td className="mono">{f(c.p.vEd, 3)} / {f(c.p.vRdc, 3)}</td><td className="mono">{f(c.top.mx, 1)} / {f(c.top.my, 1)}</td><td className="mono">{pct(c.p.util)}</td>
        </tr>
      ))}
    </tbody></table></div>
  );
  const detail = (c: FlatColumn) => (
    <div className="fs-detail">
      <PunchView c={c} s={s} />
      <table className="rep-table"><tbody>
        <tr><td>{t("fs_detail")}</td><td>{c.label} · {t(`fs_type_${c.p.type}`)} · d = {f(c.p.d, 0)} mm</td></tr>
        <tr><td>{t("fs_V")}</td><td className="mono">{f(c.V, 1)} kN</td></tr>
        <tr><td>{t("fs_Mcol")}</td><td className="mono">{f(c.Mx, 1)} / {f(c.My, 1)} kN·m (e = {f(c.p.ex, 0)}; {f(c.p.ey, 0)} mm)</td></tr>
        <tr><td>{t("fs_beta_v")}</td><td className="mono">{f(c.p.betaFem, 3)} / {f(c.p.betaApprox, 2)} → <b>{f(c.p.beta, 3)}</b></td></tr>
        <tr><td>{t("fs_u")}</td><td className="mono">{f(c.p.u0, 0)} / {f(c.p.u1, 0)} / {f(c.p.u1r, 0)} mm</td></tr>
        <tr><td>{t("fs_v0")}</td><td className="mono">{f(c.p.vEd0, 3)} / {f(c.p.vRdMax, 3)} MPa</td></tr>
        <tr className={c.p.vEd > c.p.vRdc && !s.punchOn ? "sl-bad" : ""}><td>{t("fs_v1")}</td><td className="mono">{f(c.p.vEd, 3)} / {f(c.p.vRdc, 3)} MPa</td></tr>
        {c.p.vRdcs !== undefined && c.p.vEd > c.p.vRdc && <tr className={c.p.vEd > c.p.vRdcs ? "sl-bad" : ""}><td>{t("fs_vcs")}</td><td className="mono">{f(c.p.vRdcs, 3)} MPa</td></tr>}
        <tr><td>{t("fs_uout")}</td><td className="mono">{f(c.p.uOut, 0)} mm; {f(c.p.rOut, 0)} mm{c.p.rLast !== undefined ? `; r_last + 1.5d = ${f(c.p.rLast + 1.5 * c.p.d, 0)} mm` : ""}</td></tr>
        {c.p.aswNeed !== undefined && <tr><td>{t("fs_aswNeed")}</td><td className="mono">{f(c.p.aswNeed, 0)} mm²</td></tr>}
        <tr><td>{t("fs_top")}</td><td className="mono">{f(c.top.mx, 1)} / {f(c.top.my, 1)} kN·m/m</td></tr>
      </tbody></table>
    </div>
  );
  const fieldSel = (
    <div className="seg wide sl-fields">{(["mbx", "mby", "mtx", "mty", "w"] as const).map((k) => <button key={k} id={`fs-f-${k}`} className={s.field === k ? "on" : ""} onClick={() => set({ field: k })}>{t(`sl_f_${k}`)}</button>)}</div>
  );

  return (
    <main className="layout">
      <aside className="inputs">
        <fieldset>
          <legend><span className="step">1</span>{t("fs_grid")}</legend>
          <div className="grid2">
            <label><span className="lbl">{t("fs_sx")}</span><input id="fs-sx" value={s.sx} onChange={(e) => set({ sx: e.target.value })} className={sx ? "" : "bad"} /></label>
            <label><span className="lbl">{t("fs_sy")}</span><input id="fs-sy" value={s.sy} onChange={(e) => set({ sy: e.target.value })} className={sy ? "" : "bad"} /></label>
          </div>
          <p className="hint">{t("fs_spansHint")}</p>
          {(!sx || !sy) && <p className="error">{t("fs_spansBad")}</p>}
          <label><span className="lbl">{t("fs_ov")}</span><NumInput id="fs-ov" step={0.05} min={0} value={s.ov} onChange={(e) => set({ ov: Math.max(0, num(e.target.value)) })} /></label>
          <div className="grid2 rc-gap">
            <label><span className="lbl">{t("sl_g")}</span><NumInput id="fs-g" step={0.5} value={s.g} onChange={(e) => set({ g: num(e.target.value) })} /></label>
            <label><span className="lbl">{t("sl_q")}</span><NumInput id="fs-q" step={0.5} value={s.q} onChange={(e) => set({ q: num(e.target.value) })} /></label>
            <label className="chk wide"><input id="fs-self" type="checkbox" checked={s.selfWeight} onChange={(e) => set({ selfWeight: e.target.checked })} />{t("rc_self")}</label>
          </div>
        </fieldset>
        <fieldset>
          <legend><span className="step">2</span>{t("fs_col")}</legend>
          <div className="seg wide">{(["rect", "circle"] as const).map((k) => <button key={k} id={`fs-shape-${k}`} className={s.colShape === k ? "on" : ""} onClick={() => set({ colShape: k })}>{t(`fs_${k}`)}</button>)}</div>
          <div className="grid2 rc-gap">
            <label><span className="lbl">{s.colShape === "circle" ? t("fs_D") : t("fs_cx")}</span><NumInput id="fs-cx" step={50} min={150} value={s.cx} onChange={(e) => set({ cx: Math.max(150, num(e.target.value)) })} /></label>
            {s.colShape === "rect" && <label><span className="lbl">{t("fs_cy")}</span><NumInput id="fs-cy" step={50} min={150} value={s.cy} onChange={(e) => set({ cy: Math.max(150, num(e.target.value)) })} /></label>}
            <label><span className="lbl">{t("fs_Hb")}</span><NumInput id="fs-hb" step={0.1} min={0} value={s.Hb} onChange={(e) => set({ Hb: Math.max(0, num(e.target.value)) })} /></label>
            <label><span className="lbl">{t("fs_Ha")}</span><NumInput id="fs-ha" step={0.1} min={0} value={s.Ha} onChange={(e) => set({ Ha: Math.max(0, num(e.target.value)) })} /></label>
          </div>
        </fieldset>
        <fieldset>
          <legend><span className="step">3</span>{t("sl_section")}</legend>
          <div className="grid2">
            <label><span className="lbl">{t("sl_h")}</span><NumInput id="fs-h" step={10} min={120} value={s.h} onChange={(e) => set({ h: Math.max(120, num(e.target.value)) })} /></label>
            <label><span className="lbl">{t("sl_c")}</span><NumInput id="fs-c" step={5} min={10} value={s.c} onChange={(e) => set({ c: Math.max(10, num(e.target.value)) })} /></label>
            <label><span className="lbl">{t("rc_conc")}</span><select id="fs-conc" value={conc} onChange={(e) => set({ concrete: e.target.value })}>{concs.map((c) => <option key={c.id}>{c.id}</option>)}</select></label>
            <label><span className="lbl">{t("rc_cls")}</span><select id="fs-cls" value={rebar} onChange={(e) => set({ rebar: e.target.value })}>{rebars.map((x) => <option key={x.id}>{x.id}</option>)}</select></label>
          </div>
        </fieldset>
        <fieldset>
          <legend><span className="step">4</span>{t("rc_reinf")}</legend>
          <div className="sl-bars sl-head"><span></span><span>Ø</span><span>s, mm</span><span>mm²/m</span></div>
          {(["botX", "botY", "topX", "topY"] as Layer[]).map(barsRow)}
          <p className="hint">{t("fs_barsHint")}</p>
          <label className="chk rc-gap"><input id="fs-punch" type="checkbox" checked={s.punchOn} onChange={(e) => set({ punchOn: e.target.checked })} />{t("fs_punch")}</label>
          {s.punchOn && (
            <div className="grid2">
              <label><span className="lbl">{t("fs_pd")}</span><select id="fs-pd" value={s.pd} onChange={(e) => set({ pd: Number(e.target.value) })}>{BAR_DIAMETERS.filter((d) => d >= 6 && d <= 16).map((d) => <option key={d} value={d}>Ø{d}</option>)}</select></label>
              <label><span className="lbl">{t("fs_pn")}</span><NumInput id="fs-pn" step={1} min={4} value={s.pn} onChange={(e) => set({ pn: Math.max(4, Math.round(num(e.target.value))) })} /></label>
              <label><span className="lbl">{t("fs_psr")}</span><NumInput id="fs-psr" step={25} min={50} value={s.psr} onChange={(e) => set({ psr: Math.max(50, num(e.target.value)) })} /></label>
              <label><span className="lbl">{t("fs_prows")}</span><NumInput id="fs-prows" step={1} min={1} value={s.prows} onChange={(e) => set({ prows: Math.max(1, Math.round(num(e.target.value))) })} /></label>
            </div>
          )}
        </fieldset>
        <details className="adv">
          <summary>{t("advanced")}<span className="adv-hint">{t("rc_advHint")}</span></summary>
          <div className="adv-group">
            <label><span className="lbl">{t("fs_beta")}</span><select id="fs-beta" value={s.beta} onChange={(e) => set({ beta: e.target.value as FlatState["beta"] })}>
              <option value="auto">{t("fs_beta_auto")}</option><option value="fem">{t("fs_beta_fem")}</option></select></label>
            <div className="grid2 rc-gap">
              <label><span className="lbl">{t("rc_gammaG")}</span><NumInput id="fs-gG" step={0.05} placeholder={code === "DBN" ? "1.1" : "1.35"} value={s.gammaG} onChange={(e) => set({ gammaG: e.target.value })} /></label>
              <label><span className="lbl">{t("rc_gammaQ")}</span><NumInput id="fs-gQ" step={0.05} placeholder={code === "DBN" ? "1.2" : "1.5"} value={s.gammaQ} onChange={(e) => set({ gammaQ: e.target.value })} /></label>
              <label><span className="lbl">{t("rc_psi2")}</span><NumInput id="fs-psi2" step={0.05} min={0} max={1} value={s.psi2} onChange={(e) => set({ psi2: num(e.target.value) })} /></label>
              <label><span className="lbl">{t("rc_deflN")}</span><NumInput id="fs-defl" step={10} min={0} value={s.deflN} onChange={(e) => set({ deflN: Math.max(0, num(e.target.value)) })} /></label>
              <label><span className="lbl">{t("rc_phi")}</span><NumInput id="fs-phi" step={0.1} min={0} value={s.phi} onChange={(e) => set({ phi: Math.max(0, num(e.target.value)) })} /></label>
              <label><span className="lbl">{t("rc_exp")}</span><select id="fs-exp" value={s.exp} onChange={(e) => set({ exp: e.target.value, wlim: EXPOSURE.find((x) => x[0] === e.target.value)![1] })}>{EXPOSURE.map(([k]) => <option key={k}>{k}</option>)}</select></label>
              <label><span className="lbl">{t("rc_wlim")}</span><NumInput id="fs-wlim" step={0.05} min={0.05} value={s.wlim} onChange={(e) => set({ wlim: Math.max(0.05, num(e.target.value)) })} /></label>
            </div>
          </div>
        </details>
      </aside>

      <section className={`output ${busy ? "rcc-busy" : ""}`}>
        <div className="tabs" role="tablist">
          {(["results", "report"] as const).map((k) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{t(`tab_${k}`)}</button>)}
          {busy && <span className="rcc-calc" id="fs-busy">{t("rcc_busy")}</span>}
        </div>
        {calc.err && <p className="error">{calc.err}</p>}
        {r && tab === "results" && (
          <div className="results">
            {summary}
            {Object.keys(r.need).length > 0 && (
              <div className="rc-fix">
                {(["botX", "botY", "topX", "topY"] as Layer[]).filter((k) => r.need[k]).map((k) => (
                  <div key={k}>{t("rc_need")} <b>Ø{r.need[k]!.d}/{r.need[k]!.s}</b> ({t(`sl_${k}`).toLowerCase()}, {f(slabAs(r.need[k]!), 0)} mm²/m)
                    <button id={`fs-fix-${k}`} className="primary" onClick={() => set({ [k]: r.need[k] } as Partial<FlatState>)}>{t("rc_apply")}</button></div>
                ))}
              </div>
            )}
            {!r.approxOk && s.beta === "auto" && <p className="hint">{t("fs_betaNo")}</p>}
            <div className="panel">
              <h3>{t("sl_map")}</h3>{fieldSel}
              <FlatPlan s={s} r={r} sx={calc.sx!} sy={calc.sy!} t={t} mrd={mrdOf(s.field)} sel={selCol?.label} onSel={(l) => set({ sel: l })} topMrd={topMrd} />
              <p className="hint">{t("fs_mapHint")}</p>
            </div>
            <div className="panel"><h3>{t("fs_cols")}</h3>{selCol && detail(selCol)}<p className="hint">{t("fs_detailHint")}</p></div>
            <div className="panel two-col">
              <div><h3>{t("sl_summary")}</h3><div className="fs-scroll">{table}</div></div>
              <div><h3>{t("fs_tabCols")}</h3>{colTable}</div>
            </div>
            <div className="panel"><h3>{t("results")}</h3><CheckList checks={r.checks} t={t} /></div>
          </div>
        )}
        {r && tab === "report" && (
          <div className="report-wrap">
            <div className="report-tools">
              <input id="fs-obj" placeholder={t("objPlaceholder")} value={s.obj} onChange={(e) => set({ obj: e.target.value })} />
              <input id="fs-elem" placeholder={t("fsPlaceholder")} value={s.elem} onChange={(e) => set({ elem: e.target.value })} />
              <button className="primary" onClick={() => window.print()}>{t("print")}</button>
            </div>
            <article className="report">
              <header className="rep-head">
                <h1>{t("rep_titleFs")}</h1>
                <dl>
                  <div><dt>{t("rep_object")}</dt><dd>{s.obj || "—"}</dd></div>
                  <div><dt>{t("rep_element")}</dt><dd>{s.elem || t("mod_flat")}</dd></div>
                  <div><dt>{t("rep_code")}</dt><dd>{code === "DBN" ? "ДБН В.2.6-98:2009 зі Зміною № 1; ДСТУ Б В.2.6-156:2010; ДБН В.1.2-2; ДСТУ Б В.1.2-3" : enNorms("EN 1992-1-1; EN 1990")}</dd></div>
                  <div><dt>{t("rep_date")}</dt><dd>{new Date().toLocaleDateString()}</dd></div>
                </dl>
              </header>
              <h2>{t("rep_summary")}</h2>
              {summary}
              <h2>{t("rep_inputs")}</h2>
              <table className="rep-table"><tbody>
                <tr><td>{t("fs_grid")}</td><td>x: {(calc.sx ?? []).join("; ")} m; y: {(calc.sy ?? []).join("; ")} m; {t("fs_ov").toLowerCase()}: {s.ov}</td></tr>
                <tr><td>{t("fs_col")}</td><td>{s.colShape === "circle" ? `⌀${s.cx}` : `${s.cx}×${s.cy}`} mm; H = {s.Hb} / {s.Ha} m</td></tr>
                <tr><td>{t("sl_loadsIn")}</td><td>g_k = {s.g}, q_k = {s.q} kN/m²{s.selfWeight ? ` + ${f(r.selfW)} kN/m²` : ""}; γ_G = {s.gammaG || (code === "DBN" ? "1.1" : "1.35")}, γ_Q = {s.gammaQ || (code === "DBN" ? "1.2" : "1.5")}, ψ₂ = {s.psi2}</td></tr>
                <tr><td>{t("sl_section")}</td><td>h = {s.h} mm; c = {s.c} mm; {conc}; {rebar}</td></tr>
                <tr><td>{t("rc_reinf")}</td><td>{(["botX", "botY", "topX", "topY"] as Layer[]).map((k) => `${t(`sl_${k}`)}: ${s[k].d ? `Ø${s[k].d}/${s[k].s}` : "—"}`).join("; ")}{s.punchOn ? `; ${t("fs_punch").toLowerCase()}: ${s.pn}Ø${s.pd}, s_r = ${s.psr}, ${s.prows}` : ""}</td></tr>
                <tr><td>φ(∞, t₀); {t("rc_exp")}; w_lim</td><td>{s.phi}; {s.exp}; {s.wlim} mm</td></tr>
              </tbody></table>
              <h2>{t("sl_summary")}</h2>
              {table}
              {(["mbx", "mby", "mtx", "mty", "w"] as const).map((k) => (
                <div key={k} className="fs-rep-map"><h3>{t(`sl_f_${k}`)}</h3><FlatPlan s={{ ...s, field: k }} r={r} sx={calc.sx!} sy={calc.sy!} t={t} mrd={mrdOf(k)} topMrd={topMrd} /></div>
              ))}
              <h2>{t("fs_cols")}</h2>
              {colTable}
              {selCol && detail(selCol)}
              <h2>{t("rep_checks")}</h2>
              <CheckList checks={r.checks} t={t} />
              <p className="hint">{t("fs_methodHint")}</p>
              <p className="disclaimer">{t("disclaimer")}</p>
            </article>
          </div>
        )}
        <p className="disclaimer">{t("disclaimer")}</p>
      </section>
    </main>
  );
}
