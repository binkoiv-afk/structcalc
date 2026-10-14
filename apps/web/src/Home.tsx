// Стартовый экран: сначала выбирается тип расчета, затем открывается только нужный ввод.
export type Screen = "home" | "beam" | "column" | "loads" | "section" | "connection";

const ICONS: Record<string, JSX.Element> = {
  beam: <><path d="M6 22h36" strokeWidth="3" /><path d="M6 22l-3 6h6zM42 22l-3 6h6z" /><path d="M10 10v8M17 10v8M24 10v8M31 10v8M38 10v8" /></>,
  column: <><path d="M24 8v32" strokeWidth="3" /><path d="M24 2v4" /><path d="M16 40h16M18 40l-3 5M24 40l-3 5M30 40l-3 5" /></>,
  loads: <><path d="M8 26l16-12 16 12" strokeWidth="3" /><path d="M14 6v6M24 2v8M34 6v6" /><path d="M4 34h10M4 40h16" /></>,
  section: <><path d="M12 8h24M12 40h24M24 8v32" strokeWidth="4" /></>,
  connection: <><path d="M8 14h32M8 34h32" strokeWidth="3" /><circle cx="18" cy="24" r="3" /><circle cx="30" cy="24" r="3" /></>,
  frame: <><path d="M8 42V12h32v30M8 12l16 12 16-12" strokeWidth="2.5" /></>,
  dynamic: <><path d="M4 24c4-10 8-10 12 0s8 10 12 0 8-10 12 0 4 10 6 6" strokeWidth="2.5" /></>,
  thermal: <><path d="M10 8v32M20 8v32M30 8v32" /><path d="M36 14h8M36 24h8M36 34h8" strokeWidth="2.5" /></>,
  concrete: <><rect x="8" y="12" width="32" height="24" /><circle cx="14" cy="30" r="2" /><circle cx="24" cy="30" r="2" /><circle cx="34" cy="30" r="2" /></>,
  timber: <><rect x="8" y="10" width="32" height="28" rx="3" /><path d="M14 18c6 2 14 2 20 0M14 26c6 2 14 2 20 0" /></>,
};

const GROUPS: { key: string; items: { id: string; ready: boolean }[] }[] = [
  { key: "grp_steel", items: [{ id: "beam", ready: true }, { id: "column", ready: true }, { id: "section", ready: true }, { id: "connection", ready: true }, { id: "frame", ready: false }] },
  { key: "grp_loads", items: [{ id: "loads", ready: true }, { id: "dynamic", ready: false }] },
  { key: "grp_other", items: [{ id: "concrete", ready: false }, { id: "timber", ready: false }, { id: "thermal", ready: false }] },
];

export function Home({ go, t }: { go: (s: Screen) => void; t: (k: string) => string }) {
  return (
    <main className="home">
      <h1 className="home-title">{t("home_title")}</h1>
      <p className="home-sub">{t("home_sub")}</p>
      {GROUPS.map((g) => (
        <section key={g.key} className="home-group">
          <h2>{t(g.key)}</h2>
          <div className="cards">
            {g.items.map((it) => (
              <button key={it.id} id={`card-${it.id}`} className={`card ${it.ready ? "" : "soon"}`} disabled={!it.ready} onClick={() => go(it.id as Screen)}>
                <svg viewBox="0 0 48 48" className="card-icon" aria-hidden="true">{ICONS[it.id]}</svg>
                <span className="card-title">{t(`mod_${it.id}`)}</span>
                <span className="card-desc">{t(`mod_${it.id}_d`)}</span>
                {!it.ready && <span className="card-soon">{t("soon")}</span>}
              </button>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
