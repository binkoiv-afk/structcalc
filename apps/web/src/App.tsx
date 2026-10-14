import { useState } from "react";
import { CodeId, DEFAULT_FACTORS } from "@structcalc/core";
import { Lang, LANGS, makeT } from "./i18n";
import { Home, Screen } from "./Home";
import { BeamModule, BeamState, initialBeam } from "./BeamModule";
import { ColumnModule, ColumnState, initialColumn } from "./ColumnModule";
import { SectionModule, SectionState, initialSection } from "./SectionModule";
import { ConnectionsModule, ConnKind, ConnState, initialConn, pickKind } from "./ConnectionsModule";
import { CollectorState, initialCollector } from "./LoadCollector";

interface AppState {
  lang: Lang; code: CodeId; screen: Screen;
  beam: BeamState; column: ColumnState; lc: CollectorState; sec: SectionState; conn: ConnState;
}

const KEY = "structcalc.v2";
const initial: AppState = { lang: "uk", code: "DBN", screen: "home", beam: initialBeam, column: initialColumn, lc: initialCollector, sec: initialSection, conn: initialConn };

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const o = JSON.parse(raw);
      return {
        ...initial, ...o, screen: o.screen === "loads" ? "home" : o.screen, beam: { ...initialBeam, ...o.beam }, column: { ...initialColumn, ...o.column },
        lc: { ...initialCollector, ...o.lc }, sec: { ...initialSection, ...o.sec }, conn: { ...initialConn, ...o.conn },
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
  const set = (p: Partial<AppState>) => setS((o) => {
    const n = { ...o, ...p };
    try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* ignore */ }
    return n;
  });
  const t = makeT(s.lang);
  const go = (screen: Screen, conn?: ConnKind) => {
    set(conn ? { screen, conn: { ...s.conn, ...pickKind(s.conn, conn) } } : { screen });
    window.scrollTo(0, 0);
  };
  const setCode = (code: CodeId) => {
    const steel = code === "DBN" ? "C245" : "S235";
    set({ code, beam: { ...s.beam, steel, ...DEFAULT_FACTORS[code] }, column: { ...s.column, steel } });
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
              <span className="module">{t(`mod_${s.screen}`)}{s.screen === "connection" && s.conn.kind ? ` · ${t(`conn_${s.conn.kind}`)}` : ""}</span>
            </>
          )}
        </div>
        <div className="top-controls">
          {s.screen !== "home" && <button className="ghost back" onClick={() => go("home")}>← {t("allCalcs")}</button>}
          <div className="seg" role="group" aria-label={t("code")}>
            {(["DBN", "EN"] as const).map((c) => (
              <button key={c} className={s.code === c ? "on" : ""} onClick={() => setCode(c)}>{c === "DBN" ? "ДБН" : "EN"}</button>
            ))}
          </div>
          <select id="lang" value={s.lang} onChange={(e) => set({ lang: e.target.value as Lang })} aria-label="language">
            {LANGS.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
        </div>
      </header>

      {s.screen === "home" && <Home go={go} t={t} />}
      {s.screen === "beam" && (
        <BeamModule code={s.code} s={s.beam} set={(p) => set({ beam: { ...s.beam, ...p } })}
          lc={s.lc} setLc={(p) => set({ lc: { ...s.lc, ...p } })} t={t} />
      )}
      {s.screen === "column" && <ColumnModule code={s.code} s={s.column} set={(p) => set({ column: { ...s.column, ...p } })} t={t} />}
      {s.screen === "connection" && <ConnectionsModule code={s.code} s={s.conn} set={(p) => set({ conn: { ...s.conn, ...p } })} t={t} />}
      {s.screen === "section" && <SectionModule code={s.code} s={s.sec} set={(p) => set({ sec: { ...s.sec, ...p } })} t={t} />}
    </div>
  );
}
