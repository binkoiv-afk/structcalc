// Вільний вузол: свої деталі (пластини, профілі) і свої зв'язки між ними (шви, групи болтів), сила в будь-якій точці.
// Програма розподіляє зусилля по зв'язках (деталі — жорсткі тіла, зв'язки — пружні групи) і перевіряє кожен зв'язок.
import { useMemo, useState } from "react";
import {
  BOLT_CLASSES, BOLT_DIAMETERS, checkFree, CodeId, familiesFor, familySections, findSection, FConn, FPart, FreeResult, jointSpec, JExtra, Section, STEELS,
} from "@structcalc/core";
import { CheckList, pct, T, utilState } from "./Results";
import { FamilyOptions } from "./SectionModule";
import { JointViews } from "./JointModule";

type Ax = "x" | "y" | "z";
export interface FPartUI { id: string; name: string; kind: "plate" | "profile"; axis: Ax; a: number; b: number; t: number; cx: number; cy: number; cz: number; fam?: string; size?: string; rot?: boolean; steel: string; role: FPart["role"] }
export interface FConnUI {
  id: string; name: string; a: string; b: string; kind: "weld" | "bolts"; n: Ax; ox: number; oy: number; oz: number;
  /** шви: заготовка (два паралельні, контур, один, свої відрізки), довжина L уздовж v, розмах s уздовж u */
  shape: "two" | "rect" | "one" | "custom"; L: number; s: number; kf: number; segs: { u1: number; v1: number; u2: number; v2: number }[];
  rows: number; cols: number; pu: number; pv: number; d: number; cls: string; planes: number; friction: boolean;
}
export interface FCombo { name: string; Fx?: number; Fy?: number; Fz?: number; Mx?: number; My?: number; Mz?: number }
export interface FreeState { parts: FPartUI[]; conns: FConnUI[]; ax: number; ay: number; az: number; combos: FCombo[]; sel: string; gammaC: number; gammaN: number; obj?: string; elem?: string }

const UVN: Record<Ax, [Ax, Ax]> = { x: ["y", "z"], y: ["z", "x"], z: ["x", "y"] };

export function freeInit(code: CodeId): FreeState {
  const st = code === "DBN" ? "C245" : "S235";
  const cl = code === "DBN" ? "5.6" : "8.8";
  const w = (o: Partial<FConnUI>): FConnUI => ({ id: "", name: "", a: "", b: "", kind: "weld", n: "x", ox: 0, oy: 0, oz: 0, shape: "two", L: 200, s: 12, kf: 6, segs: [],
    rows: 2, cols: 2, pu: 70, pv: 80, d: 16, cls: cl, planes: 1, friction: false, ...o });
  return {
    parts: [
      { id: "P1", name: "", kind: "plate", axis: "x", a: 300, b: 400, t: 20, cx: -10, cy: 0, cz: 0, steel: st, role: "support" },
      { id: "P2", name: "", kind: "plate", axis: "y", a: 200, b: 200, t: 12, cx: 100, cy: 0, cz: 0, steel: st, role: "free" },
      { id: "P3", name: "", kind: "plate", axis: "y", a: 300, b: 150, t: 10, cx: 300, cy: 11, cz: 0, steel: st, role: "load" },
    ],
    conns: [
      w({ id: "C1", a: "P1", b: "P2", kind: "weld", n: "x", shape: "two", L: 200, s: 12, kf: 6 }),
      w({ id: "C2", a: "P2", b: "P3", kind: "bolts", n: "y", ox: 160, oy: 6, oz: 0, rows: 2, cols: 2, pu: 70, pv: 80, d: 16 }),
    ],
    ax: 420, ay: 11, az: 0, combos: [{ name: "1", Fz: -8 }, { name: "2", Fz: -5, Fy: 1.5 }], sel: "P3", gammaC: 1, gammaN: 1,
  };
}

function segsOf(c: FConnUI) {
  const h = c.L / 2, s = c.s / 2;
  if (c.shape === "two") return [{ u1: -s, v1: -h, u2: -s, v2: h }, { u1: s, v1: -h, u2: s, v2: h }];
  if (c.shape === "one") return [{ u1: 0, v1: -h, u2: 0, v2: h }];
  if (c.shape === "rect") return [{ u1: -s, v1: -h, u2: s, v2: -h }, { u1: s, v1: -h, u2: s, v2: h }, { u1: s, v1: h, u2: -s, v2: h }, { u1: -s, v1: h, u2: -s, v2: -h }];
  return c.segs;
}

const num = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(",", ".")));
function Num({ id, label, v, on, step }: { id: string; label: string; v: number; on: (n: number) => void; step?: number }) {
  return <label><span className="lbl">{label}</span><input id={id} type="number" step={step ?? 1} value={v} onChange={(e) => on(num(e.target.value))} /></label>;
}
const DETAIL = new Set(["weldKfMin", "weldKfMax", "weldAmin", "weldLmin", "weldLflank", "weldLong"]);
function gov<C extends { key: string; util: number }>(cs: C[]): C | undefined {
  const pick = (l: C[]) => l.reduce<C | undefined>((a, b) => (!a || !(b.util <= a.util) ? b : a), undefined);
  const bad = cs.filter((c) => DETAIL.has(c.key) && !(c.util <= 1));
  return bad.length ? pick(bad) : pick(cs.filter((c) => !DETAIL.has(c.key))) ?? pick(cs);
}
const F_KEYS = ["Fx", "Fy", "Fz", "Mx", "My", "Mz"] as const;

export function FreeJointModule({ code, s, set, t, back }: { code: CodeId; s: FreeState; set: (p: Partial<FreeState>) => void; t: T; back: () => void }) {
  const [tab, setTab] = useState<"results" | "report">("results");
  const steels = STEELS.filter((x) => x.code === code);
  const okSteel = (id: string) => (steels.some((x) => x.id === id) ? id : steels[0].id);
  const secOf = (fam?: string, size?: string): Section => {
    const l = (() => { try { return familySections(fam ?? "RHS_COLD"); } catch { return []; } })();
    return l.find((x) => x.name === size) ?? l[Math.floor(l.length / 3)] ?? findSection("RHS_COLD", "100×100×5")!;
  };
  const parts: FPart[] = s.parts.map((p) => ({ id: p.id, kind: p.kind, axis: p.axis, a: p.a, b: p.b, t: p.t, c: [p.cx, p.cy, p.cz], rot: p.rot, sec: p.kind === "profile" ? secOf(p.fam, p.size) : undefined, steel: okSteel(p.steel), role: p.role }));
  const conns: FConn[] = s.conns.map((c) => ({ id: c.id, a: c.a, b: c.b, kind: c.kind, n: c.n, o: [c.ox, c.oy, c.oz], segs: segsOf(c), kf: c.kf,
    rows: c.rows, cols: c.cols, pu: c.pu, pv: c.pv, d: c.d, cls: c.cls, planes: c.planes, friction: c.friction }));
  const calc = useMemo((): { r?: FreeResult; err?: string } => {
    try {
      return { r: checkFree({ code, parts, conns, at: [s.ax, s.ay, s.az], gammaC: s.gammaC, gammaN: s.gammaN,
        combos: s.combos.map((c) => ({ name: c.name, Fx: (c.Fx ?? 0) * 1e3, Fy: (c.Fy ?? 0) * 1e3, Fz: (c.Fz ?? 0) * 1e3, Mx: (c.Mx ?? 0) * 1e6, My: (c.My ?? 0) * 1e6, Mz: (c.Mz ?? 0) * 1e6 })) }) };
    } catch (e) { return { err: String((e as Error).message) }; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, s]);
  const r = calc.r;
  const nameOf = (id: string) => { const p = s.parts.find((x) => x.id === id) ?? s.conns.find((x) => x.id === id); return p?.name || id; };
  const errText = (e: string) => e.startsWith("steelThk:") ? t("err_steelThk").replace("{s}", e.split(":")[1]).replace("{t}", e.split(":")[2]) : e.startsWith("free:") ? t(`fj_err_${e.slice(5)}`) : e;

  const steelSel = (id: string, v: string, on: (v: string) => void) => (
    <label><span className="lbl">{t("material")}</span><select id={id} value={okSteel(v)} onChange={(e) => on(e.target.value)}>{steels.map((x) => <option key={x.id}>{x.id}</option>)}</select></label>
  );
  const upPart = (k: number, q: Partial<FPartUI>) => set({ parts: s.parts.map((x, j) => (j === k ? { ...x, ...q } : x)) });
  const upConn = (k: number, q: Partial<FConnUI>) => set({ conns: s.conns.map((x, j) => (j === k ? { ...x, ...q } : x)) });
  const nextId = (pre: string, ids: string[]) => { let n = 1; while (ids.includes(`${pre}${n}`)) n++; return `${pre}${n}`; };
  const addPart = (kind: "plate" | "profile") => {
    const id = nextId("P", s.parts.map((x) => x.id)), last = s.parts[s.parts.length - 1];
    set({ parts: [...s.parts, { id, name: "", kind, axis: kind === "plate" ? "y" : "x", a: kind === "plate" ? 200 : 300, b: 150, t: 10, cx: (last?.cx ?? 0) + 150, cy: 0, cz: 0, steel: okSteel(last?.steel ?? ""), role: "free", fam: "RHS_COLD", size: "100×100×5" }], sel: id });
  };
  const addConn = (kind: "weld" | "bolts") => {
    const id = nextId("C", s.conns.map((x) => x.id)), a = s.parts[s.parts.length - 2]?.id ?? "", b = s.parts[s.parts.length - 1]?.id ?? "";
    set({ conns: [...s.conns, { id, name: "", a, b, kind, n: kind === "weld" ? "x" : "y", ox: 0, oy: 0, oz: 0, shape: "two", L: 150, s: 10, kf: 6, segs: [{ u1: 0, v1: -50, u2: 0, v2: 50 }],
      rows: 2, cols: 1, pu: 60, pv: 70, d: 16, cls: code === "DBN" ? "5.6" : "8.8", planes: 1, friction: false }], sel: id });
  };
  const partOpts = s.parts.map((p) => <option key={p.id} value={p.id}>{p.name || p.id}</option>);
  const util = (id: string) => (r ? r.connUtil[id] : undefined);

  type Card = { id: string; group: "part" | "joint"; title: string; sum: string; body: JSX.Element };
  const cards: Card[] = [];
  s.parts.forEach((p, k) => {
    const [u, v] = p.axis === "x" ? ["y", "z"] : p.axis === "y" ? ["x", "z"] : ["x", "y"];
    const sec = p.kind === "profile" ? secOf(p.fam, p.size) : undefined;
    cards.push({ id: p.id, group: "part", title: `${p.name || p.id} · ${t(`fj_role_${p.role}`)}`, sum: p.kind === "plate" ? `${p.a}×${p.b}×${p.t} · ⊥${p.axis}` : `${sec?.name} · L ${p.a} · ∥${p.axis}`, body: <div className="grid2">
      <label><span className="lbl">{t("jx_name")}</span><input id={`${p.id}-name`} value={p.name} placeholder={p.id} onChange={(e) => upPart(k, { name: e.target.value })} /></label>
      <label><span className="lbl">{t("fj_role")}</span><select id={`${p.id}-role`} value={p.role} onChange={(e) => {
        const role = e.target.value as FPart["role"];
        // навантажена деталь одна
        set({ parts: s.parts.map((x, j) => (j === k ? { ...x, role } : role === "load" && x.role === "load" ? { ...x, role: "free" } : x)) });
      }}>{(["free", "load", "support"] as const).map((x) => <option key={x} value={x}>{t(`fj_role_${x}`)}</option>)}</select></label>
      <label><span className="lbl">{t("fj_kind")}</span><select id={`${p.id}-kind`} value={p.kind} onChange={(e) => upPart(k, { kind: e.target.value as FPartUI["kind"] })}><option value="plate">{t("jx_plate")}</option><option value="profile">{t("jx_profile")}</option></select></label>
      <label><span className="lbl">{t(p.kind === "plate" ? "jx_normal" : "jx_axis")}</span><select id={`${p.id}-ax`} value={p.axis} onChange={(e) => upPart(k, { axis: e.target.value as Ax })}>
        {(["x", "y", "z"] as const).map((a) => <option key={a} value={a}>{t(`jx_${p.kind === "plate" ? "n" : "a"}_${a}`)}</option>)}</select></label>
      {p.kind === "plate" ? <>
        <Num id={`${p.id}-a`} label={`${t("jx_size")} ${u}, mm`} v={p.a} step={10} on={(n) => upPart(k, { a: Math.max(1, n) })} />
        <Num id={`${p.id}-b`} label={`${t("jx_size")} ${v}, mm`} v={p.b} step={10} on={(n) => upPart(k, { b: Math.max(1, n) })} />
        <Num id={`${p.id}-t`} label={t("jp_tp")} v={p.t} on={(n) => upPart(k, { t: Math.max(1, n) })} />
      </> : <>
        <label><span className="lbl">{t("family")}</span><select id={`${p.id}-fam`} value={p.fam ?? "RHS_COLD"} onChange={(e) => { const l = familySections(e.target.value); upPart(k, { fam: e.target.value, size: l[Math.floor(l.length / 3)]?.name }); }}><FamilyOptions fams={familiesFor("column")} t={t} /></select></label>
        <label><span className="lbl">{t("size")}</span><select id={`${p.id}-size`} value={sec?.name} onChange={(e) => upPart(k, { size: e.target.value })}>{familySections(p.fam ?? "RHS_COLD").map((x) => <option key={x.name}>{x.name}</option>)}</select></label>
        <Num id={`${p.id}-a`} label={t("jx_len")} v={p.a} step={10} on={(n) => upPart(k, { a: Math.max(1, n) })} />
        <label className="chk"><input id={`${p.id}-rot`} type="checkbox" checked={!!p.rot} onChange={(e) => upPart(k, { rot: e.target.checked })} />{t("jx_rot")}</label>
      </>}
      {steelSel(`${p.id}-st`, p.steel, (x) => upPart(k, { steel: x }))}
      <Num id={`${p.id}-cx`} label="x, mm" v={p.cx} step={10} on={(n) => upPart(k, { cx: n })} />
      <Num id={`${p.id}-cy`} label="y, mm" v={p.cy} step={5} on={(n) => upPart(k, { cy: n })} />
      <Num id={`${p.id}-cz`} label="z, mm" v={p.cz} step={10} on={(n) => upPart(k, { cz: n })} />
      <p className="hint wide">{t("fj_partHint")}</p>
      {s.parts.length > 2 && <button className="ghost danger wide" id={`${p.id}-del`} onClick={() => set({ parts: s.parts.filter((_, j) => j !== k), conns: s.conns.filter((c) => c.a !== p.id && c.b !== p.id), sel: "" })}>{t("np_remove")}</button>}
    </div> });
  });
  s.conns.forEach((c, k) => {
    const [u, v] = UVN[c.n];
    const sum = c.kind === "weld" ? `${t("fj_weld")} k_f ${c.kf} · ${t(`fj_shape_${c.shape}`)}` : `${c.rows * c.cols} × M${c.d} ${c.cls}`;
    cards.push({ id: c.id, group: "joint", title: `${c.name || c.id}: ${nameOf(c.a)} — ${nameOf(c.b)}`, sum, body: <div className="grid2">
      <label><span className="lbl">{t("jx_name")}</span><input id={`${c.id}-name`} value={c.name} placeholder={c.id} onChange={(e) => upConn(k, { name: e.target.value })} /></label>
      <label><span className="lbl">{t("fj_type")}</span><select id={`${c.id}-kind`} value={c.kind} onChange={(e) => upConn(k, { kind: e.target.value as FConnUI["kind"] })}><option value="weld">{t("fj_weld")}</option><option value="bolts">{t("fj_bolts")}</option></select></label>
      <label><span className="lbl">{t("fj_from")}</span><select id={`${c.id}-a`} value={c.a} onChange={(e) => upConn(k, { a: e.target.value })}>{partOpts}</select></label>
      <label><span className="lbl">{t("fj_to")}</span><select id={`${c.id}-b`} value={c.b} onChange={(e) => upConn(k, { b: e.target.value })}>{partOpts}</select></label>
      <label className="wide"><span className="lbl">{t("fj_plane")}</span><select id={`${c.id}-n`} value={c.n} onChange={(e) => upConn(k, { n: e.target.value as Ax })}>{(["x", "y", "z"] as const).map((a) => <option key={a} value={a}>{t(`fj_plane_${a}`)}</option>)}</select></label>
      <Num id={`${c.id}-ox`} label="x₀, mm" v={c.ox} step={5} on={(n) => upConn(k, { ox: n })} />
      <Num id={`${c.id}-oy`} label="y₀, mm" v={c.oy} step={5} on={(n) => upConn(k, { oy: n })} />
      <Num id={`${c.id}-oz`} label="z₀, mm" v={c.oz} step={5} on={(n) => upConn(k, { oz: n })} />
      {c.kind === "weld" ? <>
        <label><span className="lbl">{t("fj_shape")}</span><select id={`${c.id}-shape`} value={c.shape} onChange={(e) => upConn(k, { shape: e.target.value as FConnUI["shape"], segs: c.segs.length ? c.segs : segsOf(c) })}>{(["two", "rect", "one", "custom"] as const).map((x) => <option key={x} value={x}>{t(`fj_shape_${x}`)}</option>)}</select></label>
        <Num id={`${c.id}-kf`} label={t("w_kf")} v={c.kf} on={(n) => upConn(k, { kf: Math.max(3, n) })} />
        {c.shape !== "custom" ? <>
          <Num id={`${c.id}-L`} label={`L (${v}), mm`} v={c.L} step={10} on={(n) => upConn(k, { L: Math.max(10, n) })} />
          {c.shape !== "one" && <Num id={`${c.id}-s`} label={`${t("fj_span")} (${u}), mm`} v={c.s} step={5} on={(n) => upConn(k, { s: n })} />}
        </> : <div className="wide apts">
          <div className="apts-head seg4"><span>{u}₁</span><span>{v}₁</span><span>{u}₂</span><span>{v}₂</span><span /></div>
          {c.segs.map((g, j) => <div key={j} className="apts-row seg4">
            {(["u1", "v1", "u2", "v2"] as const).map((key) => <input key={key} id={`${c.id}-sg${j}${key}`} type="number" value={g[key]} onChange={(e) => upConn(k, { segs: c.segs.map((x, q) => (q === j ? { ...x, [key]: num(e.target.value) } : x)) })} />)}
            {c.segs.length > 1 ? <button className="ghost xbtn" aria-label="remove" onClick={() => upConn(k, { segs: c.segs.filter((_, q) => q !== j) })}>×</button> : <span />}
          </div>)}
          <button className="ghost" id={`${c.id}-addseg`} onClick={() => upConn(k, { segs: [...c.segs, { u1: 0, v1: 0, u2: 0, v2: 100 }] })}>+ {t("fj_seg")}</button>
        </div>}
      </> : <>
        <label><span className="lbl">{t("bo_d")}</span><select id={`${c.id}-d`} value={c.d} onChange={(e) => upConn(k, { d: Number(e.target.value) })}>{BOLT_DIAMETERS.map((x) => <option key={x} value={x}>M{x}</option>)}</select></label>
        <label><span className="lbl">{t("bo_class")}</span><select id={`${c.id}-cls`} value={c.cls} onChange={(e) => upConn(k, { cls: e.target.value })}>{Object.keys(BOLT_CLASSES).map((x) => <option key={x}>{x}</option>)}</select></label>
        <Num id={`${c.id}-rows`} label={`${t("fj_rows")} (${v})`} v={c.rows} on={(n) => upConn(k, { rows: Math.max(1, Math.round(n)) })} />
        <Num id={`${c.id}-cols`} label={`${t("fj_cols")} (${u})`} v={c.cols} on={(n) => upConn(k, { cols: Math.max(1, Math.round(n)) })} />
        <Num id={`${c.id}-pv`} label={`${t("fj_pitch")} ${v}, mm`} v={c.pv} step={5} on={(n) => upConn(k, { pv: n })} />
        <Num id={`${c.id}-pu`} label={`${t("fj_pitch")} ${u}, mm`} v={c.pu} step={5} on={(n) => upConn(k, { pu: n })} />
        <Num id={`${c.id}-planes`} label={t("bo_planes")} v={c.planes} on={(n) => upConn(k, { planes: Math.max(1, Math.round(n)) })} />
        <label className="chk"><input id={`${c.id}-fr`} type="checkbox" checked={c.friction} onChange={(e) => upConn(k, { friction: e.target.checked })} />{t("jp_friction")}</label>
      </>}
      <p className="hint wide">{t("fj_connHint")}</p>
      <button className="ghost danger wide" id={`${c.id}-del`} onClick={() => set({ conns: s.conns.filter((_, j) => j !== k), sel: "" })}>{t("np_remove")}</button>
    </div> });
  });

  const open = (id: string) => set({ sel: s.sel === id ? "" : id });
  const card = (x: Card) => {
    const u = x.group === "joint" ? util(x.id) : undefined;
    return (
      <div key={x.id} className={`part ${s.sel === x.id ? "open" : ""}`}>
        <button className="part-head" id={`part-${x.id}`} onClick={() => open(x.id)}>
          <span className={`part-dot ${x.group}`} /><span className="part-title">{x.title}</span>
          <span className="part-sum">{x.sum}{u !== undefined && <b className={`jutil ${utilState(u)}`}>{pct(u)}</b>}</span>
        </button>
        {s.sel === x.id && <div className="part-body">{x.body}</div>}
      </div>
    );
  };

  const setCombo = (k: number, q: Partial<FCombo>) => set({ combos: s.combos.map((c, j) => (j === k ? { ...c, ...q } : c)) });
  const loads = (
    <div className="combo-table">
      <div className="grid3">
        <Num id="fj-ax" label="x, mm" v={s.ax} step={10} on={(n) => set({ ax: n })} />
        <Num id="fj-ay" label="y, mm" v={s.ay} step={5} on={(n) => set({ ay: n })} />
        <Num id="fj-az" label="z, mm" v={s.az} step={10} on={(n) => set({ az: n })} />
      </div>
      <p className="hint">{t("fj_atHint")}</p>
      <table>
        <thead><tr><th>№</th>{F_KEYS.map((c) => <th key={c}>{t(`fj_${c}`)}</th>)}<th /></tr></thead>
        <tbody>{s.combos.map((c, k) => (
          <tr key={k}>
            <td><input id={`fcn${k}`} className="cname" value={c.name} onChange={(e) => setCombo(k, { name: e.target.value })} /></td>
            {F_KEYS.map((col) => <td key={col}><input id={`fc${col}${k}`} type="number" value={c[col] ?? ""} placeholder="0" onChange={(e) => setCombo(k, { [col]: e.target.value === "" ? undefined : num(e.target.value) })} /></td>)}
            <td>{s.combos.length > 1 && <button className="ghost xbtn" aria-label="remove" onClick={() => set({ combos: s.combos.filter((_, j) => j !== k) })}>×</button>}</td>
          </tr>))}
        </tbody>
      </table>
      <button id="faddcombo" className="ghost" onClick={() => set({ combos: [...s.combos, { name: String(s.combos.length + 1) }] })}>+ {t("nl_add")}</button>
    </div>
  );

  // ---- результати
  const g = r ? gov(r.envelope) : undefined;
  const maxU = g?.util ?? 0, st = r ? utilState(maxU) : "ok";
  const tf: T = (k) => t(k);
  const summary = r && (
    <div className={`summary ${st}`}>
      <div className="summary-main"><div className="eyebrow">{t("nd_node")}</div><div className="profile">{t("nt_free")}</div><div className="meta">{s.parts.length} {t("fj_nParts")} · {s.conns.length} {t("fj_nConns")}</div></div>
      <div className="summary-util"><div className="eyebrow">{t("rep_maxutil")}</div><div className="big">{pct(maxU)}</div><div className={`pill ${st}`}>{maxU <= 1 + 1e-9 ? t("ok") : t("fail")}</div></div>
      {g && <div className="summary-gov"><div className="eyebrow">{t("governing")}</div><div>{nameOf(g.conn)} · {t(`chk_${g.key}`)}</div><div className="meta">{t("nl_combo")} {g.combo}</div></div>}
    </div>
  );
  const forcesTable = r && (
    <table className="conn-values combo-res"><thead><tr><th>{t("fj_conn")}</th><th>{t("nl_combo")}</th><th>N</th><th>V_u</th><th>V_v</th><th>M_n</th><th>M_u</th><th>M_v</th></tr></thead>
      <tbody>{s.conns.flatMap((c) => r.combos.map((cb) => {
        const fr = cb.forces.find((x) => x.conn === c.id);
        if (!fr) return null;
        return <tr key={`${c.id}${cb.name}`}><td>{c.name || c.id}</td><td>{cb.name}</td>{[fr.N, fr.Vu, fr.Vv].map((v, j) => <td key={j} className="mono">{(v / 1e3).toFixed(2)}</td>)}{[fr.Mn, fr.Mu, fr.Mv].map((v, j) => <td key={`m${j}`} className="mono">{(v / 1e6).toFixed(2)}</td>)}</tr>;
      }))}</tbody></table>
  );
  // поради по зв'язках, що не проходять
  const advice: { id: string; text: string; fix?: () => void }[] = [];
  for (const [id, u] of Object.entries(r?.connUtil ?? {})) {
    if (u <= 1 + 1e-9) continue;
    const k = s.conns.findIndex((c) => c.id === id), c = s.conns[k];
    if (!c) continue;
    const bad = r!.envelope.filter((e) => e.conn === id && e.util > 1);
    if (c.kind === "weld") {
      const kmax = bad.some((e) => e.key === "weldKfMax");
      advice.push({ id, text: `${c.name || c.id} — ${t(kmax ? "adv_weldKfMax" : "fj_adv_weld")}`, fix: kmax ? () => upConn(k, { kf: c.kf - 1 }) : () => upConn(k, { kf: c.kf + 1 }) });
    } else {
      const punch = bad.some((e) => e.key === "jPunchPlate"), nextD = BOLT_DIAMETERS.find((d) => d > c.d);
      advice.push({ id, text: `${c.name || c.id} — ${t(punch ? "fj_adv_punch" : "fj_adv_bolts")}`, fix: punch ? undefined : nextD ? () => upConn(k, { d: nextD }) : () => upConn(k, { rows: c.rows + 1 }) });
    }
  }
  const adviceList = advice.length > 0 && (
    <ul className="compat advice">{advice.map((x) => <li key={x.id} className="bad"><span className="cmp-ic">→</span><span>{x.text}</span>
      {x.fix && <button className="ghost adv-fix" id={`ffix-${x.id}`} onClick={x.fix}>{t("adv_apply")}</button>}</li>)}</ul>
  );
  const extras: JExtra[] = parts.filter((p) => p.kind === "profile").map((p) => ({ ...p }));
  const spec = r ? jointSpec(r.parts, extras) : [];
  const specTable = r && (
    <table className="conn-values"><thead><tr><th>{t("jx_part")}</th><th>{t("jx_dims")}</th><th>{t("jx_n")}</th><th>{t("jx_mass")}</th></tr></thead>
      <tbody>{spec.map((x, k) => <tr key={k}><td>{nameOf(x.id)}</td><td className="mono">{x.size}</td><td className="mono">{x.n}</td><td className="mono">{x.mass > 0 ? x.mass.toFixed(1) : "—"}</td></tr>)}
        <tr><td><b>{t("jx_total")}</b></td><td /><td /><td className="mono"><b>{spec.reduce((a, x) => a + x.mass, 0).toFixed(1)}</b></td></tr></tbody></table>
  );
  const envelopeList = r && <CheckList checks={r.envelope.map((c) => ({ ...c, clause: `${c.clause.replace(` · ${c.conn}`, "")} · ${nameOf(c.conn)} · ${t("nl_combo")} ${c.combo}` }))} t={tf} />;
  const utilOf = (id: string) => r?.connUtil[id];

  return (
    <main className="layout node">
      <aside className="inputs">
        <button className="ghost kind-back" onClick={back}>← {t("nd_change")}</button>
        <fieldset><legend><span className="step">1</span>{t("nd_parts")}</legend>
          <div className="parts">{cards.filter((c) => c.group === "part").map(card)}</div>
          <div className="add-row">
            <button id="fadd-plate" className="ghost add-part" onClick={() => addPart("plate")}>+ {t("jx_add_plate")}</button>
            <button id="fadd-profile" className="ghost add-part" onClick={() => addPart("profile")}>+ {t("jx_add_profile")}</button>
          </div>
        </fieldset>
        <fieldset><legend><span className="step">2</span>{t("fj_conns")}</legend>
          <div className="parts">{cards.filter((c) => c.group === "joint").map(card)}</div>
          <div className="add-row">
            <button id="fadd-weld" className="ghost add-part" onClick={() => addConn("weld")}>+ {t("fj_weld")}</button>
            <button id="fadd-bolts" className="ghost add-part" onClick={() => addConn("bolts")}>+ {t("fj_bolts")}</button>
          </div>
        </fieldset>
        <fieldset><legend><span className="step">3</span>{t("fj_loads")}</legend>{loads}</fieldset>
        {code === "DBN" && (
          <details className="adv"><summary>{t("advanced")}<span className="adv-hint">γc, γn</span></summary>
            <div className="adv-group"><div className="grid2">
              <Num id="fgc" label={t("gammaC")} v={s.gammaC} step={0.05} on={(v) => set({ gammaC: v })} />
              <Num id="fgn" label={t("gammaN")} v={s.gammaN} step={0.05} on={(v) => set({ gammaN: v })} />
            </div></div></details>
        )}
      </aside>
      <section className="output">
        <div className="tabs" role="tablist">
          {(["results", "report"] as const).map((k) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{t(`tab_${k}`)}</button>)}
        </div>
        {calc.err && <p className="error">{errText(calc.err)}</p>}
        {r && tab === "results" && (
          <div className="results">
            {summary}
            <div className="panel"><h3>{t("scheme")}</h3>
              <JointViews r={{ ...r, combos: [], values: [] } as never} sel={s.sel} onPick={(id) => set({ sel: id })} utilOf={utilOf} t={t} />
              <p className="hint">{t("fj_viewHint")}</p>
            </div>
            {r.notes.length > 0 && <div className="panel"><ul className="compat">{r.notes.map((n) => <li key={n} className="warn"><span className="cmp-ic">!</span><span>{t("fj_loose").replace("{p}", nameOf(n.split(":")[1]))}</span></li>)}</ul></div>}
            {adviceList && <div className="panel"><h3>{t("adv_title")}</h3>{adviceList}</div>}
            <div className="panel"><h3>{t("fj_forces")}</h3>{forcesTable}<p className="hint">{t("fj_forcesHint")}</p></div>
            <div className="panel"><h3>{t("jx_spec")}</h3>{specTable}</div>
            <div className="panel"><h3>{t("nl_envelope")}</h3>{envelopeList}</div>
          </div>
        )}
        {r && tab === "report" && (
          <div className="report-wrap">
            <div className="report-tools">
              <input id="fobj" placeholder={t("objPlaceholder")} value={s.obj ?? ""} onChange={(e) => set({ obj: e.target.value })} />
              <input id="felem" placeholder={t("connPlaceholder")} value={s.elem ?? ""} onChange={(e) => set({ elem: e.target.value })} />
              <button className="primary" onClick={() => window.print()}>{t("print")}</button>
            </div>
            <article className="report">
              <header className="rep-head">
                <h1>{t("nd_repTitle")}: {t("nt_free").toLowerCase()}</h1>
                <dl>
                  <div><dt>{t("rep_object")}</dt><dd>{s.obj || "—"}</dd></div>
                  <div><dt>{t("rep_element")}</dt><dd>{s.elem || "—"}</dd></div>
                  <div><dt>{t("rep_code")}</dt><dd>{code === "DBN" ? "ДБН В.2.6-198:2014, розд. 16" : "EN 1993-1-8"}</dd></div>
                  <div><dt>{t("rep_date")}</dt><dd>{new Date().toLocaleDateString()}</dd></div>
                </dl>
              </header>
              <h2>{t("rep_summary")}</h2>
              {summary}
              <div className="rep-scheme"><JointViews r={{ ...r, combos: [], values: [] } as never} sel="" onPick={() => undefined} utilOf={() => undefined} t={t} interactive={false} /></div>
              <h2>{t("nd_parts")}</h2>
              <table className="conn-values"><tbody>{cards.map((x) => <tr key={x.id}><td>{x.title}</td><td className="mono">{x.sum}</td></tr>)}</tbody></table>
              <p className="hint">{t("fj_method")}</p>
              <h2>{t("fj_forces")}</h2>{forcesTable}
              <h2>{t("jx_spec")}</h2>{specTable}
              <h2>{t("rep_checks")}</h2>{envelopeList}
              <p className="disclaimer">{t("disclaimer")}</p>
            </article>
          </div>
        )}
        <p className="disclaimer">{t("disclaimer")}</p>
      </section>
    </main>
  );
}
