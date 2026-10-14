import { useMemo, useState } from "react";
import {
  BeamDesignInput, BeamDesignResult, CodeId, DEFAULT_FACTORS, designBeam, FAMILIES, familySections, findSection,
  selectBeam, SelectionResult, STEELS, SupportType, UserLoad,
} from "@structcalc/core";
import { Lang, LANGS, makeT } from "./i18n";
import { Diagram } from "./Diagram";

type Mode = "check" | "select";

interface State {
  lang: Lang;
  code: CodeId;
  steel: string;
  spans: number[];
  supports: SupportType[];
  loads: UserLoad[];
  selfWeight: boolean;
  gammaG: number;
  gammaQ: number;
  gammaC: number;
  restrained: boolean;
  loadAt: "top" | "center" | "bottom";
  LcrLT: string;
  deflLimit: number;
  mode: Mode;
  family: string;
  size: string;
  useAxial: boolean;
  NEd: number;
  Lcr_y: number;
  Lcr_z: number;
}

const initial: State = {
  lang: "uk", code: "DBN", steel: "C245", spans: [6], supports: ["pin", "pin"],
  loads: [{ type: "udl", cat: "G", q: 3 }, { type: "udl", cat: "Q", q: 5 }],
  selfWeight: true, ...DEFAULT_FACTORS.DBN, gammaC: 1.0, restrained: false, loadAt: "top", LcrLT: "",
  deflLimit: 200, mode: "select", family: "IPE", size: "IPE 270", useAxial: false, NEd: 0, Lcr_y: 6, Lcr_z: 6,
};

const num = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(",", ".")));

export function App() {
  const [s, setS] = useState<State>(initial);
  const set = (p: Partial<State>) => setS((o) => ({ ...o, ...p }));
  const t = makeT(s.lang);

  const calc = useMemo(() => {
    const input: BeamDesignInput = {
      code: s.code, steel: s.steel, spans: s.spans, supports: s.supports, loads: s.loads, selfWeight: s.selfWeight,
      gammaG: s.gammaG, gammaQ: s.gammaQ, gammaC: s.gammaC,
      ltb: { restrained: s.restrained, loadAt: s.loadAt, Lcr: s.LcrLT.trim() ? num(s.LcrLT) : undefined },
      deflectionLimit: s.deflLimit,
      axial: s.useAxial ? { NEd: s.NEd, Lcr_y: s.Lcr_y, Lcr_z: s.Lcr_z } : undefined,
    };
    try {
      if (s.mode === "select") {
        const sel: SelectionResult = selectBeam(input, s.family);
        return { result: sel.best, tried: sel.tried, error: undefined as string | undefined };
      }
      const sec = findSection(s.family, s.size) ?? familySections(s.family)[0];
      return { result: designBeam(input, sec), tried: undefined, error: undefined };
    } catch (e) {
      return { result: undefined, tried: undefined, error: String((e as Error).message) };
    }
  }, [s]);

  const setCode = (code: CodeId) =>
    set({ code, steel: code === "DBN" ? "C245" : "S235", ...DEFAULT_FACTORS[code] });

  const updateSpan = (i: number, v: number) => set({ spans: s.spans.map((x, k) => (k === i ? v : x)) });
  const updateSupport = (i: number, v: SupportType) => set({ supports: s.supports.map((x, k) => (k === i ? v : x)) });
  const updateLoad = (i: number, p: Partial<UserLoad>) =>
    set({ loads: s.loads.map((l, k) => (k === i ? ({ ...l, ...p } as UserLoad) : l)) });

  const total = s.spans.reduce((a, b) => a + b, 0);
  const r = calc.result;

  return (
    <div className="app">
      <header>
        <h1>{t("appTitle")}</h1>
        <div className="row">
          <label>{t("code")}{" "}
            <select value={s.code} onChange={(e) => setCode(e.target.value as CodeId)}>
              <option value="DBN">{t("code_DBN")}</option>
              <option value="EN">{t("code_EN")}</option>
            </select>
          </label>
          <select value={s.lang} onChange={(e) => set({ lang: e.target.value as Lang })} aria-label="language">
            {LANGS.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
        </div>
      </header>

      <main>
        <section className="inputs noprint">
          <h2>{t("scheme")}</h2>
          <div className="spans">
            {s.supports.map((sup, i) => (
              <div key={`s${i}`} className="spanrow">
                <select value={sup} onChange={(e) => updateSupport(i, e.target.value as SupportType)}>
                  {(["pin", "fixed", "free"] as const).map((o) => <option key={o} value={o}>{t(`sup_${o}`)}</option>)}
                </select>
                {i < s.spans.length && (
                  <label>L{i + 1}, m <input type="number" step="0.1" value={s.spans[i]} onChange={(e) => updateSpan(i, num(e.target.value))} /></label>
                )}
              </div>
            ))}
            <div className="row">
              <button onClick={() => set({ spans: [...s.spans, s.spans[s.spans.length - 1]], supports: [...s.supports, "pin"] })}>{t("addSpan")}</button>
              {s.spans.length > 1 && (
                <button onClick={() => set({ spans: s.spans.slice(0, -1), supports: s.supports.slice(0, -1) })}>{t("removeSpan")}</button>
              )}
            </div>
          </div>

          <h2>{t("loads")}</h2>
          <table className="loads">
            <tbody>
              {s.loads.map((l, i) => (
                <tr key={i}>
                  <td>
                    <select value={l.type} onChange={(e) => {
                      const type = e.target.value as UserLoad["type"];
                      const v = l.type === "udl" ? l.q : l.type === "point" ? l.P : l.M;
                      const nl: UserLoad = type === "udl" ? { type, cat: l.cat, q: v } : type === "point" ? { type, cat: l.cat, P: v, x: total / 2 } : { type, cat: l.cat, M: v, x: 0 };
                      set({ loads: s.loads.map((x, k) => (k === i ? nl : x)) });
                    }}>
                      {(["udl", "point", "moment"] as const).map((o) => <option key={o} value={o}>{t(`load_${o}`)}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={l.cat} onChange={(e) => updateLoad(i, { cat: e.target.value as "G" | "Q" })}>
                      <option value="G">{t("cat_G")}</option><option value="Q">{t("cat_Q")}</option>
                    </select>
                  </td>
                  <td>
                    <input type="number" step="0.1" value={l.type === "udl" ? l.q : l.type === "point" ? l.P : l.M}
                      onChange={(e) => updateLoad(i, l.type === "udl" ? { q: num(e.target.value) } : l.type === "point" ? { P: num(e.target.value) } : { M: num(e.target.value) } as Partial<UserLoad>)} />
                  </td>
                  <td>
                    {l.type === "udl" ? (
                      <>
                        <input type="number" step="0.1" placeholder={t("from")} value={l.from ?? ""} onChange={(e) => updateLoad(i, { from: e.target.value === "" ? undefined : num(e.target.value) } as Partial<UserLoad>)} />
                        <input type="number" step="0.1" placeholder={t("to")} value={l.to ?? ""} onChange={(e) => updateLoad(i, { to: e.target.value === "" ? undefined : num(e.target.value) } as Partial<UserLoad>)} />
                      </>
                    ) : (
                      <input type="number" step="0.1" title={t("position")} value={l.x} onChange={(e) => updateLoad(i, { x: num(e.target.value) } as Partial<UserLoad>)} />
                    )}
                  </td>
                  <td><button onClick={() => set({ loads: s.loads.filter((_, k) => k !== i) })}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={() => set({ loads: [...s.loads, { type: "udl", cat: "Q", q: 1 }] })}>{t("addLoad")}</button>
          <label className="check"><input type="checkbox" checked={s.selfWeight} onChange={(e) => set({ selfWeight: e.target.checked })} /> {t("selfWeight")}</label>

          <h2>{t("factors")}</h2>
          <div className="grid">
            <label>{t("gammaG")} <input type="number" step="0.05" value={s.gammaG} onChange={(e) => set({ gammaG: num(e.target.value) })} /></label>
            <label>{t("gammaQ")} <input type="number" step="0.05" value={s.gammaQ} onChange={(e) => set({ gammaQ: num(e.target.value) })} /></label>
            {s.code === "DBN" && <label>{t("gammaC")} <input type="number" step="0.05" value={s.gammaC} onChange={(e) => set({ gammaC: num(e.target.value) })} /></label>}
            <label>{t("deflLimit")} <input type="number" value={s.deflLimit} onChange={(e) => set({ deflLimit: num(e.target.value) })} /></label>
          </div>

          <h2>{t("section")}</h2>
          <div className="grid">
            <label>{t("material")}
              <select value={s.steel} onChange={(e) => set({ steel: e.target.value })}>
                {STEELS.filter((x) => x.code === s.code).map((x) => <option key={x.id}>{x.id}</option>)}
              </select>
            </label>
            <label>{t("mode")}
              <select value={s.mode} onChange={(e) => set({ mode: e.target.value as Mode })}>
                <option value="select">{t("mode_select")}</option><option value="check">{t("mode_check")}</option>
              </select>
            </label>
            <label>{t("family")}
              <select value={s.family} onChange={(e) => set({ family: e.target.value, size: familySections(e.target.value)[0].name })}>
                {FAMILIES.map((f) => <option key={f.id} value={f.id}>{f.id.replace("_", " ")} ({f.standard})</option>)}
              </select>
            </label>
            {s.mode === "check" && (
              <label>{t("size")}
                <select value={s.size} onChange={(e) => set({ size: e.target.value })}>
                  {familySections(s.family).map((x) => <option key={x.name}>{x.name}</option>)}
                </select>
              </label>
            )}
          </div>

          <h2>{t("ltb")}</h2>
          <label className="check"><input type="checkbox" checked={s.restrained} onChange={(e) => set({ restrained: e.target.checked })} /> {t("restrained")}</label>
          {!s.restrained && (
            <div className="grid">
              <label>{t("loadAt")}
                <select value={s.loadAt} onChange={(e) => set({ loadAt: e.target.value as State["loadAt"] })}>
                  {(["top", "center", "bottom"] as const).map((o) => <option key={o} value={o}>{t(`load_${o}`)}</option>)}
                </select>
              </label>
              <label>{t("LcrLT")} <input type="number" step="0.1" value={s.LcrLT} onChange={(e) => set({ LcrLT: e.target.value })} /></label>
            </div>
          )}

          <h2>{t("axial")}</h2>
          <label className="check"><input type="checkbox" checked={s.useAxial} onChange={(e) => set({ useAxial: e.target.checked })} /> {t("NEd")}</label>
          {s.useAxial && (
            <div className="grid">
              <label>{t("NEd")} <input type="number" value={s.NEd} onChange={(e) => set({ NEd: num(e.target.value) })} /></label>
              <label>{t("Lcr_y")} <input type="number" step="0.1" value={s.Lcr_y} onChange={(e) => set({ Lcr_y: num(e.target.value) })} /></label>
              <label>{t("Lcr_z")} <input type="number" step="0.1" value={s.Lcr_z} onChange={(e) => set({ Lcr_z: num(e.target.value) })} /></label>
            </div>
          )}
        </section>

        <section className="results">
          <h2>{t("results")}</h2>
          {calc.error && <p className="bad">{calc.error}</p>}
          {!r && !calc.error && <p className="bad">{t("noFit")}</p>}
          {r && <Results r={r} t={t} code={s.code} steel={s.steel} />}
          {calc.tried && (
            <details>
              <summary>{t("tried")}</summary>
              <table className="small">
                <tbody>
                  {calc.tried.map((x) => (
                    <tr key={x.name}><td>{x.name}</td><td>{x.mass.toFixed(1)} kg/m</td><td className={x.util <= 1 ? "good" : "bad"}>{Number.isFinite(x.util) ? x.util.toFixed(2) : "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          <p className="disclaimer">{t("disclaimer")}</p>
        </section>
      </main>
    </div>
  );
}

function Results({ r, t, code, steel }: { r: BeamDesignResult; t: (k: string) => string; code: CodeId; steel: string }) {
  const sec = r.section;
  const util = r.member.maxUtil;
  const ax = code === "DBN" ? { y: "x", z: "y" } : { y: "y", z: "z" };
  return (
    <>
      <div className={`summary ${r.member.ok ? "okbox" : "failbox"}`}>
        <strong>{sec.name}</strong> · {steel} · {sec.mass.toFixed(1)} kg/m — {t("util")}: <strong>{Number.isFinite(util) ? util.toFixed(2) : "—"}</strong>
        <div>{r.member.ok ? t("ok") : t("fail")}</div>
        {sec.approx && <div className="note">{t(`note_${sec.approx}`)}</div>}
      </div>

      <table className="checks">
        <thead><tr><th>{t("check")}</th><th>{t("formula")}</th><th>{t("subst")}</th><th>{t("util")}</th><th>{t("clause")}</th></tr></thead>
        <tbody>
          {r.member.checks.map((c, i) => (
            <tr key={i}>
              <td>{t(`chk_${c.key}`)}{c.notes?.map((n) => <div key={n} className="note">{t(`note_${n}`)}</div>)}</td>
              <td className="mono">{c.formula}</td>
              <td className="mono">{c.subst}</td>
              <td className={c.ok ? "good" : "bad"}>{Number.isFinite(c.util) ? c.util.toFixed(3) : "—"}</td>
              <td className="small">{c.clause}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>{t("diagrams")}</h3>
      <Diagram x={r.uls.x} y={r.uls.M.map((v) => v / 1e6)} title={t("diagM")} invert />
      <Diagram x={r.uls.x} y={r.uls.V.map((v) => v / 1e3)} title={t("diagV")} />
      <Diagram x={r.sls.x} y={r.sls.w} title={t("diagW")} invert />

      <h3>{t("reactions")}</h3>
      <table className="small">
        <tbody>
          {r.uls.reactions.map((x, i) => (
            <tr key={i}><td>x = {(x.x / 1000).toFixed(2)} m</td><td>R = {(x.R / 1000).toFixed(2)} kN</td><td>{x.M ? `M = ${(x.M / 1e6).toFixed(2)} kN·m` : ""}</td></tr>
          ))}
        </tbody>
      </table>

      <div className="two">
        <div>
          <h3>{t("props")}</h3>
          <table className="small">
            <tbody>
              <tr><td>A</td><td>{(sec.A / 100).toFixed(2)} cm²</td></tr>
              <tr><td>I{ax.y}</td><td>{(sec.Iy / 1e4).toFixed(1)} cm⁴</td></tr>
              <tr><td>W{ax.y}</td><td>{(sec.Wy / 1e3).toFixed(1)} cm³</td></tr>
              <tr><td>Wpl,{ax.y}</td><td>{(sec.Wply / 1e3).toFixed(1)} cm³</td></tr>
              <tr><td>I{ax.z}</td><td>{(sec.Iz / 1e4).toFixed(1)} cm⁴</td></tr>
              <tr><td>i{ax.y} / i{ax.z}</td><td>{(sec.iy / 10).toFixed(2)} / {(sec.iz / 10).toFixed(2)} cm</td></tr>
              <tr><td>It</td><td>{(sec.It / 1e4).toFixed(2)} cm⁴</td></tr>
              {sec.Iw > 0 && <tr><td>Iw</td><td>{(sec.Iw / 1e6).toFixed(0)} cm⁶</td></tr>}
            </tbody>
          </table>
        </div>
        <div>
          <h3>{t("values")}</h3>
          <table className="small">
            <tbody>
              {r.member.values.map((v) => (
                <tr key={v.key}><td>{v.symbol}</td><td>{Number.isInteger(v.value) ? v.value : v.value.toFixed(3)} {v.unit}</td></tr>
              ))}
              {!Number.isNaN(r.C1) && <tr><td>{t("C1")}</td><td>{r.C1.toFixed(3)}</td></tr>}
              <tr><td>L<sub>cr,LT</sub></td><td>{(r.LcrLT / 1000).toFixed(2)} m</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
