import { useDeferredValue, useMemo, useState } from "react";
import { NumInput } from "./NumInput";
import {
  BeamDesignInput, CodeId, DEFAULT_FACTORS, designBeam, familiesFor, familySections, findSection,
  selectBeam, STEELS, SupportType, UserLoad,
} from "@structcalc/core";
import { Scheme } from "./Scheme";
import { CheckList, Combos, Diagrams, SectionProps, Summary } from "./Results";
import { Report } from "./Report";
import { CollectorState, LoadCollector } from "./LoadCollector";
import { TriedList } from "./TriedList";
import { FamilyOptions } from "./SectionModule";

const beamSizes = (f: string) => familySections(f).filter((x) => x.kind === "I" || x.kind === "RHS" || x.kind === "CHS");

type Mode = "check" | "select";
type Tab = "results" | "report";

type LoadKind = "udl" | "trap" | "point" | "moment";
const kindOf = (l: UserLoad): LoadKind => (l.type === "udl" && l.q2 != null ? "trap" : l.type);

export interface BeamState {
  spans: number[]; supports: SupportType[]; springs: number[]; loads: UserLoad[];
  selfWeight: boolean; gammaG: number; gammaQ: number; gammaC: number; gammaN: number; restraints: 0 | 1 | 2;
  restrained: boolean; loadAt: "top" | "center" | "bottom"; LcrLT: string; deflLimit: number;
  mode: Mode; family: string; size: string; useAxial: boolean; NEd: number; Lcr_y: number; Lcr_z: number;
  steel: string; obj: string; elem: string;
}

export const initialBeam: BeamState = {
  steel: "C245", spans: [6], supports: ["pin", "pin"], springs: [],
  loads: [{ type: "udl", cat: "G", q: 3 }, { type: "udl", cat: "Q", q: 5 }],
  selfWeight: true, ...DEFAULT_FACTORS.DBN, gammaC: 1.0, gammaN: 1.0, restraints: 0, restrained: false, loadAt: "top", LcrLT: "",
  deflLimit: 0, mode: "select", family: "IPE", size: "IPE 270", useAxial: false, NEd: 0, Lcr_y: 6, Lcr_z: 6,
  obj: "", elem: "",
};

const num = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(",", ".")));

export function BeamModule({ code, s, set, lc, setLc, t }: {
  code: CodeId; s: BeamState; set: (p: Partial<BeamState>) => void;
  lc: CollectorState; setLc: (p: Partial<CollectorState>) => void; t: (k: string) => string;
}) {
  const [tab, setTab] = useState<Tab>("results");
  const [showLc, setShowLc] = useState(false);
  const [openLoad, setOpenLoad] = useState(-1);

  const input: BeamDesignInput = useMemo(() => ({
    code, steel: s.steel, spans: s.spans, supports: s.supports, springs: s.supports.map((_, i) => s.springs[i] ?? 0), loads: s.loads, selfWeight: s.selfWeight,
    gammaG: s.gammaG, gammaQ: s.gammaQ, gammaC: s.gammaC, gammaN: s.gammaN,
    ltb: { restrained: s.restrained, loadAt: s.loadAt, restraints: s.restraints, Lcr: s.LcrLT.trim() ? num(s.LcrLT) : undefined },
    deflectionLimit: s.deflLimit,
    axial: s.useAxial ? { NEd: s.NEd, Lcr_y: s.Lcr_y, Lcr_z: s.Lcr_z } : undefined,
  }), [s]);

  const dInput = useDeferredValue(input);
  const calc = useMemo(() => {
    try {
      if (s.mode === "select") {
        const sel = selectBeam(dInput, s.family);
        return { result: sel.best, tried: sel.tried, error: undefined as string | undefined };
      }
      const sec = findSection(s.family, s.size) ?? beamSizes(s.family)[0];
      return { result: designBeam(dInput, sec), tried: undefined, error: undefined };
    } catch (e) {
      return { result: undefined, tried: undefined, error: String((e as Error).message) };
    }
  }, [dInput, s.mode, s.family, s.size]);

  const updateSpan = (i: number, v: number) => set({ spans: s.spans.map((x, k) => (k === i ? v : x)) });
  const updateSupport = (i: number, v: SupportType) => {
    const springs = [...s.springs];
    if (v === "spring" && !springs[i]) springs[i] = 10000;
    set({ supports: s.supports.map((x, k) => (k === i ? v : x)), springs });
  };
  const updateLoad = (i: number, p: Partial<UserLoad>) => set({ loads: s.loads.map((l, k) => (k === i ? ({ ...l, ...p } as UserLoad) : l)) });
  const total = s.spans.reduce((a, b) => a + b, 0);
  const r = calc.result;

  return (
    <>
      <main className="layout">
        <aside className="inputs">
          <fieldset>
            <legend><span className="step">1</span>{t("scheme")}</legend>
            <div className="spans">
              {s.supports.map((sup, i) => (
                <div key={`s${i}`} className="span-block">
                  <label className="sup">
                    <span className="lbl">{t("support")} {i + 1}</span>
                    <select id={`sup${i}`} value={sup} onChange={(e) => updateSupport(i, e.target.value as SupportType)}>
                      {(["pin", "fixed", "free", "slide", "spring"] as const).map((o) => <option key={o} value={o}>{t(`sup_${o}`)}</option>)}
                    </select>
                  </label>
                  {sup === "spring" && (
                    <label className="span-len">
                      <span className="lbl">k, kN/m</span>
                      <NumInput id={`k${i}`} step="100" min="0" value={s.springs[i] ?? 0}
                        onChange={(e) => { const k = [...s.springs]; k[i] = num(e.target.value); set({ springs: k }); }} />
                    </label>
                  )}
                  {i < s.spans.length && (
                    <label className="span-len">
                      <span className="lbl">L{i + 1}, m</span>
                      <NumInput id={`span${i}`} step="0.1" min="0.1" value={s.spans[i]} onChange={(e) => updateSpan(i, num(e.target.value))} />
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
            <legend><span className="step">2</span>{t("loads")}</legend>
            <div className="load-list">
              {s.loads.map((l, i) => (
                <div key={i} className={`load-card ${l.cat}`}>
                  <div className="load-head">
                    <span className="load-name">{l.label ?? `${l.cat}${i + 1}`}</span>
                    {l.gf != null && <span className="load-tag" title={l.note}>γf {l.gf.toFixed(2)}{l.gfe != null ? ` · γfe ${l.gfe.toFixed(2)}` : ""}</span>}
                    {l.group && <span className="load-tag">{t("group")}: {l.group}</span>}
                  </div>
                  <div className="load-row">
                    <select id={`lt${i}`} value={kindOf(l)} onChange={(e) => {
                      const kind = e.target.value as LoadKind;
                      const v = l.type === "udl" ? l.q : l.type === "point" ? l.P : l.M;
                      const meta = { cat: l.cat, label: l.label, gf: l.gf, gfe: l.gfe, note: l.note };
                      const nl: UserLoad = kind === "udl" ? { ...meta, type: "udl", q: v }
                        : kind === "trap" ? { ...meta, type: "udl", q: 0, q2: v || 1 }
                        : kind === "point" ? { ...meta, type: "point", P: v, x: total / 2 } : { ...meta, type: "moment", M: v, x: 0 };
                      set({ loads: s.loads.map((x, k) => (k === i ? nl : x)) });
                    }}>
                      {(["udl", "trap", "point", "moment"] as const).map((o) => <option key={o} value={o}>{t(`load_${o}`)}</option>)}
                    </select>
                    <select id={`lc${i}`} value={l.cat} onChange={(e) => updateLoad(i, { cat: e.target.value as UserLoad["cat"] })}>
                      {(["G", "L", "Q", "A"] as const).map((c) => <option key={c} value={c}>{t(`cat_${c}`)}</option>)}
                    </select>
                    <button className="icon more" aria-label={t("loadMore")} title={t("loadMore")} onClick={() => setOpenLoad(openLoad === i ? -1 : i)}>⋯</button>
                    <button className="icon" aria-label="×" onClick={() => set({ loads: s.loads.filter((_, k) => k !== i) })}>×</button>
                  </div>
                  <div className="load-row">
                    {l.type === "udl" && l.q2 != null ? (
                      <>
                        <label><span className="lbl">q₁</span><NumInput id={`lv${i}`} step="0.1" value={l.q} onChange={(e) => updateLoad(i, { q: num(e.target.value) } as Partial<UserLoad>)} /></label>
                        <label><span className="lbl">q₂</span><NumInput id={`lv2${i}`} step="0.1" value={l.q2} onChange={(e) => updateLoad(i, { q2: num(e.target.value) } as Partial<UserLoad>)} /></label>
                      </>
                    ) : (
                    <label><span className="lbl">{t("value")}</span>
                      <NumInput id={`lv${i}`} step="0.1" value={l.type === "udl" ? l.q : l.type === "point" ? l.P : l.M}
                        onChange={(e) => updateLoad(i, (l.type === "udl" ? { q: num(e.target.value) } : l.type === "point" ? { P: num(e.target.value) } : { M: num(e.target.value) }) as Partial<UserLoad>)} />
                    </label>
                    )}
                    {l.type === "udl" ? (
                      <>
                        <label><span className="lbl">{t("from")}</span><NumInput id={`lf${i}`} step="0.1" placeholder="0" value={l.from ?? ""} onChange={(e) => updateLoad(i, { from: e.target.value === "" ? undefined : num(e.target.value) } as Partial<UserLoad>)} /></label>
                        <label><span className="lbl">{t("to")}</span><NumInput id={`lto${i}`} step="0.1" placeholder={String(total)} value={l.to ?? ""} onChange={(e) => updateLoad(i, { to: e.target.value === "" ? undefined : num(e.target.value) } as Partial<UserLoad>)} /></label>
                      </>
                    ) : (
                      <label><span className="lbl">{t("position")}</span><NumInput id={`lx${i}`} step="0.1" value={l.x} onChange={(e) => updateLoad(i, { x: num(e.target.value) } as Partial<UserLoad>)} /></label>
                    )}
                  </div>
                  {openLoad === i && (
                    <div className="load-more grid2">
                      <label><span className="lbl">{t("label")}</span><input id={`ln${i}`} value={l.label ?? ""} placeholder={`${l.cat}${i + 1}`} onChange={(e) => updateLoad(i, { label: e.target.value || undefined })} /></label>
                      <label><span className="lbl">{t("group")}</span><input id={`lg${i}`} value={l.group ?? ""} placeholder="—" onChange={(e) => updateLoad(i, { group: e.target.value || undefined })} /></label>
                      <label><span className="lbl">γf</span><NumInput id={`lgf${i}`} step="0.05" value={l.gf ?? ""} placeholder={String(l.cat === "G" ? s.gammaG : l.cat === "A" ? 1 : s.gammaQ)} onChange={(e) => updateLoad(i, { gf: e.target.value === "" ? undefined : num(e.target.value) })} /></label>
                      <label><span className="lbl">{code === "DBN" ? "γfe" : "ψ0"}</span>
                        {code === "DBN"
                          ? <NumInput id={`lgfe${i}`} step="0.05" value={l.gfe ?? ""} placeholder="1" onChange={(e) => updateLoad(i, { gfe: e.target.value === "" ? undefined : num(e.target.value) })} />
                          : <NumInput id={`lpsi${i}`} step="0.1" value={l.psi0 ?? ""} placeholder="0.7" onChange={(e) => updateLoad(i, { psi0: e.target.value === "" ? undefined : num(e.target.value) })} />}
                      </label>
                      <p className="hint wide">{t("groupHint")}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <button className="ghost" onClick={() => set({ loads: [...s.loads, { type: "udl", cat: "Q", q: 1 }] })}>{t("addLoad")}</button>
            <label className="check"><input id="sw" type="checkbox" checked={s.selfWeight} onChange={(e) => set({ selfWeight: e.target.checked })} /> {t("selfWeight")}</label>
            <button className={`ghost ${showLc ? "on" : ""}`} onClick={() => setShowLc(!showLc)}>{showLc ? t("lc_hide") : t("lc_open")}</button>
          </fieldset>

          {showLc && <LoadCollector code={code} c={lc} t={t} set={setLc} onAdd={(l) => set({ loads: [...s.loads, l] })} />}

          <fieldset>
            <legend><span className="step">3</span>{t("section")}</legend>
            <div className="grid2">
              <label><span className="lbl">{t("material")}</span>
                <select id="steel" value={s.steel} onChange={(e) => set({ steel: e.target.value })}>
                  {STEELS.filter((x) => x.code === code).map((x) => <option key={x.id}>{x.id}</option>)}
                </select>
              </label>
              <label><span className="lbl">{t("mode")}</span>
                <select id="mode" value={s.mode} onChange={(e) => set({ mode: e.target.value as Mode })}>
                  <option value="select">{t("mode_select")}</option><option value="check">{t("mode_check")}</option>
                </select>
              </label>
              <label className="wide"><span className="lbl">{t("family")}</span>
                <select id="family" value={s.family} onChange={(e) => set({ family: e.target.value, size: beamSizes(e.target.value)[0]?.name ?? "" })}>
                  <FamilyOptions fams={familiesFor("beam")} t={t} />
                </select>
              </label>
              {s.mode === "check" && (
                <label className="wide"><span className="lbl">{t("size")}</span>
                  <select id="size" value={s.size} onChange={(e) => set({ size: e.target.value })}>
                    {beamSizes(s.family).map((x) => <option key={x.name}>{x.name}</option>)}
                  </select>
                </label>
              )}
            </div>
          </fieldset>

          <details className="adv">
            <summary>{t("advanced")}<span className="adv-hint">{t("advancedHint")}</span></summary>
          <div className="adv-group">
            <h4>{t("factors")}</h4>
            <div className="grid2">
              <label><span className="lbl">{t("gammaG")}</span><NumInput id="gG" step="0.05" value={s.gammaG} onChange={(e) => set({ gammaG: num(e.target.value) })} /></label>
              <label><span className="lbl">{t("gammaQ")}</span><NumInput id="gQ" step="0.05" value={s.gammaQ} onChange={(e) => set({ gammaQ: num(e.target.value) })} /></label>
              {code === "DBN" && <label><span className="lbl">{t("gammaC")}</span><NumInput id="gC" step="0.05" value={s.gammaC} onChange={(e) => set({ gammaC: num(e.target.value) })} /></label>}
              {code === "DBN" && <label><span className="lbl">{t("gammaN")}</span><NumInput id="gN" step="0.05" value={s.gammaN} onChange={(e) => set({ gammaN: num(e.target.value) })} /></label>}
              <label className="wide"><span className="lbl">{t("deflLimit")}</span><NumInput id="defl" value={s.deflLimit} onChange={(e) => set({ deflLimit: num(e.target.value) })} /></label>
            </div>
          </div>

          <div className="adv-group">
            <h4>{t("ltb")}</h4>
            <label className="check"><input id="restr" type="checkbox" checked={s.restrained} onChange={(e) => set({ restrained: e.target.checked })} /> {t("restrained")}</label>
            {!s.restrained && (
              <div className="grid2">
                <label><span className="lbl">{t("loadAt")}</span>
                  <select id="loadAt" value={s.loadAt} onChange={(e) => set({ loadAt: e.target.value as BeamState["loadAt"] })}>
                    {(["top", "center", "bottom"] as const).map((o) => <option key={o} value={o}>{t(`load_${o}`)}</option>)}
                  </select>
                </label>
                <label className="wide"><span className="lbl">{t("restraintsN")}</span>
                  <select id="restraints" value={s.restraints} onChange={(e) => set({ restraints: Number(e.target.value) as 0 | 1 | 2 })}>
                    {([0, 1, 2] as const).map((o) => <option key={o} value={o}>{t(`rest_${o}`)}</option>)}
                  </select>
                </label>
                <label><span className="lbl">{t("LcrLT")}</span><NumInput id="lcrlt" step="0.1" value={s.LcrLT} onChange={(e) => set({ LcrLT: e.target.value })} /></label>
              </div>
            )}
          </div>

          <div className="adv-group">
            <h4>{t("axial")}</h4>
            <label className="check"><input id="ax" type="checkbox" checked={s.useAxial} onChange={(e) => set({ useAxial: e.target.checked })} /> {t("NEd")}</label>
            {s.useAxial && (
              <div className="grid2">
                <label><span className="lbl">{t("NEd")}</span><NumInput id="ned" value={s.NEd} onChange={(e) => set({ NEd: num(e.target.value) })} /></label>
                <label><span className="lbl">{t("Lcr_y")}</span><NumInput id="lcy" step="0.1" value={s.Lcr_y} onChange={(e) => set({ Lcr_y: num(e.target.value) })} /></label>
                <label><span className="lbl">{t("Lcr_z")}</span><NumInput id="lcz" step="0.1" value={s.Lcr_z} onChange={(e) => set({ Lcr_z: num(e.target.value) })} /></label>
              </div>
            )}
          </div>
          </details>
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
                <h3>{t("combos")}</h3>
                <Combos r={r} t={t} />
              </div>
              <div className="panel">
                <h3>{t("results")}</h3>
                <CheckList checks={r.member.checks} t={t} />
              </div>
              <div className="panel">
                <h3>{t("props")}</h3>
                <SectionProps r={r} code={code} t={t} />
              </div>
              {calc.tried && <TriedList tried={calc.tried} t={t} />}
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
              <Report r={r} input={input} t={t} obj={s.obj} elem={s.elem} steel={s.steel} code={code} />
            </div>
          )}
          <p className="disclaimer">{t("disclaimer")}</p>
        </section>
      </main>
    </>
  );
}
