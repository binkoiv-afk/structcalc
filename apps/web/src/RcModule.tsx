// Залізобетон: спочатку що рахуємо (балка або переріз із зусиллями) → переріз і бетон → армування.
// Результат: міцність нормальних перерізів (деформаційна модель, діаграма M–κ), зріз, конструктивні вимоги, тріщини, прогин.
import { useMemo, useState } from "react";
import { NumInput } from "./NumInput";
import { BAR_DIAMETERS, checkRc, CodeId, RC_REBARS, rcConcretes, rcSigmaC, RcInput, RcLayer, RcResult } from "@structcalc/core";
import { CheckList, pct, T, utilState } from "./Results";

type Sup = "ss" | "fp" | "ff" | "cant";
export interface RcState {
  mode: "beam" | "section"; shape: "rect" | "T"; b: number; h: number; bf: number; hf: number; c: number;
  concrete: string; rebar: string; bot: RcLayer[]; top: RcLayer[]; sw: { d: number; legs: number; s: number; cls: string };
  M: number; N: number; V: number; Mqp: number;
  L: number; supports: Sup; g: number; q: number; selfWeight: boolean; gammaG: string; gammaQ: string; psi2: number;
  phi: number; wlim: number; exp?: string; deflN: number; obj: string; elem: string;
}
export const initialRc: RcState = {
  mode: "beam", shape: "rect", b: 250, h: 500, bf: 800, hf: 120, c: 25,
  concrete: "C25/30", rebar: "A500C", bot: [{ n: 3, d: 20 }], top: [{ n: 2, d: 12 }], sw: { d: 8, legs: 2, s: 150, cls: "A240C" },
  M: 120, N: 0, V: 90, Mqp: 70,
  L: 6, supports: "ss", g: 12, q: 8, selfWeight: true, gammaG: "", gammaQ: "", psi2: 0.3,
  phi: 2, wlim: 0.3, exp: "XC3", deflN: 0, obj: "", elem: "",
};
// граничні w_max за класом середовища (ДСТУ Б В.2.6-156, табл. 5.1; EN 1992-1-1, табл. 7.1N), мм
const EXPOSURE: [string, number][] = [["X0", 0.4], ["XC1", 0.4], ["XC2", 0.3], ["XC3", 0.3], ["XC4", 0.3], ["XD1", 0.3], ["XD2", 0.3], ["XD3", 0.3], ["XS1", 0.3], ["XS2", 0.3], ["XS3", 0.3]];
const num = (v: string) => (v.trim() === "" ? 0 : Number(v));
const f = (v: number, n = 2) => (Number.isFinite(v) ? v.toFixed(n) : "—");

/** Переріз з арматурою, епюра деформацій і напружень бетону в граничному стані */
function SectionView({ s, r, code, neg }: { s: RcState; r: RcResult; code: CodeId; neg: boolean }) {
  const W = 420, H = 300, pad = 24, sc = Math.min((200 - 2 * pad) / Math.max(s.shape === "T" ? s.bf : s.b, 1), (H - 2 * pad) / s.h);
  const cx = 110, y0 = (H - s.h * sc) / 2, T = s.shape === "T" && s.bf > s.b;
  const X = (z: number) => cx + z * sc, Y = (y: number) => y0 + y * sc;
  const outline = T
    ? `M${X(-s.bf / 2)},${Y(0)} H${X(s.bf / 2)} V${Y(s.hf)} H${X(s.b / 2)} V${Y(s.h)} H${X(-s.b / 2)} V${Y(s.hf)} H${X(-s.bf / 2)} Z`
    : `M${X(-s.b / 2)},${Y(0)} H${X(s.b / 2)} V${Y(s.h)} H${X(-s.b / 2)} Z`;
  const cs = s.c + s.sw.d / 2;
  const u = neg && r.neg ? r.neg : r.pos, st = u.state;
  // епюри: у «перевернутому» стані верх перерізу — розтягнутий
  const yTop = (y: number) => (neg ? s.h - y : y);
  const ex = 250, ew = 70, emax = Math.max(Math.abs(st.eTop), Math.abs(st.eBot), 1e-6);
  const eps = (y: number) => st.e0 + st.k * (s.h / 2 - y);
  const ePath = `M${ex},${Y(yTop(0))} L${ex + (eps(0) / emax) * ew * 0.5},${Y(yTop(0))} L${ex + (eps(s.h) / emax) * ew * 0.5},${Y(yTop(s.h))} L${ex},${Y(yTop(s.h))}`;
  const sx = 350, fcd = r.conc.fcd, pts: string[] = [];
  for (let k = 0; k <= 60; k++) { const y = (s.h * k) / 60; pts.push(`${sx + (rcSigmaC(code, r.conc, eps(y)) / fcd) * 50},${Y(yTop(y))}`); }
  const xNA = st.x;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="rc-svg" role="img" aria-label="section">
      <path d={outline} className="rc-conc" />
      {/* хомут */}
      <rect x={X(-s.b / 2 + cs)} y={Y(cs)} width={(s.b - 2 * cs) * sc} height={(s.h - 2 * cs) * sc} rx={4} className="rc-stirrup" />
      {r.bars.map((b, k) => <circle key={k} cx={X(b.z)} cy={Y(b.y)} r={Math.max(2.5, (b.d / 2) * sc)} className={`rc-bar ${b.top ? "top" : ""}`} />)}
      {xNA > 0 && xNA < s.h && <line x1={X(-(T ? s.bf : s.b) / 2) - 8} x2={sx + 60} y1={Y(yTop(xNA))} y2={Y(yTop(xNA))} className="rc-na" />}
      <text x={cx} y={H - 4} className="rc-t mid">{T ? `${s.bf}/${s.b}×${s.h}` : `${s.b}×${s.h}`} mm</text>
      <line x1={ex} x2={ex} y1={Y(0)} y2={Y(s.h)} className="rc-axis" />
      <path d={ePath} className="rc-eps" />
      <text x={ex} y={12} className="rc-t mid">ε</text>
      <text x={ex + 4} y={Y(yTop(0)) - 4} className="rc-t">{f(st.eTop * 1000)}‰</text>
      <text x={ex + 4} y={Y(yTop(s.h)) + 12} className="rc-t">{f(st.eBot * 1000)}‰</text>
      <line x1={sx} x2={sx} y1={Y(0)} y2={Y(s.h)} className="rc-axis" />
      <polyline points={pts.join(" ")} className="rc-sig" />
      <text x={sx + 25} y={12} className="rc-t mid">σ_c / f_cd</text>
      {xNA > 0 && xNA < s.h && <text x={sx + 62} y={Y(yTop(xNA)) + 4} className="rc-t">x = {f(xNA, 0)}</text>}
    </svg>
  );
}

/** M–κ: крива деформаційної моделі і точка M_Rd */
function MKChart({ r, MEd }: { r: RcResult; MEd: number }) {
  const W = 420, H = 200, L = 46, B = 26, cv = r.pos.curve;
  if (cv.length < 2) return null;
  const kx = Math.max(...cv.map((p) => p.k)), my = Math.max(r.pos.MRd, MEd, 1e-6) * 1.12;
  const X = (k: number) => L + (k / kx) * (W - L - 12), Y = (m: number) => H - B - (m / my) * (H - B - 10);
  const st = my > 400 ? 100 : my > 200 ? 50 : my > 80 ? 20 : my > 30 ? 10 : 5, ticks: number[] = [];
  for (let m = 0; m <= my; m += st) ticks.push(m);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="rc-svg" role="img" aria-label="M-kappa">
      {ticks.map((m) => <g key={m}><line x1={L} x2={W - 12} y1={Y(m)} y2={Y(m)} className="rc-grid" /><text x={L - 5} y={Y(m) + 4} className="rc-t end">{m}</text></g>)}
      <polyline points={cv.map((p) => `${X(p.k)},${Y(p.M)}`).join(" ")} className="rc-mk" />
      {MEd > 0 && <><line x1={L} x2={W - 12} y1={Y(MEd)} y2={Y(MEd)} className="rc-med" /><text x={W - 14} y={Y(MEd) - 4} className="rc-t end">M_Ed = {f(MEd, 1)}</text></>}
      <circle cx={X(r.pos.state.k)} cy={Y(r.pos.MRd)} r={4.5} className="rc-dot" />
      <text x={X(r.pos.state.k) - 6} y={Y(r.pos.MRd) - 8} className="rc-t end">M_Rd = {f(r.pos.MRd, 1)}</text>
      <text x={4} y={12} className="rc-t">kN·m</text>
      <text x={W - 12} y={H - 6} className="rc-t end">κ, 1/m</text>
      <text x={L} y={H - 6} className="rc-t">0</text>
      <text x={W - 70} y={H - 6} className="rc-t end">{f(kx * 1000, 3)}</text>
    </svg>
  );
}

function DeflChart({ r }: { r: RcResult }) {
  if (!r.defl) return null;
  const W = 420, H = 130, L = 20, d = r.defl, mx = Math.max(d.flim, ...d.ws.map(Math.abs), 1e-6) * 1.15, Lm = d.xs[d.xs.length - 1] || 1;
  const X = (x: number) => L + (x / Lm) * (W - 2 * L), Y = (w: number) => 30 + (w / mx) * (H - 50);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="rc-svg" role="img" aria-label="deflection">
      <line x1={X(0)} x2={X(Lm)} y1={Y(0)} y2={Y(0)} className="rc-axis" />
      <line x1={X(0)} x2={X(Lm)} y1={Y(d.flim)} y2={Y(d.flim)} className="rc-med" />
      <text x={X(Lm)} y={Y(d.flim) - 4} className="rc-t end">f_lim = {f(d.flim, 1)} mm</text>
      <polyline points={d.xs.map((x, k) => `${X(x)},${Y(Math.abs(d.ws[k]))}`).join(" ")} className="rc-mk" />
      <text x={X(Lm / 2)} y={Y(d.f) + 16} className="rc-t mid">f = {f(d.f, 1)} mm</text>
    </svg>
  );
}

export function RcModule({ code, s, set, t }: { code: CodeId; s: RcState; set: (p: Partial<RcState>) => void; t: T }) {
  const [tab, setTab] = useState<"results" | "report">("results");
  const concs = rcConcretes(code), rebars = RC_REBARS[code];
  const conc = concs.some((c) => c.id === s.concrete) ? s.concrete : code === "DBN" ? "C25/30" : "C25/30";
  const ok = (id: string, dflt: string) => (rebars.some((r) => r.id === id) ? id : dflt);
  const rebar = ok(s.rebar, code === "DBN" ? "A500C" : "B500B"), swCls = ok(s.sw.cls, code === "DBN" ? "A240C" : "B500B");
  const input: RcInput = useMemo(() => ({
    code, concrete: conc, rebar, b: s.b, h: s.h, bf: s.shape === "T" ? s.bf : 0, hf: s.shape === "T" ? s.hf : 0, c: s.c,
    sw: { ...s.sw, cls: swCls }, bot: s.bot.filter((l) => l.n > 0), top: s.top.filter((l) => l.n > 0), mode: s.mode,
    M: s.M, N: s.N, V: s.V, Mqp: s.Mqp, L: s.L, supports: s.supports, g: s.g, q: s.q, selfWeight: s.selfWeight,
    gammaG: s.gammaG.trim() ? num(s.gammaG) : undefined, gammaQ: s.gammaQ.trim() ? num(s.gammaQ) : undefined, psi2: s.psi2,
    phi: s.phi, wlim: s.wlim, deflN: s.deflN,
  }), [code, s, conc, rebar, swCls]);
  const calc = useMemo(() => { try { return { r: checkRc(input) }; } catch (e) { return { err: String((e as Error).message) }; } }, [input]);
  const r = calc.r;
  const g = r?.checks.reduce<RcResult["checks"][number] | undefined>((b, c) => (!b || c.util > b.util ? c : b), undefined);
  const st = r ? utilState(r.maxUtil) : "ok";

  const layers = (which: "bot" | "top") => {
    const ls = s[which];
    const up = (k: number, p: Partial<RcLayer>) => set({ [which]: ls.map((l, j) => (j === k ? { ...l, ...p } : l)) } as Partial<RcState>);
    return (
      <div className="rc-layers">
        <div className="lbl">{t(which === "bot" ? "rc_bot" : "rc_top")}{r ? ` · A_s = ${f(which === "bot" ? r.As : r.AsTop, 0)} mm²` : ""}</div>
        {ls.map((l, k) => (
          <div key={k} className="rc-lay">
            <span className="rc-ln">{k + 1} {t("rc_row")}</span>
            <NumInput id={`rc-${which}-n-${k}`} step={1} min={0} max={20} value={l.n} aria-label={t("rc_n")} onChange={(e) => up(k, { n: Math.max(0, Math.round(num(e.target.value))) })} />
            <span>×</span>
            <select id={`rc-${which}-d-${k}`} value={l.d} onChange={(e) => up(k, { d: Number(e.target.value) })}>{BAR_DIAMETERS.map((d) => <option key={d} value={d}>Ø{d}</option>)}</select>
            <button className="ghost danger" aria-label={t("np_remove")} title={t("np_remove")} onClick={() => set({ [which]: ls.filter((_, j) => j !== k) } as Partial<RcState>)}>✕</button>
          </div>
        ))}
        <button className="ghost" id={`rc-${which}-add`} onClick={() => set({ [which]: [...ls, { n: 2, d: ls[ls.length - 1]?.d ?? 12 }] } as Partial<RcState>)}>+ {t("rc_addRow")}</button>
      </div>
    );
  };

  const summary = r && (
    <div className={`summary ${st}`}>
      <div className="summary-main"><div className="eyebrow">{t(s.mode === "beam" ? "rc_m_beam" : "rc_m_section")} · {conc} · {rebar}</div>
        <div className="profile">{s.shape === "T" ? `${s.bf}/${s.b}×${s.h}` : `${s.b}×${s.h}`}</div>
        <div className="meta">{s.bot.filter((l) => l.n).map((l) => `${l.n}Ø${l.d}`).join(" + ") || "—"}{s.top.some((l) => l.n) ? ` / ${s.top.filter((l) => l.n).map((l) => `${l.n}Ø${l.d}`).join(" + ")}` : ""} · Ø{s.sw.d}/{s.sw.s}</div></div>
      <div className="summary-util"><div className="eyebrow">{t("rep_maxutil")}</div><div className="big">{pct(r.maxUtil)}</div><div className={`pill ${st}`}>{r.maxUtil <= 1 + 1e-9 ? t("ok") : t("fail")}</div></div>
      {g && <div className="summary-gov"><div className="eyebrow">{t("governing")}</div><div>{t(`chk_${g.key}`)}</div></div>}
    </div>
  );
  const forces = r && (
    <table className="rep-table rc-forces"><tbody>
      {s.mode === "beam" && <tr><td>{t("rc_wd")}</td><td className="mono">g = {f(s.g + r.selfW)} ({s.selfWeight ? `${t("rc_self").replace("+ ", "")}: ${f(r.selfW)}` : ""}), q = {f(s.q)} kN/m</td></tr>}
      {r.MEd > 0 && <tr><td>{t("rc_MEd")}</td><td className="mono">{f(r.MEd)} kN·m</td></tr>}
      {r.MEdNeg > 0 && <tr><td>{t("rc_MEdNeg")}</td><td className="mono">{f(r.MEdNeg)} kN·m</td></tr>}
      {r.NEd !== 0 && <tr><td>N_Ed</td><td className="mono">{f(r.NEd, 1)} kN</td></tr>}
      <tr><td>{s.mode === "beam" ? t("rc_VEd") : "V_Ed"}</td><td className="mono">{f(r.VEd, 1)} kN</td></tr>
      <tr><td>{t("rc_Mqp_r")}</td><td className="mono">{f(r.Mqp)}{r.MqpNeg > 0 ? ` / ${f(-r.MqpNeg)}` : ""} kN·m</td></tr>
      <tr><td>{t("rc_props")}</td><td className="mono">d = {f(r.d, 0)} mm; f_cd = {f(r.conc.fcd, 1)}; f_ctm = {f(r.conc.fctm, 2)}; f_yd = {f(r.fyd, 0)}; f_ywd = {f(r.fywd, 0)} MPa</td></tr>
    </tbody></table>
  );
  const fix = r && (r.needBot || r.needTop) && (
    <div className="rc-fix">
      {r.needBot && <div>{t("rc_need")} <b>{r.needBot.n}Ø{r.needBot.d}</b> ({t("rc_bot").toLowerCase()}, 1 {t("rc_row")}) <button id="rc-fix-bot" className="primary" onClick={() => set({ bot: [r.needBot!, ...s.bot.slice(1)] })}>{t("rc_apply")}</button></div>}
      {r.needTop && <div>{t("rc_need")} <b>{r.needTop.n}Ø{r.needTop.d}</b> ({t("rc_top").toLowerCase()}, 1 {t("rc_row")}) <button id="rc-fix-top" className="primary" onClick={() => set({ top: [r.needTop!, ...s.top.slice(1)] })}>{t("rc_apply")}</button></div>}
    </div>
  );

  return (
    <main className="layout">
      <aside className="inputs">
        <fieldset>
          <legend><span className="step">1</span>{t("rc_element")}</legend>
          <div className="seg wide">{(["beam", "section"] as const).map((m) => <button key={m} id={`rc-mode-${m}`} className={s.mode === m ? "on" : ""} onClick={() => set({ mode: m })}>{t(`rc_m_${m}`)}</button>)}</div>
          {s.mode === "beam" ? <div className="grid2 rc-gap">
            <label><span className="lbl">{t("rc_L")}</span><NumInput id="rc-L" step={0.1} min={0.5} value={s.L} onChange={(e) => set({ L: Math.max(0.5, num(e.target.value)) })} /></label>
            <label><span className="lbl">{t("rc_sup")}</span><select id="rc-sup" value={s.supports} onChange={(e) => set({ supports: e.target.value as Sup })}>
              {(["ss", "fp", "ff", "cant"] as const).map((k) => <option key={k} value={k}>{t(`rc_sup_${k}`)}</option>)}</select></label>
            <label><span className="lbl">{t("rc_g")}</span><NumInput id="rc-g" step={1} value={s.g} onChange={(e) => set({ g: num(e.target.value) })} /></label>
            <label><span className="lbl">{t("rc_q")}</span><NumInput id="rc-q" step={1} value={s.q} onChange={(e) => set({ q: num(e.target.value) })} /></label>
            <label className="chk wide"><input id="rc-self" type="checkbox" checked={s.selfWeight} onChange={(e) => set({ selfWeight: e.target.checked })} />{t("rc_self")}</label>
            <p className="hint wide">{t("rc_loadsHint")}</p>
          </div> : <div className="grid2 rc-gap">
            <label><span className="lbl">{t("rc_M")}</span><NumInput id="rc-M" step={5} value={s.M} onChange={(e) => set({ M: num(e.target.value) })} /></label>
            <label><span className="lbl">{t("rc_N")}</span><NumInput id="rc-N" step={10} value={s.N} onChange={(e) => set({ N: num(e.target.value) })} /></label>
            <label><span className="lbl">{t("rc_V")}</span><NumInput id="rc-V" step={5} value={s.V} onChange={(e) => set({ V: num(e.target.value) })} /></label>
            <label><span className="lbl">{t("rc_Mqp")}</span><NumInput id="rc-Mqp" step={5} value={s.Mqp} onChange={(e) => set({ Mqp: num(e.target.value) })} /></label>
          </div>}
        </fieldset>
        <fieldset>
          <legend><span className="step">2</span>{t("rc_section")}</legend>
          <div className="seg wide">{(["rect", "T"] as const).map((m) => <button key={m} id={`rc-shape-${m}`} className={s.shape === m ? "on" : ""} onClick={() => set({ shape: m })}>{t(`rc_${m}`)}</button>)}</div>
          <div className="grid2 rc-gap">
            <label><span className="lbl">{t("rc_b")}</span><NumInput id="rc-b" step={10} min={100} value={s.b} onChange={(e) => set({ b: Math.max(100, num(e.target.value)) })} /></label>
            <label><span className="lbl">{t("rc_h")}</span><NumInput id="rc-h" step={10} min={100} value={s.h} onChange={(e) => set({ h: Math.max(100, num(e.target.value)) })} /></label>
            {s.shape === "T" && <>
              <label><span className="lbl">{t("rc_bf")}</span><NumInput id="rc-bf" step={10} value={s.bf} onChange={(e) => set({ bf: num(e.target.value) })} /></label>
              <label><span className="lbl">{t("rc_hf")}</span><NumInput id="rc-hf" step={10} value={s.hf} onChange={(e) => set({ hf: num(e.target.value) })} /></label>
            </>}
            <label><span className="lbl">{t("rc_conc")}</span><select id="rc-conc" value={conc} onChange={(e) => set({ concrete: e.target.value })}>{concs.map((c) => <option key={c.id}>{c.id}</option>)}</select></label>
            <label><span className="lbl">{t("rc_c")}</span><NumInput id="rc-c" step={5} min={10} value={s.c} onChange={(e) => set({ c: Math.max(10, num(e.target.value)) })} /></label>
          </div>
        </fieldset>
        <fieldset>
          <legend><span className="step">3</span>{t("rc_reinf")}</legend>
          <label><span className="lbl">{t("rc_cls")}</span><select id="rc-cls" value={rebar} onChange={(e) => set({ rebar: e.target.value })}>{rebars.map((x) => <option key={x.id}>{x.id}</option>)}</select></label>
          {layers("bot")}
          {layers("top")}
          <div className="lbl">{t("rc_stirrups")}</div>
          <div className="rc-sw">
            <select id="rc-sw-d" value={s.sw.d} aria-label="Ø" onChange={(e) => set({ sw: { ...s.sw, d: Number(e.target.value) } })}>{BAR_DIAMETERS.slice(0, 7).map((d) => <option key={d} value={d}>Ø{d}</option>)}</select>
            <label><span className="lbl">{t("rc_legs")}</span><NumInput id="rc-sw-legs" step={1} min={0} value={s.sw.legs} onChange={(e) => set({ sw: { ...s.sw, legs: Math.max(0, Math.round(num(e.target.value))) } })} /></label>
            <label><span className="lbl">{t("rc_s")}</span><NumInput id="rc-sw-s" step={25} min={0} value={s.sw.s} onChange={(e) => set({ sw: { ...s.sw, s: Math.max(0, num(e.target.value)) } })} /></label>
            <select id="rc-sw-cls" value={swCls} aria-label={t("rc_cls")} onChange={(e) => set({ sw: { ...s.sw, cls: e.target.value } })}>{rebars.map((x) => <option key={x.id}>{x.id}</option>)}</select>
          </div>
        </fieldset>
        <details className="adv">
          <summary>{t("advanced")}<span className="adv-hint">{t("rc_advHint")}</span></summary>
          <div className="adv-group"><div className="grid2">
            {s.mode === "beam" && <>
              <label><span className="lbl">{t("rc_gammaG")}</span><NumInput id="rc-gG" step={0.05} placeholder={code === "DBN" ? "1.1" : "1.35"} value={s.gammaG} onChange={(e) => set({ gammaG: e.target.value })} /></label>
              <label><span className="lbl">{t("rc_gammaQ")}</span><NumInput id="rc-gQ" step={0.05} placeholder={code === "DBN" ? "1.2" : "1.5"} value={s.gammaQ} onChange={(e) => set({ gammaQ: e.target.value })} /></label>
              <label><span className="lbl">{t("rc_psi2")}</span><NumInput id="rc-psi2" step={0.05} min={0} max={1} value={s.psi2} onChange={(e) => set({ psi2: num(e.target.value) })} /></label>
              <label><span className="lbl">{t("rc_deflN")}</span><NumInput id="rc-defl" step={10} min={0} value={s.deflN} onChange={(e) => set({ deflN: Math.max(0, num(e.target.value)) })} /></label>
            </>}
            <label><span className="lbl">{t("rc_phi")}</span><NumInput id="rc-phi" step={0.1} min={0} value={s.phi} onChange={(e) => set({ phi: Math.max(0, num(e.target.value)) })} /></label>
            <label><span className="lbl">{t("rc_exp")}</span><select id="rc-exp" value={s.exp ?? "XC3"} onChange={(e) => set({ exp: e.target.value, wlim: EXPOSURE.find((x) => x[0] === e.target.value)![1] })}>{EXPOSURE.map(([k]) => <option key={k}>{k}</option>)}</select></label>
            <label><span className="lbl">{t("rc_wlim")}</span><NumInput id="rc-wlim" step={0.05} min={0.05} value={s.wlim} onChange={(e) => set({ wlim: Math.max(0.05, num(e.target.value)) })} /></label>
          </div></div>
        </details>
      </aside>

      <section className="output">
        <div className="tabs" role="tablist">
          {(["results", "report"] as const).map((k) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{t(`tab_${k}`)}</button>)}
        </div>
        {calc.err && <p className="error">{calc.err}</p>}
        {r && tab === "results" && (
          <div className="results">
            {summary}
            {fix}
            <div className="panel two-col">
              <div><h3>{t("rc_drawing")}</h3><SectionView s={s} r={r} code={code} neg={false} />{r.neg && <SectionView s={s} r={r} code={code} neg />}</div>
              <div><h3>{t("rc_forces")}</h3>{forces}</div>
            </div>
            <div className="panel"><h3>{t("results")}</h3><CheckList checks={r.checks} t={t} /></div>
            <div className="panel two-col">
              <div><h3>{t("rc_mk")}</h3><MKChart r={r} MEd={r.MEd} /><p className="hint">{t("rc_mkHint")}</p></div>
              {r.defl && <div><h3>{t("rc_deflShape")}</h3><DeflChart r={r} /></div>}
            </div>
          </div>
        )}
        {r && tab === "report" && (
          <div className="report-wrap">
            <div className="report-tools">
              <input id="rc-obj" placeholder={t("objPlaceholder")} value={s.obj} onChange={(e) => set({ obj: e.target.value })} />
              <input id="rc-elem" placeholder={t("rcPlaceholder")} value={s.elem} onChange={(e) => set({ elem: e.target.value })} />
              <button className="primary" onClick={() => window.print()}>{t("print")}</button>
            </div>
            <article className="report">
              <header className="rep-head">
                <h1>{t("rep_titleRc")}</h1>
                <dl>
                  <div><dt>{t("rep_object")}</dt><dd>{s.obj || "—"}</dd></div>
                  <div><dt>{t("rep_element")}</dt><dd>{s.elem || t(s.mode === "beam" ? "rc_m_beam" : "rc_m_section")}</dd></div>
                  <div><dt>{t("rep_code")}</dt><dd>{code === "DBN" ? "ДБН В.2.6-98:2009 зі Зміною № 1; ДСТУ Б В.2.6-156:2010; ДБН В.1.2-2; ДСТУ Б В.1.2-3" : "EN 1992-1-1; EN 1990"}</dd></div>
                  <div><dt>{t("rep_date")}</dt><dd>{new Date().toLocaleDateString()}</dd></div>
                </dl>
              </header>
              <h2>{t("rep_summary")}</h2>
              {summary}
              <h2>{t("rep_inputs")}</h2>
              <table className="rep-table"><tbody>
                {s.mode === "beam" && <tr><td>{t("rc_m_beam")}</td><td>L = {s.L} m; {t(`rc_sup_${s.supports}`)}; g_k = {s.g}, q_k = {s.q} kN/m{s.selfWeight ? ` + ${f(r.selfW)} kN/m` : ""}; γ_G = {s.gammaG || (code === "DBN" ? "1.1" : "1.35")}, γ_Q = {s.gammaQ || (code === "DBN" ? "1.2" : "1.5")}, ψ₂ = {s.psi2}</td></tr>}
                <tr><td>{t("rc_section")}</td><td>{s.shape === "T" ? `b_f×h_f = ${s.bf}×${s.hf}, ` : ""}b×h = {s.b}×{s.h} mm; {conc}; c = {s.c} mm</td></tr>
                <tr><td>{t("rc_reinf")}</td><td>{rebar}: {t("rc_bot").toLowerCase()} {s.bot.filter((l) => l.n).map((l) => `${l.n}Ø${l.d}`).join(" + ") || "—"} (A_s = {f(r.As, 0)} mm²); {t("rc_top").toLowerCase()} {s.top.filter((l) => l.n).map((l) => `${l.n}Ø${l.d}`).join(" + ") || "—"} (A_s' = {f(r.AsTop, 0)} mm²); {t("rc_stirrups").toLowerCase()} Ø{s.sw.d} {swCls}, {s.sw.legs} {t("rc_legs")}, s = {s.sw.s} mm</td></tr>
                <tr><td>φ(∞, t₀); {t("rc_exp")}; w_lim</td><td>{s.phi}; {s.exp ?? "XC3"}; {s.wlim} mm</td></tr>
              </tbody></table>
              <h2>{t("rc_forces")}</h2>
              {forces}
              <SectionView s={s} r={r} code={code} neg={false} />
              <h2>{t("rep_checks")}</h2>
              <CheckList checks={r.checks} t={t} />
              <MKChart r={r} MEd={r.MEd} />
              {r.defl && <DeflChart r={r} />}
              <p className="disclaimer">{t("disclaimer")}</p>
            </article>
          </div>
        )}
        <p className="disclaimer">{t("disclaimer")}</p>
      </section>
    </main>
  );
}
