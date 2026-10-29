import { NumInput } from "./NumInput";
import {
  annex, CAER_PRESETS, CITIES_UA, climateEN, CodeId, skZone, snowDBN, snowEN, TEF_PRESETS, TerrainDBN, UserLoad, vb0Zone, windDBN, windNational,
} from "@structcalc/core";

// Сбор снеговой и ветровой нагрузки → погонная нагрузка на балку (через ширину грузовой площади).
export interface CollectorState {
  city: string; S0: number; W0: number; alpha: number; uneven: boolean; Ce: number; H: number;
  T: number; eta: number; width: number; z: number; terrain: TerrainDBN; flexible: boolean; caer: number;
  sk: number; Ct: number; vb: number; terrainEN: string; cpe: number;
  cityEN: string; snowZone: string; windZone: string; alt: number; cdir: number;
}

export const initialCollector: CollectorState = {
  city: "Київ", S0: 1550, W0: 370, alpha: 10, uneven: false, Ce: 1, H: 0, T: 100, eta: 0.02, width: 3,
  z: 10, terrain: "III", flexible: false, caer: 0.8, sk: 1000, Ct: 1, vb: 25, terrainEN: "II", cpe: 0.8,
  cityEN: "", snowZone: "", windZone: "", alt: 100, cdir: 1,
};

const num = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(",", ".")));
const f2 = (x: number) => x.toFixed(2);
const kPa = (pa: number) => (pa / 1000).toFixed(3);

export function LoadCollector({ code, c, set, onAdd, t }: {
  code: CodeId; c: CollectorState; set: (p: Partial<CollectorState>) => void; onAdd: (l: UserLoad) => void; t: (k: string) => string;
}) {
  const N = (key: keyof CollectorState, step = "0.1", id = `lc_${key}`) => (
    <NumInput id={id} step={step} value={c[key] as number} onChange={(e) => set({ [key]: num(e.target.value) } as Partial<CollectorState>)} />
  );
  const b = c.width;

  if (code === "DBN") {
    const sn = snowDBN({ S0: c.S0, alpha: c.alpha, uneven: c.uneven, Ce: c.Ce, H: c.H, T: c.T, eta: c.eta });
    const wn = windDBN({ W0: c.W0, z: c.z, terrain: c.terrain, flexible: c.flexible, Caer: c.caer, H: c.H, T: c.T, eta: c.eta });
    const qs = (sn.S0 * sn.C * b) / 1000, qw = (wn.W0 * wn.C * b) / 1000;
    const snowNote = `${t("lc_snow")} (ДБН В.1.2-2, 8.2–8.12): S0 = ${c.S0} Pa${c.city ? ` (${c.city})` : ""}; μ = ${f2(sn.mu)}; Ce = ${f2(sn.Ce)}; Calt = ${f2(sn.Calt)}; C = ${f2(sn.C)}; `
      + `γfm = ${f2(sn.gfm)} (T = ${c.T}); γfe = ${f2(sn.gfe)} (η = ${c.eta}); b = ${f2(b)} m → Sm = ${kPa(sn.Sm)} kPa, Se = ${kPa(sn.Se)} kPa; q0 = S0·C·b = ${f2(qs)} kN/m`;
    const windNote = `${t("lc_wind")} (ДБН В.1.2-2, 9.4–9.15): W0 = ${c.W0} Pa${c.city ? ` (${c.city})` : ""}; Caer = ${f2(wn.Caer)}; Ch = ${f2(wn.Ch)} (z = ${c.z} m, ${t("lc_terrain").toLowerCase()} ${c.terrain}); Calt = ${f2(wn.Calt)}; C = ${f2(wn.C)}; `
      + `γfm = ${f2(wn.gfm)}; γfe = ${f2(wn.gfe)}; b = ${f2(b)} m → Wm = ${kPa(wn.Wm)} kPa, We = ${kPa(wn.We)} kPa; q0 = W0·C·b = ${f2(qw)} kN/m`;
    return (
      <fieldset>
        <legend>{t("lc_title")} · ДБН В.1.2-2</legend>
        <div className="grid2">
          <label className="wide"><span className="lbl">{t("lc_city")}</span>
            <select id="lc_city" value={c.city} onChange={(e) => {
              const row = CITIES_UA.find((r) => r[0] === e.target.value);
              set(row ? { city: row[0], W0: row[2], S0: row[3] } : { city: "" });
            }}>
              <option value="">{t("lc_custom")}</option>
              {CITIES_UA.map((r) => <option key={r[0] + r[1]} value={r[0]}>{r[0]}{r[1] ? ` · ${r[1]}` : ""}</option>)}
            </select>
          </label>
          <label><span className="lbl">S0, Pa</span>{N("S0", "10")}</label>
          <label><span className="lbl">W0, Pa</span>{N("W0", "10")}</label>
          <label className="wide"><span className="lbl">{t("lc_Tef")}</span>
            <select id="lc_tef" value={TEF_PRESETS.find((p) => p.Tef === c.T)?.key ?? ""} onChange={(e) => {
              const p = TEF_PRESETS.find((x) => x.key === e.target.value);
              if (p) set({ T: p.Tef });
            }}>
              <option value="">{t("lc_manual")}</option>
              {TEF_PRESETS.map((p) => <option key={p.key} value={p.key}>{t(`tef_${p.key}`)} — {p.Tef}</option>)}
            </select>
          </label>
          <label><span className="lbl">T, {t("lc_years")}</span>{N("T", "5")}</label>
          <label><span className="lbl">η</span>{N("eta", "0.005")}</label>
          <label><span className="lbl">H, km</span>{N("H", "0.1")}</label>
          <label><span className="lbl">{t("lc_width")}</span>{N("width", "0.1")}</label>
        </div>

        <div className="lc-block">
          <div className="lc-head">{t("lc_snow")}</div>
          <div className="grid2">
            <label><span className="lbl">{t("lc_alpha")}</span>{N("alpha", "1")}</label>
            <label><span className="lbl">Ce</span>{N("Ce", "0.1")}</label>
            <label className="check wide"><input id="lc_uneven" type="checkbox" checked={c.uneven} onChange={(e) => set({ uneven: e.target.checked })} /> {t("lc_uneven")}</label>
          </div>
          <div className="lc-out">
            <span>μ = <b>{f2(sn.mu)}</b></span><span>C = <b>{f2(sn.C)}</b></span><span>γfm = <b>{f2(sn.gfm)}</b></span><span>γfe = <b>{f2(sn.gfe)}</b></span>
            <span>Sm = <b>{kPa(sn.Sm)}</b> kPa</span><span>Se = <b>{kPa(sn.Se)}</b> kPa</span>
            <span>q<sub>m</sub> = <b>{f2(qs * sn.gfm)}</b> kN/m</span>
          </div>
          <button className="ghost" onClick={() => onAdd({ type: "udl", cat: "Q", q: +qs.toFixed(3), gf: +sn.gfm.toFixed(4), gfe: +sn.gfe.toFixed(4), label: t("lc_snow"), group: t("lc_snow"), psi0: 0.5, note: snowNote })}>{t("lc_addSnow")}</button>
        </div>

        <div className="lc-block">
          <div className="lc-head">{t("lc_wind")}</div>
          <div className="grid2">
            <label><span className="lbl">z, m</span>{N("z", "1")}</label>
            <label><span className="lbl">{t("lc_terrain")}</span>
              <select id="lc_terrain" value={c.terrain} onChange={(e) => set({ terrain: e.target.value as TerrainDBN })}>
                {(["I", "II", "III", "IV"] as const).map((x) => <option key={x} value={x}>{x} — {t(`terr_${x}`)}</option>)}
              </select>
            </label>
            <label className="wide"><span className="lbl">Caer</span>
              <select id="lc_caerp" value={CAER_PRESETS.find((p) => p.value === c.caer)?.key ?? ""} onChange={(e) => {
                const p = CAER_PRESETS.find((x) => x.key === e.target.value);
                if (p) set({ caer: p.value });
              }}>
                <option value="">{t("lc_manual")}</option>
                {CAER_PRESETS.map((p) => <option key={p.key} value={p.key}>{t(`caer_${p.key}`)}: {p.value > 0 ? "+" : ""}{p.value}</option>)}
              </select>
            </label>
            <label><span className="lbl">Caer</span>{N("caer", "0.05")}</label>
            <label className="check"><input id="lc_flex" type="checkbox" checked={c.flexible} onChange={(e) => set({ flexible: e.target.checked })} /> {t("lc_flexible")}</label>
          </div>
          <div className="lc-out">
            <span>Ch = <b>{f2(wn.Ch)}</b></span><span>C = <b>{f2(wn.C)}</b></span><span>γfm = <b>{f2(wn.gfm)}</b></span><span>γfe = <b>{f2(wn.gfe)}</b></span>
            <span>Wm = <b>{kPa(wn.Wm)}</b> kPa</span><span>We = <b>{kPa(wn.We)}</b> kPa</span>
            <span>q<sub>m</sub> = <b>{f2(qw * wn.gfm)}</b> kN/m</span>
          </div>
          <button className="ghost" onClick={() => onAdd({ type: "udl", cat: "Q", q: +qw.toFixed(3), gf: +wn.gfm.toFixed(4), gfe: +wn.gfe.toFixed(4), label: t("lc_wind"), group: t("lc_wind"), psi0: 0.6, note: windNote })}>{t("lc_addWind")}</button>
          <p className="hint">{t("lc_hintDBN")}</p>
        </div>
      </fieldset>
    );
  }

  // EN: країна — з активного національного додатка; зони й місто заповнюють s_k і v_b
  const cl = climateEN(annex().id), li = Number(t("lc_li")) || 0;
  const sz = cl?.snowZones.find((z) => z.id === c.snowZone), wz = cl?.windZones.find((z) => z.id === c.windZone);
  const terrains = cl?.terrains ?? null;
  const terrain = terrains && !terrains.some((x) => x.id === c.terrainEN) ? terrains.find((x) => x.id === "II")?.id ?? terrains[0].id : c.terrainEN;
  const sk = sz ? skZone(cl!, sz.id, c.alt) * 1000 : c.sk;
  const vb0 = wz ? vb0Zone(cl!, wz.id, c.alt) : NaN;
  const vb = wz ? +(vb0 * c.cdir).toFixed(2) : c.vb;
  const sn = snowEN({ sk, alpha: c.alpha, Ce: c.Ce, Ct: c.Ct });
  const wn = windNational(cl, { vb, z: c.z, terrain, cpe: c.cpe, A: c.alt });
  const qs = (sn.s * b) / 1000, qw = (wn.w * b) / 1000;
  const psiS = cl ? cl.psiSnow(c.alt) : 0.5, psiW = cl ? cl.psiWind : 0.6;
  const place = c.cityEN ? ` (${c.cityEN})` : "";
  const skSrc = sz ? `${cl!.snowRef}, ${t("lc_zoneS").toLowerCase()} ${sz.id}, A = ${c.alt} m: sk = ${sz.f} = ${f2(sk / 1000)} kN/m²` : `sk = ${sk} Pa`;
  const vbSrc = wz ? `${cl!.windRef}, ${t("lc_zoneW").toLowerCase()} ${wz.id}: vb,0 = ${f2(vb0)} m/s; vb = ${f2(c.cdir)}·vb,0 = ${f2(vb)} m/s` : `vb = ${vb} m/s`;
  const snowNote = `${t("lc_snow")} (EN 1991-1-3, 5.3.2)${place}: ${skSrc}; μ1 = ${f2(sn.mu)} (α = ${c.alpha}°); Ce = ${f2(sn.Ce)}; Ct = ${f2(sn.Ct)}; s = ${kPa(sn.s)} kPa; b = ${f2(b)} m → q = ${f2(qs)} kN/m; ψ0 = ${psiS}`;
  const windNote = `${t("lc_wind")} (EN 1991-1-4, 4.5)${place}: ${vbSrc}; ${t("lc_terrain").toLowerCase()} ${terrain}; z = ${c.z} m; `
    + (wn.f ? `qp = ${wn.f} = ${kPa(wn.qp)} kPa` : `cr = ${f2(wn.cr)}; Iv = ${f2(wn.Iv)}; qp = ${kPa(wn.qp)} kPa`) + ` (ce = ${f2(wn.ce)}); cpe = ${f2(c.cpe)}; we = ${kPa(wn.w)} kPa; b = ${f2(b)} m → q = ${f2(qw)} kN/m; ψ0 = ${psiW}`;
  const pickCity = (key: string) => {
    const row = cl?.cities.find((r) => `${r.name}|${r.region}` === key);
    set(row ? { cityEN: row.name, snowZone: row.snow, windZone: row.wind, alt: row.alt } : { cityEN: "" });
  };
  const terrList = terrains ?? (["0", "I", "II", "III", "IV"] as const).map((id) => ({ id, name: null as null | string[] }));
  return (
    <fieldset>
      <legend>{t("lc_title")} · {cl ? `${annex().prefix} 1991` : "EN 1991"}</legend>
      <div className="grid2">
        {cl && cl.cities.length > 0 && (
          <label className="wide"><span className="lbl">{t("lc_cityEN")}</span>
            <select id="lc_cityEN" value={cl.cities.find((r) => r.name === c.cityEN) ? `${c.cityEN}|${cl.cities.find((r) => r.name === c.cityEN)!.region}` : ""} onChange={(e) => pickCity(e.target.value)}>
              <option value="">{t("lc_custom")}</option>
              {cl.cities.map((r) => <option key={r.name + r.region} value={`${r.name}|${r.region}`}>{r.name}{r.region ? ` · ${r.region}` : ""}</option>)}
            </select>
          </label>
        )}
        {cl && <label><span className="lbl">{t("lc_alt")}</span>{N("alt", "10")}</label>}
        <label className={cl ? "" : "wide"}><span className="lbl">{t("lc_width")}</span>{N("width", "0.1")}</label>
      </div>
      <div className="lc-block">
        <div className="lc-head">{t("lc_snow")} · {cl ? cl.snowRef : "EN 1991-1-3"}</div>
        <div className="grid2">
          {cl && (
            <label><span className="lbl">{t("lc_zoneS")}</span>
              <select id="lc_zoneS" value={sz?.id ?? ""} onChange={(e) => set({ snowZone: e.target.value, cityEN: "" })}>
                <option value="">{t("lc_zManual")}</option>
                {cl.snowZones.map((z) => <option key={z.id} value={z.id}>{z.id}</option>)}
              </select>
            </label>
          )}
          {sz ? <label><span className="lbl">s<sub>k</sub>, Pa</span><output id="lc_sk" className="calc">{sk.toFixed(0)}</output></label>
            : <label><span className="lbl">s<sub>k</sub>, Pa</span>{N("sk", "50")}</label>}
          <label><span className="lbl">{t("lc_alpha")}</span>{N("alpha", "1")}</label>
          <label><span className="lbl">Ce</span>{N("Ce", "0.1")}</label>
          <label><span className="lbl">Ct</span>{N("Ct", "0.1")}</label>
        </div>
        {sz && <div className="lc-src">s<sub>k</sub> = {sz.f} = <b>{f2(sk / 1000)}</b> kN/m²</div>}
        <div className="lc-out"><span>μ1 = <b>{f2(sn.mu)}</b></span><span>s = <b>{kPa(sn.s)}</b> kPa</span><span>q = <b>{f2(qs)}</b> kN/m</span><span>ψ0 = <b>{psiS}</b></span></div>
        <button className="ghost" onClick={() => onAdd({ type: "udl", cat: "Q", q: +qs.toFixed(3), label: t("lc_snow"), group: t("lc_snow"), psi0: psiS, note: snowNote })}>{t("lc_addSnow")}</button>
      </div>
      <div className="lc-block">
        <div className="lc-head">{t("lc_wind")} · {cl ? cl.windRef : "EN 1991-1-4"}</div>
        <div className="grid2">
          {cl && (
            <label><span className="lbl">{t("lc_zoneW")}</span>
              <select id="lc_zoneW" value={wz?.id ?? ""} onChange={(e) => set({ windZone: e.target.value, cityEN: "" })}>
                <option value="">{t("lc_zManual")}</option>
                {cl.windZones.map((z) => <option key={z.id} value={z.id}>{z.id} — {z.vb0(0)} m/s</option>)}
              </select>
            </label>
          )}
          {wz ? <>
            <label><span className="lbl">{t("lc_cdir")}</span>{N("cdir", "0.05")}</label>
            <label><span className="lbl">v<sub>b</sub>, m/s</span><output id="lc_vb" className="calc">{f2(vb)}</output></label>
          </> : <label><span className="lbl">v<sub>b</sub>, m/s</span>{N("vb", "1")}</label>}
          <label><span className="lbl">z, m</span>{N("z", "1")}</label>
          <label className={terrains ? "wide" : ""}><span className="lbl">{t("lc_terrain")}</span>
            <select id="lc_terrainEN" value={terrain} onChange={(e) => set({ terrainEN: e.target.value })}>
              {terrList.map((x) => <option key={x.id} value={x.id}>{x.id.startsWith("DE-") ? "" : `${x.id}${x.name ? " — " : ""}`}{x.name ? x.name[li] : ""}</option>)}
            </select>
          </label>
          <label><span className="lbl">c<sub>pe</sub></span>{N("cpe", "0.05")}</label>
        </div>
        {wn.f && <div className="lc-src">q<sub>p</sub> = {wn.f}</div>}
        <div className="lc-out"><span>q<sub>p</sub> = <b>{kPa(wn.qp)}</b> kPa</span><span>c<sub>e</sub> = <b>{f2(wn.ce)}</b></span><span>w = <b>{kPa(wn.w)}</b> kPa</span><span>q = <b>{f2(qw)}</b> kN/m</span><span>ψ0 = <b>{psiW}</b></span></div>
        <button className="ghost" onClick={() => onAdd({ type: "udl", cat: "Q", q: +qw.toFixed(3), label: t("lc_wind"), group: t("lc_wind"), psi0: psiW, note: windNote })}>{t("lc_addWind")}</button>
        <p className="hint">{cl ? t("lc_hintNA") : t("lc_hintEN")}</p>
      </div>
    </fieldset>
  );
}
