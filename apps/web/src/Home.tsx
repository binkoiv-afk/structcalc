// Стартовый экран: сначала выбирается тип расчета, затем открывается только нужный ввод.
import { CONN_ICONS, ConnKind, KINDS } from "./ConnectionsModule";
import type { AsmTemplate } from "@structcalc/core";
import { ASM_ICONS } from "./AssemblyModule";
import { useRef, useState } from "react";
import type { SavedCalc } from "./projects";

export type Screen = "home" | "beam" | "column" | "section" | "connection" | "generator" | "library" | "node" | "assembly" | "thermal";

const ICONS: Record<string, JSX.Element> = {
  beam: <><path d="M6 22h36" strokeWidth="3" /><path d="M6 22l-3 6h6zM42 22l-3 6h6z" /><path d="M10 10v8M17 10v8M24 10v8M31 10v8M38 10v8" /></>,
  column: <><path d="M24 8v32" strokeWidth="3" /><path d="M24 2v4" /><path d="M16 40h16M18 40l-3 5M24 40l-3 5M30 40l-3 5" /></>,
  section: <><path d="M12 8h24M12 40h24M24 8v32" strokeWidth="4" /></>,
  frame: <><path d="M8 42V12h32v30" strokeWidth="2.5" /><path d="M5 42h6M37 42h6" /></>,
  truss: <><path d="M4 34h40M8 34l8-14h16l8 14M16 20l4 14 4-14 4 14 4-14" strokeWidth="2" /></>,
  basePlate: <><path d="M24 4v28" strokeWidth="4" /><path d="M10 32h28" strokeWidth="3" /><path d="M16 32v12M32 32v12" strokeWidth="2" /><path d="M4 38h40" strokeDasharray="2 3" /></>,
  joints: <><path d="M10 4v40" strokeWidth="4" /><path d="M10 18h32M10 30h32" strokeWidth="3" /><circle cx="16" cy="24" r="2" /></>,
  generator: <><path d="M8 8h14v6h-4v20h4v6H8v-6h4V14H8z" strokeWidth="2" /><path d="M30 16h12M36 10v12M30 34h12" strokeWidth="2.5" /></>,
  node: <><path d="M24 4v24" strokeWidth="4" /><path d="M8 28h32" strokeWidth="3" /><path d="M14 28v14M34 28v14" strokeWidth="2" /><path d="M24 12l-9 16M24 12l9 16" strokeWidth="1.5" /><circle cx="40" cy="10" r="5" /><path d="M40 7v6M37 10h6" /></>,
  library: <><path d="M8 8v32M16 8v32M24 10l8 30M36 8v32" strokeWidth="3" /></>,
  dynamic: <><path d="M4 24c4-10 8-10 12 0s8 10 12 0 8-10 12 0 4 10 6 6" strokeWidth="2.5" /></>,
  thermal: <><path d="M10 8v32M20 8v32M30 8v32" /><path d="M36 14h8M36 24h8M36 34h8" strokeWidth="2.5" /></>,
  concrete: <><rect x="8" y="12" width="32" height="24" /><circle cx="14" cy="30" r="2" /><circle cx="24" cy="30" r="2" /><circle cx="34" cy="30" r="2" /></>,
  timber: <><rect x="8" y="10" width="32" height="28" rx="3" /><path d="M14 18c6 2 14 2 20 0M14 26c6 2 14 2 20 0" /></>,
};

// Порядок — за ходом проєктування: елементи → вузли і з'єднання → довідники → інше.
// Збір снігу і вітру — не окремий розрахунок, а крок «Навантаження» всередині елемента.
type Item = { id: string; ready: boolean; conn?: ConnKind; asm?: AsmTemplate; seis?: boolean };
const GROUPS: { key: string; hint?: string; items: Item[] }[] = [
  { key: "grp_members", hint: "grp_members_h", items: [{ id: "beam", ready: true }, { id: "column", ready: true }, { id: "truss", ready: true, asm: "truss" }, { id: "frame", ready: true, asm: "portal" }, { id: "dynamic", ready: true, asm: "portal", seis: true }] },
  { key: "grp_asm", hint: "grp_asm_h", items: [{ id: "assembly", ready: true }, { id: "canopy", ready: true, asm: "canopy" }, { id: "bracket", ready: true, asm: "bracket" }, { id: "platform", ready: true, asm: "platform" }] },
  { key: "grp_conn", hint: "grp_conn_h", items: [
    { id: "node", ready: true },
    ...KINDS.map((k) => ({ id: `conn_${k}`, ready: true, conn: k })),
  ] },
  { key: "grp_env", items: [{ id: "thermal", ready: true }] },
  { key: "grp_ref", items: [{ id: "section", ready: true }, { id: "generator", ready: true }, { id: "library", ready: true }] },
  { key: "grp_soon", items: [{ id: "concrete", ready: false }, { id: "timber", ready: false }] },
];

export function Home({ go, goAsm, t, saved, open, remove, download, downloadAll, importFile }: {
  go: (s: Screen, conn?: ConnKind) => void; goAsm: (k: AsmTemplate | null, seismic?: boolean) => void; t: (k: string) => string;
  saved: SavedCalc[]; open: (c: SavedCalc) => void; remove: (id: string) => void; download: (c: SavedCalc) => void; downloadAll: () => void; importFile: (f: File) => void;
}) {
  const [q, setQ] = useState("");
  const [del, setDel] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const fileIn = useRef<HTMLInputElement>(null);
  const title = (it: Item) => t(it.conn ? it.id : it.asm && !["truss", "frame", "dynamic"].includes(it.id) ? `at_${it.asm}` : `mod_${it.id}`);
  const desc = (it: Item) => t(it.conn ? `${it.id}_d` : it.asm && it.id !== "dynamic" ? `at_${it.asm}_d` : `mod_${it.id}_d`);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (it: Item) => { const tx = `${title(it)} ${desc(it)}`.toLowerCase(); return words.every((w) => tx.includes(w)); };
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter(hit) })).filter((g) => g.items.length);
  const list = [...saved].sort((a, b) => b.date - a.date);
  const shown = all ? list : list.slice(0, 6);
  const scrTitle = (c: SavedCalc) => t(`mod_${c.screen}`);
  return (
    <main className="home">
      <h1 className="home-title">{t("home_title")}</h1>
      <p className="home-sub">{t("home_sub")}</p>
      <div className="home-tools">
        <input id="home-search" type="search" className="home-search" placeholder={t("fm_search")} value={q} onChange={(e) => setQ(e.target.value)} />
        <button id="fm-open" className="ghost" onClick={() => fileIn.current?.click()}>⤒ {t("fm_openFile")}</button>
        <input ref={fileIn} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }} />
      </div>
      {list.length > 0 && !q && (
        <section className="home-group saved">
          <h2>{t("fm_mine")}</h2>
          <div className="saved-list">
            {shown.map((c) => (
              <div key={c.id} className="saved-row">
                <button className="saved-open" onClick={() => open(c)}>
                  <span className="saved-name">{c.name}</span>
                  <span className="saved-meta">{scrTitle(c)} · {c.code === "DBN" ? "ДБН" : "EN"} · {new Date(c.date).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}</span>
                </button>
                <button className="icon-btn" title={t("fm_download")} aria-label={t("fm_download")} onClick={() => download(c)}>⤓</button>
                <button className={`icon-btn ${del === c.id ? "danger" : ""}`} title={t("fm_delete")} aria-label={t("fm_delete")}
                  onClick={() => { if (del === c.id) { remove(c.id); setDel(null); } else setDel(c.id); }} onBlur={() => setDel(null)}>{del === c.id ? t("fm_deleteSure") : "✕"}</button>
              </div>
            ))}
          </div>
          <div className="saved-foot">
            {list.length > 6 && <button className="ghost" onClick={() => setAll(!all)}>{all ? t("fm_less") : `${t("fm_more")} (${list.length})`}</button>}
            <button className="ghost" onClick={downloadAll}>⤓ {t("fm_downloadAll")}</button>
          </div>
        </section>
      )}
      {groups.length === 0 && <p className="hint">{t("fm_nothing")}</p>}
      {groups.map((g) => (
        <section key={g.key} className="home-group">
          <h2>{t(g.key)}</h2>
          {g.hint && !q && <p className="home-hint">{t(g.hint)}</p>}
          <div className="cards">
            {g.items.map((it) => (
              <button key={it.id} id={`card-${it.id}`} className={`card ${it.ready ? "" : "soon"} ${it.conn ? "compact" : ""}`} disabled={!it.ready}
                onClick={() => (it.conn ? go("connection", it.conn) : it.asm ? goAsm(it.asm, it.seis) : it.id === "assembly" ? goAsm(null) : go(it.id as Screen))}>
                <svg viewBox="0 0 48 48" className="card-icon" aria-hidden="true">{it.conn ? CONN_ICONS[it.conn] : it.seis ? ICONS.dynamic : it.asm ? ASM_ICONS[it.asm] : ICONS[it.id] ?? ASM_ICONS.empty}</svg>
                <span className="card-title">{title(it)}</span>
                <span className="card-desc">{desc(it)}</span>
                {!it.ready && <span className="card-soon">{t("soon")}</span>}
              </button>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
