// Режим «Збірка»: конструкція з вузлів, стрижнів (профілі сортаменту), стиків (зварювання, болти, заклепки, саморези),
// вантажних панелей і опор; загруження → сполучення → МСЕ → перевірки стрижнів, стиків і баз.
// Одиниці у стані — мм, Н, МПа (як у ядрі); у полях: мм, кН, кН/м (= Н/мм), кПа, кг/м².
import { NumInput } from "./NumInput";
import { useMemo, useState } from "react";
import {
  analyzeAssembly, ASM_TEMPLATES, asmTemplate, AsmTemplate, Assembly, AsmMember, AsmNode, AsmResult, basePlateDefaults, BOLT_CLASSES, BOLT_DIAMETERS,
  Check, CodeId, CONCRETE_CLASSES, Dof, EndConn, familiesFor, familySections, findSection, GF_DEFAULT, LoadCategory, MemberLoad, PanelLoad, STEELS, Vec3,
  A0_TABLE, k1Of, K1_TABLE, seisCoefDefault, SeismicInput,
} from "@structcalc/core";
import { AsmView, Pick, ShowMode, ViewKind } from "./AsmView";
import { CheckList, pct, T, utilState } from "./Results";
import { FamilyOptions } from "./SectionModule";
import type { JointReturn } from "./JointModule";
import type { NodeState } from "./NodeModule";
import { baseFromNode, gussetFromNode, jointFromConn, jointKindOf } from "./asmJoint";

export interface AsmState {
  tmpl: AsmTemplate | "empty" | null;
  asm: Assembly | null;
  sel: Pick;
  view: ViewKind;
  show: ShowMode;
  tool: "select" | "node" | "member" | "panel";
  /** вузли, вибрані інструментом стрижня / панелі */
  pending: string[];
  loadsOf: string;
  combo: number;
  ids: boolean;
  obj: string; elem: string;
  /** вузли, розраховані в модулі «Вузол»: ключ «стрижень|кінець» */
  jres?: Record<string, JointReturn>;
  /** показати форму власних коливань (−1 — ні) */
  mode?: number;
  /** тип конструкції для k1 (табл. 6.3) */
  k1kind?: string;
}
export const initialAsm: AsmState = { tmpl: null, asm: null, sel: null, view: "3d", show: "util", tool: "select", pending: [], loadsOf: "", combo: -1, ids: false, obj: "", elem: "" };

const SUP: NonNullable<AsmNode["support"]>[] = ["none", "fixed", "pinned", "roller", "base"];
const KINDS: EndConn["kind"][] = ["weld", "bolts", "rivets", "screws", "none"];
const DOF_LIST: Dof[] = ["ux", "uy", "uz", "rx", "ry", "rz"];
const num = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(",", ".")));
const r1 = (v: number) => Math.round(v * 1000) / 1000;

function Num({ id, label, v, on, step, ph, className }: { id: string; label: string; v: number | string | undefined; on: (n: number) => void; step?: number; ph?: string; className?: string }) {
  return <label className={className}><span className="lbl">{label}</span><NumInput id={id} step={step ?? 1} placeholder={ph} value={v ?? ""} onChange={(e) => on(num(e.target.value))} /></label>;
}

// конструктивні обмеження (катети, довжини швів) не перекривають міцність, поки виконуються
const DETAIL = new Set(["weldKfMin", "weldKfMax", "weldAmin", "weldLmin", "weldLflank", "weldLong"]);
function gov<C extends { key: string; util: number }>(cs: C[]): C | undefined {
  const pick = (l: C[]) => l.reduce<C | undefined>((a, b) => (!a || !(b.util <= a.util) ? b : a), undefined);
  const bad = cs.filter((c) => DETAIL.has(c.key) && !(c.util <= 1));
  return bad.length ? pick(bad) : pick(cs.filter((c) => !DETAIL.has(c.key))) ?? pick(cs);
}
const govU = (cs: { key: string; util: number }[]) => gov(cs)?.util ?? 0;

const nextId = (ids: string[], prefix: string) => { let k = 1; while (ids.includes(`${prefix}${k}`)) k++; return `${prefix}${k}`; };

export function AssemblyModule({ code, s, set, t, openNode }: { code: CodeId; s: AsmState; set: (p: Partial<AsmState>) => void; t: T; openNode?: (p: Partial<NodeState>) => void }) {
  const [tab, setTab] = useState<"results" | "report">("results");
  const asm = s.asm;
  const setAsm = (p: Partial<Assembly>) => asm && set({ asm: { ...asm, ...p } });
  const steels = STEELS.filter((x) => x.code === code);

  const calc = useMemo((): { r?: AsmResult; err?: string } => {
    if (!asm || !asm.members.length) return {};
    // при зміні норм сталі й анкери, яких немає в цих нормах, замінюються типовими
    const ok = (id: string) => STEELS.some((x) => x.id === id && x.code === code);
    const def = basePlateDefaults(code);
    const a: Assembly = { ...asm, code,
      members: asm.members.map((m) => (ok(m.steel) ? m : { ...m, steel: def.plate.steel })),
      nodes: asm.nodes.map((n) => (!n.base ? n : { ...n, base: { ...n.base, plate: { ...n.base.plate, steel: ok(n.base.plate.steel) ? n.base.plate.steel : def.plate.steel },
        anchors: { ...n.base.anchors, steel: (code === "DBN") === /[А-ЯЄІЇҐ]/.test(n.base.anchors.steel) ? n.base.anchors.steel : def.anchors.steel } } })) };
    try { return { r: analyzeAssembly(a) }; } catch (e) { return { err: String((e as Error).message) }; }
  }, [asm, code]);

  if (!asm) {
    return (
      <main className="home">
        <h1 className="home-title">{t("asm_pick")}</h1>
        <p className="home-sub">{t("asm_pick_sub")}</p>
        <div className="cards">
          {[...ASM_TEMPLATES, "empty" as const].map((k) => (
            <button key={k} id={`asm-${k}`} className="card" onClick={() => {
              const a: Assembly = k === "empty" ? { code, nodes: [{ id: "1", x: 0, y: 0, z: 0, support: "fixed" }, { id: "2", x: 0, y: 0, z: 3000 }], members: [], panels: [], panelLoads: [], cases: [{ id: "G", label: "G", cat: "G", gf: GF_DEFAULT[code].G, selfWeight: true }] } : asmTemplate(k, code);
              set({ tmpl: k, asm: a, sel: null, loadsOf: a.cases[0]?.id ?? "", tool: k === "empty" ? "member" : "select", pending: [], combo: -1 });
            }}>
              <svg viewBox="0 0 48 48" className="card-icon" aria-hidden="true">{ASM_ICONS[k]}</svg>
              <span className="card-title">{t(`at_${k}`)}</span>
              <span className="card-desc">{t(`at_${k}_d`)}</span>
            </button>
          ))}
        </div>
      </main>
    );
  }

  const r = calc.r;
  const err = calc.err && errText(calc.err, t);
  const node = (id: string) => asm.nodes.find((n) => n.id === id);
  const sel = s.sel;
  const selNode = sel?.kind === "node" ? node(sel.id) : undefined;
  const selMember = sel?.kind === "member" ? asm.members.find((m) => m.id === sel.id) : undefined;
  const selPanel = sel?.kind === "panel" ? asm.panels.find((p) => p.id === sel.id) : undefined;
  const updNode = (id: string, p: Partial<AsmNode>) => setAsm({ nodes: asm.nodes.map((n) => (n.id === id ? { ...n, ...p } : n)) });
  const updMember = (id: string, p: Partial<AsmMember>) => setAsm({ members: asm.members.map((m) => (m.id === id ? { ...m, ...p } : m)) });

  // ---- інструменти
  const onPick = (p: Pick) => {
    if (p?.kind === "node" && (s.tool === "member" || s.tool === "panel")) {
      const pend = s.pending.includes(p.id) ? s.pending : [...s.pending, p.id];
      if (s.tool === "member" && pend.length === 2) {
        const id = nextId(asm.members.map((m) => m.id), "m");
        const last = asm.members[asm.members.length - 1];
        const m: AsmMember = { id, i: pend[0], j: pend[1], family: last?.family ?? "RHS_COLD", size: last?.size ?? "100×100×4", steel: last?.steel ?? (code === "DBN" ? "C245" : "S235"),
          endI: { ...(last?.endJ ?? { behaviour: "rigid", kind: "weld", kf: 4 }) }, endJ: { ...(last?.endJ ?? { behaviour: "rigid", kind: "weld", kf: 4 }) } };
        set({ asm: { ...asm, members: [...asm.members, m] }, pending: [pend[1]], sel: { kind: "member", id } });
        return;
      }
      if (s.tool === "panel" && pend.length === 4) { addPanel(pend); return; }
      set({ pending: pend, sel: p });
      return;
    }
    set({ sel: p });
  };
  const addPanel = (ids: string[]) => {
    const id = nextId(asm.panels.map((p) => p.id), "P");
    set({ asm: { ...asm, panels: [...asm.panels, { id, nodes: ids, mode: "two", mass: 0 }] }, pending: [], tool: "select", sel: { kind: "panel", id } });
  };
  const onPlace = (p: Vec3) => {
    if (s.tool !== "node") { set({ sel: null }); return; }
    const id = nextId(asm.nodes.map((n) => n.id), "");
    set({ asm: { ...asm, nodes: [...asm.nodes, { id, x: p[0], y: p[1], z: p[2] }] }, sel: { kind: "node", id } });
  };
  const delSel = () => {
    if (!sel) return;
    if (sel.kind === "node") set({ sel: null, asm: { ...asm, nodes: asm.nodes.filter((n) => n.id !== sel.id), members: asm.members.filter((m) => m.i !== sel.id && m.j !== sel.id), panels: asm.panels.filter((p) => !p.nodes.includes(sel.id)) } });
    if (sel.kind === "member") set({ sel: null, asm: { ...asm, members: asm.members.filter((m) => m.id !== sel.id), cases: asm.cases.map((c) => ({ ...c, members: c.members?.filter((l) => l.member !== sel.id) })) } });
    if (sel.kind === "panel") set({ sel: null, asm: { ...asm, panels: asm.panels.filter((p) => p.id !== sel.id), panelLoads: asm.panelLoads.filter((l) => l.panel !== sel.id) } });
  };

  // ---- результати вибраного сполучення
  const uls = r?.uls ?? [];
  const ulsCombos = r?.combos.filter((c) => c.kind !== "SLS") ?? [];
  const govIdx = (() => {
    if (!r) return 0;
    let best = 0, bu = -1;
    ulsCombos.forEach((c, k) => {
      const u = Math.max(...r.members.flatMap((m) => m.checks.filter((x) => x.combo === c.name).map((x) => x.util)), 0);
      if (u > bu) { bu = u; best = k; }
    });
    return best;
  })();
  const ci = s.combo >= 0 && s.combo < uls.length ? s.combo : govIdx;
  const modeOn = r?.seismic && (s.mode ?? -1) >= 0 && (s.mode ?? -1) < r.seismic.shapes.length;
  const comboRes = modeOn ? r!.seismic!.shapes[s.mode!] : uls[ci];

  // ---- картки редагування
  const memberIds = asm.members.map((m) => m.id), nodeIds = asm.nodes.map((n) => n.id);
  const endEditor = (m: AsmMember, which: "endI" | "endJ") => {
    const e = m[which], up = (p: Partial<EndConn>) => updMember(m.id, { [which]: { ...e, ...p } } as Partial<AsmMember>);
    const pre = `${which}-${m.id}`;
    return (
      <div className="end-ed">
        <div className="end-head">
          <b>{t(which === "endI" ? "asm_endI" : "asm_endJ")} · {t("asm_node")} {which === "endI" ? m.i : m.j}</b>
          <div className="seg" role="group">
            <button id={`${pre}-rigid`} className={e.behaviour === "rigid" ? "on" : ""} onClick={() => up({ behaviour: "rigid" })}>{t("asm_rigid")}</button>
            <button id={`${pre}-pin`} className={e.behaviour === "pin" ? "on" : ""} onClick={() => up({ behaviour: "pin" })}>{t("asm_pin")}</button>
          </div>
        </div>
        <div className="grid2">
          <label className="wide"><span className="lbl">{t("asm_connector")}</span><select id={`${pre}-kind`} value={e.kind} onChange={(x) => up({ kind: x.target.value as EndConn["kind"] })}>{KINDS.map((k) => <option key={k} value={k}>{t(`ck_${k}`)}</option>)}</select></label>
          {e.kind === "weld" && <><Num id={`${pre}-kf`} label={t("w_kf")} v={e.kf ?? 5} on={(v) => up({ kf: v })} /><Num id={`${pre}-tp`} label={t("asm_tp")} v={e.tp} ph="—" on={(v) => up({ tp: v || undefined })} /></>}
          {(e.kind === "bolts" || e.kind === "rivets") && <>
            <label className="wide"><span className="lbl">{t("asm_plane")}</span><select id={`${pre}-plane`} value={e.plane ?? "web"} onChange={(x) => up({ plane: x.target.value as EndConn["plane"] })}><option value="web">{t("asm_plane_web")}</option><option value="end">{t("asm_plane_end")}</option></select></label>
            <label><span className="lbl">{t("bo_d")}</span><select id={`${pre}-d`} value={e.d ?? 16} onChange={(x) => up({ d: Number(x.target.value) })}>{BOLT_DIAMETERS.map((d) => <option key={d} value={d}>M{d}</option>)}</select></label>
            {e.kind === "bolts" && <label><span className="lbl">{t("bo_class")}</span><select id={`${pre}-cls`} value={e.boltClass ?? (code === "DBN" ? "5.6" : "8.8")} onChange={(x) => up({ boltClass: x.target.value })}>{Object.keys(BOLT_CLASSES).map((c) => <option key={c}>{c}</option>)}</select></label>}
            <Num id={`${pre}-rows`} label={t("asm_rows")} v={e.rows ?? 1} on={(v) => up({ rows: Math.max(1, Math.round(v)) })} />
            <Num id={`${pre}-cols`} label={t("asm_cols")} v={e.cols ?? 2} on={(v) => up({ cols: Math.max(1, Math.round(v)) })} />
            <Num id={`${pre}-px`} label={t("asm_px")} v={e.px ?? 3 * (e.d ?? 16)} on={(v) => up({ px: v })} />
            <Num id={`${pre}-py`} label={t("asm_py")} v={e.py ?? 3 * (e.d ?? 16)} on={(v) => up({ py: v })} />
            <Num id={`${pre}-tp`} label={t("asm_tp")} v={e.tp ?? 10} on={(v) => up({ tp: v })} />
            <Num id={`${pre}-edge`} label={t("asm_edge")} v={e.edge ?? 2 * (e.d ?? 16)} on={(v) => up({ edge: v })} />
          </>}
          {e.kind === "screws" && <>
            <Num id={`${pre}-n`} label={t("asm_n")} v={e.n ?? 4} on={(v) => up({ n: Math.max(1, Math.round(v)) })} />
            <Num id={`${pre}-sd`} label="d, mm" step={0.1} v={e.d ?? 5.5} on={(v) => up({ d: v })} />
            <Num id={`${pre}-fv`} label={t("asm_FvRk")} step={0.1} v={(e.FvRk ?? 4000) / 1000} on={(v) => up({ FvRk: v * 1000 })} />
            <Num id={`${pre}-ft`} label={t("asm_FtRk")} step={0.1} v={e.FtRk ? e.FtRk / 1000 : undefined} ph="—" on={(v) => up({ FtRk: v ? v * 1000 : undefined })} />
            <Num id={`${pre}-stp`} label={t("asm_tsheet")} step={0.1} v={e.tp ?? 1} on={(v) => up({ tp: v })} />
          </>}
        </div>
      </div>
    );
  };

  let card: JSX.Element | null = null;
  if (selNode) {
    const n = selNode;
    const base = n.base ?? basePlateDefaults(code);
    const upBase = (p: Partial<typeof base>) => updNode(n.id, { base: { ...base, ...p } });
    card = (
      <div className="part open"><div className="part-body">
        <h3 className="card-h">{t("asm_node")} {n.id}</h3>
        <div className="grid3">
          {(["x", "y", "z"] as const).map((c) => <Num key={c} id={`n-${c}`} label={`${c.toUpperCase()}, mm`} step={50} v={n[c]} on={(v) => updNode(n.id, { [c]: v })} />)}
        </div>
        <label><span className="lbl">{t("asm_support")}</span><select id="n-sup" value={n.support ?? "none"} onChange={(e) => updNode(n.id, { support: e.target.value as AsmNode["support"], ...(e.target.value === "base" && !n.base ? { base: basePlateDefaults(code) } : {}) })}>{SUP.map((x) => <option key={x} value={x}>{t(`sup_a_${x}`)}</option>)}</select></label>
        <details className="adv"><summary>{t("asm_fixDofs")}</summary>
          <div className="dof-row">{DOF_LIST.map((d) => <label key={d} className="chk"><input id={`n-fix-${d}`} type="checkbox" checked={!!n.fix?.[d]} onChange={(e) => updNode(n.id, { fix: { ...(n.fix ?? {}), [d]: e.target.checked } })} />{d}</label>)}</div>
          <p className="hint">{t("asm_fixHint")}</p>
        </details>
        {n.support === "base" && <div className="base-ed">
          <h4>{t("asm_base")}</h4>
          <div className="grid3">
            <Num id="b-L" label="L, mm" v={base.plate.L} on={(v) => upBase({ plate: { ...base.plate, L: v } })} />
            <Num id="b-B" label="B, mm" v={base.plate.B} on={(v) => upBase({ plate: { ...base.plate, B: v } })} />
            <Num id="b-t" label="t, mm" v={base.plate.t} on={(v) => upBase({ plate: { ...base.plate, t: v } })} />
            <label><span className="lbl">{t("bo_d")}</span><select id="b-d" value={base.anchors.d} onChange={(e) => upBase({ anchors: { ...base.anchors, d: Number(e.target.value) } })}>{BOLT_DIAMETERS.map((d) => <option key={d} value={d}>M{d}</option>)}</select></label>
            <Num id="b-nx" label="n_x" v={base.anchors.nx} on={(v) => upBase({ anchors: { ...base.anchors, nx: Math.max(1, Math.round(v)), points: undefined } })} />
            <Num id="b-ny" label="n_y" v={base.anchors.ny} on={(v) => upBase({ anchors: { ...base.anchors, ny: Math.max(1, Math.round(v)), points: undefined } })} />
            <Num id="b-sx" label="s_x, mm" v={base.anchors.sx} on={(v) => upBase({ anchors: { ...base.anchors, sx: v } })} />
            <Num id="b-sy" label="s_y, mm" v={base.anchors.sy} on={(v) => upBase({ anchors: { ...base.anchors, sy: v } })} />
            <Num id="b-hef" label="h_ef, mm" v={base.anchors.hef} on={(v) => upBase({ anchors: { ...base.anchors, hef: v } })} />
            <label><span className="lbl">{t("an_class")}</span><select id="b-conc" value={CONCRETE_CLASSES.find((c) => c.fck === base.concrete.fck)?.id ?? "C20/25"} onChange={(e) => upBase({ concrete: { ...base.concrete, fck: CONCRETE_CLASSES.find((c) => c.id === e.target.value)?.fck ?? 20 } })}>{CONCRETE_CLASSES.map((c) => <option key={c.id}>{c.id}</option>)}</select></label>
            <Num id="b-gr" label={t("np_grout")} v={base.concrete.grout} on={(v) => upBase({ concrete: { ...base.concrete, grout: v } })} />
            <Num id="b-kf" label={t("w_kf")} v={base.weld.kf} on={(v) => upBase({ weld: { ...base.weld, kf: v } })} />
          </div>
          <p className="hint">{t("asm_baseHint")}</p>
        </div>}
      </div></div>
    );
  } else if (selMember) {
    const m = selMember;
    const fams = familiesFor("column");
    const sizes = familySections(fams.some((f) => f.id === m.family) ? m.family : "RHS_COLD");
    card = (
      <div className="part open"><div className="part-body">
        <h3 className="card-h">{t("asm_member")} {m.id}</h3>
        <div className="grid2">
          <label><span className="lbl">{t("asm_from")}</span><select id="m-i" value={m.i} onChange={(e) => updMember(m.id, { i: e.target.value })}>{nodeIds.map((id) => <option key={id}>{id}</option>)}</select></label>
          <label><span className="lbl">{t("asm_to")}</span><select id="m-j" value={m.j} onChange={(e) => updMember(m.id, { j: e.target.value })}>{nodeIds.map((id) => <option key={id}>{id}</option>)}</select></label>
          <label><span className="lbl">{t("family")}</span><select id="m-fam" value={m.family} onChange={(e) => { const l = familySections(e.target.value); updMember(m.id, { family: e.target.value, size: l[Math.floor(l.length / 3)]?.name ?? "" }); }}><FamilyOptions fams={fams} t={t} /></select></label>
          <label><span className="lbl">{t("size")}</span><select id="m-size" value={m.size} onChange={(e) => updMember(m.id, { size: e.target.value })}>{sizes.map((x) => <option key={x.name}>{x.name}</option>)}</select></label>
          <label><span className="lbl">{t("material")}</span><select id="m-st" value={steels.some((x) => x.id === m.steel) ? m.steel : steels[0].id} onChange={(e) => updMember(m.id, { steel: e.target.value })}>{steels.map((x) => <option key={x.id}>{x.id}</option>)}</select></label>
          <Num id="m-beta" label={t("asm_beta")} step={90} v={m.beta ?? 0} on={(v) => updMember(m.id, { beta: v })} />
          <Num id="m-muy" label="μ_y" step={0.1} v={m.mu?.y ?? 1} on={(v) => updMember(m.id, { mu: { y: v, z: m.mu?.z ?? 1 } })} />
          <Num id="m-muz" label="μ_z" step={0.1} v={m.mu?.z ?? 1} on={(v) => updMember(m.id, { mu: { y: m.mu?.y ?? 1, z: v } })} />
        </div>
        {endEditor(m, "endI")}
        {endEditor(m, "endJ")}
        <p className="hint">{t("asm_memberHint")}</p>
      </div></div>
    );
  } else if (selPanel) {
    const p = selPanel;
    const upP = (q: Partial<typeof p>) => setAsm({ panels: asm.panels.map((x) => (x.id === p.id ? { ...x, ...q } : x)) });
    const pls = asm.panelLoads.map((l, k) => ({ l, k })).filter((x) => x.l.panel === p.id);
    const upL = (k: number, q: Partial<PanelLoad>) => setAsm({ panelLoads: asm.panelLoads.map((x, j) => (j === k ? { ...x, ...q } : x)) });
    const info = r?.panels.find((x) => x.id === p.id);
    card = (
      <div className="part open"><div className="part-body">
        <h3 className="card-h">{t("asm_panel")} {p.id} · {p.nodes.join("–")}</h3>
        <div className="seg wide" role="group">
          <button id="pk-load" className={p.kind !== "plate" ? "on" : ""} onClick={() => upP({ kind: "load" })}>{t("asm_kLoad")}</button>
          <button id="pk-plate" className={p.kind === "plate" ? "on" : ""} onClick={() => upP({ kind: "plate", t: p.t ?? 8, steel: p.steel ?? (code === "DBN" ? "C245" : "S235") })}>{t("asm_kPlate")}</button>
        </div>
        <p className="hint">{t(p.kind === "plate" ? "asm_kPlateHint" : "asm_kLoadHint")}</p>
        {p.kind === "plate" && <div className="grid3">
          <Num id="p-t" label="t, mm" step={1} v={p.t ?? 8} on={(v) => upP({ t: Math.max(0.5, v) })} />
          <label><span className="lbl">{t("material")}</span><select id="p-st" value={steels.some((x) => x.id === p.steel) ? p.steel : code === "DBN" ? "C245" : "S235"} onChange={(e) => upP({ steel: e.target.value })}>{steels.map((x) => <option key={x.id}>{x.id}</option>)}</select></label>
          <Num id="p-mesh" label={t("asm_mesh")} step={1} v={p.mesh} ph={t("asm_auto")} on={(v) => upP({ mesh: v ? Math.max(2, Math.min(20, Math.round(v))) : undefined })} />
        </div>}
        {p.kind !== "plate" && <div className="seg wide" role="group">
          <button id="pm-two" className={p.mode === "two" ? "on" : ""} onClick={() => upP({ mode: "two" })}>{t("asm_two")}</button>
          <button id="pm-one0" className={p.mode === "one" && (p.span ?? 0) === 0 ? "on" : ""} onClick={() => upP({ mode: "one", span: 0 })}>{t("asm_one0")}</button>
          <button id="pm-one1" className={p.mode === "one" && p.span === 1 ? "on" : ""} onClick={() => upP({ mode: "one", span: 1 })}>{t("asm_one1")}</button>
        </div>}
        <Num id="p-mass" label={t("asm_mass")} v={p.mass ?? 0} on={(v) => upP({ mass: v })} />
        {info && p.kind === "plate" && <p className="hint">{t("asm_area")}: {(info.area / 1e6).toFixed(2)} m²</p>}
        {info && p.kind !== "plate" && <p className="hint">{t("asm_area")}: {(info.area / 1e6).toFixed(2)} m² · {t("asm_edges")}: {info.edges.map((e, k) => `${k}${e.supported ? "✓" : "–"}`).join(" ")}{info.error ? ` · ${t(`asm_perr_${info.error}`)}` : ""}</p>}
        <h4>{t("asm_panelLoads")}</h4>
        {pls.map(({ l, k }) => (
          <div key={k} className="pl-row">
            <div className="grid3">
              <label><span className="lbl">{t("nl_case")}</span><select id={`pl-c${k}`} value={l.case} onChange={(e) => upL(k, { case: e.target.value })}>{asm.cases.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
              <Num id={`pl-q${k}`} label="q, kPa" step={0.1} v={r1(l.q * 1000)} on={(v) => upL(k, { q: v / 1000 })} />
              <label><span className="lbl">{t("asm_dir")}</span><select id={`pl-d${k}`} value={l.dir} onChange={(e) => upL(k, { dir: e.target.value as PanelLoad["dir"] })}>{(["normal", "gz", "gx", "gy"] as const).map((d) => <option key={d} value={d}>{t(`dir_${d}`)}</option>)}</select></label>
            </div>
            <label className="chk"><input type="checkbox" checked={!!l.projected} onChange={(e) => upL(k, { projected: e.target.checked })} />{t("asm_projected")}</label>
            <details className="adv"><summary>{t("asm_region")}{l.region ? ` · u ${Math.round(l.region.u0 * 100)}–${Math.round(l.region.u1 * 100)}%, v ${Math.round(l.region.v0 * 100)}–${Math.round(l.region.v1 * 100)}%` : ""}</summary>
              <div className="grid3">
                {(["u0", "u1", "v0", "v1"] as const).map((q) => <Num key={q} id={`pl-${q}${k}`} label={`${q}, %`} v={Math.round((l.region?.[q] ?? (q.endsWith("1") ? 1 : 0)) * 100)} on={(v) => upL(k, { region: { u0: 0, u1: 1, v0: 0, v1: 1, ...l.region, [q]: Math.max(0, Math.min(100, v)) / 100 } })} />)}
              </div>
              <p className="hint">{t("asm_regionHint")}</p>
            </details>
            <button className="ghost danger" onClick={() => setAsm({ panelLoads: asm.panelLoads.filter((_, j) => j !== k) })}>{t("remove")}</button>
          </div>
        ))}
        <button id="pl-add" className="ghost" onClick={() => setAsm({ panelLoads: [...asm.panelLoads, { panel: p.id, case: s.loadsOf || asm.cases[0]?.id || "G", q: -0.001, dir: "gz" }] })}>+ {t("asm_addPanelLoad")}</button>
        <p className="hint">{t("asm_panelHint")}</p>
      </div></div>
    );
  }

  // ---- загруження
  const caseEd = (() => {
    const c = asm.cases.find((x) => x.id === s.loadsOf) ?? asm.cases[0];
    if (!c) return null;
    const upC = (p: Partial<typeof c>) => setAsm({ cases: asm.cases.map((x) => (x.id === c.id ? { ...x, ...p } : x)) });
    const nls = c.nodal ?? [], mls = c.members ?? [];
    return (
      <div className="case-ed">
        <div className="grid3">
          <label><span className="lbl">{t("nl_case")}</span><input id="c-label" value={c.label} onChange={(e) => upC({ label: e.target.value })} /></label>
          <label><span className="lbl">{t("nl_cat")}</span><select id="c-cat" value={c.cat} onChange={(e) => upC({ cat: e.target.value as LoadCategory, gf: GF_DEFAULT[code][e.target.value as LoadCategory] })}>{(["G", "L", "Q", "A"] as const).map((x) => <option key={x}>{x}</option>)}</select></label>
          <Num id="c-gf" label="γ_f" step={0.05} v={c.gf ?? GF_DEFAULT[code][c.cat]} on={(v) => upC({ gf: v })} />
        </div>
        <label className="chk"><input id="c-sw" type="checkbox" checked={!!c.selfWeight} onChange={(e) => upC({ selfWeight: e.target.checked })} />{t("asm_selfWeight")}</label>
        <label><span className="lbl">{t("asm_group")}</span><input id="c-grp" value={c.group ?? ""} placeholder="—" onChange={(e) => upC({ group: e.target.value || undefined })} /></label>
        <h4>{t("asm_nodal")}</h4>
        {nls.map((nl, k) => (
          <div key={k} className="ld-row">
            <select value={nl.node} onChange={(e) => upC({ nodal: nls.map((x, j) => (j === k ? { ...x, node: e.target.value } : x)) })}>{nodeIds.map((id) => <option key={id}>{id}</option>)}</select>
            {["Fx", "Fy", "Fz"].map((lbl, q) => <label key={lbl} className="mini"><span>{lbl}</span><NumInput id={`nl${k}-${q}`} step={0.1} value={r1((nl.F[q] ?? 0) / 1000)} onChange={(e) => upC({ nodal: nls.map((x, j) => (j === k ? { ...x, F: x.F.map((v, i) => (i === q ? num(e.target.value) * 1000 : v)) } : x)) })} /></label>)}
            <button className="icon" aria-label="remove" onClick={() => upC({ nodal: nls.filter((_, j) => j !== k) })}>×</button>
          </div>
        ))}
        <button id="add-nl" className="ghost" onClick={() => upC({ nodal: [...nls, { node: (selNode?.id ?? nodeIds[nodeIds.length - 1]) || "1", F: [0, 0, -1000, 0, 0, 0] }] })}>+ {t("asm_addNodal")}</button>
        <h4>{t("asm_memberLoads")}</h4>
        {mls.map((ml, k) => (
          <div key={k} className="ld-row">
            <select value={ml.member} onChange={(e) => upC({ members: mls.map((x, j) => (j === k ? { ...x, member: e.target.value } : x)) })}>{memberIds.map((id) => <option key={id}>{id}</option>)}</select>
            <select value={ml.dir} onChange={(e) => upC({ members: mls.map((x, j) => (j === k ? { ...x, dir: e.target.value as MemberLoad["dir"] } : x)) })}>{(["gz", "gx", "gy", "lz", "ly", "lx"] as const).map((d) => <option key={d} value={d}>{d}</option>)}</select>
            {ml.kind === "dist" && <>
              <label className="mini"><span>w₁</span><NumInput step={0.1} value={r1(ml.w1)} onChange={(e) => upC({ members: mls.map((x, j) => (j === k ? { ...x, w1: num(e.target.value) } as MemberLoad : x)) })} /></label>
              <label className="mini"><span>w₂</span><NumInput step={0.1} placeholder="=w₁" value={ml.w2 ?? ""} onChange={(e) => upC({ members: mls.map((x, j) => (j === k ? { ...x, w2: e.target.value === "" ? undefined : num(e.target.value) } as MemberLoad : x)) })} /></label>
            </>}
            <button className="icon" aria-label="remove" onClick={() => upC({ members: mls.filter((_, j) => j !== k) })}>×</button>
          </div>
        ))}
        <button id="add-ml" className="ghost" onClick={() => upC({ members: [...mls, { member: selMember?.id ?? memberIds[0], kind: "dist", dir: "gz", w1: -1 }] })}>+ {t("asm_addMemberLoad")}</button>
        <p className="hint">{t("asm_loadsHint")}</p>
      </div>
    );
  })();

  // ---- сейсміка
  const sq: SeismicInput = asm.seismic ?? { on: false, dirs: { x: true, y: true, z: false } };
  const upS = (p: Partial<SeismicInput>) => setAsm({ seismic: { ...sq, ...p } });
  const I = sq.intensity ?? 7, k1kind = s.k1kind ?? "steelFrame";
  const a0Key = A0_TABLE.findIndex((x) => x.a0 === (sq.a0 ?? 0.1) && x.A === I);
  const K2 = [1.5, 1.4, 1.3, 1.2, 1.4, 1.4, 1.0, 1.0, 0.5];
  const seisEd = (
    <fieldset className="seis"><legend><span className="step">3</span>{t("seis_title")}</legend>
      <label className="chk"><input id="seis-on" type="checkbox" checked={sq.on} onChange={(e) => upS({ on: e.target.checked, ...(code === "DBN" && sq.a0 === undefined ? { a0: 0.1, intensity: 7, soil: "II", k1: k1Of(k1kind, 7), k2: 1 } : {}) })} />{t("seis_on")}</label>
      {sq.on && <>
        {code === "DBN" ? <div className="grid2">
          <label className="wide"><span className="lbl">{t("seis_map")}</span><select id="seis-a0" value={a0Key} onChange={(e) => { const x = A0_TABLE[Number(e.target.value)]; if (x) upS({ a0: x.a0, intensity: x.A as 6 | 7 | 8 | 9, k1: k1Of(k1kind, x.A) }); }}>
            {a0Key < 0 && <option value={-1}>a₀ = {sq.a0}</option>}
            {A0_TABLE.map((x, k) => <option key={k} value={k}>A {x.A} / B {x.B} → a₀ = {x.a0}g</option>)}</select></label>
          <Num id="seis-a0v" label="a₀, g" step={0.01} v={sq.a0 ?? 0.1} on={(v) => upS({ a0: v })} />
          <label><span className="lbl">{t("seis_soil")}</span><select id="seis-soil" value={sq.soil ?? "II"} onChange={(e) => upS({ soil: e.target.value as SeismicInput["soil"] })}>{(["I", "II", "III"] as const).map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
          <label className="wide"><span className="lbl">{t("seis_k1")}</span><select id="seis-k1" value={k1kind} onChange={(e) => { set({ k1kind: e.target.value }); upS({ k1: k1Of(e.target.value, I) }); }}>
            {Object.keys(K1_TABLE).map((k) => <option key={k} value={k}>{t(`seis_k1_${k}`)} · {k1Of(k, I)}</option>)}</select></label>
          <Num id="seis-k1v" label="k₁" step={0.05} v={sq.k1 ?? k1Of(k1kind, I)} on={(v) => upS({ k1: v })} />
          <label><span className="lbl">k₂ ({t("seis_k2")})</span><select id="seis-k2" value={sq.k2 ?? 1} onChange={(e) => upS({ k2: Number(e.target.value) })}>{[...new Set(K2)].sort().map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
          <Num id="seis-n" label={t("seis_storeys")} v={sq.storeys ?? 1} on={(v) => upS({ storeys: Math.max(1, Math.round(v)) })} />
          <label className="chk wide"><input id="seis-kgr" type="checkbox" checked={!!sq.kgr} onChange={(e) => upS({ kgr: e.target.checked })} />{t("seis_kgr")}</label>
          <label className="wide"><span className="lbl">{t("seis_level")}</span><select id="seis-level" value={sq.level ?? "PZ"} onChange={(e) => upS({ level: e.target.value as SeismicInput["level"] })}>{(["SZ", "PZ", "MRZ"] as const).map((x) => <option key={x} value={x}>{t(`seis_lvl_${x}`)}</option>)}</select></label>
        </div> : <div className="grid2">
          <Num id="seis-ag" label="a_gR, g" step={0.01} v={sq.agR ?? 0.1} on={(v) => upS({ agR: v })} />
          <Num id="seis-gi" label="γ_I" step={0.1} v={sq.gammaI ?? 1} on={(v) => upS({ gammaI: v })} />
          <label><span className="lbl">{t("seis_ground")}</span><select id="seis-gr" value={sq.ground ?? "B"} onChange={(e) => upS({ ground: e.target.value as SeismicInput["ground"] })}>{(["A", "B", "C", "D", "E"] as const).map((x) => <option key={x}>{x}</option>)}</select></label>
          <label><span className="lbl">{t("seis_type")}</span><select id="seis-type" value={sq.spectrum ?? 1} onChange={(e) => upS({ spectrum: Number(e.target.value) as 1 | 2 })}><option value={1}>1</option><option value={2}>2</option></select></label>
          <Num id="seis-q" label={t("seis_q")} step={0.5} v={sq.q ?? 1.5} on={(v) => upS({ q: Math.max(1, v) })} />
          <Num id="seis-beta" label="β" step={0.05} v={sq.beta ?? 0.2} on={(v) => upS({ beta: v })} />
        </div>}
        <div className="seg wide seis-dirs" role="group">{(["x", "y", "z"] as const).map((d) => <button key={d} id={`seis-d${d}`} className={sq.dirs[d] ? "on" : ""} onClick={() => upS({ dirs: { ...sq.dirs, [d]: !sq.dirs[d] } })}>{t(`seis_dir_${d}`)}</button>)}</div>
        <h4>{t(code === "DBN" ? "seis_coefDBN" : "seis_coefEN")}</h4>
        <div className="grid3">{asm.cases.map((c) => <Num key={c.id} id={`seis-c-${c.id}`} label={`${c.label} · ${c.cat}`} step={0.05} v={sq.coef?.[c.id] ?? seisCoefDefault(code, c)} on={(v) => upS({ coef: { ...(sq.coef ?? {}), [c.id]: v } })} />)}</div>
        <p className="hint">{t(code === "DBN" ? "seis_hintDBN" : "seis_hintEN")}</p>
      </>}
    </fieldset>
  );
  const sr = r?.seismic;
  const seisRes = sr && (
    <div className="panel seis-res"><h3>{t("seis_title")}</h3>
      <table className="conn-values"><thead><tr><th>{t("seis_mode")}</th><th>T, s</th><th>f, Hz</th><th>M_eff X</th><th>M_eff Y</th><th>M_eff Z</th><th>S_a X/Y, g</th></tr></thead>
        <tbody>{sr.modes.map((m, k) => <tr key={k} className={(s.mode ?? -1) === k ? "on" : ""} onClick={() => set({ mode: (s.mode ?? -1) === k ? -1 : k })}>
          <td>{k + 1}</td><td className="mono">{m.T.toFixed(3)}</td><td className="mono">{(1 / m.T).toFixed(2)}</td>
          {m.meff.map((v, d) => <td key={d} className="mono">{(v * 100).toFixed(1)}%</td>)}<td className="mono">{m.Sa[0].toFixed(3)}</td></tr>)}
          <tr><td><b>Σ</b></td><td /><td />{sr.sum.map((v, d) => <td key={d} className={`mono ${v < (d === 2 ? 0.75 : 0.85) && sr.Mtot[d] ? "fail" : ""}`}><b>{(v * 100).toFixed(1)}%</b></td>)}<td /></tr></tbody></table>
      <p className="hint">{t("seis_modeHint")}</p>
      <table className="conn-values"><tbody>
        <tr><td>{t("seis_mass")}</td><td className="mono">{sr.Mtot[0].toFixed(2)} t</td></tr>
        <tr><td>{t("seis_vbase")}</td><td className="mono">{sr.Vbase.map((v) => (v / 1e3).toFixed(2)).join(" / ")} kN</td></tr>
      </tbody></table>
      {sr.warnings.map((w) => <p key={w} className="error">{w.startsWith("modalMass") ? t("seis_wMass").replace("{d}", w.split(":")[1].toUpperCase()).replace("{p}", w.split(":")[2]) : t("seis_wNoMass")}</p>)}
      {sr.drift.length > 0 && <><h4>{t("seis_drift")}</h4>
        <table className="conn-values"><thead><tr><th>{t("asm_member")}</th><th>{t("seis_driftR")}</th><th>{t("seis_driftL")}</th><th>{t("rep_maxutil")}</th></tr></thead>
          <tbody>{[...sr.drift].sort((a, b) => b.util - a.util).slice(0, 8).map((d) => <tr key={d.member} className={utilState(d.util)}><td>{d.member}</td><td className="mono">1/{Math.round(1 / Math.max(d.ratio, 1e-9))}</td><td className="mono">1/{Math.round(1 / d.limit)}</td><td className="mono">{pct(d.util)}</td></tr>)}</tbody></table>
        <p className="hint">{t(code === "DBN" ? "seis_driftHintDBN" : "seis_driftHintEN")}</p></>}
    </div>
  );

  // ---- результати
  const worst = r && [...r.members.map((m) => ({ k: "member" as const, id: m.member, ch: m.checks })), ...r.conns.map((c) => ({ k: "conn" as const, id: `${c.member} · ${c.end}`, ch: c.checks })), ...r.supports.map((x) => ({ k: "support" as const, id: x.node, ch: (x.result?.envelope ?? []) as (Check & { combo: string })[] })), ...r.plates.map((x) => ({ k: "plate" as const, id: x.panel, ch: x.checks }))]
    .map((x) => ({ ...x, u: govU(x.ch) })).reduce((a, b) => (!(b.u <= a.u) ? b : a));
  const govCheck = worst && gov(worst.ch);
  const maxU = worst ? worst.u : 0;
  const st = r ? utilState(maxU) : "ok";
  const summary = r && (
    <div className={`summary ${st}`}>
      <div className="summary-main"><div className="eyebrow">{t("asm_struct")}</div><div className="profile">{t(`at_${s.tmpl ?? "empty"}`)}</div>
        <div className="meta">{asm.nodes.length} {t("asm_nodesN")} · {asm.members.length} {t("asm_membersN")} · {asm.panels.length} {t("asm_panelsN")} · {r.combos.length} {t("asm_combosN")}</div></div>
      <div className="summary-util"><div className="eyebrow">{t("rep_maxutil")}</div><div className="big">{pct(maxU)}</div><div className={`pill ${st}`}>{r.ok ? t("ok") : t("fail")}</div></div>
      {worst && govCheck && <div className="summary-gov"><div className="eyebrow">{t("governing")}</div><div>{t(`asm_k_${worst.k}`)} {worst.id}: {t(`chk_${govCheck.key}`)}</div><div className="meta">{t("nl_combo")} {govCheck.combo} · {t("asm_maxDisp")} {r.maxDisp.v.toFixed(1)} mm</div></div>}
    </div>
  );
  const memberTable = r && (
    <table className="conn-values asm-table"><thead><tr><th>{t("asm_member")}</th><th>{t("size")}</th><th>{t("governing")}</th><th>{t("nl_combo")}</th><th>{t("rep_maxutil")}</th></tr></thead>
      <tbody>{r.members.map((m) => { const g = gov(m.checks); return (
        <tr key={m.member} className={`${utilState(m.util)} ${sel?.kind === "member" && sel.id === m.member ? "on" : ""}`} onClick={() => set({ sel: { kind: "member", id: m.member } })}>
          <td>{m.member}</td><td className="mono">{m.section}</td><td>{g ? t(`chk_${g.key}`) : "—"}</td><td className="mono">{g?.combo}</td><td className="mono">{pct(m.util)}</td></tr>); })}</tbody></table>
  );
  const jr = (member: string, end: "i" | "j") => { const x = s.jres?.[`${member}|${end}`]; return x ? `${t(`nt_${x.kind}`)} · ${pct(x.util)}` : "—"; };
  const connTable = r && r.conns.length > 0 && (
    <table className="conn-values asm-table"><thead><tr><th>{t("asm_joint")}</th><th>{t("asm_connector")}</th><th>{t("governing")}</th><th>{t("rep_maxutil")}</th><th>{t("asm_nodeRes")}</th></tr></thead>
      <tbody>{r.conns.map((c) => { const g = gov(c.checks); const m = asm.members.find((x) => x.id === c.member)!; return (
        <tr key={`${c.member}${c.end}`} className={utilState(govU(c.checks))} onClick={() => set({ sel: { kind: "member", id: c.member } })}>
          <td>{c.member} → {t("asm_node")} {c.end === "i" ? m.i : m.j}</td><td>{t(`ck_${c.kind}`)} · {t(`asm_${(c.end === "i" ? m.endI : m.endJ).behaviour}`)}</td><td>{g ? t(`chk_${g.key}`) : "—"}</td><td className="mono">{pct(govU(c.checks))}</td><td className="mono">{jr(c.member, c.end)}</td></tr>); })}</tbody></table>
  );
  const supTable = r && r.supports.length > 0 && (
    <table className="conn-values asm-table"><thead><tr><th>{t("asm_node")}</th><th>{t("governing")}</th><th>{t("rep_maxutil")}</th></tr></thead>
      <tbody>{r.supports.map((x) => { const g = x.result && gov(x.result.envelope); return (
        <tr key={x.node} className={x.error ? "fail" : utilState(x.result ? govU(x.result.envelope) : 0)} onClick={() => set({ sel: { kind: "node", id: x.node } })}>
          <td>{x.node}</td><td>{x.error ? t(`asm_serr_${x.error}`) : g ? t(`chk_${g.key}`) : "—"}</td><td className="mono">{x.result ? pct(govU(x.result.envelope)) : "—"}</td></tr>); })}</tbody></table>
  );
  const plateTable = r && r.plates.length > 0 && (
    <table className="conn-values asm-table"><thead><tr><th>{t("asm_panel")}</th><th>t, mm</th><th>σ_ef / R, MPa</th><th>{t("nl_combo")}</th><th>w, mm</th><th>{t("rep_maxutil")}</th></tr></thead>
      <tbody>{r.plates.map((x) => (
        <tr key={x.panel} className={`${utilState(x.util)} ${sel?.kind === "panel" && sel.id === x.panel ? "on" : ""}`} onClick={() => set({ sel: { kind: "panel", id: x.panel } })}>
          <td>{x.panel}</td><td className="mono">{x.t}</td><td className="mono">{x.smax.toFixed(1)} / {x.R.toFixed(0)}</td><td className="mono">{x.checks[0]?.combo}</td><td className="mono">{x.wmax.toFixed(1)}</td><td className="mono">{pct(x.util)}</td></tr>))}</tbody></table>
  );
  // деталі вибраного
  let detail: JSX.Element | null = null;
  if (r && selMember) {
    const mc = r.members.find((m) => m.member === selMember.id);
    const cc = r.conns.filter((c) => c.member === selMember.id);
    const mf = comboRes?.members[selMember.id];
    const mx = (a: number[] | undefined) => (a ? a.reduce((p, v) => (Math.abs(v) > Math.abs(p) ? v : p), 0) : 0);
    detail = (
      <div className="panel"><h3>{t("asm_member")} {selMember.id} · {mc?.section} · {t("nl_combo")} {ulsCombos[ci]?.name}</h3>
        {mf && <table className="conn-values"><tbody>
          <tr><td>N (+ {t("asm_tension")}), kN</td><td className="mono">{(mf.N[0] / 1000).toFixed(2)} … {(mf.N[mf.N.length - 1] / 1000).toFixed(2)}</td></tr>
          <tr><td>M_y max, kN·m</td><td className="mono">{(mx(mf.My) / 1e6).toFixed(2)}</td></tr>
          <tr><td>M_z max, kN·m</td><td className="mono">{(mx(mf.Mz) / 1e6).toFixed(2)}</td></tr>
          <tr><td>V_z / V_y max, kN</td><td className="mono">{(mx(mf.Vz) / 1000).toFixed(2)} / {(mx(mf.Vy) / 1000).toFixed(2)}</td></tr>
          <tr><td>T max, kN·m</td><td className="mono">{(mx(mf.T) / 1e6).toFixed(3)}</td></tr>
        </tbody></table>}
        {mc && <CheckList checks={mc.checks.map((c) => ({ ...c, clause: `${c.clause} · ${t("nl_combo")} ${c.combo}` }))} t={t} />}
        {cc.map((c) => <div key={c.end}><h4>{t("asm_joint")} {t("asm_node")} {c.end === "i" ? selMember.i : selMember.j} · {t(`ck_${c.kind}`)}</h4>
          {openNode && (() => {
            const k = jointKindOf(asm, selMember.id, c.end);
            return k ? <p className="asm-jbtn"><button id={`open-joint-${selMember.id}-${c.end}`} className="ghost" onClick={() => { const j = jointFromConn(asm, r, selMember.id, c.end, code); if (j) openNode({ tmpl: j.kind, j, asmLink: undefined }); }}>
              {t("asm_openNode")}: {t(`nt_${k}`)} →</button>{s.jres?.[`${selMember.id}|${c.end}`] && <span className="hint"> {t("asm_nodeResHint")}: {jr(selMember.id, c.end)}</span>}</p>
              : asm.nodes.find((n) => n.id === (c.end === "i" ? selMember.i : selMember.j))?.support === "base"
                ? <p className="asm-jbtn"><button id={`open-base-${selMember.id}-${c.end}`} className="ghost" onClick={() => { const b = baseFromNode(asm, r, c.end === "i" ? selMember.i : selMember.j); if (b) openNode(b); }}>{t("asm_openNode")}: {t("nt_baseRigid")} →</button></p>
                : <p className="hint">{t("asm_noJointKind")}</p>;
          })()}
          <CheckList checks={c.checks.map((x) => ({ ...x, clause: `${x.clause} · ${t("nl_combo")} ${x.combo}` }))} t={t} /></div>)}
      </div>
    );
  } else if (r && selPanel && selPanel.kind === "plate") {
    const pc = r.plates.find((x) => x.panel === selPanel.id);
    detail = pc ? (
      <div className="panel"><h3>{t("asm_panel")} {selPanel.id} · t = {pc.t} mm</h3>
        <CheckList checks={pc.checks.map((c) => ({ ...c, clause: `${c.clause} · ${t("nl_combo")} ${c.combo}` }))} t={t} />
        <p className="hint">{t("asm_plateRes")}</p>
      </div>
    ) : null;
  } else if (r && selNode) {
    const sp = r.supports.find((x) => x.node === selNode.id);
    const R = comboRes?.reactions[selNode.id];
    detail = (
      <div className="panel"><h3>{t("asm_node")} {selNode.id}</h3>
        {R && <table className="conn-values"><tbody>
          <tr><td>R_x, R_y, R_z, kN · {ulsCombos[ci]?.name}</td><td className="mono">{R.slice(0, 3).map((v) => (v / 1000).toFixed(2)).join(" / ")}</td></tr>
          <tr><td>M_x, M_y, M_z, kN·m</td><td className="mono">{R.slice(3).map((v) => (v / 1e6).toFixed(2)).join(" / ")}</td></tr>
        </tbody></table>}
        {comboRes?.u[selNode.id] && <p className="hint">u = {comboRes.u[selNode.id].slice(0, 3).map((v) => v.toFixed(2)).join(" / ")} mm ({t("asm_ulsDisp")})</p>}
        {openNode && sp?.result && <p className="asm-jbtn"><button id={`open-base-${selNode.id}`} className="ghost" onClick={() => { const b = baseFromNode(asm, r, selNode.id); if (b) openNode(b); }}>{t("asm_openNode")}: {t("nt_baseRigid")} →</button></p>}
        {openNode && (() => { const g = gussetFromNode(asm, r, selNode.id, code); return g ? <p className="asm-jbtn"><button id={`open-gusset-${selNode.id}`} className="ghost" onClick={() => openNode({ tmpl: "gusset", j: g, asmLink: undefined })}>{t("asm_openNode")}: {t("nt_gusset")} →</button></p> : null; })()}
        {sp?.result && <><h4>{t("asm_base")}</h4><CheckList checks={sp.result.envelope.map((c) => ({ ...c, clause: `${c.clause} · ${t("nl_combo")} ${c.combo}` }))} t={t} /></>}
        {sp?.error && <p className="error">{t(`asm_serr_${sp.error}`)}</p>}
      </div>
    );
  }

  const toolBtn = (k: AsmState["tool"]) => <button key={k} id={`tool-${k}`} className={s.tool === k ? "on" : ""} onClick={() => set({ tool: k, pending: [] })}>{t(`tool_${k}`)}</button>;
  const viewEl = (interactive: boolean) => (
    <AsmView asm={asm} res={r} combo={comboRes} sel={s.sel} onPick={onPick} view={interactive ? s.view : "3d"} show={modeOn && interactive ? "def" : s.show} loadsOf={interactive ? s.loadsOf : undefined}
      marks={[...(s.ids ? ["ids"] : []), ...s.pending.map((p) => `n:${p}`)]} interactive={interactive} t={t}
      onMoveNode={(id, p) => updNode(id, { x: Math.round(p[0]), y: Math.round(p[1]), z: Math.round(p[2]) })} onPlace={onPlace} />
  );

  return (
    <main className="layout asm">
      <aside className="inputs">
        <button className="ghost kind-back" onClick={() => set({ asm: null, tmpl: null, sel: null })}>← {t("asm_change")}</button>
        <fieldset><legend><span className="step">1</span>{t("asm_build")}</legend>
          <div className="seg wide tools" role="group">{(["select", "node", "member", "panel"] as const).map(toolBtn)}</div>
          <p className="hint">{t(`tool_${s.tool}_h`)}{s.pending.length ? ` · ${s.pending.join(" → ")}` : ""}</p>
          {s.tool === "panel" && s.pending.length === 3 && <button id="panel-3" className="ghost" onClick={() => addPanel(s.pending)}>{t("asm_panel3")}</button>}
          {card ?? <p className="hint">{t("asm_selectHint")}</p>}
          {sel && <button id="del-sel" className="ghost danger" onClick={delSel}>{t("asm_delete")}</button>}
        </fieldset>
        <fieldset><legend><span className="step">2</span>{t("asm_loads")}</legend>
          <div className="case-tabs">
            {asm.cases.map((c) => <button key={c.id} id={`case-${c.id}`} className={`ghost ${(s.loadsOf || asm.cases[0]?.id) === c.id ? "on" : ""}`} onClick={() => set({ loadsOf: c.id })}>{c.label} · {c.cat}</button>)}
            <button id="add-case" className="ghost" onClick={() => { const id = nextId(asm.cases.map((c) => c.id), "Q"); set({ asm: { ...asm, cases: [...asm.cases, { id, label: id, cat: "Q", gf: GF_DEFAULT[code].Q }] }, loadsOf: id }); }}>+</button>
            {asm.cases.length > 1 && <button className="icon" aria-label="remove" onClick={() => { const id = s.loadsOf || asm.cases[0].id; const cases = asm.cases.filter((c) => c.id !== id); set({ asm: { ...asm, cases, panelLoads: asm.panelLoads.filter((l) => l.case !== id) }, loadsOf: cases[0].id }); }}>×</button>}
          </div>
          {caseEd}
          {r && <details className="gen-list"><summary>{t("nl_generated")}: {r.combos.length}</summary><ol>{r.combos.map((c) => <li key={c.name}><b>{c.name}</b> {c.kind === "SLS" ? `(${t("asm_sls")}) ` : c.kind === "SEIS" ? `(${t("seis_comb")}) ` : ""}{c.text}</li>)}</ol></details>}
        </fieldset>
        {seisEd}
        {code === "DBN" && (
          <details className="adv"><summary>{t("advanced")}<span className="adv-hint">γc, γn</span></summary>
            <div className="adv-group"><div className="grid2">
              <Num id="agc" label={t("gammaC")} step={0.05} v={asm.gammaC ?? 1} on={(v) => setAsm({ gammaC: v })} />
              <Num id="agn" label={t("gammaN")} step={0.05} v={asm.gammaN ?? 1} on={(v) => setAsm({ gammaN: v })} />
            </div></div></details>
        )}
      </aside>
      <section className="output">
        <div className="tabs" role="tablist">
          {(["results", "report"] as const).map((k) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{t(`tab_${k}`)}</button>)}
        </div>
        {tab === "results" && <div className="results">
          {summary}
          <div className="panel view-panel">
            <div className="view-bar">
              <div className="seg" role="group">{(["3d", "xz", "yz", "xy"] as const).map((v) => <button key={v} id={`view-${v}`} className={s.view === v ? "on" : ""} onClick={() => set({ view: v })}>{t(`view_${v}`)}</button>)}</div>
              <select id="show" value={s.show} onChange={(e) => set({ show: e.target.value as ShowMode })}>{(["util", "My", "Mz", "N", "def", "none"] as const).map((x) => <option key={x} value={x}>{t(`show_${x}`)}</option>)}</select>
              {r && <select id="combo" value={ci} onChange={(e) => set({ combo: Number(e.target.value) })}>{ulsCombos.map((c, k) => <option key={c.name} value={k}>{t("nl_combo")} {c.name}{k === govIdx ? " ★" : ""}</option>)}</select>}
              {r?.seismic && r.seismic.modes.length > 0 && <select id="mode" value={s.mode ?? -1} onChange={(e) => set({ mode: Number(e.target.value) })}>
                <option value={-1}>{t("seis_noMode")}</option>
                {r.seismic.modes.map((m, k) => <option key={k} value={k}>{t("seis_mode")} {k + 1} · T = {m.T.toFixed(3)} s</option>)}</select>}
              <label className="chk"><input type="checkbox" checked={s.ids} onChange={(e) => set({ ids: e.target.checked })} />{t("asm_ids")}</label>
            </div>
            {viewEl(true)}
            <p className="hint">{t(s.view === "3d" ? "asm_viewHint3d" : "asm_viewHint2d")}</p>
          </div>
          {err && <p className="error">{err}</p>}
          {detail}
          {r && <>
            <div className="panel"><h3>{t("asm_members")}</h3>{memberTable}</div>
            {connTable && <div className="panel"><h3>{t("asm_joints")}</h3>{connTable}<p className="hint">{t("asm_jointsHint")}</p></div>}
            {plateTable && <div className="panel"><h3>{t("asm_plates")}</h3>{plateTable}<p className="hint">{t("asm_plateRes")}</p></div>}
            {supTable && <div className="panel"><h3>{t("asm_bases")}</h3>{supTable}</div>}
            {seisRes}
          </>}
        </div>}
        {tab === "report" && r && (
          <div className="report-wrap">
            <div className="report-tools">
              <input id="aobj" placeholder={t("objPlaceholder")} value={s.obj} onChange={(e) => set({ obj: e.target.value })} />
              <input id="aelem" placeholder={t("connPlaceholder")} value={s.elem} onChange={(e) => set({ elem: e.target.value })} />
              <button className="primary" onClick={() => window.print()}>{t("print")}</button>
            </div>
            <article className="report">
              <header className="rep-head">
                <h1>{t("asm_repTitle")}</h1>
                <dl>
                  <div><dt>{t("rep_object")}</dt><dd>{s.obj || "—"}</dd></div>
                  <div><dt>{t("rep_element")}</dt><dd>{s.elem || "—"}</dd></div>
                  <div><dt>{t("rep_code")}</dt><dd>{code === "DBN" ? "ДБН В.1.2-2:2006; ДБН В.2.6-198:2014; EN 1992-4; EN 1993-1-3, 1-8" : "EN 1990; EN 1993-1-1, 1-3, 1-8; EN 1992-4"}</dd></div>
                  <div><dt>{t("rep_date")}</dt><dd>{new Date().toLocaleDateString()}</dd></div>
                </dl>
              </header>
              <h2>{t("rep_summary")}</h2>
              {summary}
              <div className="rep-scheme">{viewEl(false)}</div>
              <h2>{t("asm_method")}</h2>
              <p>{t("asm_methodText")}</p>
              <h2>{t("asm_loads")}</h2>
              <ol>{r.combos.map((c) => <li key={c.name}><b>{c.name}</b> {c.kind === "SLS" ? `(${t("asm_sls")}) ` : c.kind === "SEIS" ? `(${t("seis_comb")}) ` : ""}{c.text}</li>)}</ol>
              <h2>{t("asm_members")}</h2>{memberTable}
              {connTable && <><h2>{t("asm_joints")}</h2>{connTable}</>}
              {plateTable && <><h2>{t("asm_plates")}</h2>{plateTable}</>}
              {supTable && <><h2>{t("asm_bases")}</h2>{supTable}</>}
              {sr && <><h2>{t("seis_title")}</h2><p>{t(code === "DBN" ? "seis_methodDBN" : "seis_methodEN")}</p>{seisRes}</>}
              <h2>{t("rep_checks")}</h2>
              {r.members.map((m) => <div key={m.member}><h3>{t("asm_member")} {m.member} · {m.section}</h3><CheckList checks={m.checks.map((c) => ({ ...c, clause: `${c.clause} · ${t("nl_combo")} ${c.combo}` }))} t={t} /></div>)}
              {r.conns.map((c) => <div key={`${c.member}${c.end}`}><h3>{t("asm_joint")} {c.member} · {c.end}</h3><CheckList checks={c.checks.map((x) => ({ ...x, clause: `${x.clause} · ${t("nl_combo")} ${x.combo}` }))} t={t} /></div>)}
              {r.plates.map((x) => <div key={x.panel}><h3>{t("asm_panel")} {x.panel} · t = {x.t} mm</h3><CheckList checks={x.checks.map((c) => ({ ...c, clause: `${c.clause} · ${t("nl_combo")} ${c.combo}` }))} t={t} /></div>)}
              {r.supports.filter((x) => x.result).map((x) => <div key={x.node}><h3>{t("asm_base")} {x.node}</h3><CheckList checks={x.result!.envelope.map((c) => ({ ...c, clause: `${c.clause} · ${t("nl_combo")} ${c.combo}` }))} t={t} /></div>)}
              <p className="disclaimer">{t("disclaimer")}</p>
            </article>
          </div>
        )}
        <p className="disclaimer">{t("disclaimer")}</p>
      </section>
    </main>
  );
}

function errText(e: string, t: T) {
  const m = e.match(/mechanism:([^:]+):(\w+)/);
  if (m) return t("asm_err_mech").replace("{n}", m[1]).replace("{d}", m[2]);
  const z = e.match(/zero-length:(.+)/);
  if (z) return t("asm_err_zero").replace("{m}", z[1]);
  const sc = e.match(/section:([^:]+):/);
  if (sc) return t("asm_err_section").replace("{m}", sc[1]);
  return e;
}

export const ASM_ICONS: Record<string, JSX.Element> = {
  platform: <><path d="M4 18l12-8h28l-12 8z" strokeWidth="2" /><path d="M10 14l12 0M16 10l-12 8" strokeWidth="0.8" /><path d="M8 18v24M30 18v24M40 12v22" strokeWidth="2.5" /><path d="M14 16h22M18 13h22" strokeWidth="0.8" /></>,
  canopy: <><path d="M6 16l18-6 18 6" strokeWidth="2.5" /><path d="M10 16v26M38 16v26" strokeWidth="3" /><path d="M4 42h8M34 42h8" /></>,
  truss: <><path d="M4 34h40M4 18h40M4 18v16M44 18v16M4 18l10 16 10-16 10 16 10-16M14 18v16M24 18v16M34 18v16" strokeWidth="1.8" /></>,
  portal: <><path d="M8 42V12h32v30" strokeWidth="3" /><path d="M5 42h6M37 42h6" /><path d="M8 18l6-6M40 18l-6-6" strokeWidth="1.5" /></>,
  bracket: <><path d="M8 4v40" strokeDasharray="2 3" /><path d="M10 14h30" strokeWidth="3" /><path d="M10 34l30-20" strokeWidth="2.5" /><path d="M40 16v10" className="arr" /></>,
  empty: <><circle cx="12" cy="36" r="3" /><circle cx="36" cy="12" r="3" /><path d="M14 34l20-20" strokeDasharray="3 3" /><path d="M36 30v12M30 36h12" strokeWidth="2.5" /></>,
};

void findSection;
