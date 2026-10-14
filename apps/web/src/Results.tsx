import type { BeamDesignResult, Check, CodeId } from "@structcalc/core";
import { Diagram } from "./Diagram";

export type T = (k: string) => string;

export function utilState(u: number): "ok" | "warn" | "fail" {
  if (!Number.isFinite(u) || u > 1 + 1e-9) return "fail";
  return u > 0.9 ? "warn" : "ok";
}

export const pct = (u: number) => (Number.isFinite(u) ? `${Math.round(u * 100)}%` : "—");

export function UtilBar({ u }: { u: number }) {
  const w = Number.isFinite(u) ? Math.min(u, 1.25) / 1.25 : 1;
  return (
    <div className={`ubar ${utilState(u)}`} aria-hidden="true">
      <div className="ubar-fill" style={{ width: `${w * 100}%` }} />
      <div className="ubar-limit" />
    </div>
  );
}

export function governing(checks: Check[]): Check | undefined {
  return checks.reduce<Check | undefined>((a, c) => (!a || !(c.util <= a.util) ? c : a), undefined);
}

/** То, что нужно для сводки и характеристик: сечение, проверки и (для балок) параметры ПФУ. */
export interface MemberView { section: BeamDesignResult["section"]; member: BeamDesignResult["member"]; C1?: number; LcrLT?: number }

export function Summary({ r, t, steel }: { r: MemberView; t: T; steel: string }) {
  const g = governing(r.member.checks);
  const st = utilState(r.member.maxUtil);
  return (
    <div className={`summary ${st}`}>
      <div className="summary-main">
        <div className="eyebrow">{t("rep_profile")}</div>
        <div className="profile">{r.section.name}</div>
        <div className="meta">{steel} · {r.section.mass.toFixed(1)} kg/m</div>
      </div>
      <div className="summary-util">
        <div className="eyebrow">{t("rep_maxutil")}</div>
        <div className="big">{pct(r.member.maxUtil)}</div>
        <div className={`pill ${st}`}>{r.member.ok ? t("ok") : t("fail")}</div>
      </div>
      {g && (
        <div className="summary-gov">
          <div className="eyebrow">{t("governing")}</div>
          <div>{t(`chk_${g.key}`)}</div>
        </div>
      )}
    </div>
  );
}

export function CheckList({ checks, t }: { checks: Check[]; t: T }) {
  return (
    <ol className="checklist">
      {checks.map((c, i) => (
        <li key={i} className={`check-item ${utilState(c.util)}`}>
          <div className="check-head">
            <span className="check-name">{t(`chk_${c.key}`)}</span>
            <span className="check-pct">{pct(c.util)}</span>
          </div>
          <UtilBar u={c.util} />
          <div className="check-formula mono">{c.formula}</div>
          <div className="check-subst mono">{c.subst}</div>
          <div className="check-foot">
            <span className="clause">{c.clause}</span>
            {c.notes?.map((n) => <span key={n} className="note">{t(`note_${n}`)}</span>)}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Diagrams({ r, t, spans }: { r: BeamDesignResult; t: T; spans: number[] }) {
  const sup = [0];
  spans.forEach((s) => sup.push(sup[sup.length - 1] + s * 1000));
  return (
    <div className="diagrams">
      <Diagram x={r.uls.x} y={r.uls.M.map((v) => v / 1e6)} title="M" unit="kN·m" supportsX={sup} invert />
      <Diagram x={r.uls.x} y={r.uls.V.map((v) => v / 1e3)} title={t("diagV").split(",")[0]} unit="kN" supportsX={sup} />
      <Diagram x={r.sls.x} y={r.sls.w} title="f" unit="mm" supportsX={sup} invert />
    </div>
  );
}

export function SectionProps({ r, code, t }: { r: MemberView; code: CodeId; t: T }) {
  const s = r.section;
  const ax = code === "DBN" ? { y: "x", z: "y" } : { y: "y", z: "z" };
  const rows: [string, string][] = [
    ["A", `${(s.A / 100).toFixed(2)} cm²`],
    [`I${ax.y}`, `${(s.Iy / 1e4).toFixed(1)} cm⁴`],
    [`W${ax.y}`, `${(s.Wy / 1e3).toFixed(1)} cm³`],
    [`Wpl,${ax.y}`, `${(s.Wply / 1e3).toFixed(1)} cm³`],
    [`I${ax.z}`, `${(s.Iz / 1e4).toFixed(1)} cm⁴`],
    [`i${ax.y} / i${ax.z}`, `${(s.iy / 10).toFixed(2)} / ${(s.iz / 10).toFixed(2)} cm`],
    ["It", `${(s.It / 1e4).toFixed(2)} cm⁴`],
  ];
  if (s.Iw > 0) rows.push(["Iw", `${(s.Iw / 1e6).toFixed(0)} cm⁶`]);
  for (const v of r.member.values) rows.push([v.symbol, `${Number.isInteger(v.value) ? v.value : v.value.toFixed(3)} ${v.unit}`]);
  if (r.C1 != null && r.LcrLT != null) rows.push([t("C1"), r.C1.toFixed(3)], ["Lcr,LT", `${(r.LcrLT / 1000).toFixed(2)} m`]);
  return (
    <dl className="props">
      {rows.map(([k, v]) => (
        <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
      ))}
    </dl>
  );
}
