// НВФ: кронштейни підсистеми вентфасаду. Тип кронштейна → розміри й отвори (параметрично, з кресленням) → навантаження з фасаду → перевірки.
// Поки один тип — Г-подібний (форми погоджуються з igor по одному).
import { NumInput } from "./NumInput";
import { annex, BR_MATERIALS, BrResult, checkLBracket, CodeId, L_BRACKET_DEFAULT, LBracket } from "@structcalc/core";
import { CheckList, governing, pct, T, utilState } from "./Results";

export interface NvfState {
  type: "L";
  br: LBracket; round: string; slots: string; mat: string; fixed: boolean;
  g: number; b: number; lb: number; Lg: number; wP: number; wS: number; gG: number; gQ: number; cont: number;
  nR: number; FvRd: number; NRdA: number; VRdA: number; dT: number; xFix: number; alphaG: number;
}
const D = L_BRACKET_DEFAULT;
export const initialNvf: NvfState = {
  type: "L", br: D, round: D.holes.filter((h) => !h.slot).map((h) => h.y).join(" "), slots: D.holes.filter((h) => h.slot).map((h) => h.y).join(" "),
  mat: "S250GD+Z", fixed: true,
  g: 0.35, b: 0.6, lb: 0.9, Lg: 3, wP: 0.8, wS: 1.6, gG: 0, gQ: 0, cont: 1.1,
  nR: 2, FvRd: 1.8, NRdA: 4.6, VRdA: 4.6, dT: 100, xFix: 2.5, alphaG: 23e-6,
};
const nums = (s: string) => s.replace(/,/g, ".").split(/[\s;]+/).filter(Boolean).map(Number).filter((x) => Number.isFinite(x));
const f = (v: number, n = 2) => (Number.isFinite(v) ? v.toFixed(n) : "—");

/** Креслення: вид на крило збоку, вид на полицю спереду, план */
function BracketDrawing({ br, r, fixed, t }: { br: LBracket; r?: BrResult; fixed: boolean; t: T }) {
  const sc = Math.min(1.6, 300 / Math.max(br.L + br.bf, br.Hw * 1.4));
  const pad = 64, wX = pad, wY = 52, H = br.Hw * sc;
  const X = (x: number) => wX + x * sc, Yw = (y: number) => wY + y * sc; // y від верху
  const fx = X(br.L) + 90; // вид на полицю
  const planY = wY + H + 70;
  const xr = br.L - br.xr;
  const dim = (x1: number, y1: number, x2: number, y2: number, txt: string, off = 0, vert = false) => (
    <g className="br-dim">
      <line x1={x1} y1={y1} x2={x2} y2={y2} markerStart="url(#brA)" markerEnd="url(#brA)" />
      <text x={(x1 + x2) / 2 + (vert ? -4 + off : 0)} y={(y1 + y2) / 2 + (vert ? 3 : -4 + off)} textAnchor={vert ? "end" : "middle"}>{txt}</text>
    </g>
  );
  const W = fx + Math.max(br.bf * sc + 80, 170), Ht = planY + br.bf * sc + 60;
  return (
    <svg viewBox={`0 0 ${W} ${Ht}`} className="br-svg" role="img" aria-label={t("nvf_drawing")}>
      <defs><marker id="brA" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,2 L4,4 L0,6" className="br-arrowhead" /></marker>
        <marker id="brF" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" className="br-force-h" /></marker></defs>
      {/* вид збоку на крило */}
      <text x={wX} y={16} className="br-cap">{t("nvf_vWing")}</text>
      <line x1={X(0) - 10} x2={X(0) - 10} y1={wY - 14} y2={wY + H + 14} className="br-wall" />
      <rect x={X(0)} y={wY} width={br.L * sc} height={H} className="br-plate" />
      <rect x={X(0)} y={wY} width={br.t * sc + 1} height={H} className="br-edge" />
      {br.holes.map((h, k) => h.slot
        ? <rect key={k} x={X(xr) - (br.dh / 2) * sc} y={Yw(h.y - br.ls / 2)} width={br.dh * sc} height={br.ls * sc} rx={(br.dh / 2) * sc} className={`br-hole ${fixed ? "" : "on"}`} />
        : <circle key={k} cx={X(xr)} cy={Yw(h.y)} r={(br.dh / 2) * sc} className={`br-hole ${fixed ? "on" : ""}`} />)}
      {r && r.cases[0].V > 0 && <line x1={X(xr)} y1={wY - 30} x2={X(xr)} y2={wY - 4} className="br-force" markerEnd="url(#brF)" />}
      <line x1={X(br.L) + 32} y1={wY + H / 2} x2={X(br.L) + 4} y2={wY + H / 2} className="br-force" markerEnd="url(#brF)" />
      <text x={X(br.L) + 34} y={wY + H / 2 - 6} className="br-flbl">H</text>
      {r && r.cases[0].V > 0 && <text x={X(xr) + 6} y={wY - 18} className="br-flbl">V</text>}
      {dim(X(0), wY + H + 16, X(br.L), wY + H + 16, `L = ${br.L}`)}
      {dim(X(xr), wY + H + 32, X(br.L), wY + H + 32, `${br.xr}`)}
      {dim(X(0) - 26, wY, X(0) - 26, wY + H, `${br.Hw}`, 0, true)}
      {/* вид на полицю */}
      <text x={fx} y={16} className="br-cap">{t("nvf_vFlange")}</text>
      <rect x={fx} y={wY} width={br.bf * sc} height={H} className="br-plate" />
      <rect x={fx} y={wY} width={br.t * sc + 1} height={H} className="br-edge" />
      {r?.anchor.z.map((z, k) => {
        const yc = wY + H - z * sc, xc = fx + br.eA * sc, lw = Math.max(br.lA, br.dA);
        return <rect key={k} x={xc - (lw / 2) * sc} y={yc - (br.dA / 2) * sc} width={lw * sc} height={br.dA * sc} rx={(br.dA / 2) * sc} className="br-hole on" />;
      })}
      {dim(fx, wY + H + 16, fx + br.bf * sc, wY + H + 16, `${br.bf}`)}
      {br.nA === 2 && dim(fx + br.bf * sc + 18, wY + H / 2 - (br.sA / 2) * sc, fx + br.bf * sc + 18, wY + H / 2 + (br.sA / 2) * sc, `${br.sA}`, 30, true)}
      {dim(fx, wY - 12, fx + br.eA * sc, wY - 12, `e_A = ${br.eA}`)}
      {/* план */}
      <text x={wX} y={planY - 18} className="br-cap">{t("nvf_vPlan")}</text>
      <line x1={X(0) - 10} x2={X(0) - 10} y1={planY - 8} y2={planY + br.bf * sc + 8} className="br-wall" />
      <path d={`M${X(0)},${planY} v${br.bf * sc} M${X(0)},${planY + br.bf * sc - br.t * sc / 2} H${X(br.L)}`} className="br-planline" style={{ strokeWidth: Math.max(br.t * sc, 2) }} />
      {dim(X(0) - 26, planY, X(0) - 26, planY + br.bf * sc, `${br.bf}`, 0, true)}
      <text x={X(br.L)} y={planY + br.bf * sc + 22} className="br-cap" textAnchor="end">t = {br.t} mm, r = {br.r} mm</text>
    </svg>
  );
}

export function NvfModule({ code, s, set, t }: { code: CodeId; s: NvfState; set: (p: Partial<NvfState>) => void; t: T }) {
  const na = annex();
  const gG = s.gG || (code === "EN" ? na.e1990.gG : 1.1), gQ = s.gQ || (code === "EN" ? na.e1990.gQ : 1.0);
  const holes = [...nums(s.round).map((y) => ({ y, slot: false })), ...nums(s.slots).map((y) => ({ y, slot: true }))].filter((h) => h.y > 0 && h.y < s.br.Hw).sort((a, b) => a.y - b.y);
  const br = { ...s.br, holes };
  // навантаження на кронштейн: вага — на несучий (один на напрямну), вітер — з площі b × l_b, × коеф. нерозрізності
  const Vk = s.g * s.b * s.Lg;
  const Hp = s.wP * s.b * s.lb * s.cont, Hs = s.wS * s.b * s.lb * s.cont;
  const r = checkLBracket({ br, mat: s.mat, fixed: s.fixed, Vk, Hp, Hs, gG, gQ, nR: s.nR, FvRd: s.FvRd, NRdA: s.NRdA, VRdA: s.VRdA, dT: s.dT, xFix: s.xFix, alphaG: s.alphaG });
  const maxU = Math.max(...r.checks.map((c) => c.util)), st = utilState(maxU), g = governing(r.checks);
  const B = (key: keyof LBracket, step = "1") => (
    <NumInput id={`br_${key}`} step={step} value={s.br[key] as number} onChange={(e) => set({ br: { ...s.br, [key]: Number(e.target.value.replace(",", ".")) || 0 } })} />
  );
  const N = (key: keyof NvfState, step = "0.1") => (
    <NumInput id={`nvf_${key}`} step={step} value={s[key] as number} onChange={(e) => set({ [key]: Number(e.target.value.replace(",", ".")) || 0 } as Partial<NvfState>)} />
  );
  return (
    <main className="layout">
      <aside className="inputs">
        <fieldset>
          <legend><span className="step">1</span>{t("nvf_type")}</legend>
          <div className="br-types">
            <button className={`br-type on`} id="br-type-L">
              <svg viewBox="0 0 48 32"><path d="M8 4v24M8 26h34" strokeWidth="3" /></svg>{t("nvf_L")}
            </button>
            {["U", "adj", "cw"].map((k) => <button key={k} className="br-type soon" disabled>{t(`nvf_${k}`)}<span>{t("soon")}</span></button>)}
          </div>
          <label className="wide"><span className="lbl">{t("nvf_mode")}</span>
            <select id="nvf_fixed" value={s.fixed ? "1" : "0"} onChange={(e) => set({ fixed: e.target.value === "1", nR: e.target.value === "1" ? 2 : 1 })}>
              <option value="1">{t("nvf_fixed")}</option><option value="0">{t("nvf_slide")}</option>
            </select>
          </label>
        </fieldset>
        <fieldset>
          <legend><span className="step">2</span>{t("nvf_dims")}</legend>
          <div className="grid2">
            <label><span className="lbl">{t("nvf_Lk")}</span>{B("L", "5")}</label>
            <label><span className="lbl">{t("nvf_Hw")}</span>{B("Hw", "5")}</label>
            <label><span className="lbl">{t("nvf_bf")}</span>{B("bf", "1")}</label>
            <label><span className="lbl">t, mm</span>{B("t", "0.1")}</label>
            <label><span className="lbl">{t("nvf_r")}</span>{B("r", "0.5")}</label>
            <label className="wide"><span className="lbl">{t("nvf_mat")}</span>
              <select id="nvf_mat" value={s.mat} onChange={(e) => set({ mat: e.target.value })}>
                {BR_MATERIALS.map((m) => <option key={m.id} value={m.id}>{m.id}: f = {m.f}, f_u = {m.fu} MPa</option>)}
              </select>
            </label>
          </div>
          <div className="lc-head">{t("nvf_anch")}</div>
          <div className="grid2">
            <label><span className="lbl">{t("nvf_nA")}</span>
              <select id="br_nA" value={s.br.nA} onChange={(e) => set({ br: { ...s.br, nA: Number(e.target.value) as 1 | 2 } })}><option value={1}>1</option><option value={2}>2</option></select>
            </label>
            {s.br.nA === 2 && <label><span className="lbl">{t("nvf_sA")}</span>{B("sA", "5")}</label>}
            <label><span className="lbl">{t("nvf_eA")}</span>{B("eA", "1")}</label>
            <label><span className="lbl">{t("nvf_dA")}</span>{B("dA", "0.5")}</label>
            <label><span className="lbl">{t("nvf_lA")}</span>{B("lA", "0.5")}</label>
            <label><span className="lbl">{t("nvf_dw")}</span>{B("dw", "1")}</label>
          </div>
          <div className="lc-head">{t("nvf_rivRow")}</div>
          <div className="grid2">
            <label><span className="lbl">{t("nvf_xr")}</span>{B("xr", "0.5")}</label>
            <label><span className="lbl">{t("nvf_dh")}</span>{B("dh", "0.5")}</label>
            <label><span className="lbl">{t("nvf_ls")}</span>{B("ls", "1")}</label>
            <label className="wide"><span className="lbl">{t("nvf_round")}</span><input id="nvf_round" value={s.round} onChange={(e) => set({ round: e.target.value })} /></label>
            <label className="wide"><span className="lbl">{t("nvf_slots")}</span><input id="nvf_slots" value={s.slots} onChange={(e) => set({ slots: e.target.value })} /></label>
          </div>
        </fieldset>
        <fieldset>
          <legend><span className="step">3</span>{t("nvf_loads")}</legend>
          <div className="grid2">
            <label><span className="lbl">{t("nvf_g")}</span>{N("g", "0.05")}</label>
            <label><span className="lbl">{t("nvf_b")}</span>{N("b", "0.05")}</label>
            <label><span className="lbl">{t("nvf_lb")}</span>{N("lb", "0.05")}</label>
            <label><span className="lbl">{t("nvf_Lg")}</span>{N("Lg", "0.1")}</label>
            <label><span className="lbl">{t("nvf_wP")}</span>{N("wP", "0.05")}</label>
            <label><span className="lbl">{t("nvf_wS")}</span>{N("wS", "0.05")}</label>
            <label><span className="lbl">{t("nvf_cont")}</span>{N("cont", "0.05")}</label>
            <label><span className="lbl">γ<sub>G</sub> / γ<sub>Q</sub></span>
              <span className="pair"><NumInput id="nvf_gG" step="0.05" value={gG} onChange={(e) => set({ gG: Number(e.target.value) || 0 })} /><NumInput id="nvf_gQ" step="0.05" value={gQ} onChange={(e) => set({ gQ: Number(e.target.value) || 0 })} /></span>
            </label>
          </div>
          <div className="lc-out"><span>V<sub>k</sub> = <b>{f(Vk, 3)}</b> kN{s.fixed ? "" : ` (${t("nvf_notHere")})`}</span><span>H<sub>p</sub> = <b>{f(Hp, 3)}</b></span><span>H<sub>s</sub> = <b>{f(Hs, 3)}</b> kN</span></div>
          <p className="hint">{t("nvf_loadsH")}</p>
        </fieldset>
        <fieldset>
          <legend><span className="step">4</span>{t("nvf_fast")}</legend>
          <div className="grid2">
            <label><span className="lbl">{t("nvf_nR")}</span>{N("nR", "1")}</label>
            <label><span className="lbl">{t("nvf_FvRd")}</span>{N("FvRd", "0.1")}</label>
            <label><span className="lbl">{t("nvf_NRdA")}</span>{N("NRdA", "0.1")}</label>
            <label><span className="lbl">{t("nvf_VRdA")}</span>{N("VRdA", "0.1")}</label>
            {!s.fixed && <>
              <label><span className="lbl">ΔT, K</span>{N("dT", "5")}</label>
              <label><span className="lbl">{t("nvf_xFix")}</span>{N("xFix", "0.1")}</label>
            </>}
          </div>
          <p className="hint">{t("nvf_fastH")}</p>
        </fieldset>
      </aside>
      <section className="output">
        <div className="results">
          <div className={`summary ${st}`}>
            <div className="summary-main">
              <div className="eyebrow">{t("nvf_L")} · {s.fixed ? t("nvf_fixedS") : t("nvf_slideS")}</div>
              <div className="profile">{s.br.L}×{s.br.Hw}×{s.br.bf}×{s.br.t}</div>
              <div className="meta">{r.mat.id} · f = {r.mat.f} MPa</div>
            </div>
            <div className="summary-util">
              <div className="eyebrow">{t("rep_maxutil")}</div>
              <div className="big">{pct(maxU)}</div>
              <div className={`pill ${st}`}>{maxU <= 1 ? t("ok") : t("fail")}</div>
            </div>
            {g && <div className="summary-gov"><div className="eyebrow">{t("governing")}</div><div>{t(`chk_${g.key}`)}</div></div>}
          </div>
          <div className="panel">
            <h3>{t("nvf_drawing")}</h3>
            <BracketDrawing br={br} r={r} fixed={s.fixed} t={t} />
            <p className="hint">{t("nvf_drawH")}</p>
          </div>
          <div className="panel two-col">
            <div>
              <h3>{t("nvf_forces")}</h3>
              <table className="rep-table cw-tab"><tbody>
                <tr><td>V<sub>Ed</sub></td><td className="mono">{f(r.cases[0].V, 3)} kN</td></tr>
                <tr><td>N<sub>Ed</sub> {t("nvf_suct")} / {t("nvf_press")}</td><td className="mono">{f(r.cases[0].N, 3)} / {f(r.cases[1].N, 3)} kN</td></tr>
                <tr><td>M<sub>Ed</sub> ({t("nvf_root")})</td><td className="mono">{f(r.cases[0].M * 1000, 1)} N·m</td></tr>
                <tr><td>M<sub>cr</sub>, λ̄<sub>LT</sub>, χ<sub>LT</sub></td><td className="mono">{f(r.Mcr * 1000, 0)} N·m, {f(r.lamLT, 3)}, {f(r.chiLT, 3)}</td></tr>
              </tbody></table>
            </div>
            <div>
              <h3>{t("nvf_anchF")}</h3>
              <table className="rep-table cw-tab"><tbody>
                <tr><td>N<sub>Ed</sub> ({t("nvf_topA")})</td><td className="mono">{f(r.anchor.Nt, 3)} kN</td></tr>
                <tr><td>V<sub>Ed</sub></td><td className="mono">{f(r.anchor.V, 3)} kN</td></tr>
                <tr><td>{t("nvf_rivF")}</td><td className="mono">{f(r.rivet.F, 3)} kN (F<sub>b,Rd</sub> {f(r.rivet.FbRd, 2)})</td></tr>
              </tbody></table>
            </div>
          </div>
          <div className="panel"><h3>{t("results")}</h3><CheckList checks={r.checks} t={t} /></div>
          <p className="hint">{t("nvf_notes")}</p>
        </div>
      </section>
    </main>
  );
}
