// Залізобетонна плита: спочатку плита (прольоти, опирання граней, навантаження) → товщина і бетон → армування.
// Результат: карти моментів Вуда–Армера і прогину на плані з позначенням зон, де армування не вистачає, перевірки смуг 1 м.
import { useEffect, useMemo, useState } from "react";
import { NumInput } from "./NumInput";
import { BAR_DIAMETERS, checkSlab, CodeId, RC_REBARS, rcConcretes, slabAs, SlabBars, SlabEdge, SlabInput, SlabResult } from "@structcalc/core";
import { CheckList, pct, T, utilState } from "./Results";

type EdgeKey = "x0" | "x1" | "y0" | "y1";
type Layer = "botX" | "botY" | "topX" | "topY";
export interface SlabState {
  lx: number; ly: number; edges: Record<EdgeKey, SlabEdge>; g: number; q: number; selfWeight: boolean;
  h: number; c: number; concrete: string; rebar: string;
  botX: SlabBars; botY: SlabBars; topX: SlabBars; topY: SlabBars;
  gammaG: string; gammaQ: string; psi2: number; phi: number; exp: string; wlim: number; deflN: number;
  field: "mbx" | "mby" | "mtx" | "mty" | "w"; obj: string; elem: string;
}
export const initialSlab: SlabState = {
  lx: 4.5, ly: 6, edges: { x0: "pin", x1: "pin", y0: "pin", y1: "pin" }, g: 2.5, q: 2, selfWeight: true,
  h: 180, c: 20, concrete: "C25/30", rebar: "A500C",
  botX: { d: 10, s: 150 }, botY: { d: 8, s: 200 }, topX: { d: 8, s: 200 }, topY: { d: 8, s: 200 },
  gammaG: "", gammaQ: "", psi2: 0.3, phi: 2, exp: "XC1", wlim: 0.4, deflN: 0, field: "mbx", obj: "", elem: "",
};
const EXPOSURE: [string, number][] = [["X0", 0.4], ["XC1", 0.4], ["XC2", 0.3], ["XC3", 0.3], ["XC4", 0.3], ["XD1", 0.3], ["XS1", 0.3]];
const num = (v: string) => (v.trim() === "" ? 0 : Number(v));
const f = (v: number, n = 2) => (Number.isFinite(v) ? v.toFixed(n) : "—");
const NEXT: Record<SlabEdge, SlabEdge> = { free: "pin", pin: "fix", fix: "free" };
const SPACINGS = [100, 125, 150, 175, 200, 250, 300];

/** План плити: опирання граней (клік — змінити), карта обраного поля, зони перевищення M_Rd */
function SlabPlan({ s, r, set, t, mrd }: { s: SlabState; r?: SlabResult; set?: (p: Partial<SlabState>) => void; t: T; mrd?: number }) {
  const W = 440, H = 320, pad = 34, sc = Math.min((W - 2 * pad) / s.lx, (H - 2 * pad) / s.ly);
  const x0 = (W - s.lx * sc) / 2, y0 = (H - s.ly * sc) / 2, x1 = x0 + s.lx * sc, y1 = y0 + s.ly * sc;
  const fd = r?.field, vals = fd ? fd[s.field] : [];
  const cells: JSX.Element[] = [];
  let vmax = 0, kmax = -1;
  if (fd) {
    vals.forEach((v, k) => { if (v > vmax) { vmax = v; kmax = k; } });
    const cw = (s.lx * sc) / fd.nx, ch = (s.ly * sc) / fd.ny;
    for (let b = 0; b < fd.ny; b++) for (let a = 0; a < fd.nx; a++) {
      const id = (p: number, q: number) => q * (fd.nx + 1) + p;
      const v = (vals[id(a, b)] + vals[id(a + 1, b)] + vals[id(a + 1, b + 1)] + vals[id(a, b + 1)]) / 4;
      const over = mrd !== undefined && v > mrd;
      cells.push(<rect key={`${a}-${b}`} x={x0 + a * cw} y={y1 - (b + 1) * ch} width={cw + 0.3} height={ch + 0.3}
        className={over ? "sl-over" : "sl-cell"} fillOpacity={over ? 0.85 : vmax > 0 ? 0.08 + 0.8 * (v / vmax) : 0} />);
    }
  }
  const edge = (k: EdgeKey) => {
    const e = s.edges[k], [ax, ay, bx, by] = k === "x0" ? [x0, y0, x0, y1] : k === "x1" ? [x1, y0, x1, y1] : k === "y0" ? [x0, y1, x1, y1] : [x0, y0, x1, y0];
    const nx = k === "x0" ? -1 : k === "x1" ? 1 : 0, ny = k === "y0" ? 1 : k === "y1" ? -1 : 0, L = Math.hypot(bx - ax, by - ay), ticks: JSX.Element[] = [];
    const tx = (bx - ax) / L, ty = (by - ay) / L; // уздовж грані; (nx, ny) — назовні
    if (e === "fix") for (let d = 6; d < L; d += 10) { const px = ax + tx * d, py = ay + ty * d; ticks.push(<line key={d} x1={px} y1={py} x2={px + nx * 8 - tx * 5} y2={py + ny * 8 - ty * 5} className="sl-hatch" />); }
    if (e === "pin") for (let d = 14; d < L - 6; d += 28) { const px = ax + tx * d, py = ay + ty * d; ticks.push(<path key={d} d={`M${px},${py} L${px + nx * 9 - tx * 5},${py + ny * 9 - ty * 5} L${px + nx * 9 + tx * 5},${py + ny * 9 + ty * 5} Z`} className="sl-pin" />); }
    return (
      <g key={k} className={`sl-edge ${e} ${set ? "click" : ""}`} onClick={set ? () => set({ edges: { ...s.edges, [k]: NEXT[e] } }) : undefined}>
        <line x1={ax} y1={ay} x2={bx} y2={by} className="sl-hit" />
        <line x1={ax} y1={ay} x2={bx} y2={by} className="sl-line" />
        {ticks}
        <title>{t(`sl_e_${e}`)}</title>
      </g>
    );
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="rc-svg" role="img" aria-label="slab plan">
      <rect x={x0} y={y0} width={s.lx * sc} height={s.ly * sc} className="sl-slab" />
      {cells}
      {(["x0", "x1", "y0", "y1"] as EdgeKey[]).map(edge)}
      {fd && kmax >= 0 && vmax > 0 && (() => {
        const a = kmax % (fd.nx + 1), b = Math.floor(kmax / (fd.nx + 1)), px = x0 + (a / fd.nx) * s.lx * sc, py = y1 - (b / fd.ny) * s.ly * sc;
        return <g><circle cx={px} cy={py} r={4} className="rc-dot" /><text x={Math.min(px + 7, W - 70)} y={Math.max(py - 7, 12)} className="rc-t">{f(vmax, s.field === "w" ? 1 : 1)} {s.field === "w" ? "mm" : "kN·m/m"}</text></g>;
      })()}
      <text x={(x0 + x1) / 2} y={H - 6} className="rc-t mid">l_x = {s.lx} m</text>
      <text x={10} y={(y0 + y1) / 2} className="rc-t" transform={`rotate(-90 14 ${(y0 + y1) / 2})`}>l_y = {s.ly} m</text>
      <path d={`M${x0 - 22},${y1 + 18} h22 M${x0 - 22},${y1 + 18} v-22`} className="rc-axis" />
      <text x={x0 + 3} y={y1 + 22} className="rc-t">x</text><text x={x0 - 26} y={y1 - 6} className="rc-t">y</text>
    </svg>
  );
}

export function SlabModule({ code, s, set, t }: { code: CodeId; s: SlabState; set: (p: Partial<SlabState>) => void; t: T }) {
  const [tab, setTab] = useState<"results" | "report">("results");
  const concs = rcConcretes(code), rebars = RC_REBARS[code];
  const conc = concs.some((c) => c.id === s.concrete) ? s.concrete : "C25/30";
  const rebar = rebars.some((r) => r.id === s.rebar) ? s.rebar : code === "DBN" ? "A500C" : "B500B";
  const input: SlabInput = useMemo(() => ({
    code, concrete: conc, rebar, lx: s.lx, ly: s.ly, h: s.h, c: s.c, edges: s.edges, g: s.g, q: s.q, selfWeight: s.selfWeight,
    gammaG: s.gammaG.trim() ? num(s.gammaG) : undefined, gammaQ: s.gammaQ.trim() ? num(s.gammaQ) : undefined, psi2: s.psi2,
    botX: s.botX, botY: s.botY, topX: s.topX, topY: s.topY, phi: s.phi, wlim: s.wlim, deflN: s.deflN,
  }), [code, s, conc, rebar]);
  const key = JSON.stringify(input);
  const [calc, setCalc] = useState<{ r?: SlabResult; err?: string; key?: string }>({});
  useEffect(() => {
    const id = setTimeout(() => { try { setCalc({ r: checkSlab(input), key }); } catch (e) { setCalc({ err: String((e as Error).message), key }); } }, 80);
    return () => clearTimeout(id);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const busy = calc.key !== key, r = calc.r;
  const g = r?.checks.reduce<SlabResult["checks"][number] | undefined>((b, c) => (!b || c.util > b.util ? c : b), undefined);
  const st = r ? utilState(r.maxUtil) : "ok";
  const allFree = Object.values(s.edges).every((e) => e === "free");
  const mrdOf = (fl: SlabState["field"]) => !r ? undefined : fl === "mbx" ? r.rc.x.pos.MRd : fl === "mby" ? r.rc.y.pos.MRd : fl === "mtx" ? r.rc.xNeg.neg?.MRd ?? 0 : fl === "mty" ? r.rc.yNeg.neg?.MRd ?? 0 : r.defl.flim;

  const barsRow = (k: Layer) => {
    const b = s[k];
    return (
      <div key={k} className="sl-bars">
        <span className="sl-bl">{t(`sl_${k}`)}</span>
        <select id={`sl-${k}-d`} aria-label="Ø" value={b.d} onChange={(e) => set({ [k]: { ...b, d: Number(e.target.value) } } as Partial<SlabState>)}>
          <option value={0}>—</option>{BAR_DIAMETERS.filter((d) => d >= 6 && d <= 25).map((d) => <option key={d} value={d}>Ø{d}</option>)}
        </select>
        <select id={`sl-${k}-s`} aria-label={t("rc_s")} value={SPACINGS.includes(b.s) ? b.s : ""} disabled={!b.d} onChange={(e) => set({ [k]: { ...b, s: Number(e.target.value) } } as Partial<SlabState>)}>
          {SPACINGS.map((x) => <option key={x} value={x}>/{x}</option>)}{!SPACINGS.includes(b.s) && <option value="">/{b.s}</option>}
        </select>
        <span className="sl-as mono">{b.d ? `${f(slabAs(b), 0)}` : "0"}</span>
      </div>
    );
  };

  const summary = r && (
    <div className={`summary ${st}`}>
      <div className="summary-main"><div className="eyebrow">{t("mod_slab")} · {conc} · {rebar}</div>
        <div className="profile">{s.lx}×{s.ly} m · h = {s.h}</div>
        <div className="meta">{t(`sl_kind_${r.kind}`)}{r.kind !== "two" ? ` (l₂/l₁ = ${f(r.ratio)})` : ""}</div></div>
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
      <tr><td>V_Ed, kN/m</td><td className="mono" colSpan={3}>x: {f(r.V.x, 1)}; y: {f(r.V.y, 1)}</td></tr>
      <tr><td>{t("sl_defl")}</td><td className="mono" colSpan={3}>{f(r.defl.el, 1)} × {f(r.defl.k, 2)} = {f(r.defl.f, 1)} ≤ {f(r.defl.flim, 1)} mm (l = {f(r.defl.l)} m)</td></tr>
    </tbody></table>
  );
  const fieldSel = (
    <div className="seg wide sl-fields">{(["mbx", "mby", "mtx", "mty", "w"] as const).map((k) => <button key={k} id={`sl-f-${k}`} className={s.field === k ? "on" : ""} onClick={() => set({ field: k })}>{t(`sl_f_${k}`)}</button>)}</div>
  );

  return (
    <main className="layout">
      <aside className="inputs">
        <fieldset>
          <legend><span className="step">1</span>{t("sl_plate")}</legend>
          <div className="grid2">
            <label><span className="lbl">l_x, m</span><NumInput id="sl-lx" step={0.1} min={1} value={s.lx} onChange={(e) => set({ lx: Math.max(1, num(e.target.value)) })} /></label>
            <label><span className="lbl">l_y, m</span><NumInput id="sl-ly" step={0.1} min={1} value={s.ly} onChange={(e) => set({ ly: Math.max(1, num(e.target.value)) })} /></label>
          </div>
          <div className="lbl rc-gap">{t("sl_edges")}</div>
          <div className="sl-edges">
            {(["x0", "x1", "y0", "y1"] as EdgeKey[]).map((k) => (
              <label key={k}><span className="lbl">{t(`sl_${k}`)}</span>
                <select id={`sl-${k}`} value={s.edges[k]} onChange={(e) => set({ edges: { ...s.edges, [k]: e.target.value as SlabEdge } })}>
                  {(["pin", "fix", "free"] as SlabEdge[]).map((e) => <option key={e} value={e}>{t(`sl_e_${e}`)}</option>)}
                </select></label>
            ))}
          </div>
          {allFree && <p className="error">{t("sl_noSupport")}</p>}
          <div className="grid2 rc-gap">
            <label><span className="lbl">{t("sl_g")}</span><NumInput id="sl-g" step={0.5} value={s.g} onChange={(e) => set({ g: num(e.target.value) })} /></label>
            <label><span className="lbl">{t("sl_q")}</span><NumInput id="sl-q" step={0.5} value={s.q} onChange={(e) => set({ q: num(e.target.value) })} /></label>
            <label className="chk wide"><input id="sl-self" type="checkbox" checked={s.selfWeight} onChange={(e) => set({ selfWeight: e.target.checked })} />{t("rc_self")}</label>
          </div>
        </fieldset>
        <fieldset>
          <legend><span className="step">2</span>{t("sl_section")}</legend>
          <div className="grid2">
            <label><span className="lbl">{t("sl_h")}</span><NumInput id="sl-h" step={10} min={60} value={s.h} onChange={(e) => set({ h: Math.max(60, num(e.target.value)) })} /></label>
            <label><span className="lbl">{t("sl_c")}</span><NumInput id="sl-c" step={5} min={10} value={s.c} onChange={(e) => set({ c: Math.max(10, num(e.target.value)) })} /></label>
            <label><span className="lbl">{t("rc_conc")}</span><select id="sl-conc" value={conc} onChange={(e) => set({ concrete: e.target.value })}>{concs.map((c) => <option key={c.id}>{c.id}</option>)}</select></label>
            <label><span className="lbl">{t("rc_cls")}</span><select id="sl-cls" value={rebar} onChange={(e) => set({ rebar: e.target.value })}>{rebars.map((x) => <option key={x.id}>{x.id}</option>)}</select></label>
          </div>
        </fieldset>
        <fieldset>
          <legend><span className="step">3</span>{t("rc_reinf")}</legend>
          <div className="sl-bars sl-head"><span></span><span>Ø</span><span>s, mm</span><span>mm²/m</span></div>
          {(["botX", "botY", "topX", "topY"] as Layer[]).map(barsRow)}
          <p className="hint">{t("sl_barsHint")}</p>
        </fieldset>
        <details className="adv">
          <summary>{t("advanced")}<span className="adv-hint">{t("rc_advHint")}</span></summary>
          <div className="adv-group"><div className="grid2">
            <label><span className="lbl">{t("rc_gammaG")}</span><NumInput id="sl-gG" step={0.05} placeholder={code === "DBN" ? "1.1" : "1.35"} value={s.gammaG} onChange={(e) => set({ gammaG: e.target.value })} /></label>
            <label><span className="lbl">{t("rc_gammaQ")}</span><NumInput id="sl-gQ" step={0.05} placeholder={code === "DBN" ? "1.2" : "1.5"} value={s.gammaQ} onChange={(e) => set({ gammaQ: e.target.value })} /></label>
            <label><span className="lbl">{t("rc_psi2")}</span><NumInput id="sl-psi2" step={0.05} min={0} max={1} value={s.psi2} onChange={(e) => set({ psi2: num(e.target.value) })} /></label>
            <label><span className="lbl">{t("rc_deflN")}</span><NumInput id="sl-defl" step={10} min={0} value={s.deflN} onChange={(e) => set({ deflN: Math.max(0, num(e.target.value)) })} /></label>
            <label><span className="lbl">{t("rc_phi")}</span><NumInput id="sl-phi" step={0.1} min={0} value={s.phi} onChange={(e) => set({ phi: Math.max(0, num(e.target.value)) })} /></label>
            <label><span className="lbl">{t("rc_exp")}</span><select id="sl-exp" value={s.exp} onChange={(e) => set({ exp: e.target.value, wlim: EXPOSURE.find((x) => x[0] === e.target.value)![1] })}>{EXPOSURE.map(([k]) => <option key={k}>{k}</option>)}</select></label>
            <label><span className="lbl">{t("rc_wlim")}</span><NumInput id="sl-wlim" step={0.05} min={0.05} value={s.wlim} onChange={(e) => set({ wlim: Math.max(0.05, num(e.target.value)) })} /></label>
          </div></div>
        </details>
      </aside>

      <section className={`output ${busy ? "rcc-busy" : ""}`}>
        <div className="tabs" role="tablist">
          {(["results", "report"] as const).map((k) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{t(`tab_${k}`)}</button>)}
          {busy && <span className="rcc-calc" id="sl-busy">{t("rcc_busy")}</span>}
        </div>
        {calc.err && !allFree && <p className="error">{calc.err}</p>}
        {r && tab === "results" && (
          <div className="results">
            {summary}
            {Object.keys(r.need).length > 0 && (
              <div className="rc-fix">
                {(["botX", "botY", "topX", "topY"] as Layer[]).filter((k) => r.need[k]).map((k) => (
                  <div key={k}>{t("rc_need")} <b>Ø{r.need[k]!.d}/{r.need[k]!.s}</b> ({t(`sl_${k}`).toLowerCase()}, {f(slabAs(r.need[k]!), 0)} mm²/m)
                    <button id={`sl-fix-${k}`} className="primary" onClick={() => set({ [k]: r.need[k] } as Partial<SlabState>)}>{t("rc_apply")}</button></div>
                ))}
              </div>
            )}
            <div className="panel two-col">
              <div><h3>{t("sl_map")}</h3>{fieldSel}<SlabPlan s={s} r={r} set={set} t={t} mrd={s.field === "w" ? undefined : mrdOf(s.field)} />
                <p className="hint">{t("sl_mapHint")}</p></div>
              <div><h3>{t("sl_summary")}</h3>{table}</div>
            </div>
            <div className="panel"><h3>{t("results")}</h3><CheckList checks={r.checks} t={t} /></div>
          </div>
        )}
        {r && tab === "report" && (
          <div className="report-wrap">
            <div className="report-tools">
              <input id="sl-obj" placeholder={t("objPlaceholder")} value={s.obj} onChange={(e) => set({ obj: e.target.value })} />
              <input id="sl-elem" placeholder={t("slPlaceholder")} value={s.elem} onChange={(e) => set({ elem: e.target.value })} />
              <button className="primary" onClick={() => window.print()}>{t("print")}</button>
            </div>
            <article className="report">
              <header className="rep-head">
                <h1>{t("rep_titleSl")}</h1>
                <dl>
                  <div><dt>{t("rep_object")}</dt><dd>{s.obj || "—"}</dd></div>
                  <div><dt>{t("rep_element")}</dt><dd>{s.elem || t("mod_slab")}</dd></div>
                  <div><dt>{t("rep_code")}</dt><dd>{code === "DBN" ? "ДБН В.2.6-98:2009 зі Зміною № 1; ДСТУ Б В.2.6-156:2010; ДБН В.1.2-2; ДСТУ Б В.1.2-3" : "EN 1992-1-1; EN 1990"}</dd></div>
                  <div><dt>{t("rep_date")}</dt><dd>{new Date().toLocaleDateString()}</dd></div>
                </dl>
              </header>
              <h2>{t("rep_summary")}</h2>
              {summary}
              <h2>{t("rep_inputs")}</h2>
              <table className="rep-table"><tbody>
                <tr><td>{t("sl_plate")}</td><td>l_x × l_y = {s.lx} × {s.ly} m; {(["x0", "x1", "y0", "y1"] as EdgeKey[]).map((k) => `${t(`sl_${k}`)}: ${t(`sl_e_${s.edges[k]}`)}`).join("; ")}</td></tr>
                <tr><td>{t("sl_loadsIn")}</td><td>g_k = {s.g}, q_k = {s.q} kN/m²{s.selfWeight ? ` + ${f(r.selfW)} kN/m²` : ""}; γ_G = {s.gammaG || (code === "DBN" ? "1.1" : "1.35")}, γ_Q = {s.gammaQ || (code === "DBN" ? "1.2" : "1.5")}, ψ₂ = {s.psi2}</td></tr>
                <tr><td>{t("sl_section")}</td><td>h = {s.h} mm; c = {s.c} mm; {conc}; {rebar}</td></tr>
                <tr><td>{t("rc_reinf")}</td><td>{(["botX", "botY", "topX", "topY"] as Layer[]).map((k) => `${t(`sl_${k}`)}: ${s[k].d ? `Ø${s[k].d}/${s[k].s}` : "—"}`).join("; ")}</td></tr>
                <tr><td>φ(∞, t₀); {t("rc_exp")}; w_lim</td><td>{s.phi}; {s.exp}; {s.wlim} mm</td></tr>
              </tbody></table>
              <h2>{t("sl_summary")}</h2>
              {table}
              {(["mbx", "mby", "mtx", "mty", "w"] as const).map((k) => (
                <div key={k} className="sl-rep-map"><h3>{t(`sl_f_${k}`)}</h3><SlabPlan s={{ ...s, field: k }} r={r} t={t} mrd={k === "w" ? undefined : mrdOf(k)} /></div>
              ))}
              <h2>{t("rep_checks")}</h2>
              <CheckList checks={r.checks} t={t} />
              <p className="hint">{t("sl_methodHint")}</p>
              <p className="disclaimer">{t("disclaimer")}</p>
            </article>
          </div>
        )}
        <p className="disclaimer">{t("disclaimer")}</p>
      </section>
    </main>
  );
}
