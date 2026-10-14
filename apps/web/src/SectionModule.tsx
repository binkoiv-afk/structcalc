import { CodeId, FAMILIES, familySections, findSection } from "@structcalc/core";
import { SectionDrawing } from "./SectionDrawing";

export interface SectionState { family: string; size: string }
export const initialSection: SectionState = { family: "IPE", size: "IPE 300" };

export function SectionModule({ code, s, set, t }: { code: CodeId; s: SectionState; set: (p: Partial<SectionState>) => void; t: (k: string) => string }) {
  const sec = findSection(s.family, s.size) ?? familySections(s.family)[0];
  const ax = code === "DBN" ? { y: "x", z: "y" } : { y: "y", z: "z" };
  const fam = FAMILIES.find((f) => f.id === s.family);
  const rows: [string, string][] = [
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
  ];
  if (sec.Iw > 0) rows.push(["Iw", `${(sec.Iw / 1e6).toFixed(0)} cm⁶`]);
  if (sec.kind === "L") rows.push(["i_min", `${(sec.imin / 10).toFixed(2)} cm`]);
  const dims = Object.entries(sec.dims).map(([k, v]) => `${k} = ${+v.toFixed(1)}`).join(", ");
  return (
    <main className="layout">
      <aside className="inputs">
        <fieldset>
          <legend><span className="step">1</span>{t("family")}</legend>
          <select id="sfam" value={s.family} onChange={(e) => set({ family: e.target.value, size: familySections(e.target.value)[0].name })}>
            {FAMILIES.map((f) => <option key={f.id} value={f.id}>{f.id.replace("_", " ")} · {f.standard}</option>)}
          </select>
        </fieldset>
        <fieldset>
          <legend><span className="step">2</span>{t("size")}</legend>
          <div className="size-grid">
            {familySections(s.family).map((x) => (
              <button key={x.name} className={x.name === sec.name ? "chip on" : "chip"} onClick={() => set({ size: x.name })}>{x.name.replace(/^\S+\s/, "")}</button>
            ))}
          </div>
        </fieldset>
      </aside>
      <section className="output">
        <div className="panel two-col">
          <div>
            <h3>{sec.name}</h3>
            <SectionDrawing s={sec} code={code} size={260} />
            <p className="hint">{fam?.standard} · {dims} mm{sec.approx ? ` · ${t("sec_approx")}` : ""}</p>
          </div>
          <div>
            <h3>{t("props")}</h3>
            <dl className="props one">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          </div>
        </div>
      </section>
    </main>
  );
}
