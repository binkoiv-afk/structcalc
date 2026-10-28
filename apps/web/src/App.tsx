import { useEffect, useRef, useState } from "react";
import { downloadFile, loadSaved, newId, parseFile, SavedCalc, storeSaved } from "./projects";
import { FileMenu } from "./FileMenu";
import { ANNEXES, AnnexId, CodeId, DEFAULT_FACTORS, FAMILIES, setAnnex, setCustomMaterials, setCustomSections, STEELS } from "@structcalc/core";
import { GeneratorModule, GenState, initialGen, initialLib, LibraryModule, LibState } from "./GeneratorModule";
import { Lang, LANGS, makeT } from "./i18n";
import { Home, Screen } from "./Home";
import { BeamModule, BeamState, initialBeam } from "./BeamModule";
import { ColumnModule, ColumnState, initialColumn } from "./ColumnModule";
import { SectionModule, SectionState, initialSection } from "./SectionModule";
import { ConnectionsModule, ConnKind, ConnState, initialConn, pickKind } from "./ConnectionsModule";
import { CollectorState, initialCollector } from "./LoadCollector";
import { initialNode, NodeModule, NodeState } from "./NodeModule";
import { AssemblyModule, AsmState, initialAsm } from "./AssemblyModule";
import { asmTemplate, AsmTemplate } from "@structcalc/core";
import { baseToAsm } from "./asmJoint";
import { initialThermal, ThermalModule, ThermalState } from "./ThermalModule";
import { initialRc, RcModule, RcState } from "./RcModule";
import { initialRcCol, RcColState, RcColumnModule } from "./RcColumnModule";
import { initialSlab, SlabModule, SlabState } from "./SlabModule";
import { FlatSlabModule, FlatState, initialFlat } from "./FlatSlabModule";

interface AppState {
  lang: Lang; code: CodeId; annex?: AnnexId; screen: Screen;
  beam: BeamState; column: ColumnState; lc: CollectorState; sec: SectionState; conn: ConnState; gen: GenState; lib: LibState; node: NodeState; asm: AsmState; thermal: ThermalState; rc: RcState; rcc: RcColState; slab: SlabState; flat: FlatState;
  /** відкритий збережений розрахунок (id у «Моїх розрахунках») для кожного екрана */
  cur?: Partial<Record<Screen, string>>;
}

/** Частини стану, що належать екрану: їх зберігають, відкривають, скидають і відкочують (Ctrl+Z) */
type Slot = "beam" | "column" | "lc" | "sec" | "conn" | "gen" | "lib" | "node" | "asm" | "thermal" | "rc" | "rcc" | "slab" | "flat";
const SLOTS: Record<Screen, Slot[]> = { home: [], beam: ["beam", "lc"], column: ["column"], section: ["sec"], connection: ["conn"], generator: ["gen"], library: ["lib"], node: ["node"], assembly: ["asm"], thermal: ["thermal"], concrete: ["rc"], rccolumn: ["rcc"], slab: ["slab"], flat: ["flat"] };
const SCREENS = Object.keys(SLOTS) as Screen[];
const screenOfHash = () => { const h = location.hash.replace(/^#\/?/, ""); return (SCREENS as string[]).includes(h) ? (h as Screen) : null; };

const KEY = "structcalc.v2";
const initial: AppState = { lang: "uk", code: "DBN", screen: "home", beam: initialBeam, column: initialColumn, lc: initialCollector, sec: initialSection, conn: initialConn, gen: initialGen, lib: initialLib, node: initialNode, asm: initialAsm, thermal: initialThermal, rc: initialRc, rcc: initialRcCol, slab: initialSlab, flat: initialFlat };

function loadState(): AppState {
  const st = loadStored(), h = screenOfHash();
  return h ? { ...st, screen: h } : st;
}

function loadStored(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const o = JSON.parse(raw);
      return {
        ...initial, ...o, screen: o.screen === "loads" ? "home" : o.screen, beam: { ...initialBeam, ...o.beam }, column: { ...initialColumn, ...o.column },
        lc: { ...initialCollector, ...o.lc }, sec: { ...initialSection, ...o.sec }, conn: { ...initialConn, ...o.conn }, gen: { ...initialGen, ...o.gen }, lib: { ...initialLib, ...o.lib }, node: { ...initialNode, ...o.node }, asm: { ...initialAsm, ...o.asm }, thermal: { ...initialThermal, ...o.thermal }, rc: { ...initialRc, ...o.rc }, rcc: { ...initialRcCol, ...o.rcc }, slab: { ...initialSlab, ...o.slab, edges: { ...initialSlab.edges, ...o.slab?.edges } }, flat: { ...initialFlat, ...o.flat },
      };
    }
    const old = localStorage.getItem("structcalc.beam"); // версия 0.1
    if (old) {
      const o = JSON.parse(old);
      return { ...initial, lang: o.lang ?? "uk", code: o.code ?? "DBN", beam: { ...initialBeam, ...o }, lc: { ...initialCollector, ...(o.lc ?? {}) } };
    }
  } catch { /* хранилище недоступно */ }
  return initial;
}

export function App() {
  const [s, setS] = useState<AppState>(loadState);
  // історія змін для Ctrl+Z / Ctrl+Y — окремо для кожного екрана, лише його частини стану
  const hist = useRef<{ past: Partial<Record<Screen, Partial<AppState>[]>>; future: Partial<Record<Screen, Partial<AppState>[]>>; last: number; lastScreen: Screen | null }>({ past: {}, future: {}, last: 0, lastScreen: null });
  const [, bump] = useState(0);
  const pick = (o: AppState, sc: Screen): Partial<AppState> => { const r: Partial<AppState> = { code: o.code, annex: o.annex }; for (const k of SLOTS[sc]) (r as Record<string, unknown>)[k] = o[k]; return r; };
  const persist = (n: AppState) => { try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* ignore */ } };
  const set = (p: Partial<AppState>, opt?: { noHist?: boolean }) => setS((o) => {
    const n = { ...o, ...p };
    const sc = n.screen, h = hist.current;
    if (!opt?.noHist && sc !== "home" && (Object.keys(p) as (keyof AppState)[]).some((k) => k === "code" || (SLOTS[sc] as string[]).includes(k))) {
      const now = Date.now();
      // серія швидких змін (набір числа, перетягування) — один крок
      if (now - h.last > 700 || h.lastScreen !== sc) { (h.past[sc] ??= []).push(pick(o, sc)); if (h.past[sc]!.length > 100) h.past[sc]!.shift(); }
      h.future[sc] = []; h.last = now; h.lastScreen = sc;
    }
    persist(n);
    return n;
  });
  const undoRedo = (dir: -1 | 1) => setS((o) => {
    const h = hist.current, sc = o.screen, from = dir < 0 ? h.past : h.future, to = dir < 0 ? h.future : h.past;
    const snap = from[sc]?.pop();
    if (!snap) return o;
    (to[sc] ??= []).push(pick(o, sc));
    h.last = 0;
    const n = { ...o, ...snap };
    persist(n); bump((x) => x + 1);
    return n;
  });
  const canUndo = !!hist.current.past[s.screen]?.length, canRedo = !!hist.current.future[s.screen]?.length;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      const redo = k === "y" || (k === "z" && e.shiftKey);
      if (k !== "z" && k !== "y") return;
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur?.();
      undoRedo(redo ? 1 : -1);
    };
    // кнопка «Назад» браузера повертає на попередній екран
    const onPop = () => { const h = screenOfHash() ?? "home"; setS((o) => (o.screen === h ? o : { ...o, screen: h })); };
    // вихід з поля закриває крок відкату: наступна зміна — окремий крок
    const onOut = () => { hist.current.last = 0; };
    window.addEventListener("keydown", onKey);
    window.addEventListener("popstate", onPop);
    window.addEventListener("focusout", onOut);
    if (!screenOfHash()) history.replaceState(null, "", `#${s.screen}`);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("popstate", onPop); window.removeEventListener("focusout", onOut); };
  }, []);
  const t = makeT(s.lang);
  const [saved, setSaved] = useState<SavedCalc[]>(loadSaved);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast((x) => (x === m ? null : x)), 2600); };
  const putSaved = (l: SavedCalc[]) => { setSaved(l); if (!storeSaved(l)) flash(t("fm_full")); };
  const curId = s.cur?.[s.screen];
  const curCalc = saved.find((x) => x.id === curId);
  const defName = () => `${t(`mod_${s.screen}`)}${s.screen === "assembly" && s.asm.tmpl ? ` · ${t(`at_${s.asm.tmpl}`)}` : ""} · ${new Date().toLocaleDateString()}`;
  const saveCalc = (name: string, asNew: boolean) => {
    const id = !asNew && curCalc ? curCalc.id : newId();
    const item: SavedCalc = { id, name: name.trim() || defName(), screen: s.screen, code: s.code, date: Date.now(), data: pick(s, s.screen) as Record<string, unknown> };
    putSaved([item, ...saved.filter((x) => x.id !== id)]);
    set({ cur: { ...(s.cur ?? {}), [s.screen]: id } }, { noHist: true });
    flash(t("fm_saved"));
  };
  const openCalc = (c: SavedCalc) => {
    const base = (initial as unknown as Record<string, Record<string, unknown>>);
    const data: Partial<AppState> = {};
    for (const k of SLOTS[c.screen] ?? []) if (c.data[k] && typeof c.data[k] === "object") (data as Record<string, unknown>)[k] = { ...base[k], ...(c.data[k] as object) };
    hist.current.past[c.screen] = []; hist.current.future[c.screen] = [];
    set({ ...data, code: c.code ?? s.code, screen: c.screen, cur: { ...(s.cur ?? {}), [c.screen]: c.id } }, { noHist: true });
    if (location.hash !== `#${c.screen}`) history.pushState(null, "", `#${c.screen}`);
    window.scrollTo(0, 0);
  };
  const resetCalc = () => {
    const d: Partial<AppState> = {};
    for (const k of SLOTS[s.screen]) (d as Record<string, unknown>)[k] = initial[k];
    // «Збірка» без шаблону — порожня схема; модулі зберігають вибраний шаблон
    if (s.screen === "assembly" && s.asm.tmpl) { const a = s.asm.tmpl === "empty" ? null : asmTemplate(s.asm.tmpl, s.code); d.asm = { ...initialAsm, tmpl: s.asm.tmpl, asm: a, loadsOf: a?.cases[0]?.id ?? "" }; }
    if (s.screen === "connection") d.conn = { ...initialConn, ...pickKind(initialConn, s.conn.kind as ConnKind) };
    if (s.screen === "node") d.node = { ...initialNode, tmpl: s.node.tmpl };
    if (s.screen === "library") return;
    set({ ...d, cur: { ...(s.cur ?? {}), [s.screen]: undefined } });
    flash(t("fm_resetDone"));
  };
  const libOf = () => ({ materials: s.lib.materials, sections: s.lib.sections });
  const dl = (items: SavedCalc[]) => { downloadFile(items, libOf()).then((r) => { if (r === "fail") flash(t("fm_dlFail")); }); };
  const importFile = async (f: File) => {
    const pf = parseFile(await f.text());
    if (!pf || !pf.items.length) { flash(t("fm_badFile")); return; }
    if (pf.lib) {
      const key = (x: unknown) => { const o = x as { id?: string; name?: string }; return o?.id ?? o?.name ?? ""; };
      const merge = <X,>(cur: X[], add?: unknown[]) => [...cur, ...((add ?? []) as X[]).filter((m) => key(m) && !cur.some((c) => key(c) === key(m)))];
      const mats = merge(s.lib.materials, pf.lib.materials), secs = merge(s.lib.sections, pf.lib.sections);
      if (mats.length !== s.lib.materials.length || secs.length !== s.lib.sections.length) set({ lib: { materials: mats, sections: secs } }, { noHist: true });
    }
    putSaved([...pf.items, ...saved]);
    if (pf.items.length === 1) openCalc(pf.items[0]);
    else flash(t("fm_imported").replace("{n}", String(pf.items.length)));
  };
  // свої матеріали і перерізи — у каталоги ядра до розрахунку модулів
  // національний додаток EN — до розрахунку модулів
  setAnnex(s.annex ?? "EU");
  setCustomMaterials(s.lib.materials);
  setCustomSections(s.lib.sections);
  // якщо свій матеріал / переріз видалено — повертаємося до типових
  const okSteel = (id: string) => (STEELS.some((x) => x.id === id && x.code === s.code) ? id : s.code === "DBN" ? "C245" : "S235");
  const okFam = (id: string, def: string) => (FAMILIES.some((f) => f.id === id) ? id : def);
  const beam = { ...s.beam, steel: okSteel(s.beam.steel), family: okFam(s.beam.family, "IPE") };
  const column = { ...s.column, steel: okSteel(s.column.steel), family: okFam(s.column.family, "HEB") };
  const sec = { ...s.sec, family: okFam(s.sec.family, "IPE") };
  const nav = (screen: Screen) => { if (location.hash !== `#${screen}`) history.pushState(null, "", `#${screen}`); };
  const go = (screen: Screen, conn?: ConnKind) => {
    set(conn ? { screen, conn: { ...s.conn, ...pickKind(s.conn, conn) }, cur: { ...(s.cur ?? {}), connection: undefined } } : { screen }, { noHist: !conn });
    nav(screen);
    window.scrollTo(0, 0);
  };
  const goAsm = (k: AsmTemplate | null, seismic?: boolean) => {
    const a0 = k ? asmTemplate(k, s.code) : null;
    const a = a0 && seismic ? { ...a0, seismic: { on: true, dirs: { x: true, y: true, z: false }, ...(s.code === "DBN" ? { a0: 0.1, intensity: 7 as const, soil: "II" as const, k1: 0.25, k2: 1 } : {}) } } : a0;
    set({ screen: "assembly", asm: { ...initialAsm, tmpl: k, asm: a, loadsOf: a?.cases[0]?.id ?? "" }, cur: { ...(s.cur ?? {}), assembly: undefined } });
    nav("assembly");
    window.scrollTo(0, 0);
  };
  const setCode = (code: CodeId, an?: AnnexId) => {
    if (an) setAnnex(an);
    const steel = code === "DBN" ? "C245" : "S235";
    const keep = code === s.code; // інша країна тієї ж родини норм — матеріали лишаються
    set({ code, annex: an ?? s.annex, beam: { ...s.beam, ...(keep ? {} : { steel }), ...DEFAULT_FACTORS[code] }, column: keep ? s.column : { ...s.column, steel } });
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <button className="home-btn" onClick={() => go("home")} aria-label={t("home")}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M3 6h18M3 18h18M12 6v12" className="brand-mark" /></svg>
            <span>StructCalc</span>
          </button>
          {s.screen !== "home" && (
            <>
              <span className="crumb-sep">/</span>
              <span className="module">{t(`mod_${s.screen}`)}{s.screen === "connection" && s.conn.kind ? ` · ${t(`conn_${s.conn.kind}`)}` : ""}{s.screen === "node" && s.node.tmpl ? ` · ${t(`nt_${s.node.tmpl}`)}` : ""}{s.screen === "assembly" && s.asm.tmpl ? ` · ${t(`at_${s.asm.tmpl}`)}` : ""}</span>
            </>
          )}
        </div>
        <div className="top-controls">
          {s.screen !== "home" && <button className="ghost back" onClick={() => go("home")}>← {t("allCalcs")}</button>}
          {s.screen !== "home" && <div className="seg undo" role="group">
            <button id="undo" disabled={!canUndo} onClick={() => undoRedo(-1)} title={`${t("fm_undo")} (Ctrl+Z)`} aria-label={t("fm_undo")}>↶</button>
            <button id="redo" disabled={!canRedo} onClick={() => undoRedo(1)} title={`${t("fm_redo")} (Ctrl+Y)`} aria-label={t("fm_redo")}>↷</button>
          </div>}
          {s.screen !== "home" && s.screen !== "library" && <FileMenu t={t} name={curCalc?.name} defName={defName} onSave={saveCalc}
            onDownload={() => dl([{ id: curId ?? newId(), name: curCalc?.name ?? defName(), screen: s.screen, code: s.code, date: Date.now(), data: pick(s, s.screen) as Record<string, unknown> }])}
            onReset={resetCalc} />}
          <select id="norm" className="norm-sel" value={s.code === "DBN" ? "DBN" : `EN:${s.annex ?? "EU"}`} aria-label={t("code")} title={t("code")}
            onChange={(e) => { const v = e.target.value; if (v === "DBN") setCode("DBN"); else setCode("EN", v.slice(3) as AnnexId); }}>
            <option value="DBN">{t("norm_dbn")}</option>
            {Object.values(ANNEXES).map((a) => <option key={a.id} value={`EN:${a.id}`}>{a.name[s.lang === "ru" ? 1 : s.lang === "uk" ? 0 : 2]}</option>)}
          </select>
          <select id="lang" value={s.lang} onChange={(e) => set({ lang: e.target.value as Lang })} aria-label="language">
            {LANGS.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
        </div>
      </header>

      <div key={s.code === "DBN" ? "DBN" : s.annex ?? "EU"} className="norm-scope">
      {s.screen === "home" && <Home go={go} goAsm={goAsm} t={t} saved={saved} open={openCalc}
        remove={(id) => putSaved(saved.filter((x) => x.id !== id))}
        download={(c) => dl([c])} downloadAll={() => dl(saved)} importFile={importFile} />}
      {toast && <div className="toast" role="status">{toast}</div>}
      {s.screen === "beam" && (
        <BeamModule code={s.code} s={beam} set={(p) => set({ beam: { ...s.beam, ...p } })}
          lc={s.lc} setLc={(p) => set({ lc: { ...s.lc, ...p } })} t={t} />
      )}
      {s.screen === "column" && <ColumnModule code={s.code} s={column} set={(p) => set({ column: { ...s.column, ...p } })} t={t} />}
      {s.screen === "connection" && <ConnectionsModule code={s.code} s={s.conn} set={(p) => set({ conn: { ...s.conn, ...p } })} t={t} />}
      {s.screen === "node" && <NodeModule code={s.code} s={{ ...s.node, family: s.node.family === "MANUAL" ? "MANUAL" : okFam(s.node.family, "HEB"), pSteel: okSteel(s.node.pSteel), plSteel: okSteel(s.node.plSteel) }} set={(p) => set({ node: { ...s.node, ...p } })} t={t}
        onReturn={s.asm.asm ? (jr) => { set({ screen: "assembly", asm: { ...s.asm, jres: { ...(s.asm.jres ?? {}), [`${jr.member}|${jr.end}`]: jr } } }); window.scrollTo(0, 0); } : undefined}
        onReturnBase={s.asm.asm ? (ns) => {
          const a = s.asm.asm!, id = ns.asmLink?.node;
          set({ screen: "assembly", node: { ...s.node, asmLink: undefined }, asm: { ...s.asm, sel: id ? { kind: "node", id } : s.asm.sel, asm: { ...a, nodes: a.nodes.map((n) => (n.id === id ? baseToAsm(ns, n) : n)) } } });
          window.scrollTo(0, 0);
        } : undefined} />}
      {s.screen === "generator" && <GeneratorModule code={s.code} s={s.gen} set={(p) => set({ gen: { ...s.gen, ...p } })} lib={s.lib} setLib={(p) => set({ lib: { ...s.lib, ...p } })} t={t} />}
      {s.screen === "assembly" && <AssemblyModule code={s.code} s={s.asm} set={(p) => set({ asm: { ...s.asm, ...p } })} t={t} openNode={(p) => { set({ screen: "node", node: { ...s.node, ...p } }); window.scrollTo(0, 0); }} />}
      {s.screen === "thermal" && <ThermalModule code={s.code} s={s.thermal} set={(p) => set({ thermal: { ...s.thermal, ...p } })} t={t} />}
      {s.screen === "flat" && <FlatSlabModule code={s.code} s={s.flat} set={(p) => set({ flat: { ...s.flat, ...p } })} t={t} />}
      {s.screen === "slab" && <SlabModule code={s.code} s={s.slab} set={(p) => set({ slab: { ...s.slab, ...p } })} t={t} />}
      {s.screen === "rccolumn" && <RcColumnModule code={s.code} s={s.rcc} set={(p) => set({ rcc: { ...s.rcc, ...p } })} t={t} />}
      {s.screen === "concrete" && <RcModule code={s.code} s={s.rc} set={(p) => set({ rc: { ...s.rc, ...p } })} t={t} />}
      {s.screen === "library" && <LibraryModule lib={s.lib} setLib={(p) => set({ lib: { ...s.lib, ...p } })} t={t} />}
      {s.screen === "section" && <SectionModule code={s.code} s={sec} set={(p) => set({ sec: { ...s.sec, ...p } })} lib={s.lib} setLib={(p) => set({ lib: { ...s.lib, ...p } })} t={t} />}
      </div>
    </div>
  );
}
