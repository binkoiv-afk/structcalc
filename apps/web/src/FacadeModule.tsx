// Фасади: стоечно-ригельна система (СРС). Крок за кроком: сітка і схема стояка → вітер → скло → профілі.
// Результат: схема стояка з кронштейнами і вкладишами, епюра моментів, прогини між кронштейнами, ригелі, реакції на кронштейни.
import { useMemo } from "react";
import { NumInput } from "./NumInput";
import {
  ALLOYS, annex, checkCurtainWall, CITIES_UA, climateEN, CodeId, cpeWall, CW_PROFILES, CwInput, CwLimit, CwResult, CwScheme,
  TerrainDBN, vb0Zone, windDBN, windNational,
} from "@structcalc/core";
import { CheckList, governing, pct, T, utilState } from "./Results";

type Zone = "A" | "B" | "C" | "S";
export interface FacadeState {
  a: number; edge: boolean; scheme: CwScheme; L1: number; L2: number; c: number; hang: boolean; panes: string;
  city: string; W0: number; T: number; terr: TerrainDBN; cityEN: string; vbZone: string; alt: number; vb: number; terrEN: string;
  z: number; hd: number; zone: Zone;
  glass: string; ab: number; e: number; e0: number;
  alloy: string; mArt: string; mIx: number; mIy: number; mWx: number; mWy: number; mA: number; mtw: number; mD: number;
  tArt: string; tIx: number; tIy: number; tWx: number; tWy: number; tD: number; tAm: number; ttt: number;
  insert: boolean; iI: number; iW: number; ify: number;
  limit: CwLimit; custDiv: number; custCap: number;
}

// оцінки W і A за глибиною D і шириною b, якщо виробник не дав значень (позначено в UI)
const estW = (Ix: number, D: number) => +(Ix / (0.055 * (D + 12))).toFixed(1); // см³: I/(0.55·(D+12 мм))
const estWy = (Iy: number, b: number) => +(Iy / (b / 20)).toFixed(1);
const estA = (D: number, b: number, t: number) => +((2 * (D + b) * t) / 100).toFixed(2);
const bOf = (sys: string) => (sys.includes("60") ? 60 : 50);
const fromProfile = (art: string, role: "m" | "t") => {
  const p = CW_PROFILES.find((x) => x.art === art && x.role === role);
  if (!p) return null;
  const b = bOf(p.sys);
  return { Ix: p.Ix, Iy: p.Iy, D: p.D, Wx: estW(p.Ix, p.D), Wy: estWy(p.Iy, b), A: estA(p.D, b, 2.2) };
};
const m0 = fromProfile("322300", "m")!, t0 = fromProfile("322410", "t")!;

export const initialFacade: FacadeState = {
  a: 1.5, edge: false, scheme: "gerber", L1: 3.6, L2: 3.6, c: 0.4, hang: true, panes: "1.2 2.4",
  city: "Київ", W0: 370, T: 50, terr: "III", cityEN: "", vbZone: "", alt: 100, vb: 25, terrEN: "III",
  z: 30, hd: 1, zone: "A",
  glass: "6 6", ab: 100, e: 20, e0: 10,
  alloy: "6060-T66", mArt: "322300", mIx: m0.Ix, mIy: m0.Iy, mWx: m0.Wx, mWy: m0.Wy, mA: m0.A, mtw: 2.2, mD: m0.D,
  tArt: "322410", tIx: t0.Ix, tIy: t0.Iy, tWx: t0.Wx, tWy: t0.Wy, tD: t0.D, tAm: 0, ttt: 0,
  insert: false, iI: 100, iW: 15, ify: 235,
  limit: "2015", custDiv: 300, custCap: 15,
};

const nums = (s: string) => s.replace(/,/g, ".").split(/[\s;+]+/).filter(Boolean).map(Number);
const f = (v: number, n = 2) => (Number.isFinite(v) ? (Math.abs(v) < 0.5 * 10 ** -n ? 0 : v).toFixed(n) : "—");

/** Фасад стояка: кронштейни, вкладиші, панелі, епюра M збоку */
function Elevation({ r, panes, scheme, t }: { r: CwResult; panes: number[]; scheme: CwScheme; t: T }) {
  const W = 460, H = 520, top = 24, bot = 30, sc = (H - top - bot) / r.length, X0 = 190;
  const Y = (x: number) => H - bot - x * sc;
  const Mabs = Math.max(r.Mmax, 1e-9), ms = 120 / Mabs;
  const path = r.pts.map((p, k) => `${k ? "L" : "M"}${(X0 + p.M * ms).toFixed(1)},${Y(p.x).toFixed(1)}`).join(" ");
  const storey = scheme === "gerber" ? r.supports[1] : r.length;
  const paneEdges: number[] = [];
  for (let base = 0; base < r.length - 1e-6; base += storey) { let y = base; for (const h of panes) { y += h; if (y <= r.length + 1e-6) paneEdges.push(y); } }
  const kMax = r.pts.reduce((k, p, i) => (Math.abs(p.M) > Math.abs(r.pts[k].M) ? i : k), 0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="cw-elev" role="img" aria-label={t("cw_scheme")}>
      <rect x={8} y={Y(r.length)} width={56} height={r.length * sc} className="cw-glass" />
      {paneEdges.map((y, k) => <line key={k} x1={8} x2={64} y1={Y(y)} y2={Y(y)} className="cw-transom" />)}
      <line x1={X0} x2={X0} y1={Y(0)} y2={Y(r.length)} className="cw-mull" />
      <path d={`${path} L${X0},${Y(r.length)} L${X0},${Y(0)} Z`} className="cw-mfill" />
      <path d={path} className="cw-mline" />
      {r.supports.map((x, k) => (
        <g key={`s${k}`}>
          <path d={`M${X0 - 2},${Y(x)} l-14,-8 v16 z`} className="cw-brk" />
          <text x={W - 4} y={Y(x) + 4} className="cw-lbl" textAnchor="end">R = {f(r.reactions[k].R)} kN</text>
        </g>
      ))}
      {r.hinges.map((x, k) => <circle key={`h${k}`} cx={X0} cy={Y(x)} r={4.5} className="cw-hinge" />)}
      <text x={X0 + r.pts[kMax].M * ms + (r.pts[kMax].M >= 0 ? 6 : -6)} y={Y(r.pts[kMax].x) + 4} className="cw-lbl" textAnchor={r.pts[kMax].M >= 0 ? "start" : "end"}>{f(r.pts[kMax].M)} kN·m</text>
      <text x={X0} y={H - 8} className="cw-lbl" textAnchor="middle">q = {f(r.q)} kN/m</text>
      <text x={36} y={H - 8} className="cw-lbl" textAnchor="middle">{t("cw_panes")}</text>
    </svg>
  );
}

export function FacadeModule({ code, s, set, t }: { code: CodeId; s: FacadeState; set: (p: Partial<FacadeState>) => void; t: T }) {
  const li = Number(t("lc_li")) || 0;
  const cl = code === "EN" ? climateEN(annex().id) : undefined;
  const panes = nums(s.panes).filter((x) => x > 0.05 && x < 10);
  const glass = nums(s.glass).filter((x) => x > 0 && x < 40);
  const spans = s.scheme === "two" ? [s.L1, s.L2] : [s.L1];
  const pieceL = s.scheme === "gerber" ? s.L1 : s.scheme === "two" ? s.L1 + s.L2 : s.scheme === "cant" ? s.L1 + s.c : s.L1;
  const panesSum = panes.reduce((a, b) => a + b, 0);
  const areaM = s.a * Math.max(...spans), areaT = s.a * Math.max(...(panes.length ? panes : [1]));

  // вітер: характеристичні тиск (+) і відсос (−), кПа; коефіцієнт для ULS
  const wind = useMemo(() => {
    if (code === "DBN") {
      const caerS = { A: -1.0, B: -0.8, C: -0.5, S: -2.0 }[s.zone];
      const base = windDBN({ W0: s.W0, z: s.z, terrain: s.terr, Caer: 1, T: s.T });
      const w0 = (s.W0 * base.Ch) / 1000; // кПа при C_aer = 1
      const wP = w0 * (0.8 + 0.2), wS = w0 * (caerS - 0.2);
      return { wP, wS, wPt: wP, wSt: wS, gW: base.gfm, gG: 1.1, txt: `W0 = ${s.W0} Pa; Ch = ${f(base.Ch)} (z = ${s.z} m, ${s.terr}); C_aer: +0.8 / ${caerS}; C_i = ∓0.2; C_d = 1; γfm = ${f(base.gfm)} (T = ${s.T})`, qp: w0 };
    }
    const vz = cl?.windZones.find((z) => z.id === s.vbZone);
    const vb = vz ? vb0Zone(cl!, vz.id, s.alt) : s.vb;
    const qp = windNational(cl, { vb, z: s.z, terrain: s.terrEN, cpe: 1, A: s.alt }).qp / 1000;
    const zz = s.zone === "S" ? "A" : s.zone;
    const D = (A: number) => cpeWall("D", s.hd, A).cpe, Su = (A: number) => cpeWall(zz, s.hd, A).cpe;
    const na = annex();
    return {
      wP: qp * (D(areaM) + 0.3), wS: qp * (Su(areaM) - 0.2), wPt: qp * (D(areaT) + 0.3), wSt: qp * (Su(areaT) - 0.2), gW: na.e1990.gQ, gG: na.e1990.gG,
      txt: `vb = ${f(vb)} m/s; qp(z = ${s.z} m) = ${f(qp, 3)} kPa; c_pe(D) = ${f(D(areaM))}, c_pe(${zz}) = ${f(Su(areaM))} (A = ${f(areaM, 1)} m²); c_pi = −0.3 / +0.2`, qp,
    };
  }, [code, cl, s.zone, s.W0, s.z, s.terr, s.T, s.vbZone, s.alt, s.vb, s.terrEN, s.hd, areaM, areaT]);

  const calc = useMemo(() => {
    if (!panes.length || !glass.length) return { err: t("cw_bad") };
    const inp: CwInput = {
      code, a: s.a, edge: s.edge, scheme: s.scheme, spans, c: s.c, hang: s.hang, panes,
      wP: wind.wP, wS: wind.wS, wPt: wind.wPt, wSt: wind.wSt, gW: wind.gW, gG: wind.gG,
      glass, ab: s.ab, e: s.e, e0: s.e0, alloy: s.alloy,
      mullion: { Ix: s.mIx, Iy: s.mIy, Wx: s.mWx, Wy: s.mWy, A: s.mA, tw: s.mtw, D: s.mD },
      transom: { Ix: s.tIx, Iy: s.tIy, Wx: s.tWx, Wy: s.tWy, A: 0, tw: 0, D: s.tD, Am: s.tAm, tt: s.ttt },
      insert: s.insert ? { I: s.iI, W: s.iW, fy: s.ify } : { I: 0, W: 0, fy: 235 },
      limit: s.limit, custDiv: s.custDiv, custCap: s.custCap,
    };
    try { return { r: checkCurtainWall(inp) }; } catch (e) { return { err: String((e as Error).message) }; }
  }, [s, wind, code]); // eslint-disable-line react-hooks/exhaustive-deps

  const N = (key: keyof FacadeState, step = "0.1", extra?: { min?: number }) => (
    <NumInput id={`cw_${key}`} step={step} min={extra?.min} value={s[key] as number} onChange={(e) => set({ [key]: Number(e.target.value.replace(",", ".")) || 0 } as Partial<FacadeState>)} />
  );
  const pickM = (art: string) => { const p = fromProfile(art, "m"); set(p ? { mArt: art, mIx: p.Ix, mIy: p.Iy, mWx: p.Wx, mWy: p.Wy, mA: p.A, mD: p.D } : { mArt: "" }); };
  const pickT = (art: string) => { const p = fromProfile(art, "t"); set(p ? { tArt: art, tIx: p.Ix, tIy: p.Iy, tWx: p.Wx, tWy: p.Wy, tD: p.D } : { tArt: "" }); };
  const r = calc.r;
  const g = r ? governing(r.checks) : undefined;
  const maxU = r ? Math.max(...r.checks.map((c) => c.util)) : NaN, st = utilState(maxU);
  const tw = r ? r.transoms[r.tWorst] : undefined;

  return (
    <main className="layout">
      <aside className="inputs">
        <fieldset>
          <legend><span className="step">1</span>{t("cw_geom")}</legend>
          <div className="grid2">
            <label><span className="lbl">{t("cw_a")}</span>{N("a", "0.05")}</label>
            <label className="check"><input id="cw_edge" type="checkbox" checked={s.edge} onChange={(e) => set({ edge: e.target.checked })} /> {t("cw_edge")}</label>
            <label className="wide"><span className="lbl">{t("cw_schemeL")}</span>
              <select id="cw_scheme" value={s.scheme} onChange={(e) => set({ scheme: e.target.value as CwScheme })}>
                {(["gerber", "single", "two", "cant"] as const).map((k) => <option key={k} value={k}>{t(`cw_sc_${k}`)}</option>)}
              </select>
            </label>
            <label><span className="lbl">{s.scheme === "gerber" ? t("cw_H") : s.scheme === "two" ? "L1, m" : "L, m"}</span>{N("L1", "0.1")}</label>
            {s.scheme === "two" && <label><span className="lbl">L2, m</span>{N("L2", "0.1")}</label>}
            {(s.scheme === "cant" || s.scheme === "gerber") && <label><span className="lbl">{s.scheme === "gerber" ? t("cw_cG") : t("cw_cC")}</span>{N("c", "0.05")}</label>}
            {s.scheme !== "gerber" && (
              <label className="wide"><span className="lbl">{t("cw_hangL")}</span>
                <select id="cw_hang" value={s.hang ? "1" : "0"} onChange={(e) => set({ hang: e.target.value === "1" })}>
                  <option value="1">{t("cw_hang1")}</option><option value="0">{t("cw_hang0")}</option>
                </select>
              </label>
            )}
            <label className="wide"><span className="lbl">{t("cw_panesL")}</span>
              <input id="cw_panes" value={s.panes} onChange={(e) => set({ panes: e.target.value })} />
            </label>
          </div>
          {Math.abs(panesSum - pieceL) > 0.05 * pieceL && panes.length > 0 && <p className="hint warn">{t("cw_panesSum")} ({f(panesSum)} / {f(pieceL)} m)</p>}
          <p className="hint">{t(`cw_sch_h_${s.scheme}`)}</p>
        </fieldset>

        <fieldset>
          <legend><span className="step">2</span>{t("cw_wind")} · {code === "DBN" ? "ДБН В.1.2-2" : cl ? `${annex().prefix} 1991-1-4` : "EN 1991-1-4"}</legend>
          <div className="grid2">
            {code === "DBN" ? <>
              <label className="wide"><span className="lbl">{t("lc_city")}</span>
                <select id="cw_city" value={s.city} onChange={(e) => { const row = CITIES_UA.find((x) => x[0] === e.target.value); set(row ? { city: row[0], W0: row[2] } : { city: "" }); }}>
                  <option value="">{t("lc_custom")}</option>
                  {CITIES_UA.map((x) => <option key={x[0] + x[1]} value={x[0]}>{x[0]}{x[1] ? ` · ${x[1]}` : ""}</option>)}
                </select>
              </label>
              <label><span className="lbl">W0, Pa</span>{N("W0", "10")}</label>
              <label><span className="lbl">T, {t("lc_years")}</span>{N("T", "5")}</label>
              <label className="wide"><span className="lbl">{t("lc_terrain")}</span>
                <select id="cw_terr" value={s.terr} onChange={(e) => set({ terr: e.target.value as TerrainDBN })}>
                  {(["I", "II", "III", "IV"] as const).map((x) => <option key={x} value={x}>{x} — {t(`terr_${x}`)}</option>)}
                </select>
              </label>
            </> : <>
              {cl && cl.cities.length > 0 && (
                <label className="wide"><span className="lbl">{t("lc_cityEN")}</span>
                  <select id="cw_cityEN" value={s.cityEN} onChange={(e) => { const row = cl.cities.find((x) => x.name === e.target.value); set(row ? { cityEN: row.name, vbZone: row.wind, alt: row.alt } : { cityEN: "" }); }}>
                    <option value="">{t("lc_custom")}</option>
                    {cl.cities.map((x) => <option key={x.name + x.region} value={x.name}>{x.name}{x.region ? ` · ${x.region}` : ""}{x.wSt === "l" ? " ≈" : ""}</option>)}
                  </select>
                </label>
              )}
              {cl && (
                <label><span className="lbl">{t("lc_zoneW")}</span>
                  <select id="cw_vbZone" value={s.vbZone} onChange={(e) => set({ vbZone: e.target.value, cityEN: "" })}>
                    <option value="">{t("lc_zManual")}</option>
                    {cl.windZones.map((z) => <option key={z.id} value={z.id}>{z.id} — {+z.vb0(0).toFixed(1)} m/s</option>)}
                  </select>
                </label>
              )}
              {cl && <label><span className="lbl">{t("lc_alt")}</span>{N("alt", "10")}</label>}
              {!(cl && cl.windZones.some((z) => z.id === s.vbZone)) && <label><span className="lbl">v<sub>b</sub>, m/s</span>{N("vb", "0.5")}</label>}
              <label className="wide"><span className="lbl">{t("lc_terrain")}</span>
                <select id="cw_terrEN" value={s.terrEN} onChange={(e) => set({ terrEN: e.target.value })}>
                  {(cl?.terrains ?? (["0", "I", "II", "III", "IV"] as const).map((id) => ({ id, name: null as null | string[] }))).map((x) => <option key={x.id} value={x.id}>{x.id.startsWith("DE-") ? "" : x.id}{x.name ? ` — ${x.name[li]}` : ""}</option>)}
                </select>
              </label>
              <label><span className="lbl">{t("cw_hd")}</span>{N("hd", "0.25")}</label>
            </>}
            <label><span className="lbl">{t("cw_z")}</span>{N("z", "1")}</label>
            <label className="wide"><span className="lbl">{t("cw_zone")}</span>
              <select id="cw_zone" value={s.zone} onChange={(e) => set({ zone: e.target.value as Zone })}>
                {(["A", "B", "C", "S"] as const).filter((z) => code === "DBN" || z !== "S").map((z) => <option key={z} value={z}>{t(`cw_zone_${z}${code === "DBN" ? "d" : ""}`)}</option>)}
              </select>
            </label>
          </div>
          <div className="lc-out"><span>w<sup>+</sup> = <b>{f(wind.wP, 3)}</b> kPa</span><span>w<sup>−</sup> = <b>{f(wind.wS, 3)}</b> kPa</span><span>{code === "DBN" ? "γfm" : "γQ"} = <b>{f(wind.gW)}</b></span></div>
          <p className="hint mono">{wind.txt}</p>
        </fieldset>

        <fieldset>
          <legend><span className="step">3</span>{t("cw_glassT")}</legend>
          <div className="grid2">
            <label className="wide"><span className="lbl">{t("cw_glassL")}</span><input id="cw_glass" value={s.glass} onChange={(e) => set({ glass: e.target.value })} /></label>
            <label><span className="lbl">{t("cw_ab")}</span>{N("ab", "10")}</label>
            <label><span className="lbl">{t("cw_e")}</span>{N("e", "1")}</label>
            <label><span className="lbl">{t("cw_e0")}</span>{N("e0", "1")}</label>
          </div>
          <p className="hint">{t("cw_glassH")}</p>
        </fieldset>

        <fieldset>
          <legend><span className="step">4</span>{t("cw_prof")}</legend>
          <div className="grid2">
            <label className="wide"><span className="lbl">{t("cw_alloy")}</span>
              <select id="cw_alloy" value={s.alloy} onChange={(e) => set({ alloy: e.target.value })}>
                {ALLOYS.map((x) => <option key={x.id} value={x.id}>{x.id}: f0 = {x.f0}, fu = {x.fu} MPa (t {x.tmax} mm)</option>)}
              </select>
            </label>
            <label className="wide"><span className="lbl">{t("cw_mull")}</span>
              <select id="cw_mArt" value={s.mArt} onChange={(e) => pickM(e.target.value)}>
                <option value="">{t("cw_own")}</option>
                {CW_PROFILES.filter((p) => p.role === "m").map((p) => <option key={p.art} value={p.art}>{p.sys} · {p.art} · {p.D}{p.Dest ? "≈" : ""} mm · Ix {p.Ix} cm⁴</option>)}
              </select>
            </label>
            <label><span className="lbl">I<sub>x</sub>, cm⁴</span>{N("mIx", "1")}</label>
            <label><span className="lbl">I<sub>y</sub>, cm⁴</span>{N("mIy", "1")}</label>
            <label><span className="lbl">W<sub>x</sub>, cm³{s.mArt ? " ≈" : ""}</span>{N("mWx", "0.5")}</label>
            <label><span className="lbl">A, cm²{s.mArt ? " ≈" : ""}</span>{N("mA", "0.1")}</label>
            <label><span className="lbl">D, mm</span>{N("mD", "5")}</label>
            <label><span className="lbl">t<sub>w</sub>, mm</span>{N("mtw", "0.1")}</label>
            <label className="check wide"><input id="cw_insert" type="checkbox" checked={s.insert} onChange={(e) => set({ insert: e.target.checked })} /> {t("cw_insertL")}</label>
            {s.insert && <>
              <label><span className="lbl">I<sub>st</sub>, cm⁴</span>{N("iI", "1")}</label>
              <label><span className="lbl">W<sub>st</sub>, cm³</span>{N("iW", "0.5")}</label>
              <label><span className="lbl">f<sub>y</sub>, MPa</span>{N("ify", "5")}</label>
            </>}
            <label className="wide"><span className="lbl">{t("cw_trans")}</span>
              <select id="cw_tArt" value={s.tArt} onChange={(e) => pickT(e.target.value)}>
                <option value="">{t("cw_own")}</option>
                {CW_PROFILES.filter((p) => p.role === "t").map((p) => <option key={p.art} value={p.art}>{p.sys} · {p.art} · Ix {p.Ix} / Iy {p.Iy} cm⁴</option>)}
              </select>
            </label>
            <label><span className="lbl">I<sub>x</sub>, cm⁴</span>{N("tIx", "1")}</label>
            <label><span className="lbl">I<sub>y</sub>, cm⁴</span>{N("tIy", "1")}</label>
            <label><span className="lbl">W<sub>x</sub>, cm³{s.tArt ? " ≈" : ""}</span>{N("tWx", "0.5")}</label>
            <label><span className="lbl">W<sub>y</sub>, cm³{s.tArt ? " ≈" : ""}</span>{N("tWy", "0.5")}</label>
            <label><span className="lbl">{t("cw_Am")}</span>{N("tAm", "1")}</label>
            <label><span className="lbl">{t("cw_tt")}</span>{N("ttt", "0.1")}</label>
            <label className="wide"><span className="lbl">{t("cw_limit")}</span>
              <select id="cw_limit" value={s.limit} onChange={(e) => set({ limit: e.target.value as CwLimit })}>
                {(["2015", "2003", "custom"] as const).map((k) => <option key={k} value={k}>{t(`cw_lim_${k}`)}</option>)}
              </select>
            </label>
            {s.limit === "custom" && <>
              <label><span className="lbl">L / …</span>{N("custDiv", "10")}</label>
              <label><span className="lbl">{t("cw_cap")}</span>{N("custCap", "1")}</label>
            </>}
          </div>
          <p className="hint">{t("cw_profH")}</p>
        </fieldset>
      </aside>

      <section className="output">
        {calc.err && <p className="error">{calc.err}</p>}
        {r && (
          <div className="results">
            <div className={`summary ${st}`}>
              <div className="summary-main">
                <div className="eyebrow">{t("cw_mull")}</div>
                <div className="profile">{s.mArt ? `${CW_PROFILES.find((p) => p.art === s.mArt)?.sys} ${s.mArt}` : `Ix ${s.mIx} cm⁴`}</div>
                <div className="meta">{s.alloy} · f0 = {r.f0} MPa · γM1 = {r.gM1}{s.insert ? ` · ${t("cw_withInsert")}` : ""}</div>
              </div>
              <div className="summary-util">
                <div className="eyebrow">{t("rep_maxutil")}</div>
                <div className="big">{pct(maxU)}</div>
                <div className={`pill ${st}`}>{maxU <= 1 ? t("ok") : t("fail")}</div>
              </div>
              {g && <div className="summary-gov"><div className="eyebrow">{t("governing")}</div><div>{t(`chk_${g.key}`)}</div></div>}
            </div>
            <div className="panel two-col">
              <div>
                <h3>{t("cw_scheme")}</h3>
                <Elevation r={r} panes={panes} scheme={s.scheme} t={t} />
                <p className="hint">{t("cw_elevH")}</p>
              </div>
              <div>
                <h3>{t("cw_forces")}</h3>
                <table className="rep-table cw-tab">
                  <tbody>
                    <tr><td>q<sub>w</sub> = w·b</td><td className="mono">{f(r.q, 3)} kN/m</td></tr>
                    <tr><td>M<sub>max</sub> / V<sub>max</sub> ({t("cw_char")})</td><td className="mono">{f(r.Mmax, 3)} kN·m / {f(r.Vmax, 3)} kN</td></tr>
                    <tr><td>{t("cw_Gst")}</td><td className="mono">{f(r.Gstorey, 3)} + {f(r.selfW, 3)} = {f(r.N, 3)} kN</td></tr>
                    {s.insert && <tr><td>{t("cw_share")}</td><td className="mono">{f(r.shareAl * 100, 0)} % / {f(100 - r.shareAl * 100, 0)} %</td></tr>}
                  </tbody>
                </table>
                <h3>{t("cw_brackets")}</h3>
                <table className="rep-table cw-tab">
                  <thead><tr><th>x, m</th><th>H<sub>k</sub>, kN</th><th>H<sub>d</sub>, kN</th></tr></thead>
                  <tbody>{r.reactions.map((x, k) => <tr key={k}><td className="mono">{f(x.x)}</td><td className="mono">{f(x.R, 3)}</td><td className="mono">{f(x.R * wind.gW, 3)}</td></tr>)}</tbody>
                </table>
                <p className="hint">{t("cw_brkH")} V<sub>d</sub> = {f(r.N * wind.gG, 3)} kN.</p>
                <h3>{t("cw_defl")}</h3>
                <table className="rep-table cw-tab">
                  <tbody>{r.defl.map((d, k) => <tr key={k} className={d.w > d.lim ? "bad" : ""}><td className="mono">{f(d.from)}–{f(d.to)} m{d.cant ? ` (${t("cw_cant")})` : ""}</td><td className="mono">{f(d.w, 1)} / {f(d.lim, 1)} mm</td></tr>)}</tbody>
                </table>
              </div>
            </div>
            <div className="panel">
              <h3>{t("cw_transoms")}</h3>
              <div className="fs-scroll">
                <table className="rep-table cw-tab">
                  <thead><tr><th>#</th><th>{t("cw_hBA")}</th><th>G, kN</th><th>M<sub>x</sub> / M<sub>y</sub>, kN·m</th><th>f<sub>w</sub> / f<sub>g</sub>, mm</th><th>{t("cw_util")}</th></tr></thead>
                  <tbody>{r.transoms.map((x) => (
                    <tr key={x.i} className={x.i === r.tWorst ? "sel" : ""}>
                      <td>{x.i + 1}</td><td className="mono">{f(x.hB)} / {f(x.hA)}</td><td className="mono">{f(x.G, 3)}</td>
                      <td className="mono">{f(x.Mx, 3)} / {f(x.My, 3)}</td><td className="mono">{f(x.fw, 1)} / {f(x.fg, 2)}</td><td className="mono">{pct(x.util)}</td>
                    </tr>))}
                  </tbody>
                </table>
              </div>
              {tw && <p className="hint">{t("cw_tWorst")} {tw.i + 1}.</p>}
            </div>
            <div className="panel"><h3>{t("results")}</h3><CheckList checks={r.checks} t={t} /></div>
            <p className="hint">{t("cw_notes")}</p>
          </div>
        )}
      </section>
    </main>
  );
}
