// Сортамент: вітчизняний (ДСТУ/ГОСТ), європейський (EN) і свої перерізи — з таблицею, кресленням і редактором своїх.
import { useMemo, useState } from "react";
import { buildCustomSection, CodeId, CustomSectionDef, CustomSectionType, Family, FAMILIES, familySections, findSection, Section } from "@structcalc/core";
import type { LibState } from "./GeneratorModule";

export interface SectionState { family: string; size: string; origin?: Origin }
export const initialSection: SectionState = { family: "IPE", size: "IPE 300", origin: "all" };

type Origin = "all" | "UA" | "EU" | "my";
const SHAPES = ["I", "C", "L", "RHS", "CHS"] as const;

/** Коротка назва сімейства для списків */
export function famLabel(f: Family | string, t: (k: string) => string): string {
  const id = typeof f === "string" ? f : f.id;
  const map: Record<string, string> = {
    I_GOST8239: "ГОСТ 8239", I_G26020_B: "ГОСТ 26020 Б", I_G26020_SH: "ГОСТ 26020 Ш", I_G26020_K: "ГОСТ 26020 К",
    C_GOST8240_U: "ГОСТ 8240 У", C_GOST8240_P: "ГОСТ 8240 П", L_GOST8509: "ГОСТ 8509", L_GOST8510: "ГОСТ 8510", L_EN: "L EN 10056",
    RHS_COLD: "□ EN 10219 / ГОСТ 30245", CHS_COLD: "○ EN 10219", CUSTOM: t("fam_CUSTOM"), MANUAL: t("np_manual"),
  };
  return map[id] ?? id;
}

/** Вибір сімейства з групуванням: вітчизняні, європейські, мої */
export function FamilyOptions({ fams, t }: { fams: Family[]; t: (k: string) => string }) {
  const grp = (o: string) => fams.filter((f) => (o === "UA" ? f.origin === "UA" || f.origin === "both" : o === "EU" ? f.origin === "EU" : !f.origin || f.origin === "custom"));
  return <>
    {(["UA", "EU", "my"] as const).map((o) => grp(o).length > 0 && (
      <optgroup key={o} label={t(`sort_${o}`)}>{grp(o).map((f) => <option key={f.id} value={f.id}>{famLabel(f, t)}</option>)}</optgroup>
    ))}
  </>;
}

/** Креслення перерізу з розмірами */
export function SectionDims({ s, code, size = 280 }: { s: Section; code: CodeId; size?: number }) {
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const l of s.loops) for (const p of l) { xmin = Math.min(xmin, p.x); xmax = Math.max(xmax, p.x); ymin = Math.min(ymin, p.y); ymax = Math.max(ymax, p.y); }
  const pad = 46;
  const k = (size - 2 * pad) / Math.max(xmax - xmin, ymax - ymin);
  const cx = (xmax + xmin) / 2, cy = (ymax + ymin) / 2;
  const X = (x: number) => size / 2 + (x - cx) * k, Y = (y: number) => size / 2 - (y - cy) * k;
  const d = s.loops.map((l) => "M" + l.map((p) => `${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(" L") + " Z").join(" ");
  const ax = code === "DBN" ? ["x", "y"] : ["y", "z"];
  const D = s.dims;
  const f1 = (v: number) => +v.toFixed(1);
  const skip = ["h", "b", "d", ...(D.bt ? ["tf", "bt", "bb"] : [])];
  const notes = Object.entries(D).filter(([key]) => !skip.includes(key) && D[key] > 0).map(([key, v]) => `${key} ${f1(v)}`).join(" · ");
  return (<>
    <svg viewBox={`0 0 ${size} ${size}`} className="section-drawing big" role="img" aria-label={s.name}>
      <line x1={8} x2={size - 8} y1={Y(0)} y2={Y(0)} className="sd-axis" />
      <line y1={8} y2={size - 8} x1={X(0)} x2={X(0)} className="sd-axis" />
      <text x={size - 10} y={Y(0) - 4} className="sd-lbl" textAnchor="end">{ax[0]}</text>
      <text x={X(0) + 4} y={14} className="sd-lbl">{ax[1]}</text>
      <path d={d} className="sd-shape" fillRule="evenodd" />
      {/* габарити */}
      <line x1={X(xmin) - 18} x2={X(xmin) - 18} y1={Y(ymax)} y2={Y(ymin)} className="sd-dimline" />
      <text x={X(xmin) - 22} y={(Y(ymax) + Y(ymin)) / 2 - 8} className="sd-dim" textAnchor="end">{f1(s.h)}</text>
      <line x1={X(xmin)} x2={X(xmax)} y1={Y(ymin) + 16} y2={Y(ymin) + 16} className="sd-dimline" />
      <text x={(X(xmin) + X(xmax)) / 2} y={Y(ymin) + 30} className="sd-dim" textAnchor="middle">{f1(s.kind === "I" && D.bb ? D.bb : s.b)}</text>
      {s.kind === "I" && D.bt && D.bt !== D.bb && <text x={(X(xmin) + X(xmax)) / 2} y={Y(ymax) - 10} className="sd-dim" textAnchor="middle">{f1(D.bt)}</text>}
    </svg>
    <p className="sd-notes">{notes}</p>
  </>);
}

const TYPES: CustomSectionType[] = ["weldedI", "rolledI", "channel", "angle", "rhs", "chs"];
const blank = (type: CustomSectionType): CustomSectionDef => ({
  weldedI: { name: "", type, h: 500, b: 200, tw: 8, tf: 12, b2: 250, tf2: 16, r: 6 },
  rolledI: { name: "", type, h: 300, b: 150, tw: 7, tf: 10.7, r: 15 },
  channel: { name: "", type, h: 200, b: 80, tw: 6, tf: 9, r: 9 },
  angle: { name: "", type, h: 100, b: 63, tw: 6, tf: 6, t: 6, r: 10 },
  rhs: { name: "", type, h: 200, b: 100, tw: 0, tf: 0, t: 6, ro: 12 },
  chs: { name: "", type, h: 159, b: 159, tw: 0, tf: 0, d: 159, t: 6 },
}[type]);
const FIELDS: Record<CustomSectionType, (keyof CustomSectionDef)[]> = {
  weldedI: ["h", "b", "tf", "b2", "tf2", "tw", "r"],
  rolledI: ["h", "b", "tw", "tf", "r"],
  channel: ["h", "b", "tw", "tf", "r"],
  angle: ["h", "b", "t", "r"],
  rhs: ["h", "b", "t", "ro"],
  chs: ["d", "t"],
};

export function SectionModule({ code, s, set, t, lib, setLib }: {
  code: CodeId; s: SectionState; set: (p: Partial<SectionState>) => void; t: (k: string) => string; lib: LibState; setLib: (p: Partial<LibState>) => void;
}) {
  const origin: Origin = s.origin ?? "all";
  const fams = FAMILIES.filter((f) => origin === "all" || (origin === "UA" ? f.origin === "UA" || f.origin === "both" : origin === "EU" ? f.origin === "EU" || f.origin === "both" : f.id === "CUSTOM"));
  const famOk = FAMILIES.some((f) => f.id === s.family);
  const family = famOk ? s.family : origin === "my" ? "" : "IPE";
  const list = family ? familySections(family) : [];
  const sec = (family ? findSection(family, s.size) : undefined) ?? list[0];
  const fam = FAMILIES.find((f) => f.id === family);
  const ax = code === "DBN" ? { y: "x", z: "y" } : { y: "y", z: "z" };
  const [draft, setDraft] = useState<CustomSectionDef | null>(null);
  const preview = useMemo(() => {
    if (!draft) return null;
    try { return buildCustomSection({ ...draft, name: draft.name || "—" }); } catch { return null; }
  }, [draft]);
  const myMode = origin === "my" || family === "CUSTOM";

  const rows: [string, string][] = sec ? [
    [t("sec_mass"), `${sec.mass.toFixed(2)} kg/m`],
    ["A", `${(sec.A / 100).toFixed(2)} cm²`],
    [`I${ax.y}`, `${(sec.Iy / 1e4).toFixed(1)} cm⁴`],
    [`W${ax.y}`, `${(sec.Wy / 1e3).toFixed(1)} cm³`],
    [`Wpl,${ax.y}`, `${(sec.Wply / 1e3).toFixed(1)} cm³`],
    [`i${ax.y}`, `${(sec.iy / 10).toFixed(2)} cm`],
    [`I${ax.z}`, `${(sec.Iz / 1e4).toFixed(1)} cm⁴`],
    [`W${ax.z}`, `${(sec.Wz / 1e3).toFixed(1)} cm³`],
    [`Wpl,${ax.z}`, `${(sec.Wplz / 1e3).toFixed(1)} cm³`],
    [`i${ax.z}`, `${(sec.iz / 10).toFixed(2)} cm`],
    ["It", `${(sec.It / 1e4).toFixed(2)} cm⁴`],
    ...(sec.Iw > 0 ? [["Iw", `${(sec.Iw / 1e6).toFixed(0)} cm⁶`] as [string, string]] : []),
    ...(sec.kind === "L" ? [["i_min", `${(sec.imin / 10).toFixed(2)} cm`] as [string, string]] : []),
  ] : [];

  const saveDraft = () => {
    if (!draft || !preview) return;
    const name = draft.name.trim() || `${t(`cst_${draft.type}`)} ${lib.sections.length + 1}`;
    const def = { ...draft, name, ...(draft.type === "chs" ? { h: draft.d ?? draft.h, b: draft.d ?? draft.h } : {}), ...(draft.type === "angle" ? { tw: draft.t ?? 6, tf: draft.t ?? 6 } : {}) };
    setLib({ sections: [...lib.sections.filter((x) => x.name !== name), def] });
    set({ family: "CUSTOM", size: name });
    setDraft(null);
  };

  return (
    <main className="layout sortament">
      <aside className="inputs">
        <div className="seg sort-origin" role="group">
          {(["all", "UA", "EU", "my"] as const).map((o) => (
            <button key={o} id={`orig-${o}`} className={origin === o ? "on" : ""} onClick={() => set({ origin: o, ...(o === "my" ? { family: "CUSTOM" } : {}) })}>{t(`sort_${o}`)}</button>
          ))}
        </div>
        {SHAPES.map((sh) => {
          const g = fams.filter((f) => f.shape === sh);
          return g.length > 0 && (
            <fieldset key={sh}><legend>{t(`shp_${sh}`)}</legend>
              <div className="fam-list">{g.map((f) => (
                <button key={f.id} id={`fam-${f.id}`} className={`fam ${f.id === family ? "on" : ""}`} onClick={() => { set({ family: f.id, size: familySections(f.id)[0]?.name ?? "" }); setDraft(null); }}>
                  <span className="fam-name">{famLabel(f, t)}</span><span className="fam-std">{f.standard} · {familySections(f.id).length}</span>
                </button>))}
              </div>
            </fieldset>
          );
        })}
        {(origin === "all" || origin === "my") && (
          <fieldset><legend>{t("sort_my")}</legend>
            <div className="fam-list">
              {FAMILIES.some((f) => f.id === "CUSTOM") && <button id="fam-CUSTOM" className={`fam ${family === "CUSTOM" ? "on" : ""}`} onClick={() => set({ family: "CUSTOM", size: lib.sections[0]?.name ?? "" })}>
                <span className="fam-name">{t("fam_CUSTOM")}</span><span className="fam-std">{lib.sections.length}</span></button>}
              <button id="ms-new" className="ghost" onClick={() => setDraft(blank("weldedI"))}>+ {t("ms_new")}</button>
            </div>
          </fieldset>
        )}
      </aside>
      <section className="output">
        {draft && (
          <div className="panel two-col ms-editor">
            <div>
              <h3>{t("ms_new")}</h3>
              <div className="grid2">
                <label className="wide"><span className="lbl">{t("ms_type")}</span>
                  <select id="ms-type" value={draft.type} onChange={(e) => setDraft({ ...blank(e.target.value as CustomSectionType), name: draft.name })}>{TYPES.map((x) => <option key={x} value={x}>{t(`cst_${x}`)}</option>)}</select></label>
                <label className="wide"><span className="lbl">{t("ms_name")}</span><input id="ms-name" value={draft.name} placeholder={t(`cst_${draft.type}`)} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
                {FIELDS[draft.type].map((f) => (
                  <label key={f}><span className="lbl">{t(`msf_${draft.type === "weldedI" && f === "r" ? "rw" : f}`)}</span>
                    <input id={`ms-${f}`} type="number" step="0.5" value={(draft[f] as number | undefined) ?? ""} onChange={(e) => setDraft({ ...draft, [f]: e.target.value === "" ? undefined : Number(e.target.value) })} /></label>
                ))}
              </div>
              <p className="hint">{t(`ms_hint_${draft.type}`)}</p>
              <div className="row-btns">
                <button id="ms-save" className="primary" disabled={!preview} onClick={saveDraft}>{t("ms_save")}</button>
                <button className="ghost" onClick={() => setDraft(null)}>{t("cancel")}</button>
              </div>
            </div>
            <div>{preview ? <>
              <SectionDims s={preview} code={code} />
              <dl className="props one compact">
                <div><dt>A</dt><dd>{(preview.A / 100).toFixed(2)} cm²</dd></div>
                <div><dt>{t("sec_mass")}</dt><dd>{preview.mass.toFixed(2)} kg/m</dd></div>
                <div><dt>I{ax.y} / I{ax.z}</dt><dd>{(preview.Iy / 1e4).toFixed(1)} / {(preview.Iz / 1e4).toFixed(1)} cm⁴</dd></div>
                <div><dt>W{ax.y},min / W{ax.z}</dt><dd>{(preview.Wy / 1e3).toFixed(1)} / {(preview.Wz / 1e3).toFixed(1)} cm³</dd></div>
              </dl>
              {preview.approx === "mono" && <p className="hint">{t("sec_mono")}</p>}
            </> : <p className="error">{t("ms_bad")}</p>}</div>
          </div>
        )}
        {sec && !draft && (
          <div className="panel two-col">
            <div>
              <h3>{sec.name}</h3>
              <SectionDims s={sec} code={code} />
              <p className="hint">{fam?.standard ?? ""}{sec.approx === "slope" ? ` · ${t("sec_approx")}` : ""}{sec.approx === "mono" ? ` · ${t("sec_mono")}` : ""}</p>
              {fam?.verify && <p className="hint warn-text">{t("sort_verify")}</p>}
            </div>
            <div>
              <h3>{t("props")}</h3>
              <dl className="props one">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
              {family === "CUSTOM" && (
                <div className="row-btns">
                  <button className="ghost" onClick={() => { const d = lib.sections.find((x) => x.name === sec.name); if (d) setDraft({ ...d }); }}>{t("ms_edit")}</button>
                  <button className="ghost danger" onClick={() => setLib({ sections: lib.sections.filter((x) => x.name !== sec.name) })}>{t("remove")}</button>
                </div>
              )}
            </div>
          </div>
        )}
        {myMode && !sec && !draft && <div className="panel"><p className="hint">{t("lib_secsEmpty")}</p></div>}
        {list.length > 0 && (
          <div className="panel">
            <h3>{fam ? famLabel(fam, t) : ""} · {t("sort_table")}</h3>
            <div className="sort-table-wrap">
              <table className="sort-table">
                <thead><tr><th>{t("size")}</th><th>h</th><th>b</th><th>t<sub>w</sub></th><th>t<sub>f</sub></th><th>r</th><th>A, cm²</th><th>kg/m</th>
                  <th>I{ax.y}, cm⁴</th><th>W{ax.y}, cm³</th><th>i{ax.y}, cm</th><th>I{ax.z}, cm⁴</th><th>W{ax.z}, cm³</th><th>i{ax.z}, cm</th></tr></thead>
                <tbody>{list.map((x) => {
                  const D = x.dims;
                  return (
                    <tr key={x.name} className={x.name === sec?.name ? "on" : ""} onClick={() => { set({ size: x.name }); setDraft(null); }}>
                      <td>{x.name}</td><td>{+x.h.toFixed(1)}</td><td>{+x.b.toFixed(1)}</td>
                      <td>{+(D.tw ?? D.t ?? 0).toFixed(1)}</td><td>{+(D.tf ?? D.t ?? 0).toFixed(1)}</td><td>{+(D.r ?? D.ro ?? 0).toFixed(1)}</td>
                      <td>{(x.A / 100).toFixed(2)}</td><td>{x.mass.toFixed(1)}</td>
                      <td>{(x.Iy / 1e4).toFixed(0)}</td><td>{(x.Wy / 1e3).toFixed(1)}</td><td>{(x.iy / 10).toFixed(2)}</td>
                      <td>{(x.Iz / 1e4).toFixed(1)}</td><td>{(x.Wz / 1e3).toFixed(1)}</td><td>{(x.iz / 10).toFixed(2)}</td>
                    </tr>);
                })}</tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
