import { useMemo, useState } from "react";
import {
  BeamDesignInput, CodeId, DEFAULT_FACTORS, designBeam, FAMILIES, familySections, findSection,
  selectBeam, STEELS, SupportType, UserLoad,
} from "@structcalc/core";
import { Lang, LANGS, makeT } from "./i18n";
import { Scheme } from "./Scheme";
import { CheckList, Diagrams, pct, SectionProps, Summary, utilState } from "./Results";
import { Report } from "./Report";
import { CollectorState, initialCollector, LoadCollector } from "./LoadCollector";

type Mode = "check" | "select";
type Tab = "results" | "report";

interface State {
  lang: Lang; code: CodeId; steel: string; spans: number[]; supports: SupportType[]; loads: UserLoad[];
  selfWeight: boolean; gammaG: number; gammaQ: number; gammaC: number; gammaN: number; restraints: 0 | 1 | 2;
  restrained: boolean; loadAt: "top" | "center" | "bottom"; LcrLT: string; deflLimit: number;
  mode: Mode; family: string; size: string; useAxial: boolean; NEd: number; Lcr_y: number; Lcr_z: number;
  obj: string; elem: string; lc: CollectorState;
}

const initial: State = {
  lang: "uk", code: "DBN", steel: "C245", spans: [6], supports: ["pin", "pin"],
  loads: [{ type: "udl", cat: "G", q: 3 }, { type: "udl", cat: "Q", q: 5 }],
  selfWeight: true, ...DEFAULT_FACTORS.DBN, gammaC: 1.0, gammaN: 1.0, restraints: 0, restrained: false, loadAt: "top", LcrLT: "",
  deflLimit: 0, mode: "select", family: "IPE", size: "IPE 270", useAxial: false, NEd: 0, Lcr_y: 6, Lcr_z: 6,
  obj: "", elem: "", lc: initialCollector,
};

const num = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(",", ".")));

function loadState(): State {
  try {
    const raw = localStorage.getItem("structcalc.beam");
    if (raw) { const o = JSON.parse(raw); return { ...initial, ...o, lc: { ...initialCollector, ...(o.lc ?? {}) } }; }
  } catch { /* хранилище недоступно */ }
  return initial;
}

export function App() {
  const [s, setS] = useState<State>(loadState);
  const [tab, setTab] = useState<Tab>("results");
  const set = (p: Partial<State>) => setS((o) => {
    const n = { ...o, ...p };
    try { localStorage.setItem("structcalc.beam", JSON.stringify(n)); } catch { /* ignore */ }
    return n;
  });
  const t = makeT(s.lang);

  const input: BeamDesignInput = useMemo(() => ({
    code: s.code, steel: s.steel, spans: s.spans, supports: s.supports, loads: s.loads, selfWeight: s.selfWeight,
    gammaG: s.gammaG, gammaQ: s.gammaQ, gammaC: s.gammaC, gammaN: s.gammaN,
    ltb: { restrained: s.restrained, loadAt: s.loadAt, restraints: s.restraints, Lcr: s.LcrLT.trim() ? num(s.LcrLT) : undefined },
    deflectionLimit: s.deflLimit,
    axial: s.useAxial ? { NEd: s.NEd, Lcr_y: s.Lcr_y, Lcr_z: s.Lcr_z } : undefined,
  }), [s]);

  const calc = useMemo(() => {
    try {
      if (s.mode === "select") {
        const sel = selectBeam(input, s.family);
        return { result: sel.best, tried: sel.tried, error: undefined as string | undefined };
      }
      const sec = findSection(s.family, s.size) ?? familySections(s.family)[0];
      return { result: designBeam(input, sec), tried: undefined, error: undefined };
    } catch (e) {
      return { result: undefined, tried: undefined, error: String((e as Error).message) };
    }
  }, [input, s.mode, s.family, s.size]);

  const setCode = (code: CodeId) => set({ code, steel: code === "DBN" ? "C245" : "S235", ...DEFAULT_FACTORS[code] });
  const updateSpan = (i: number, v: number) => set({ spans: s.spans.map((x, k) => (k === i ? v : x)) });
  const updateSupport = (i: number, v: SupportType) => set({ supports: s.supports.map((x, k) => (k === i ? v : x)) });
  const updateLoad = (i: number, p: Partial<UserLoad>) => set({ loads: s.loads.map((l, k) => (k === i ? ({ ...l, ...p } as UserLoad) : l)) });
  const total = s.spans.reduce((a, b) => a + b, 0);
  const r = calc.result;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M3 6h18M3 18h18M12 6v12" className="brand-mark" /></svg>
          <span>StructCalc</span>
          <span className="module">{t("appTitle").split("—")[1]?.trim()}</span>
        </div>
        <div className="top-controls">
          <div className="seg" role="group" aria-label={t("code")}>
            {(["DBN", "EN"] as const).map((c) => (
              <button key={c} className={s.code === c ? "on" : ""} onClick={() => setCode(c)}>{c === "DBN" ? "ДБН" : "EN"}</button>
            ))}
          </div>
          <select id="lang" value={s.lang} onChange={(e) => set({ lang: e.target.value as Lang })} aria-label="language">
            {LANGS.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
        </div>
      </header>

      <main className="layout">
        <aside className="inputs">
          <fieldset>
            <legend>{t("scheme")}</legend>
            <div className="spans">
              {s.supports.map((sup, i) => (
                <div key={`s${i}`} className="span-block">
                  <label className="sup">
                    <span className="lbl">{t("support")} {i + 1}</span>
                    <select id={`sup${i}`} value={sup} onChange={(e) => updateSupport(i, e.target.value as SupportType)}>
                      {(["pin", "fixed", "free"] as const).map((o) => <option key={o} value={o}>{t(`sup_${o}`)}</option>)}
                    </select>
                  </label>
                  {i < s.spans.length && (
                    <label className="span-len">
                      <span className="lbl">L{i + 1}, m</span>
                      <input id={`span${i}`} type="number" step="0.1" min="0.1" value={s.spans[i]} onChange={(e) => updateSpan(i, num(e.target.value))} />
                    </label>
                  )}
                </div>
              ))}
            </div>
            <div className="row">
              <button className="ghost" onClick={() => set({ spans: [...s.spans, s.spans[s.spans.length - 1]], supports: [...s.supports, "pin"] })}>{t("addSpan")}</button>
              {s.spans.length > 1 && <button className="ghost" onClick={() => set({ spans: s.spans.slice(0, -1), supports: s.supports.slice(0, -1) })}>{t("removeSpan")}</button>}
            </div>
          </fieldset>

          <fieldset>
            <legend>{t("loads")}</legend>
            <div className="load-list">
              {s.loads.map((l, i) => (
                <div key={i} className={`load-card ${l.cat}`}>
                  <div className="load-row">
                    <select id={`lt${i}`} value={l.type} onChange={(e) => {
                      const type = e.target.value as UserLoad["type"];
                      const v = l.type === "udl" ? l.q : l.type === "point" ? l.P : l.M;
                      const nl: UserLoad = type === "udl" ? { type, cat: l.cat, q: v } : type === "point" ? { type, cat: l.cat, P: v, x: total / 2 } : { type, cat: l.cat, M: v, x: 0 };
                      set({ loads: s.loads.map((x, k) => (k === i ? nl : x)) });
                    }}>
                      {(["udl", "point", "moment"] as const).map((o) => <option key={o} value={o}>{t(`load_${o}`)}</option>)}
                    </select>
                    <select id={`lc${i}`} value={l.cat} onChange={(e) => updateLoad(i, { cat: e.target.value as "G" | "Q" })}>
                      <option value="G">{t("cat_G")}</option><option value="Q">{t("cat_Q")}</option>
                    </select>
                    {l.label && <span className="load-tag" title={l.note}>{l.label}{l.gf != null ? ` · γf ${l.gf.toFixed(2)}` : ""}</span>}
                    <button className="icon" aria-label="×" onClick={() => set({ loads: s.loads.filter((_, k) => k !== i) })}>×</button>
                  </div>
                  <div className="load-row">
                    <label><span className="lbl">{t("value")}</span>
                      <input id={`lv${i}`} type="number" step="0.1" value={l.type === "udl" ? l.q : l.type === "point" ? l.P : l.M}
                        onChange={(e) => updateLoad(i, (l.type === "udl" ? { q: num(e.target.value) } : l.type === "point" ? { P: num(e.target.value) } : { M: num(e.target.value) }) as Partial<UserLoad>)} />
                    </label>
                    {l.type === "udl" ? (
                      <>
                        <label><span className="lbl">{t("from")}</span><input id={`lf${i}`} type="number" step="0.1" placeholder="0" value={l.from ?? ""} onChange={(e) => updateLoad(i, { from: e.target.value === "" ? undefined : num(e.target.value) } as Partial<UserLoad>)} /></label>
                        <label><span className="lbl">{t("to")}</span><input id={`lto${i}`} type="number" step="0.1" placeholder={String(total)} value={l.to ?? ""} onChange={(e) => updateLoad(i, { to: e.target.value === "" ? undefined : num(e.target.value) } as Partial<UserLoad>)} /></label>
                      </>
                    ) : (
                      <label><span className="lbl">{t("position")}</span><input id={`lx${i}`} type="number" step="0.1" value={l.x} onChange={(e) => updateLoad(i, { x: num(e.target.value) } as Partial<UserLoad>)} /></label>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button className="ghost" onClick={() => set({ loads: [...s.loads, { type: "udl", cat: "Q", q: 1 }] })}>{t("addLoad")}</button>
            <label className="check"><input id="sw" type="checkbox" checked={s.selfWeight} onChange={(e) => set({ selfWeight: e.target.checked })} /> {t("selfWeight")}</label>
          </fieldset>

          <LoadCollector code={s.code} c={s.lc} t={t} set={(p) => set({ lc: { ...s.lc, ...p } })} onAdd={(l) => set({ loads: [...s.loads, l] })} />

          <fieldset>
            <legend>{t("section")}</legend>
            <div className="grid2">
              <label><span className="lbl">{t("material")}</span>
                <select id="steel" value={s.steel} onChange={(e) => set({ steel: e.target.value })}>
                  {STEELS.filter((x) => x.code === s.code).map((x) => <option key={x.id}>{x.id}</option>)}
                </select>
              </label>
              <label><span className="lbl">{t("mode")}</span>
                <select id="mode" value={s.mode} onChange={(e) => set({ mode: e.target.value as Mode })}>
                  <option value="select">{t("mode_select")}</option><option value="check">{t("mode_check")}</option>
                </select>
              </label>
              <label className="wide"><span className="lbl">{t("family")}</span>
                <select id="family" value={s.family} onChange={(e) => set({ family: e.target.value, size: familySections(e.target.value)[0].name })}>
                  {FAMILIES.map((f) => <option key={f.id} value={f.id}>{f.id.replace("_", " ")} · {f.standard}</option>)}
                </select>
              </label>
              {s.mode === "check" && (
                <label className="wide"><span className="lbl">{t("size")}</span>
                  <select id="size" value={s.size} onChange={(e) => set({ size: e.target.value })}>
                    {familySections(s.family).map((x) => <option key={x.name}>{x.name}</option>)}
                  </select>
                </label>
              )}
            </div>
          </fieldset>

          <fieldset>
            <legend>{t("factors")}</legend>
            <div className="grid2">
              <label><span className="lbl">{t("gammaG")}</span><input id="gG" type="number" step="0.05" value={s.gammaG} onChange={(e) => set({ gammaG: num(e.target.value) })} /></label>
              <label><span className="lbl">{t("gammaQ")}</span><input id="gQ" type="number" step="0.05" value={s.gammaQ} onChange={(e) => set({ gammaQ: num(e.target.value) })} /></label>
              {s.code === "DBN" && <label><span className="lbl">{t("gammaC")}</span><input id="gC" type="number" step="0.05" value={s.gammaC} onChange={(e) => set({ gammaC: num(e.target.value) })} /></label>}
              {s.code === "DBN" && <label><span className="lbl">{t("gammaN")}</span><input id="gN" type="number" step="0.05" value={s.gammaN} onChange={(e) => set({ gammaN: num(e.target.value) })} /></label>}
              <label className="wide"><span className="lbl">{t("deflLimit")}</span><input id="defl" type="number" value={s.deflLimit} onChange={(e) => set({ deflLimit: num(e.target.value) })} /></label>
            </div>
          </fieldset>

          <fieldset>
            <legend>{t("ltb")}</legend>
            <label className="check"><input id="restr" type="checkbox" checked={s.restrained} onChange={(e) => set({ restrained: e.target.checked })} /> {t("restrained")}</label>
            {!s.restrained && (
              <div className="grid2">
                <label><span className="lbl">{t("loadAt")}</span>
                  <select id="loadAt" value={s.loadAt} onChange={(e) => set({ loadAt: e.target.value as State["loadAt"] })}>
                    {(["top", "center", "bottom"] as const).map((o) => <option key={o} value={o}>{t(`load_${o}`)}</option>)}
                  </select>
                </label>
                <label className="wide"><span className="lbl">{t("restraintsN")}</span>
                  <select id="restraints" value={s.restraints} onChange={(e) => set({ restraints: Number(e.target.value) as 0 | 1 | 2 })}>
                    {([0, 1, 2] as const).map((o) => <option key={o} value={o}>{t(`rest_${o}`)}</option>)}
                  </select>
                </label>
                <label><span className="lbl">{t("LcrLT")}</span><input id="lcrlt" type="number" step="0.1" value={s.LcrLT} onChange={(e) => set({ LcrLT: e.target.value })} /></label>
              </div>
            )}
          </fieldset>

          <fieldset>
            <legend>{t("axial")}</legend>
            <label className="check"><input id="ax" type="checkbox" checked={s.useAxial} onChange={(e) => set({ useAxial: e.target.checked })} /> {t("NEd")}</label>
            {s.useAxial && (
              <div className="grid2">
                <label><span className="lbl">{t("NEd")}</span><input id="ned" type="number" value={s.NEd} onChange={(e) => set({ NEd: num(e.target.value) })} /></label>
                <label><span className="lbl">{t("Lcr_y")}</span><input id="lcy" type="number" step="0.1" value={s.Lcr_y} onChange={(e) => set({ Lcr_y: num(e.target.value) })} /></label>
                <label><span className="lbl">{t("Lcr_z")}</span><input id="lcz" type="number" step="0.1" value={s.Lcr_z} onChange={(e) => set({ Lcr_z: num(e.target.value) })} /></label>
              </div>
            )}
          </fieldset>
        </aside>

        <section className="output">
          <div className="tabs" role="tablist">
            {(["results", "report"] as const).map((k) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{t(`tab_${k}`)}</button>
            ))}
          </div>

          {calc.error && <p className="error">{calc.error}</p>}
          {!r && !calc.error && <p className="error">{t("noFit")}</p>}

          {r && tab === "results" && (
            <div className="results">
              <Summary r={r} t={t} steel={s.steel} />
              <div className="panel">
                <h3>{t("scheme")}</h3>
                <Scheme spans={s.spans} supports={s.supports} loads={s.loads} t={t} />
              </div>
              <div className="panel">
                <h3>{t("diagrams")}</h3>
                <Diagrams r={r} t={t} spans={s.spans} />
                <div className="reactions">
                  {r.uls.reactions.map((x, i) => (
                    <span key={i}>R{i + 1} = <b>{(x.R / 1000).toFixed(2)}</b> kN{x.M ? <> · M = <b>{(x.M / 1e6).toFixed(2)}</b> kN·m</> : null}</span>
                  ))}
                </div>
              </div>
              <div className="panel">
                <h3>{t("results")}</h3>
                <CheckList checks={r.member.checks} t={t} />
              </div>
              <div className="panel">
                <h3>{t("props")}</h3>
                <SectionProps r={r} code={s.code} t={t} />
              </div>
              {calc.tried && (
                <details className="panel">
                  <summary>{t("tried")} ({calc.tried.length})</summary>
                  <div className="tried">
                    {calc.tried.map((x) => (
                      <div key={x.name} className={`tried-row ${utilState(x.util)}`}>
                        <span>{x.name}</span><span>{x.mass.toFixed(1)} kg/m</span><span>{pct(x.util)}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {r && tab === "report" && (
            <div className="report-wrap">
              <div className="report-tools">
                <input id="obj" placeholder={t("objPlaceholder")} value={s.obj} onChange={(e) => set({ obj: e.target.value })} />
                <input id="elem" placeholder={t("elemPlaceholder")} value={s.elem} onChange={(e) => set({ elem: e.target.value })} />
                <button className="primary" onClick={() => window.print()}>{t("print")}</button>
                <span className="hint">{t("printHint")}</span>
              </div>
              <Report r={r} input={input} t={t} obj={s.obj} elem={s.elem} steel={s.steel} code={s.code} />
            </div>
          )}
          <p className="disclaimer">{t("disclaimer")}</p>
        </section>
      </main>
    </div>
  );
}
