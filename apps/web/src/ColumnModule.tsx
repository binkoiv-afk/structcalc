import { useMemo, useState } from "react";
import { NumInput } from "./NumInput";
import {
  CodeId, ColumnDesignInput, designColumn, END_CONDITIONS, familiesFor, familySections, findSection, selectColumn, STEELS,
} from "@structcalc/core";
import { CheckList, SectionProps, Summary } from "./Results";
import { TriedList } from "./TriedList";
import { FamilyOptions } from "./SectionModule";
import { SectionDrawing } from "./SectionDrawing";

export interface ColumnState {
  steel: string; L: number; muY: number; muZ: number; Lz: string; N: number; M: number;
  mode: "check" | "select"; family: string; size: string; gammaC: number; gammaN: number; obj: string; elem: string;
}

export const initialColumn: ColumnState = {
  steel: "C245", L: 4, muY: 1, muZ: 1, Lz: "", N: 500, M: 0, mode: "select", family: "HEB", size: "HEB 200",
  gammaC: 1, gammaN: 1, obj: "", elem: "",
};

const num = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(",", ".")));

/** Схема стержня с закреплениями концов: шарнир — кружок, заделка — штриховка, свободный конец — ничего. */
function ColumnScheme({ mu, L, N, M }: { mu: number; L: number; N: number; M: number }) {
  const ec = END_CONDITIONS.find((e) => e.mu === mu)?.key ?? "pinPin";
  const bottom = ec === "pinPin" ? "pin" : "fixed";
  const top = ec === "fixedFixed" ? "fixed" : ec === "fixedFree" ? "free" : "pin";
  const x = 80, y0 = 30, y1 = 190;
  const end = (kind: string, y: number, up: boolean) => {
    if (kind === "free") return null;
    if (kind === "pin") return <g><circle cx={x} cy={y} r={4} className="cs-node" /><path d={up ? `M${x - 10} ${y - 14} L${x} ${y - 4} L${x + 10} ${y - 14}` : `M${x - 10} ${y + 14} L${x} ${y + 4} L${x + 10} ${y + 14}`} className="cs-sup" /></g>;
    return <g><line x1={x - 18} x2={x + 18} y1={y} y2={y} className="cs-fix" />
      {[-15, -7, 1, 9].map((d) => <line key={d} x1={x + d} y1={y} x2={x + d + 7} y2={up ? y - 7 : y + 7} className="cs-sup" />)}</g>;
  };
  return (
    <svg viewBox="0 0 220 220" className="column-scheme" role="img" aria-label="scheme">
      <line x1={x} x2={x} y1={y0} y2={y1} className="cs-bar" />
      {end(top, y0, true)}
      {end(bottom, y1, false)}
      <line x1={x} x2={x} y1={2} y2={y0 - (top === "free" ? 4 : 16)} className="cs-load" markerEnd="url(#carr)" />
      <defs><marker id="carr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" className="s-load-fill" /></marker></defs>
      <text x={x + 10} y={14} className="s-text">N = {N} kN{M ? `, M = ${M} kN·m` : ""}</text>
      <line x1={x + 46} x2={x + 46} y1={y0} y2={y1} className="cs-dim" />
      <text x={x + 52} y={(y0 + y1) / 2} className="s-text">L = {L} m</text>
      <text x={x + 52} y={(y0 + y1) / 2 + 16} className="s-text">μ = {mu}</text>
    </svg>
  );
}

export function ColumnModule({ code, s, set, t }: { code: CodeId; s: ColumnState; set: (p: Partial<ColumnState>) => void; t: (k: string) => string }) {
  const [tab, setTab] = useState<"results" | "report">("results");
  const input: ColumnDesignInput = useMemo(() => ({
    code, steel: s.steel, L: s.L, muY: s.muY, muZ: s.muZ, Lz: s.Lz.trim() ? num(s.Lz) : undefined,
    N: s.N, M: s.M, gammaC: s.gammaC, gammaN: s.gammaN,
  }), [code, s]);
  const calc = useMemo(() => {
    try {
      if (s.mode === "select") { const r = selectColumn(input, s.family); return { r: r.best, tried: r.tried }; }
      const sec = findSection(s.family, s.size) ?? familySections(s.family)[0];
      return { r: designColumn(input, sec), tried: undefined };
    } catch (e) { return { r: undefined, tried: undefined, error: String((e as Error).message) }; }
  }, [input, s.mode, s.family, s.size]);
  const r = calc.r;
  const muSel = (id: string, v: number, k: "muY" | "muZ") => (
    <select id={id} value={END_CONDITIONS.some((e) => e.mu === v) ? v : "custom"} onChange={(e) => e.target.value !== "custom" && set({ [k]: Number(e.target.value) } as Partial<ColumnState>)}>
      {END_CONDITIONS.map((e) => <option key={e.key} value={e.mu}>{t(`ec_${e.key}`)} · μ = {e.mu}</option>)}
      <option value="custom">{t("lc_manual")}</option>
    </select>
  );

  return (
    <main className="layout">
      <aside className="inputs">
        <fieldset>
          <legend><span className="step">1</span>{t("col_geometry")}</legend>
          <div className="grid2">
            <label><span className="lbl">{t("col_L")}</span><NumInput id="cL" step="0.1" value={s.L} onChange={(e) => set({ L: num(e.target.value) })} /></label>
            <span />
            <label className="wide"><span className="lbl">{t("col_endsY")}</span>{muSel("cmuy", s.muY, "muY")}</label>
            <label className="wide"><span className="lbl">{t("col_endsZ")}</span>{muSel("cmuz", s.muZ, "muZ")}</label>
          </div>
        </fieldset>
        <fieldset>
          <legend><span className="step">2</span>{t("col_forces")}</legend>
          <div className="grid2">
            <label><span className="lbl">{t("col_N")}</span><NumInput id="cN" step="10" value={s.N} onChange={(e) => set({ N: num(e.target.value) })} /></label>
            <label><span className="lbl">{t("col_M")}</span><NumInput id="cM" step="1" value={s.M} onChange={(e) => set({ M: num(e.target.value) })} /></label>
          </div>
          <p className="hint">{t("col_forcesHint")}</p>
        </fieldset>
        <fieldset>
          <legend><span className="step">3</span>{t("section")}</legend>
          <div className="grid2">
            <label><span className="lbl">{t("material")}</span>
              <select id="csteel" value={s.steel} onChange={(e) => set({ steel: e.target.value })}>
                {STEELS.filter((x) => x.code === code).map((x) => <option key={x.id}>{x.id}</option>)}
              </select>
            </label>
            <label><span className="lbl">{t("mode")}</span>
              <select id="cmode" value={s.mode} onChange={(e) => set({ mode: e.target.value as ColumnState["mode"] })}>
                <option value="select">{t("mode_select")}</option><option value="check">{t("mode_check")}</option>
              </select>
            </label>
            <label className="wide"><span className="lbl">{t("family")}</span>
              <select id="cfam" value={s.family} onChange={(e) => set({ family: e.target.value, size: familySections(e.target.value)[0].name })}>
                <FamilyOptions fams={familiesFor("column")} t={t} />
              </select>
            </label>
            {s.mode === "check" && (
              <label className="wide"><span className="lbl">{t("size")}</span>
                <select id="csize" value={s.size} onChange={(e) => set({ size: e.target.value })}>
                  {familySections(s.family).map((x) => <option key={x.name}>{x.name}</option>)}
                </select>
              </label>
            )}
          </div>
        </fieldset>
        <details className="adv">
          <summary>{t("advanced")}<span className="adv-hint">{t("advancedHintCol")}</span></summary>
          <div className="adv-group">
            <div className="grid2">
              <label><span className="lbl">{t("col_muY")}</span><NumInput id="cmuyv" step="0.05" value={s.muY} onChange={(e) => set({ muY: num(e.target.value) })} /></label>
              <label><span className="lbl">{t("col_muZ")}</span><NumInput id="cmuzv" step="0.05" value={s.muZ} onChange={(e) => set({ muZ: num(e.target.value) })} /></label>
              <label className="wide"><span className="lbl">{t("col_Lz")}</span><NumInput id="cLz" step="0.1" placeholder={String(s.L)} value={s.Lz} onChange={(e) => set({ Lz: e.target.value })} /></label>
              {code === "DBN" && <label><span className="lbl">{t("gammaC")}</span><NumInput id="cgc" step="0.05" value={s.gammaC} onChange={(e) => set({ gammaC: num(e.target.value) })} /></label>}
              {code === "DBN" && <label><span className="lbl">{t("gammaN")}</span><NumInput id="cgn" step="0.05" value={s.gammaN} onChange={(e) => set({ gammaN: num(e.target.value) })} /></label>}
            </div>
          </div>
        </details>
      </aside>

      <section className="output">
        <div className="tabs" role="tablist">
          {(["results", "report"] as const).map((k) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{t(`tab_${k}`)}</button>
          ))}
        </div>
        {"error" in calc && calc.error && <p className="error">{calc.error}</p>}
        {!r && !("error" in calc && calc.error) && <p className="error">{t("noFit")}</p>}
        {r && tab === "results" && (
          <div className="results">
            <Summary r={r} t={t} steel={s.steel} />
            <div className="panel two-col">
              <div><h3>{t("scheme")}</h3><ColumnScheme mu={s.muY} L={s.L} N={s.N} M={s.M} /></div>
              <div><h3>{t("section")}</h3><SectionDrawing s={r.section} code={code} /></div>
            </div>
            <div className="panel"><h3>{t("results")}</h3><CheckList checks={r.member.checks} t={t} /></div>
            <div className="panel"><h3>{t("props")}</h3><SectionProps r={r} code={code} t={t} /></div>
            {calc.tried && <TriedList tried={calc.tried} t={t} />}
          </div>
        )}
        {r && tab === "report" && (
          <div className="report-wrap">
            <div className="report-tools">
              <input id="cobj" placeholder={t("objPlaceholder")} value={s.obj} onChange={(e) => set({ obj: e.target.value })} />
              <input id="celem" placeholder={t("colPlaceholder")} value={s.elem} onChange={(e) => set({ elem: e.target.value })} />
              <button className="primary" onClick={() => window.print()}>{t("print")}</button>
            </div>
            <article className="report">
              <header className="rep-head">
                <h1>{t("rep_titleCol")}</h1>
                <dl>
                  <div><dt>{t("rep_object")}</dt><dd>{s.obj || "—"}</dd></div>
                  <div><dt>{t("rep_element")}</dt><dd>{s.elem || "—"}</dd></div>
                  <div><dt>{t("rep_code")}</dt><dd>{code === "DBN" ? "ДБН В.2.6-198:2014" : "EN 1993-1-1"}</dd></div>
                  <div><dt>{t("rep_date")}</dt><dd>{new Date().toLocaleDateString()}</dd></div>
                </dl>
              </header>
              <h2>{t("rep_summary")}</h2>
              <Summary r={r} t={t} steel={s.steel} />
              <h2>{t("rep_inputs")}</h2>
              <table className="rep-table"><tbody>
                <tr><td>{t("col_L")}</td><td>{s.L} m</td></tr>
                <tr><td>{t("col_lef")}</td><td>l<sub>ef,x</sub> = {s.muY}·{s.L} = {(r.Lcr_y / 1000).toFixed(2)} m; l<sub>ef,y</sub> = {(r.Lcr_z / 1000).toFixed(2)} m</td></tr>
                <tr><td>{t("col_forces")}</td><td>N = {s.N} kN{s.M ? `; M = ${s.M} kN·m` : ""}</td></tr>
                <tr><td>{t("rep_steel")}</td><td>{s.steel}</td></tr>
              </tbody></table>
              <h2>{t("rep_checks")}</h2>
              <CheckList checks={r.member.checks} t={t} />
              <h2>{t("rep_section")}</h2>
              <SectionProps r={r} code={code} t={t} />
              <p className="disclaimer">{t("disclaimer")}</p>
            </article>
          </div>
        )}
        <p className="disclaimer">{t("disclaimer")}</p>
      </section>
    </main>
  );
}
