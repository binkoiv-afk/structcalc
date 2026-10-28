// Залізобетонна колона: спочатку колона (довжина, закріплення, зусилля) → переріз і бетон → армування.
// Результат: загальний метод з впливами другого порядку, косий згин, діаграма взаємодії N–M, конструювання.
import { useEffect, useMemo, useState } from "react";
import { NumInput } from "./NumInput";
import { BAR_DIAMETERS, checkRcColumn, CodeId, RC_REBARS, rcConcretes, RcColInput, RcColResult } from "@structcalc/core";
import { CheckList, pct, T, utilState, enNorms } from "./Results";

export interface RcColState {
  L: number; mux: number; muy: number; N: number; Mx1: number; Mx2: number; My1: number; My2: number;
  b: number; h: number; c: number; concrete: string; rebar: string;
  d: number; nb: number; nh: number; tieAll: boolean; tieD: number; tieS: number;
  phi: number; qp: number; obj: string; elem: string;
}
export const initialRcCol: RcColState = {
  L: 4.2, mux: 1, muy: 1, N: 1800, Mx1: 30, Mx2: 90, My1: 0, My2: 25,
  b: 400, h: 400, c: 25, concrete: "C25/30", rebar: "A500C",
  d: 20, nb: 1, nh: 1, tieAll: true, tieD: 8, tieS: 300,
  phi: 2, qp: 0.7, obj: "", elem: "",
};
const num = (v: string) => (v.trim() === "" ? 0 : Number(v));
const f = (v: number, n = 2) => (Number.isFinite(v) ? v.toFixed(n) : "—");
// рис. 6.2 ДСТУ Б В.2.6-156 (EN 1992-1-1, рис. 5.7)
const MU: [string, number][] = [["pp", 1], ["cant", 2], ["fp", 0.7], ["ff", 0.5], ["fs", 1]];

/** Переріз, стрижні, нейтральна вісь у середині колони при λ = 1 */
function ColSection({ s, r, t }: { s: RcColState; r: RcColResult; t: T }) {
  const W = 300, H = 300, pad = 34, sc = Math.min((W - 2 * pad) / s.b, (H - 2 * pad) / s.h), cx = W / 2, cy = H / 2;
  const X = (x: number) => cx + x * sc, Y = (y: number) => cy - y * sc;
  const p = r.gov.plane, cs = s.c + s.tieD / 2;
  let na = "";
  if (p && (Math.abs(p.kx) > 1e-12 || Math.abs(p.ky) > 1e-12)) {
    // ε = e0 + kx·y + ky·x = 0, обрізаємо прямокутником
    const pts: [number, number][] = [], bx = s.b / 2, hy = s.h / 2;
    if (Math.abs(p.kx) > 1e-12) for (const x of [-bx, bx]) { const y = -(p.e0 + p.ky * x) / p.kx; if (Math.abs(y) <= hy + 1e-9) pts.push([x, y]); }
    if (Math.abs(p.ky) > 1e-12) for (const y of [-hy, hy]) { const x = -(p.e0 + p.kx * y) / p.ky; if (Math.abs(x) <= bx + 1e-9) pts.push([x, y]); }
    if (pts.length >= 2) na = `M${X(pts[0][0])},${Y(pts[0][1])} L${X(pts[1][0])},${Y(pts[1][1])}`;
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="rc-svg rcc-sec" role="img" aria-label="section">
      <rect x={X(-s.b / 2)} y={Y(s.h / 2)} width={s.b * sc} height={s.h * sc} className="rc-conc" />
      <rect x={X(-s.b / 2 + cs)} y={Y(s.h / 2 - cs)} width={(s.b - 2 * cs) * sc} height={(s.h - 2 * cs) * sc} rx={4} className="rc-stirrup" />
      {r.bars.map((b, k) => <circle key={k} cx={X(b.x)} cy={Y(b.y)} r={Math.max(2.5, (b.d / 2) * sc)} className="rc-bar" />)}
      {na && <path d={na} className="rc-na" />}
      {!na && p && <text x={cx} y={14} className="rc-t mid">{t(p.e0 > 0 ? "rcc_allComp" : "rcc_allTen")}</text>}
      <line x1={cx} x2={cx + 40} y1={cy} y2={cy} className="rc-axis" /><text x={cx + 44} y={cy + 4} className="rc-t">x</text>
      <line x1={cx} x2={cx} y1={cy} y2={cy - 40} className="rc-axis" /><text x={cx - 4} y={cy - 44} className="rc-t">y</text>
      <text x={cx} y={Y(-s.h / 2) + 18} className="rc-t mid">b = {s.b}</text>
      <text x={X(-s.b / 2) - 8} y={cy} className="rc-t end" transform={`rotate(-90 ${X(-s.b / 2) - 12} ${cy})`}>h = {s.h}</text>
    </svg>
  );
}

/** Діаграма взаємодії N–M для двох площин і точки зусиль */
function NMChart({ r, s, t }: { r: RcColResult; s: RcColState; t: T }) {
  const W = 440, H = 300, L = 54, B = 30, R = 14, Tp = 12;
  const all = [...r.diag.x, ...r.diag.y];
  if (all.length < 3) return null;
  const g = r.gov, pts: { M: number; N: number; c: "x" | "y"; lbl: string }[] = [];
  if (Number.isFinite(g.M.x)) pts.push({ M: Math.abs(g.M.x), N: s.N, c: "x", lbl: "M_x" }, { M: Math.abs(g.M.y), N: s.N, c: "y", lbl: "M_y" });
  for (const [m, c] of [[Math.max(Math.abs(s.Mx1), Math.abs(s.Mx2)), "x"], [Math.max(Math.abs(s.My1), Math.abs(s.My2)), "y"]] as const) pts.push({ M: m, N: s.N, c, lbl: "" });
  const mMax = Math.max(...all.map((p) => p.M), ...pts.map((p) => p.M)) * 1.1, nMax = Math.max(...all.map((p) => p.N), s.N) * 1.05, nMin = Math.min(...all.map((p) => p.N)) * 1.05;
  const X = (m: number) => L + (m / mMax) * (W - L - R), Y = (n: number) => Tp + ((nMax - n) / (nMax - nMin)) * (H - Tp - B);
  const step = (v: number) => { const e = 10 ** Math.floor(Math.log10(v / 4)); return [1, 2, 5, 10].map((k) => k * e).find((k) => v / k <= 6)!; };
  const sm = step(mMax), sn = step(nMax - nMin), mt: number[] = [], nt: number[] = [];
  for (let m = 0; m <= mMax; m += sm) mt.push(m);
  for (let n = Math.ceil(nMin / sn) * sn; n <= nMax; n += sn) nt.push(n);
  const path = (d: { N: number; M: number }[]) => d.map((p, k) => `${k ? "L" : "M"}${X(p.M)},${Y(p.N)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="rc-svg" role="img" aria-label="N-M">
      {mt.map((m) => <g key={`m${m}`}><line x1={X(m)} x2={X(m)} y1={Tp} y2={H - B} className="rc-grid" /><text x={X(m)} y={H - B + 14} className="rc-t mid">{m}</text></g>)}
      {nt.map((n) => <g key={`n${n}`}><line x1={L} x2={W - R} y1={Y(n)} y2={Y(n)} className="rc-grid" /><text x={L - 5} y={Y(n) + 4} className="rc-t end">{n}</text></g>)}
      <line x1={L} x2={W - R} y1={Y(0)} y2={Y(0)} className="rc-axis" />
      <path d={path(r.diag.x)} className="rcc-x" />
      <path d={path(r.diag.y)} className="rcc-y" />
      {pts.map((p, k) => <g key={k}>
        <circle cx={X(p.M)} cy={Y(p.N)} r={p.lbl ? 5 : 3.5} className={`rcc-pt ${p.c} ${p.lbl ? "" : "end"}`} />
        {p.lbl && <text x={X(p.M) + 8} y={Y(p.N) - 6} className="rc-t">{p.lbl}</text>}
      </g>)}
      <text x={4} y={Tp + 2} className="rc-t">N, kN</text>
      <text x={W - R} y={H - 4} className="rc-t end">M, kN·m</text>
      <g transform={`translate(${W - R - 150},${Tp + 6})`}>
        <line x1={0} x2={18} y1={0} y2={0} className="rcc-x" /><text x={22} y={4} className="rc-t">{t("rcc_planeH")}</text>
        <line x1={0} x2={18} y1={16} y2={16} className="rcc-y" /><text x={22} y={20} className="rc-t">{t("rcc_planeB")}</text>
      </g>
    </svg>
  );
}

export function RcColumnModule({ code, s, set, t }: { code: CodeId; s: RcColState; set: (p: Partial<RcColState>) => void; t: T }) {
  const [tab, setTab] = useState<"results" | "report">("results");
  const concs = rcConcretes(code), rebars = RC_REBARS[code];
  const conc = concs.some((c) => c.id === s.concrete) ? s.concrete : "C25/30";
  const rebar = rebars.some((r) => r.id === s.rebar) ? s.rebar : code === "DBN" ? "A500C" : "B500B";
  const tieCls = code === "DBN" ? "A240C" : "B500B";
  const input: RcColInput = useMemo(() => ({
    code, concrete: conc, rebar, b: s.b, h: s.h, c: s.c, bars: { d: s.d, nb: s.nb, nh: s.nh }, tie: { d: s.tieD, s: s.tieS, cls: tieCls }, tieAll: s.tieAll,
    L: s.L, mux: s.mux, muy: s.muy, N: s.N, Mx1: s.Mx1, Mx2: s.Mx2, My1: s.My1, My2: s.My2, phi: s.phi, qp: s.qp,
  }), [code, s, conc, rebar, tieCls]);
  // розрахунок нелінійний (частки секунди) — відкладаємо, щоб введення не гальмувало
  const [calc, setCalc] = useState<{ r?: RcColResult; err?: string; key?: string }>({});
  const key = JSON.stringify(input);
  useEffect(() => {
    const id = setTimeout(() => {
      try { setCalc({ r: checkRcColumn(input), key }); } catch (e) { setCalc({ err: String((e as Error).message), key }); }
    }, 120);
    return () => clearTimeout(id);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const busy = calc.key !== key;
  const r = calc.r;
  const g = r?.checks.reduce<RcColResult["checks"][number] | undefined>((b, c) => (!b || c.util > b.util ? c : b), undefined);
  const st = r ? utilState(r.maxUtil) : "ok";
  const nBars = 4 + 2 * s.nb + 2 * s.nh;

  const muSel = (k: "mux" | "muy") => (
    <label><span className="lbl">{t(k === "mux" ? "rcc_muX" : "rcc_muY")}</span>
      <div className="rcc-mu">
        <select id={`rcc-${k}-p`} aria-label={t("rcc_scheme")} value={MU.find(([, v]) => v === s[k])?.[0] ?? ""} onChange={(e) => { const m = MU.find(([id]) => id === e.target.value); if (m) set({ [k]: m[1] } as Partial<RcColState>); }}>
          {MU.map(([id, v]) => <option key={id} value={id}>{t(`rcc_mu_${id}`)} · {v}</option>)}
          {!MU.some(([, v]) => v === s[k]) && <option value="">{t("rcc_mu_own")}</option>}
        </select>
        <NumInput id={`rcc-${k}`} step={0.05} min={0.3} value={s[k]} onChange={(e) => set({ [k]: Math.max(0.3, num(e.target.value)) } as Partial<RcColState>)} />
      </div>
    </label>
  );

  const summary = r && (
    <div className={`summary ${st}`}>
      <div className="summary-main"><div className="eyebrow">{t("mod_rccolumn")} · {conc} · {rebar}</div>
        <div className="profile">{s.b}×{s.h}</div>
        <div className="meta">{nBars}Ø{s.d} · Ø{s.tieD}/{s.tieS} · L = {s.L} m</div></div>
      <div className="summary-util"><div className="eyebrow">{t("rep_maxutil")}</div><div className="big">{pct(r.maxUtil)}</div><div className={`pill ${st}`}>{r.maxUtil <= 1 + 1e-9 ? t("ok") : t("fail")}</div></div>
      {g && <div className="summary-gov"><div className="eyebrow">{t("governing")}</div><div>{t(`chk_${g.key}`)}</div></div>}
    </div>
  );
  const slender = r && (
    <table className="rep-table rcc-tab"><thead><tr><th></th><th>{t("rcc_planeH")}</th><th>{t("rcc_planeB")}</th></tr></thead><tbody>
      <tr><td>l₀ = μ·l, m</td><td className="mono">{f(r.ax.x.l0 / 1000)}</td><td className="mono">{f(r.ax.y.l0 / 1000)}</td></tr>
      <tr><td>λ = l₀ / i (6.8)</td><td className="mono">{f(r.ax.x.lam, 1)}</td><td className="mono">{f(r.ax.y.lam, 1)}</td></tr>
      <tr><td>λ_lim (6.7)</td><td className="mono">{f(r.ax.x.lamLim, 1)}</td><td className="mono">{f(r.ax.y.lamLim, 1)}</td></tr>
      <tr><td>{t("rcc_second")}</td><td>{r.ax.x.lam <= r.ax.x.lamLim ? t("rcc_small") : t("rcc_needed")}</td><td>{r.ax.y.lam <= r.ax.y.lamLim ? t("rcc_small") : t("rcc_needed")}</td></tr>
      <tr><td>r_m = M01/M02; M0e, kN·m</td><td className="mono">{f(r.ax.x.rm)}; {f(r.ax.x.M0e)}</td><td className="mono">{f(r.ax.y.rm)}; {f(r.ax.y.M0e)}</td></tr>
      <tr><td>e_i = θ_i·l₀/2 (6.2), mm</td><td className="mono">{f(r.ei.x, 1)}</td><td className="mono">{f(r.ei.y, 1)}</td></tr>
      <tr><td>{t("rcc_u")}</td><td className="mono">{f(r.gov.u.y, 1)}</td><td className="mono">{f(r.gov.u.x, 1)}</td></tr>
      <tr><td>{t("rcc_Mtot")}</td><td className="mono">{f(r.gov.M.x)}</td><td className="mono">{f(r.gov.M.y)}</td></tr>
      <tr><td>{t("rcc_nc")}</td><td className="mono">{f(r.ax.x.MEdNc)}</td><td className="mono">{f(r.ax.y.MEdNc)}</td></tr>
    </tbody></table>
  );
  const props = r && (
    <table className="rep-table rc-forces"><tbody>
      <tr><td>A_c; A_s; ω; n</td><td className="mono">{f(r.Ac / 100, 0)} cm²; {f(r.As, 0)} mm²; {f(r.omega, 3)}; {f(r.n, 3)}</td></tr>
      <tr><td>f_cd; f_yd</td><td className="mono">{f(r.conc.fcd, 1)}; {f(r.fyd, 0)} MPa</td></tr>
      <tr><td>φ_ef = φ·M0Eqp/M0Ed (6.15)</td><td className="mono">{f(r.phiEf)}{r.creepIgnored ? ` — ${t("rcc_creep0")}` : ""}</td></tr>
      <tr><td>λ_u</td><td className="mono">{f(r.gov.lamU, 3)} ({t("rcc_impIn")} {r.gov.imp === "x" ? "h" : "b"})</td></tr>
    </tbody></table>
  );

  return (
    <main className="layout">
      <aside className="inputs">
        <fieldset>
          <legend><span className="step">1</span>{t("rcc_column")}</legend>
          <div className="grid2">
            <label className="wide"><span className="lbl">{t("rcc_L")}</span><NumInput id="rcc-L" step={0.1} min={0.3} value={s.L} onChange={(e) => set({ L: Math.max(0.3, num(e.target.value)) })} /></label>
            {muSel("mux")}
            {muSel("muy")}
            <label className="wide"><span className="lbl">{t("rcc_N")}</span><NumInput id="rcc-N" step={50} value={s.N} onChange={(e) => set({ N: num(e.target.value) })} /></label>
            <label><span className="lbl">{t("rcc_Mx1")}</span><NumInput id="rcc-Mx1" step={5} value={s.Mx1} onChange={(e) => set({ Mx1: num(e.target.value) })} /></label>
            <label><span className="lbl">{t("rcc_Mx2")}</span><NumInput id="rcc-Mx2" step={5} value={s.Mx2} onChange={(e) => set({ Mx2: num(e.target.value) })} /></label>
            <label><span className="lbl">{t("rcc_My1")}</span><NumInput id="rcc-My1" step={5} value={s.My1} onChange={(e) => set({ My1: num(e.target.value) })} /></label>
            <label><span className="lbl">{t("rcc_My2")}</span><NumInput id="rcc-My2" step={5} value={s.My2} onChange={(e) => set({ My2: num(e.target.value) })} /></label>
            <p className="hint wide">{t("rcc_loadsHint")}</p>
          </div>
        </fieldset>
        <fieldset>
          <legend><span className="step">2</span>{t("rc_section")}</legend>
          <div className="grid2">
            <label><span className="lbl">{t("rc_b")}</span><NumInput id="rcc-b" step={50} min={150} value={s.b} onChange={(e) => set({ b: Math.max(150, num(e.target.value)) })} /></label>
            <label><span className="lbl">{t("rc_h")}</span><NumInput id="rcc-h" step={50} min={150} value={s.h} onChange={(e) => set({ h: Math.max(150, num(e.target.value)) })} /></label>
            <label><span className="lbl">{t("rc_conc")}</span><select id="rcc-conc" value={conc} onChange={(e) => set({ concrete: e.target.value })}>{concs.map((c) => <option key={c.id}>{c.id}</option>)}</select></label>
            <label><span className="lbl">{t("rc_c")}</span><NumInput id="rcc-c" step={5} min={10} value={s.c} onChange={(e) => set({ c: Math.max(10, num(e.target.value)) })} /></label>
          </div>
        </fieldset>
        <fieldset>
          <legend><span className="step">3</span>{t("rc_reinf")}</legend>
          <div className="grid2">
            <label><span className="lbl">{t("rc_cls")}</span><select id="rcc-cls" value={rebar} onChange={(e) => set({ rebar: e.target.value })}>{rebars.map((x) => <option key={x.id}>{x.id}</option>)}</select></label>
            <label><span className="lbl">{t("rcc_d")}</span><select id="rcc-d" value={s.d} onChange={(e) => set({ d: Number(e.target.value) })}>{BAR_DIAMETERS.filter((d) => d >= 8).map((d) => <option key={d} value={d}>Ø{d}</option>)}</select></label>
            <label><span className="lbl">{t("rcc_nb")}</span><NumInput id="rcc-nb" step={1} min={0} max={10} value={s.nb} onChange={(e) => set({ nb: Math.max(0, Math.min(10, Math.round(num(e.target.value)))) })} /></label>
            <label><span className="lbl">{t("rcc_nh")}</span><NumInput id="rcc-nh" step={1} min={0} max={10} value={s.nh} onChange={(e) => set({ nh: Math.max(0, Math.min(10, Math.round(num(e.target.value)))) })} /></label>
            <p className="hint wide">{t("rcc_total")}: {nBars}Ø{s.d}{r ? ` · A_s = ${f(r.As, 0)} mm² (${f((100 * r.As) / r.Ac, 2)} %)` : ""}</p>
            <label><span className="lbl">{t("rcc_tieD")}</span><select id="rcc-tieD" value={s.tieD} onChange={(e) => set({ tieD: Number(e.target.value) })}>{BAR_DIAMETERS.slice(0, 6).map((d) => <option key={d} value={d}>Ø{d}</option>)}</select></label>
            <label><span className="lbl">{t("rc_s")}</span><NumInput id="rcc-tieS" step={25} min={50} value={s.tieS} onChange={(e) => set({ tieS: Math.max(50, num(e.target.value)) })} /></label>
            <label className="chk wide"><input id="rcc-tieAll" type="checkbox" checked={s.tieAll} onChange={(e) => set({ tieAll: e.target.checked })} />{t("rcc_tieAll")}</label>
          </div>
        </fieldset>
        <details className="adv">
          <summary>{t("advanced")}<span className="adv-hint">{t("rcc_advHint")}</span></summary>
          <div className="adv-group"><div className="grid2">
            <label><span className="lbl">{t("rc_phi")}</span><NumInput id="rcc-phi" step={0.1} min={0} value={s.phi} onChange={(e) => set({ phi: Math.max(0, num(e.target.value)) })} /></label>
            <label><span className="lbl">{t("rcc_qp")}</span><NumInput id="rcc-qp" step={0.05} min={0} max={1} value={s.qp} onChange={(e) => set({ qp: Math.max(0, Math.min(1, num(e.target.value))) })} /></label>
          </div></div>
        </details>
      </aside>

      <section className={`output ${busy ? "rcc-busy" : ""}`}>
        <div className="tabs" role="tablist">
          {(["results", "report"] as const).map((k) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{t(`tab_${k}`)}</button>)}
          {busy && <span className="rcc-calc" id="rcc-busy">{t("rcc_busy")}</span>}
        </div>
        {calc.err && <p className="error">{calc.err}</p>}
        {r && tab === "results" && (
          <div className="results">
            {summary}
            <div className="panel two-col">
              <div><h3>{t("rcc_secMid")}</h3><ColSection s={s} r={r} t={t} /></div>
              <div><h3>{t("rcc_nm")}</h3><NMChart r={r} s={s} t={t} /><p className="hint">{t("rcc_nmHint")}</p></div>
            </div>
            <div className="panel"><h3>{t("results")}</h3><CheckList checks={r.checks} t={t} /></div>
            <div className="panel two-col">
              <div><h3>{t("rcc_slender")}</h3>{slender}</div>
              <div><h3>{t("rc_props")}</h3>{props}<p className="hint">{t("rcc_methodHint")}</p></div>
            </div>
          </div>
        )}
        {r && tab === "report" && (
          <div className="report-wrap">
            <div className="report-tools">
              <input id="rcc-obj" placeholder={t("objPlaceholder")} value={s.obj} onChange={(e) => set({ obj: e.target.value })} />
              <input id="rcc-elem" placeholder={t("rccPlaceholder")} value={s.elem} onChange={(e) => set({ elem: e.target.value })} />
              <button className="primary" onClick={() => window.print()}>{t("print")}</button>
            </div>
            <article className="report">
              <header className="rep-head">
                <h1>{t("rep_titleRcc")}</h1>
                <dl>
                  <div><dt>{t("rep_object")}</dt><dd>{s.obj || "—"}</dd></div>
                  <div><dt>{t("rep_element")}</dt><dd>{s.elem || t("mod_rccolumn")}</dd></div>
                  <div><dt>{t("rep_code")}</dt><dd>{code === "DBN" ? "ДБН В.2.6-98:2009 зі Зміною № 1; ДСТУ Б В.2.6-156:2010" : enNorms("EN 1992-1-1")}</dd></div>
                  <div><dt>{t("rep_date")}</dt><dd>{new Date().toLocaleDateString()}</dd></div>
                </dl>
              </header>
              <h2>{t("rep_summary")}</h2>
              {summary}
              <h2>{t("rep_inputs")}</h2>
              <table className="rep-table"><tbody>
                <tr><td>{t("rcc_column")}</td><td>l = {s.L} m; μ_x = {s.mux}, μ_y = {s.muy}; N_Ed = {s.N} kN; M_x = {s.Mx1} / {s.Mx2}, M_y = {s.My1} / {s.My2} kN·m</td></tr>
                <tr><td>{t("rc_section")}</td><td>b×h = {s.b}×{s.h} mm; {conc}; c = {s.c} mm</td></tr>
                <tr><td>{t("rc_reinf")}</td><td>{rebar}: {nBars}Ø{s.d} (A_s = {f(r.As, 0)} mm²); {t("rc_stirrups").toLowerCase()} Ø{s.tieD} {tieCls}, s = {s.tieS} mm{s.tieAll ? `; ${t("rcc_tieAll").toLowerCase()}` : ""}</td></tr>
                <tr><td>φ(∞, t₀); M0Eqp/M0Ed</td><td>{s.phi}; {s.qp}</td></tr>
              </tbody></table>
              <h2>{t("rcc_slender")}</h2>
              {slender}
              {props}
              <ColSection s={s} r={r} t={t} />
              <NMChart r={r} s={s} t={t} />
              <h2>{t("rep_checks")}</h2>
              <CheckList checks={r.checks} t={t} />
              <p className="hint">{t("rcc_methodHint")}</p>
              <p className="disclaimer">{t("disclaimer")}</p>
            </article>
          </div>
        )}
        <p className="disclaimer">{t("disclaimer")}</p>
      </section>
    </main>
  );
}
