import { useMemo, useState } from "react";
import { NumInput } from "./NumInput";
import { CodeId, CustomMaterialDef, CustomSectionDef, DENSITIES, SHAPES, ShapeId, shapeProps } from "@structcalc/core";
import type { T } from "./Results";

export interface GenState { shape: ShapeId; dims: Record<string, Record<string, number>>; mat: string }
export const initialGen: GenState = { shape: "iSym", dims: {}, mat: "steel" };

export interface LibState { materials: CustomMaterialDef[]; sections: CustomSectionDef[] }
export const initialLib: LibState = { materials: [], sections: [] };

const num = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(",", ".")));

/** Іконки шаблонів (48×48) */
const SHAPE_ICONS: Record<ShapeId, string> = {
  rect: "M14 6h20v36H14z", round: "M24 8a16 16 0 1 0 0.01 0z", chs: "M24 6a18 18 0 1 0 0.01 0zM24 12a12 12 0 1 1-0.01 0z",
  rhs: "M12 6h24v36H12zM17 11h14v26H17z", iSym: "M8 6h32v5H26v26h14v5H8v-5h14V11H8z",
  iAsym: "M14 6h20v4H26v28h12v4H10v-4h12V10h-8z", tee: "M8 6h32v6H27v30h-6V12H8z", channel: "M12 6h22v5H18v26h16v5H12z",
  angle: "M12 6h6v30h20v6H12z", zed: "M10 36h18v6H24 4M20 6h18M20 6v36h-10M28 6v4M10 36v-4", cLip: "M34 12V6H14v36h20v-6",
  omega: "M4 38h10V10h20v28h10",
};

function Drawing({ p, size = 280 }: { p: ReturnType<typeof shapeProps>; size?: number }) {
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const l of p.loops) for (const q of l) { xmin = Math.min(xmin, q.x); xmax = Math.max(xmax, q.x); ymin = Math.min(ymin, q.y); ymax = Math.max(ymax, q.y); }
  const pad = 36, k = (size - 2 * pad) / Math.max(xmax - xmin, ymax - ymin, 1e-6);
  const X = (x: number) => size / 2 + (x - (xmax + xmin) / 2) * k, Y = (y: number) => size / 2 - (y - (ymax + ymin) / 2) * k;
  const d = p.loops.map((l) => "M" + l.map((q) => `${X(q.x).toFixed(1)} ${Y(q.y).toFixed(1)}`).join(" L") + " Z").join(" ");
  const L = size * 0.42, ca = Math.cos(p.alpha), sa = Math.sin(p.alpha);
  const showPrincipal = Math.abs(p.alpha) > 1e-3;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="section-drawing gen" role="img" aria-label="section">
      <path d={d} className="sd-shape" fillRule="evenodd" />
      <line x1={8} x2={size - 8} y1={Y(0)} y2={Y(0)} className="sd-axis" />
      <line y1={8} y2={size - 8} x1={X(0)} x2={X(0)} className="sd-axis" />
      <text x={size - 10} y={Y(0) - 4} className="sd-lbl" textAnchor="end">y</text>
      <text x={X(0) + 4} y={14} className="sd-lbl">z</text>
      {showPrincipal && <>
        <line x1={X(0) - L * ca} y1={Y(0) + L * sa} x2={X(0) + L * ca} y2={Y(0) - L * sa} className="sd-principal" />
        <line x1={X(0) + L * sa} y1={Y(0) + L * ca} x2={X(0) - L * sa} y2={Y(0) - L * ca} className="sd-principal" />
        <text x={X(0) + L * ca + 2} y={Y(0) - L * sa - 4} className="sd-lbl principal">u</text>
        <text x={X(0) - L * sa + 4} y={Y(0) - L * ca + 4} className="sd-lbl principal">v</text>
      </>}
      <circle cx={X(0)} cy={Y(0)} r={3.5} className="sd-cg" />
      <text x={X(xmin) - 6} y={(Y(ymax) + Y(ymin)) / 2} className="sd-dim" textAnchor="end">{+p.H.toFixed(1)}</text>
      <text x={(X(xmin) + X(xmax)) / 2} y={Y(ymin) + 18} className="sd-dim" textAnchor="middle">{+p.B.toFixed(1)}</text>
    </svg>
  );
}

/** Шаблони, які можна зберегти як «мій переріз» і використовувати в балці / колоні */
function toCustom(shape: ShapeId, d: Record<string, number>, name: string): CustomSectionDef | null {
  if (shape === "iSym") return { name, type: "weldedI", h: d.h, b: d.b, tw: d.tw, tf: d.tf };
  if (shape === "rhs") return { name, type: "rhs", h: d.h, b: d.b, tw: 0, tf: 0, t: d.t };
  if (shape === "chs") return { name, type: "chs", h: d.d, b: d.d, tw: 0, tf: 0, d: d.d, t: d.t };
  return null;
}

export function GeneratorModule({ s, set, lib, setLib, t }: {
  code: CodeId; s: GenState; set: (p: Partial<GenState>) => void; lib: LibState; setLib: (p: Partial<LibState>) => void; t: T;
}) {
  const shape = SHAPES.find((x) => x.id === s.shape) ?? SHAPES[0];
  const dims = { ...shape.def, ...(s.dims[shape.id] ?? {}) };
  const mats = [...DENSITIES.map((d) => ({ id: d.id, label: t(`mat_${d.id}`), rho: d.rho })),
    ...lib.materials.filter((m) => m.rho).map((m) => ({ id: `u:${m.id}`, label: m.id, rho: m.rho! }))];
  const mat = mats.find((m) => m.id === s.mat) ?? mats[0];
  const [name, setName] = useState("");
  const p = useMemo(() => {
    try {
      if (Object.values(dims).some((v) => !(v >= 0)) || shape.dims.some((k) => k !== "c" && k !== "r" && !(dims[k] > 0))) return null;
      return shapeProps(shape.id, dims, mat.rho);
    } catch { return null; }
  }, [shape.id, JSON.stringify(dims), mat.rho]);
  const setDim = (k: string, v: number) => set({ dims: { ...s.dims, [shape.id]: { ...dims, [k]: v } } });
  const custom = toCustom(shape.id, dims, name.trim());
  const deg = (r: number) => (r * 180) / Math.PI;
  const rows: [string, string][] = p ? [
    [t("sec_mass"), `${p.mass.toFixed(3)} kg/m`],
    ["A", `${(p.A / 100).toFixed(3)} cm²`],
    [t("gen_cg"), `y_c = ${p.yc.toFixed(1)}; z_c = ${p.zc.toFixed(1)} mm`],
    ["I_y", `${(p.Iy / 1e4).toFixed(2)} cm⁴`],
    ["I_z", `${(p.Iz / 1e4).toFixed(2)} cm⁴`],
    ...(Math.abs(p.Iyz) > 1e-6 * (p.Iy + p.Iz) ? [["I_yz", `${(p.Iyz / 1e4).toFixed(2)} cm⁴`] as [string, string],
      ["I_u / I_v", `${(p.I1 / 1e4).toFixed(2)} / ${(p.I2 / 1e4).toFixed(2)} cm⁴`] as [string, string],
      ["α", `${deg(p.alpha).toFixed(2)}°`] as [string, string]] : []),
    ["W_y (верх / низ)", `${(p.Wy_top / 1e3).toFixed(2)} / ${(p.Wy_bot / 1e3).toFixed(2)} cm³`],
    ["W_z (ліво / право)", `${(p.Wz_left / 1e3).toFixed(2)} / ${(p.Wz_right / 1e3).toFixed(2)} cm³`],
    ["W_pl,y / W_pl,z", `${(p.Wply / 1e3).toFixed(2)} / ${(p.Wplz / 1e3).toFixed(2)} cm³`],
    ["S_y / S_z", `${(p.Sy / 1e3).toFixed(2)} / ${(p.Sz / 1e3).toFixed(2)} cm³`],
    ["i_y / i_z", `${(p.iy / 10).toFixed(2)} / ${(p.iz / 10).toFixed(2)} cm`],
    ...(Math.abs(p.Iyz) > 1e-6 * (p.Iy + p.Iz) ? [["i_u / i_v", `${(p.i1 / 10).toFixed(2)} / ${(p.i2 / 10).toFixed(2)} cm`] as [string, string]] : []),
    ["I_t", `${(p.It / 1e4).toFixed(3)} cm⁴`],
    ["I_p", `${(p.Ip / 1e4).toFixed(2)} cm⁴`],
  ] : [];

  return (
    <main className="layout">
      <aside className="inputs">
        <fieldset>
          <legend><span className="step">1</span>{t("gen_shape")}</legend>
          <div className="shape-grid">
            {SHAPES.map((x) => (
              <button key={x.id} id={`shape-${x.id}`} className={`shape-chip ${x.id === shape.id ? "on" : ""}`} title={t(`shape_${x.id}`)} onClick={() => set({ shape: x.id })}>
                <svg viewBox="0 0 48 48" aria-hidden="true"><path d={SHAPE_ICONS[x.id]} fillRule="evenodd" /></svg>
                <span>{t(`shape_${x.id}`)}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend><span className="step">2</span>{t("gen_dims")}</legend>
          <div className="grid2">
            {shape.dims.map((k) => (
              <label key={k}><span className="lbl">{k}, mm</span>
                <NumInput id={`gd-${k}`} step={k.startsWith("t") || k === "r" || k === "c" ? 0.5 : 1} value={dims[k]} onChange={(e) => setDim(k, num(e.target.value))} /></label>
            ))}
          </div>
          <p className="hint">{t(`shape_${shape.id}_h`)}</p>
        </fieldset>
        <fieldset>
          <legend><span className="step">3</span>{t("material")}</legend>
          <select id="gmat" value={mat.id} onChange={(e) => set({ mat: e.target.value })}>
            {mats.map((m) => <option key={m.id} value={m.id}>{m.label} · {m.rho} kg/m³</option>)}
          </select>
        </fieldset>
        {custom && (
          <fieldset>
            <legend>{t("gen_save")}</legend>
            <div className="save-row">
              <input id="gname" placeholder={t("gen_namePh")} value={name} onChange={(e) => setName(e.target.value)} />
              <button className="primary" disabled={!name.trim()} onClick={() => {
                setLib({ sections: [...lib.sections.filter((x) => x.name !== custom.name), custom] });
                setName("");
              }}>{t("gen_saveBtn")}</button>
            </div>
            <p className="hint">{t("gen_saveHint")}</p>
          </fieldset>
        )}
      </aside>
      <section className="output">
        {!p && <p className="error">{t("gen_bad")}</p>}
        {p && (
          <div className="panel two-col">
            <div>
              <h3>{t(`shape_${shape.id}`)}</h3>
              <Drawing p={p} />
              <p className="hint">{t("gen_axesHint")}</p>
            </div>
            <div>
              <h3>{t("props")}</h3>
              <dl className="props one">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
            </div>
          </div>
        )}
        <p className="disclaimer">{t("gen_note")}</p>
      </section>
    </main>
  );
}

/** Мої матеріали і перерізи */
export function LibraryModule({ lib, setLib, t }: { lib: LibState; setLib: (p: Partial<LibState>) => void; t: T }) {
  const upd = (i: number, p: Partial<CustomMaterialDef>) => setLib({ materials: lib.materials.map((m, k) => (k === i ? { ...m, ...p } : m)) });
  const presets: CustomMaterialDef[] = [
    { id: "EN AW-6063 T6", E: 70000, G: 27000, fy: 160, fu: 195, gammaM: 1.1, rho: 2700 },
    { id: "EN AW-6082 T6", E: 70000, G: 27000, fy: 260, fu: 310, gammaM: 1.1, rho: 2700 },
    { id: "1.4301 (AISI 304)", E: 200000, G: 77000, fy: 230, fu: 540, gammaM: 1.1, rho: 7950 },
  ];
  return (
    <main className="library">
      <div className="inputs">
        <fieldset>
          <legend>{t("lib_mats")}</legend>
          <p className="hint">{t("lib_matsHint")}</p>
          {lib.materials.length > 0 && (
            <div className="lib-table">
              <div className="lib-row head"><span>{t("lib_name")}</span><span>E, MPa</span><span>R_yn / f_y</span><span>R_un / f_u</span><span>γ_m</span><span>ρ, kg/m³</span><span /></div>
              {lib.materials.map((m, i) => (
                <div className="lib-row" key={i}>
                  <input aria-label={t("lib_name")} value={m.id} onChange={(e) => upd(i, { id: e.target.value })} />
                  <NumInput value={m.E} onChange={(e) => upd(i, { E: num(e.target.value) })} />
                  <NumInput value={m.fy} onChange={(e) => upd(i, { fy: num(e.target.value) })} />
                  <NumInput value={m.fu} onChange={(e) => upd(i, { fu: num(e.target.value) })} />
                  <NumInput step={0.005} value={m.gammaM} onChange={(e) => upd(i, { gammaM: num(e.target.value) })} />
                  <NumInput value={m.rho ?? ""} onChange={(e) => upd(i, { rho: num(e.target.value) })} />
                  <button className="ghost" aria-label={t("remove")} onClick={() => setLib({ materials: lib.materials.filter((_, k) => k !== i) })}>✕</button>
                </div>
              ))}
            </div>
          )}
          <div className="lib-add">
            <button className="ghost" id="lib-addmat" onClick={() => setLib({ materials: [...lib.materials, { id: `${t("lib_newMat")} ${lib.materials.length + 1}`, E: 206000, fy: 245, fu: 370, gammaM: 1.025, rho: 7850 }] })}>+ {t("lib_addMat")}</button>
            {presets.filter((p) => !lib.materials.some((m) => m.id === p.id)).map((p) => (
              <button key={p.id} className="ghost" onClick={() => setLib({ materials: [...lib.materials, p] })}>+ {p.id}</button>
            ))}
          </div>
          <p className="hint">{t("lib_matsWarn")}</p>
        </fieldset>
        <fieldset>
          <legend>{t("lib_secs")}</legend>
          {lib.sections.length === 0 && <p className="hint">{t("lib_secsEmpty")}</p>}
          {lib.sections.map((x) => (
            <div key={x.name} className="lib-sec">
              <span className="mono">{x.name}</span>
              <span className="hint">{t(`cst_${x.type}`)} · {x.type === "weldedI" ? `${x.h}×${x.b}×${x.tw}×${x.tf}` : x.type === "chs" ? `Ø${x.d}×${x.t}` : `${x.h}×${x.b}×${x.t}`}</span>
              <button className="ghost" aria-label={t("remove")} onClick={() => setLib({ sections: lib.sections.filter((y) => y.name !== x.name) })}>✕</button>
            </div>
          ))}
          <p className="hint">{t("lib_secsHint")}</p>
        </fieldset>
      </div>
    </main>
  );
}
