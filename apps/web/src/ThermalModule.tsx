// Теплофізика огороджувальної конструкції: вибір конструкції → шари зсередини назовні → умови.
// Результат: опір теплопередачі (U), температури в товщі, точка роси, конденсація і річний баланс вологи (Глазер).
import { useMemo, useState } from "react";
import { NumInput } from "./NumInput";
import {
  BuildingKind, checkThermal, CLIMATES, CodeId, MonthClimate, RQ_MIN, TE_ZONE, thermalMaterial, ThermalElement, ThermalLayer, ThermalResult, THERMAL_MATERIALS,
} from "@structcalc/core";
import { CheckList, pct, T, utilState } from "./Results";

export interface ThermalState {
  element: ThermalElement; building: BuildingKind; zone: 1 | 2; ti: number; phii: number; te: number; teEN: number;
  layers: ThermalLayer[]; r: number; Rmin: string; uPreset: "pl" | "de" | "own" | "none"; Umax: number;
  climate: string; custom: MonthClimate[]; phiCrit: number; obj: string; elem: string;
}

export const initialThermal: ThermalState = {
  element: "wall", building: "res", zone: 1, ti: 20, phii: 55, te: -22, teEN: -20,
  layers: [{ mat: "limePlaster", d: 20 }, { mat: "claybrick", d: 380 }, { mat: "minwoolFacade", d: 150 }, { mat: "facadePlaster", d: 8 }],
  r: 1, Rmin: "", uPreset: "pl", Umax: 0.2, climate: "kyiv", custom: CLIMATES.kyiv, phiCrit: 80, obj: "", elem: "",
};

// типові приклади за видом конструкції — щоб не починати з порожнього списку
const SAMPLES: Record<ThermalElement, ThermalLayer[]> = {
  wall: initialThermal.layers,
  roof: [{ mat: "rc", d: 200 }, { mat: "vaporBarrier", d: 0.2 }, { mat: "minwoolRoof", d: 300 }, { mat: "pvcMembrane", d: 1.5 }],
  attic: [{ mat: "rc", d: 220 }, { mat: "vaporBarrier", d: 0.2 }, { mat: "minwoolLight", d: 250 }],
  floor: [{ mat: "cementMortar", d: 50 }, { mat: "rc", d: 220 }, { mat: "xps", d: 150 }],
};
/** U_max: Польща — WT 2021 (Dz.U. 2019 poz. 1065, zał. 2); Німеччина — GEG 2020, Anlage 1 (референтна будівля) */
const U_PRESET: Record<"pl" | "de", Record<ThermalElement, number>> = {
  pl: { wall: 0.2, roof: 0.15, attic: 0.15, floor: 0.25 },
  de: { wall: 0.28, roof: 0.2, attic: 0.2, floor: 0.35 },
};
const MAT_GROUPS: [string, string[]][] = [
  ["mas", ["rc", "concrete", "claybrick", "claybrickHollow", "ceramicBlock", "silicatebrick", "aerated400", "aerated500", "keramzitConc", "cementMortar", "limePlaster", "facadePlaster"]],
  ["ins", ["minwoolFacade", "minwoolLight", "minwoolRoof", "eps", "xps", "pir", "foamglass", "keramzitFill"]],
  ["wood", ["gypsumBoard", "pine", "osb", "plywood"]],
  ["mem", ["vaporBarrier", "windMembrane", "bitumen", "pvcMembrane"]],
  ["met", ["steel", "aluminium"]],
  ["air", ["airGap", "ventGap"]],
];
const ELS: ThermalElement[] = ["wall", "roof", "attic", "floor"];
const f = (v: number, n = 2) => (Number.isFinite(v) ? v.toFixed(n) : "—");
const num = (v: string) => (v.trim() === "" ? 0 : Number(v));

// кольори шарів за групою матеріалу
const GCLS: Record<string, string> = { minwool: "ins", eps: "ins", pur: "ins", foamglass: "ins", fill: "ins", ceramic: "mas", silicate: "mas", aerated: "aer", concrete: "con", organic: "wood", other: "mem" };

/** Переріз у масштабі товщин (тонкі шари — не вужчі за мінімум) з температурою або тиском пари поверх */
function Chart({ r, layers, t, mode, ti, te }: { r: ThermalResult; layers: ThermalLayer[]; t: T; mode: "temp" | "vap"; ti: number; te: number }) {
  const W = 640, H = 250, L = 46, Rg = 46, top = 16, bot = 30, air = 34;
  const used = r.layers.map((l, k) => ({ l, k })).filter(({ l }) => !l.excluded || mode === "temp");
  const tot = used.reduce((a, { l }) => a + l.d, 0) || 1, minW = 0.035 * tot;
  const dw = used.map(({ l }) => Math.max(l.d, minW)), dsum = dw.reduce((a, b) => a + b, 0);
  const X0 = L + air, X1 = W - Rg - air, sc = (X1 - X0) / dsum;
  const xs: number[] = [X0];
  dw.forEach((w) => xs.push(xs[xs.length - 1] + w * sc));
  // реальна координата (мм) → екранна
  const realB = [0]; used.forEach(({ l }) => realB.push(realB[realB.length - 1] + l.d));
  const mapX = (x: number) => {
    for (let k = 0; k < used.length; k++) if (x <= realB[k + 1] + 1e-9) return xs[k] + (realB[k + 1] > realB[k] ? ((x - realB[k]) / (realB[k + 1] - realB[k])) * (xs[k + 1] - xs[k]) : 0);
    return xs[xs.length - 1];
  };
  let y: (v: number) => number, ticks: number[], unit: string;
  const lines: JSX.Element[] = [];
  if (mode === "temp") {
    const lo = Math.min(te, r.tdew) - 2, hi = ti + 2;
    y = (v) => top + ((hi - v) / (hi - lo)) * (H - top - bot);
    const step = hi - lo > 30 ? 10 : 5;
    ticks = []; for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
    unit = "°C";
    const pts: [number, number][] = [[L, ti], [X0, r.tsi]];
    used.forEach(({ l }, k) => { if (!l.excluded) { pts.push([xs[k], l.th1]); pts.push([xs[k + 1], l.th2]); } });
    const lastIn = used.filter(({ l }) => !l.excluded).length;
    pts.push([xs[lastIn], r.tse], [W - Rg, te]);
    lines.push(<polyline key="t" className="th-line t" points={pts.map(([a, b]) => `${a},${y(b)}`).join(" ")} />);
    lines.push(<line key="d" className="th-dew" x1={L} x2={W - Rg} y1={y(r.tdew)} y2={y(r.tdew)} />);
    lines.push(<text key="dl" className="th-lbl dew" x={L + 4} y={y(r.tdew) - 4}>{t("th_dew")} = {f(r.tdew, 1)} °C</text>);
    lines.push(<text key="ti" className="th-lbl" x={L + 2} y={y(ti) - 6}>{f(ti, 0)} °C</text>);
    lines.push(<text key="tsi" className="th-lbl" x={X0 + 3} y={y(r.tsi) + 13}>{f(r.tsi, 1)}</text>);
    lines.push(<text key="te" className="th-lbl end" x={W - Rg - 2} y={y(te) - 6}>{f(te, 0)} °C</text>);
  } else {
    const ps = r.jan.map((q) => q.ps), hi = Math.max(...ps, ...r.jan.map((q) => q.p)) * 1.08;
    y = (v) => top + ((hi - v) / hi) * (H - top - bot);
    const step = hi > 2000 ? 500 : hi > 800 ? 200 : 100;
    ticks = []; for (let v = 0; v <= hi; v += step) ticks.push(v);
    unit = "Pa";
    lines.push(<polyline key="ps" className="th-line ps" points={r.jan.map((q) => `${mapX(q.x)},${y(q.ps)}`).join(" ")} />);
    lines.push(<polyline key="p" className="th-line p" points={r.jan.map((q) => `${mapX(q.x)},${y(q.p)}`).join(" ")} />);
    r.janPlanes.forEach((k) => lines.push(<circle key={`c${k}`} className="th-plane" cx={mapX(r.jan[k].x)} cy={y(r.jan[k].p)} r={4} />));
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="th-chart" role="img" aria-label={mode}>
      <rect x={L} y={top} width={air} height={H - top - bot} className="th-air in" />
      <rect x={W - Rg - air} y={top} width={air} height={H - top - bot} className="th-air out" />
      {used.map(({ l, k }, j) => (
        <g key={k}>
          <rect x={xs[j]} y={top} width={xs[j + 1] - xs[j]} height={H - top - bot} className={`th-layer ${GCLS[l.group] ?? "mem"} ${l.excluded ? "ex" : ""}`}><title>{t(`th_m_${layers[k]?.mat}`)} · {l.d} mm</title></rect>
          <text x={(xs[j] + xs[j + 1]) / 2} y={H - bot + 14} className="th-num">{k + 1}</text>
        </g>
      ))}
      {ticks.map((v) => <g key={v}><line x1={L - 4} x2={L} y1={y(v)} y2={y(v)} className="th-axis" /><text x={L - 6} y={y(v) + 4} className="th-tick">{v}</text></g>)}
      <text x={4} y={top - 4} className="th-tick start">{unit}</text>
      <text x={L + air / 2} y={H - 6} className="th-tick mid">{t("th_inside")}</text>
      <text x={W - Rg - air / 2} y={H - 6} className="th-tick mid">{t("th_outside")}</text>
      {lines}
    </svg>
  );
}

export function ThermalModule({ code, s, set, t }: { code: CodeId; s: ThermalState; set: (p: Partial<ThermalState>) => void; t: T }) {
  const [tab, setTab] = useState<"results" | "report">("results");
  const clim = s.climate === "custom" ? s.custom : CLIMATES[s.climate] ?? CLIMATES.kyiv;
  const Umax = s.uPreset === "none" ? undefined : s.uPreset === "own" ? s.Umax : U_PRESET[s.uPreset][s.element];
  const te = code === "DBN" ? s.te : s.teEN;
  const calc = useMemo(() => {
    try {
      return { r: checkThermal({ code, element: s.element, layers: s.layers.filter((l) => l.d > 0), ti: s.ti, phii: s.phii, te, zone: s.zone, building: s.building,
        Rmin: s.Rmin.trim() ? num(s.Rmin) : undefined, Umax, r: s.r, climate: clim, phiCrit: s.phiCrit / 100 }) };
    } catch (e) { return { err: String((e as Error).message) }; }
  }, [code, s, te, Umax, clim]);
  const r = calc.r;
  const mn = t("th_months").split(",");
  const upL = (k: number, p: Partial<ThermalLayer>) => set({ layers: s.layers.map((l, j) => (j === k ? { ...l, ...p } : l)) });
  const move = (k: number, d: number) => { const a = [...s.layers]; const [x] = a.splice(k, 1); a.splice(k + d, 0, x); set({ layers: a }); };
  const g = r?.checks.reduce<ThermalResult["checks"][number] | undefined>((b, c) => (!b || c.util > b.util ? c : b), undefined);
  const st = r ? utilState(r.maxUtil) : "ok";

  const summary = r && (
    <div className={`summary ${st}`}>
      <div className="summary-main"><div className="eyebrow">{t(`th_el_${s.element}`)}</div>
        <div className="profile">{code === "DBN" ? <>R<sub>Σпр</sub> = {f(r.Rred)} m²·K/W</> : <>U = {f(r.U, 3)} W/(m²·K)</>}</div>
        <div className="meta">{code === "DBN" ? <>{t("th_need")} ≥ {f(r.Rmin ?? 0)} · U = {f(r.U, 3)}</> : <>R<sub>T</sub> = {f(r.Rred)} m²·K/W{Umax ? ` · ${t("th_need")} ≤ ${f(Umax)}` : ""}</>} · θ<sub>si</sub> = {f(r.tsi, 1)} °C</div></div>
      <div className="summary-util"><div className="eyebrow">{t("rep_maxutil")}</div><div className="big">{pct(r.maxUtil)}</div><div className={`pill ${st}`}>{r.maxUtil <= 1 + 1e-9 ? t("ok") : t("fail")}</div></div>
      {g && <div className="summary-gov"><div className="eyebrow">{t("governing")}</div><div>{t(`chk_${g.key}`)}</div></div>}
    </div>
  );
  const layerTable = r && (
    <div className="th-tw"><table className="conn-values th-table"><thead><tr><th>№</th><th>{t("th_mat")}</th><th>d</th><th>λ</th><th>{t("th_R")}</th><th>μ</th><th>{t("th_sd")}</th><th>{t("th_theta")}</th><th>{t("th_dw")}</th></tr></thead>
      <tbody>
        <tr><td /><td>R<sub>si</sub></td><td /><td /><td className="mono">{f(r.Rsi, 3)}</td><td /><td /><td className="mono">{f(s.ti, 1)} → {f(r.tsi, 1)}</td><td /></tr>
        {r.layers.map((l, k) => <tr key={k} className={l.excluded ? "th-ex" : ""}><td>{k + 1}</td><td>{t(`th_m_${l.mat}`)}{l.excluded ? <div className="hint">{t("th_excluded")}</div> : null}</td><td className="mono">{l.d}</td>
          <td className="mono">{thermalMaterial(l.mat)?.air || thermalMaterial(l.mat)?.vent ? "—" : f(l.lambda, 3)}</td><td className="mono">{l.excluded ? "—" : f(l.R, 3)}</td><td className="mono">{l.mu >= 1e4 ? l.mu.toExponential(0) : l.mu}</td>
          <td className="mono">{l.excluded ? "—" : f(l.sd, l.sd < 1 ? 3 : 1)}</td><td className="mono">{l.excluded ? "—" : `${f(l.th1, 1)} → ${f(l.th2, 1)}`}</td>
          <td className={`mono ${l.dw !== undefined && l.dwLim !== undefined && l.dw > l.dwLim ? "bad" : ""}`}>{l.dw !== undefined ? `${f(l.dw)}${Number.isFinite(l.dwLim!) ? ` / ${f(l.dwLim!, 1)}` : ""}` : "—"}</td></tr>)}
        <tr><td /><td>R<sub>se</sub></td><td /><td /><td className="mono">{f(r.Rse, 3)}</td><td /><td /><td className="mono">{f(r.tse, 1)} → {f(te, 1)}</td><td /></tr>
        <tr className="th-sum"><td /><td>R<sub>Σ</sub>{s.r !== 1 ? ` · r = ${s.r}` : ""}</td><td className="mono">{r.layers.reduce((a, l) => a + l.d, 0).toFixed(0)}</td><td /><td className="mono">{f(r.Rred, 3)}</td><td /><td /><td /><td /></tr>
      </tbody></table></div>
  );
  const moist = r && (
    <>
      <p className={`th-verdict ${r.maxMa <= 0 ? "ok" : r.endMa > 0.5 ? "fail" : "warn"}`}>{r.maxMa <= 0 ? t("th_noCond") : `${r.endMa > 0.5 ? t("th_noDry") : t("th_dries")} M_a,max = ${f(r.maxMa, 0)} g/m²`}</p>
      {r.maxMa > 0 && <div className="th-tw"><table className="conn-values th-table months"><thead><tr><th>{t("th_month")}</th>{r.months.map((m) => <th key={m.m}>{mn[m.m - 1]}</th>)}</tr></thead>
        <tbody>
          <tr><td>{t("th_te_m")}</td>{r.months.map((m) => <td key={m.m} className="mono">{f(m.te, 1)}</td>)}</tr>
          <tr><td>{t("th_phie_m")}</td>{r.months.map((m) => <td key={m.m} className="mono">{f(m.phie, 0)}</td>)}</tr>
          <tr><td>{t("th_gc")}</td>{r.months.map((m) => <td key={m.m} className="mono">{f(m.gc, 0)}</td>)}</tr>
          <tr><td>{t("th_Ma")}</td>{r.months.map((m) => <td key={m.m} className="mono">{f(m.Ma, 0)}</td>)}</tr>
        </tbody></table></div>}
    </>
  );

  return (
    <main className="layout">
      <aside className="inputs">
        <fieldset>
          <legend><span className="step">1</span>{t("th_construction")}</legend>
          <div className="th-els">
            {ELS.map((e) => <button key={e} id={`th-el-${e}`} className={s.element === e ? "on" : ""}
              onClick={() => s.element !== e && set({ element: e, layers: SAMPLES[e] })}>{t(`th_el_${e}`)}</button>)}
          </div>
          {code === "DBN" && <label><span className="lbl">{t("th_building")}</span>
            <select id="th-building" value={s.building} onChange={(e) => { const b = e.target.value as BuildingKind; set({ building: b, phii: b === "res" ? 55 : 50 }); }}>
              {(["res", "pub", "ind"] as const).map((b) => <option key={b} value={b}>{t(`th_b_${b}`)}</option>)}
            </select></label>}
        </fieldset>
        <fieldset>
          <legend><span className="step">2</span>{t("th_layers")}</legend>
          <p className="hint">{t("th_layersHint")}</p>
          <div className="th-layers">
            {s.layers.map((l, k) => {
              const m = thermalMaterial(l.mat), air = m?.air || m?.vent;
              return (
                <div key={k} className="th-row">
                  <span className="th-n">{k + 1}</span>
                  <select id={`th-mat-${k}`} value={l.mat} onChange={(e) => upL(k, { mat: e.target.value, lambda: undefined, mu: undefined, rho: undefined })}>
                    {MAT_GROUPS.map(([gk, ids]) => <optgroup key={gk} label={t(`th_g_${gk}`)}>{ids.map((id) => <option key={id} value={id}>{t(`th_m_${id}`)}</option>)}</optgroup>)}
                  </select>
                  <label><span className="lbl">{t("th_d")}</span><NumInput id={`th-d-${k}`} step={10} min={0} value={l.d} onChange={(e) => upL(k, { d: Math.max(0, num(e.target.value)) })} /></label>
                  <label><span className="lbl">{t("th_lambda")}</span><NumInput id={`th-l-${k}`} step={0.001} min={0} disabled={air} placeholder={air ? "—" : String(m?.lambda ?? "")} value={l.lambda ?? ""}
                    onChange={(e) => upL(k, { lambda: e.target.value.trim() === "" ? undefined : Math.max(1e-4, num(e.target.value)) })} /></label>
                  <label><span className="lbl">{t("th_mu")}</span><NumInput id={`th-mu-${k}`} step={1} min={0} placeholder={String(m?.mu ?? "")} value={l.mu ?? ""}
                    onChange={(e) => upL(k, { mu: e.target.value.trim() === "" ? undefined : Math.max(0, num(e.target.value)) })} /></label>
                  <span className="th-tools">
                    <button className="ghost" title={t("th_up")} aria-label={t("th_up")} disabled={k === 0} onClick={() => move(k, -1)}>↑</button>
                    <button className="ghost" title={t("th_down")} aria-label={t("th_down")} disabled={k === s.layers.length - 1} onClick={() => move(k, 1)}>↓</button>
                    <button className="ghost danger" id={`th-del-${k}`} title={t("np_remove")} aria-label={t("np_remove")} disabled={s.layers.length < 2} onClick={() => set({ layers: s.layers.filter((_, j) => j !== k) })}>✕</button>
                  </span>
                  {r && !r.layers[k]?.excluded && r.layers[k] && <span className="th-r mono">R = {f(r.layers[k].R, 3)}</span>}
                </div>
              );
            })}
          </div>
          <button className="ghost" id="th-add" onClick={() => set({ layers: [...s.layers, { mat: "minwoolFacade", d: 50 }] })}>+ {t("th_addLayer")}</button>
        </fieldset>
        <fieldset>
          <legend><span className="step">3</span>{t("th_conditions")}</legend>
          <div className="grid2">
            {code === "DBN"
              ? <label className="wide"><span className="lbl">{t("th_zone")}</span>
                <select id="th-zone" value={s.zone} onChange={(e) => { const z = Number(e.target.value) as 1 | 2; set({ zone: z, te: TE_ZONE[z] }); }}>
                  <option value={1}>{t("th_zone1")}</option><option value={2}>{t("th_zone2")}</option></select></label>
              : <label className="wide"><span className="lbl">{t("th_umax")}</span>
                <select id="th-upreset" value={s.uPreset} onChange={(e) => set({ uPreset: e.target.value as ThermalState["uPreset"] })}>
                  {(["pl", "de", "own", "none"] as const).map((k) => <option key={k} value={k}>{t(`th_u_${k}`)}{k === "pl" || k === "de" ? ` · ${U_PRESET[k][s.element]}` : ""}</option>)}</select></label>}
            {code === "EN" && s.uPreset === "own" && <label className="wide"><span className="lbl">{t("th_Umax")}</span><NumInput id="th-umax" step={0.01} value={s.Umax} onChange={(e) => set({ Umax: num(e.target.value) })} /></label>}
            <label><span className="lbl">{t("th_ti")}</span><NumInput id="th-ti" step={1} value={s.ti} onChange={(e) => set({ ti: num(e.target.value) })} /></label>
            <label><span className="lbl">{t("th_phii")}</span><NumInput id="th-phii" step={5} min={1} max={100} value={s.phii} onChange={(e) => set({ phii: num(e.target.value) })} /></label>
            <label className="wide"><span className="lbl">{t("th_te")}</span><NumInput id="th-te" step={1} value={te} onChange={(e) => set(code === "DBN" ? { te: num(e.target.value) } : { teEN: num(e.target.value) })} /></label>
            <label className="wide"><span className="lbl">{t("th_climate")}</span>
              <select id="th-climate" value={s.climate} onChange={(e) => set(e.target.value === "custom" ? { climate: "custom", custom: clim } : { climate: e.target.value })}>
                {[...Object.keys(CLIMATES), "custom"].map((k) => <option key={k} value={k}>{t(`th_c_${k}`)}</option>)}</select></label>
          </div>
          <p className="hint">{t("th_climateHint")}</p>
        </fieldset>
        <details className="adv">
          <summary>{t("advanced")}<span className="adv-hint">r, R_q,min, φ_si</span></summary>
          <div className="adv-group">
            <div className="grid2">
              <label><span className="lbl">{t("th_r")}</span><NumInput id="th-r" step={0.05} min={0.3} max={1} value={s.r} onChange={(e) => set({ r: Math.min(1, Math.max(0.3, num(e.target.value) || 1)) })} /></label>
              {code === "DBN"
                ? <label><span className="lbl">{t("th_Rmin")}</span><NumInput id="th-rmin" step={0.1} placeholder={String(RQ_MIN[s.element][s.zone - 1])} value={s.Rmin} onChange={(e) => set({ Rmin: e.target.value })} /></label>
                : <label><span className="lbl">{t("th_phiCrit")}</span><NumInput id="th-phic" step={5} min={50} max={100} value={s.phiCrit} onChange={(e) => set({ phiCrit: num(e.target.value) })} /></label>}
            </div>
            <p className="hint">{t("th_rHint")}{code === "DBN" ? ` ${t("th_RminHint")}.` : ""}</p>
            {s.climate === "custom" && <>
              <div className="lbl">{t("th_custClimate")}</div>
              <div className="th-clim">
                {s.custom.map((c, m) => <div key={m} className="th-cm"><span>{mn[m]}</span>
                  <NumInput id={`th-cte-${m}`} step={0.5} value={c.te} aria-label={`${mn[m]} t`} onChange={(e) => set({ custom: s.custom.map((x, j) => (j === m ? { ...x, te: num(e.target.value) } : x)) })} />
                  <NumInput id={`th-cph-${m}`} step={1} min={1} max={100} value={c.phie} aria-label={`${mn[m]} φ`} onChange={(e) => set({ custom: s.custom.map((x, j) => (j === m ? { ...x, phie: num(e.target.value) } : x)) })} /></div>)}
              </div>
            </>}
          </div>
        </details>
      </aside>

      <section className="output">
        <div className="tabs" role="tablist">
          {(["results", "report"] as const).map((k) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{t(`tab_${k}`)}</button>
          ))}
        </div>
        {calc.err && <p className="error">{calc.err}</p>}
        {r && tab === "results" && (
          <div className="results">
            {summary}
            <div className="panel"><h3>{t("th_profile")}</h3><Chart r={r} layers={s.layers} t={t} mode="temp" ti={s.ti} te={te} /></div>
            <div className="panel"><h3>{t("results")}</h3><CheckList checks={r.checks} t={t} /></div>
            <div className="panel"><h3>{t("th_layerTable")}</h3>{layerTable}</div>
            <div className="panel"><h3>{t("th_glaser")}</h3><Chart r={r} layers={s.layers} t={t} mode="vap" ti={s.ti} te={te} /><p className="hint">{t("th_glaserHint")}</p>
              <h3>{t("th_moist")}</h3>{moist}</div>
          </div>
        )}
        {r && tab === "report" && (
          <div className="report-wrap">
            <div className="report-tools">
              <input id="th-obj" placeholder={t("objPlaceholder")} value={s.obj} onChange={(e) => set({ obj: e.target.value })} />
              <input id="th-elem" placeholder={t("thPlaceholder")} value={s.elem} onChange={(e) => set({ elem: e.target.value })} />
              <button className="primary" onClick={() => window.print()}>{t("print")}</button>
            </div>
            <article className="report">
              <header className="rep-head">
                <h1>{t("rep_titleThermal")}</h1>
                <dl>
                  <div><dt>{t("rep_object")}</dt><dd>{s.obj || "—"}</dd></div>
                  <div><dt>{t("rep_element")}</dt><dd>{s.elem || t(`th_el_${s.element}`)}</dd></div>
                  <div><dt>{t("rep_code")}</dt><dd>{code === "DBN" ? "ДБН В.2.6-31:2021; ДСТУ EN ISO 13788; EN ISO 6946" : "EN ISO 6946; EN ISO 13788"}</dd></div>
                  <div><dt>{t("rep_date")}</dt><dd>{new Date().toLocaleDateString()}</dd></div>
                </dl>
              </header>
              <h2>{t("rep_summary")}</h2>
              {summary}
              <h2>{t("rep_inputs")}</h2>
              <table className="rep-table"><tbody>
                <tr><td>{t("th_construction")}</td><td>{t(`th_el_${s.element}`)}{code === "DBN" ? ` · ${t(`th_b_${s.building}`)} · ${t(s.zone === 1 ? "th_zone1" : "th_zone2")}` : ""}</td></tr>
                <tr><td>{t("th_conditions")}</td><td>θ<sub>int</sub> = {s.ti} °C, φ<sub>int</sub> = {s.phii} %; θ<sub>e</sub> = {te} °C; R<sub>si</sub> = {f(r.Rsi, 3)}, R<sub>se</sub> = {f(r.Rse, 3)} m²·K/W{s.r !== 1 ? `; r = ${s.r}` : ""}</td></tr>
                <tr><td>{t("th_climate")}</td><td>{t(`th_c_${s.climate}`)}: {clim.map((c, m) => `${mn[m]} ${c.te}°/${c.phie}%`).join("; ")}</td></tr>
              </tbody></table>
              <h2>{t("th_layerTable")}</h2>
              {layerTable}
              <Chart r={r} layers={s.layers} t={t} mode="temp" ti={s.ti} te={te} />
              <h2>{t("rep_checks")}</h2>
              <CheckList checks={r.checks} t={t} />
              <h2>{t("th_moist")}</h2>
              <Chart r={r} layers={s.layers} t={t} mode="vap" ti={s.ti} te={te} />
              {moist}
              <p className="disclaimer">{t("disclaimer")}</p>
            </article>
          </div>
        )}
        <p className="disclaimer">{t("disclaimer")}</p>
      </section>
    </main>
  );
}
