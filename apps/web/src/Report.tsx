import type { BeamDesignInput, BeamDesignResult, CodeId } from "@structcalc/core";
import { Scheme } from "./Scheme";
import { CheckList, Diagrams, governing, pct, SectionProps, T, utilState } from "./Results";

// Отчет в стиле статрасчета: вывод → исходные данные → схема и усилия → проверки → характеристики.
export function Report({ r, input, t, obj, elem, steel, code }: {
  r: BeamDesignResult; input: BeamDesignInput; t: T; obj: string; elem: string; steel: string; code: CodeId;
}) {
  const g = governing(r.member.checks);
  const date = new Date().toLocaleDateString();
  const loadText = (l: BeamDesignInput["loads"][number]) => {
    const cat = (l.label ? `${l.label} · ` : "") + t(`cat_${l.cat}`) + (l.gf != null ? ` (γfm = ${l.gf}${l.gfe != null ? `, γfe = ${l.gfe}` : ""})` : "");
    if (l.type === "udl") {
      const range = l.from != null || l.to != null ? ` (${l.from ?? 0}…${l.to ?? "L"} m)` : "";
      return `${cat}: q = ${l.q2 != null ? `${l.q}…${l.q2}` : l.q} kN/m${range}`;
    }
    if (l.type === "point") return `${cat}: P = ${l.P} kN, x = ${l.x} m`;
    return `${cat}: M = ${l.M} kN·m, x = ${l.x} m`;
  };
  const Mmax = Math.max(Math.abs(r.uls.Mmax), Math.abs(r.uls.Mmin)) / 1e6;

  return (
    <article className="report">
      <header className="rep-head">
        <h1>{t("rep_title")}</h1>
        <dl>
          <div><dt>{t("rep_object")}</dt><dd>{obj || "—"}</dd></div>
          <div><dt>{t("rep_element")}</dt><dd>{elem || "—"}</dd></div>
          <div><dt>{t("rep_code")}</dt><dd>{code === "DBN" ? "ДБН В.2.6-198:2014, ДБН В.1.2-2:2006" : "EN 1990, EN 1993-1-1"}</dd></div>
          <div><dt>{t("rep_date")}</dt><dd>{date}</dd></div>
        </dl>
      </header>

      <h2>{t("rep_summary")}</h2>
      <table className="rep-table">
        <thead><tr><th>{t("rep_question")}</th><th>{t("rep_answer")}</th></tr></thead>
        <tbody>
          <tr><td>{t("rep_profile")}</td><td><strong>{r.section.name}</strong>, {steel}, {r.section.mass.toFixed(1)} kg/m</td></tr>
          <tr><td>{t("rep_result")}</td><td className={utilState(r.member.maxUtil)}>{r.member.ok ? t("ok") : t("fail")}</td></tr>
          <tr><td>{t("rep_maxutil")}</td><td>{pct(r.member.maxUtil)}{g ? ` — ${t(`chk_${g.key}`)}` : ""}</td></tr>
          <tr><td>{t("rep_checks").replace(/^\d+\.\s*/, "")}</td><td>{r.member.checks.map((c) => `${t(`chk_${c.key}`)} ${pct(c.util)}`).join("; ")}</td></tr>
        </tbody>
      </table>

      <h2>{t("rep_inputs")}</h2>
      <table className="rep-table">
        <tbody>
          <tr><td>{t("rep_spans")}</td><td>{input.spans.map((s) => `${s} m`).join(" + ")}</td></tr>
          <tr><td>{t("rep_supports")}</td><td>{input.supports.map((s, i) => t(`sup_${s}`) + (s === "spring" ? ` (k = ${input.springs?.[i] ?? 0} kN/m)` : "")).join(" — ")}</td></tr>
          <tr><td>{t("rep_loadsList")}</td><td>{input.loads.map((l, i) => <div key={i}>{loadText(l)}</div>)}</td></tr>
          {input.loads.some((l) => l.note) && (
            <tr><td>{t("rep_loadsDerivation")}</td><td>{input.loads.filter((l) => l.note).map((l, i) => <div key={i} className="rep-note">{l.note}</div>)}</td></tr>
          )}
          <tr><td>{t("rep_selfw")}</td><td>{input.selfWeight ? `${t("yes")}, ${(r.section.mass * 9.81 / 1000).toFixed(3)} kN/m` : t("no")}</td></tr>
          <tr><td>{t("rep_comb")}</td><td>{input.gammaG}·G + {input.gammaQ}·Q{input.loads.some((l) => l.gf != null) ? ` (${t("rep_ownGf")})` : ""}{r.uplift ? `; ${t("rep_uplift")}` : ""}{code === "DBN" ? `; γc = ${input.gammaC ?? 1}; γn = ${input.gammaN ?? 1}` : ""}</td></tr>
          <tr><td>{t("rep_steel")}</td><td>{steel}</td></tr>
          <tr><td>{t("rep_ltb")}</td><td>{input.ltb.restrained ? t("yes") : `${t("no")}; ${t("loadAt").toLowerCase()}: ${t(`load_${input.ltb.loadAt}`)}; ${t("restraintsN").toLowerCase()}: ${t(`rest_${input.ltb.restraints ?? 0}`)}; l_ef = ${(r.LcrLT / 1000).toFixed(2)} m`}</td></tr>
          <tr><td>{t("rep_defl")}</td><td>{r.member.checks.find((c) => c.key === "deflection")?.formula ?? "—"}</td></tr>
        </tbody>
      </table>

      <h2>{t("rep_scheme")}</h2>
      <Scheme spans={input.spans} supports={input.supports} loads={input.loads} t={t} />
      <p className="rep-line">M<sub>max</sub> = {Mmax.toFixed(2)} kN·m; Q<sub>max</sub> = {(r.uls.Vabs / 1e3).toFixed(2)} kN; {r.uls.reactions.map((x, i) => `R${i + 1} = ${(x.R / 1e3).toFixed(2)} kN`).join("; ")}</p>
      <Diagrams r={r} t={t} spans={input.spans} />

      <h2>{t("rep_checks")}</h2>
      <CheckList checks={r.member.checks} t={t} />

      <h2>{t("rep_section")}</h2>
      <SectionProps r={r} code={code} t={t} />

      <p className="disclaimer">{t("disclaimer")}</p>
    </article>
  );
}
