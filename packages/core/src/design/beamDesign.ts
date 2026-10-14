// Расчет и подбор стальной балки: нагрузки → сочетания → усилия → проверки норм.
// Входные данные в «инженерных» единицах: м, кН, кН/м, кН·м.

import { analyzeBeam, BeamLoad, BeamResult, combineResults, SupportType } from "../analysis/beam";
import { buildCombinations, Combination, LoadCategory } from "../loads/combinations";
import { steel } from "../catalog/materials";
import { familySections } from "../catalog/profiles";
import type { Section } from "../geometry/sections";
import { checkMemberDBN, deflectionLimitDSTU, PsiCase } from "../codes/dbn198";
import { checkMemberEN } from "../codes/en1993";
import { finalize } from "../codes/types";
import type { CodeId, MemberResult } from "../codes/types";

export type { LoadCategory };

/** Общие поля нагрузки: свой коэффициент надежности (напр. γfm снега) и экспл. коэффициент γfe. */
export interface LoadMeta {
  cat: LoadCategory;
  /** название (напр. «Сніг»), отображается в схеме и отчете */
  label?: string;
  /** коэффициент для предельного (ULS) значения; по умолчанию γG / γQ */
  gf?: number;
  /** коэффициент для эксплуатационного (SLS) значения; по умолчанию 1 */
  gfe?: number;
  /** вывод значения (сбор нагрузок) для отчета */
  note?: string;
  /** взаимоисключающие нагрузки (одно действие, разные варианты) — одинаковое имя группы */
  group?: string;
  /** EN 1990: ψ0 для сопутствующих (по умолчанию 0.7) */
  psi0?: number;
}

export type UserLoad =
  | (LoadMeta & { type: "udl"; q: number; q2?: number; from?: number; to?: number }) // кН/м, м; q2 — в конце участка (трапеция)
  | (LoadMeta & { type: "point"; P: number; x: number }) // кН, м
  | (LoadMeta & { type: "moment"; M: number; x: number }); // кН·м, м

export interface BeamDesignInput {
  code: CodeId;
  steel: string;
  spans: number[]; // м
  supports: SupportType[];
  /** жесткость упругих опор, кН/м (по индексу опоры, для типа «spring») */
  springs?: number[];
  loads: UserLoad[];
  selfWeight: boolean;
  gammaG: number;
  gammaQ: number;
  gammaC?: number;
  /** ДБН: коэффициент надежности по ответственности γn */
  gammaN?: number;
  ltb: {
    restrained: boolean;
    loadAt: "top" | "center" | "bottom";
    /** число закреплений сжатого пояса в пролете: 0, 1 (в середине), 2 (два и более) */
    restraints?: 0 | 1 | 2;
    /** м; по умолчанию — пролет между закреплениями */
    Lcr?: number;
  };
  /** знаменатель n предельного прогиба l/n; 0 — по норме (ДСТУ Б В.1.2-3 для ДБН, l/250 для EN) */
  deflectionLimit: number;
  /** осевая сжимающая сила, кН (расчетная), и расчетные длины, м */
  axial?: { NEd: number; Lcr_y: number; Lcr_z: number };
}

export const DEFAULT_FACTORS: Record<CodeId, { gammaG: number; gammaQ: number }> = {
  // ДБН В.1.2-2: γf для металлоконструкций 1.05, для прочих постоянных 1.1–1.3; полезные 1.2–1.3
  DBN: { gammaG: 1.1, gammaQ: 1.3 },
  // EN 1990, табл. A1.2(B), формула 6.10
  EN: { gammaG: 1.35, gammaQ: 1.5 },
};

export interface BeamDesignResult {
  section: Section;
  uls: BeamResult;
  sls: BeamResult;
  member: MemberResult;
  C1: number;
  C2: number;
  LcrLT: number;
  /** расчетным оказалось сочетание с отрывом (суммарная нагрузка вверх) */
  uplift: boolean;
  /** все сформированные сочетания и номера расчетных */
  combos: Combination[];
  govern: { M: number; V: number; w: number };
  /** огибающая расчетных (ULS + ACC) усилий */
  envelope: { x: number[]; Mmax: number[]; Mmin: number[]; Vmax: number[]; Vmin: number[] };
}

function toCore(l: UserLoad, factor: number): BeamLoad {
  if (l.type === "udl") return { type: "udl", q: l.q * factor, q2: l.q2 != null ? l.q2 * factor : undefined, from: l.from != null ? l.from * 1000 : undefined, to: l.to != null ? l.to * 1000 : undefined };
  if (l.type === "point") return { type: "point", P: l.P * 1000 * factor, x: l.x * 1000 };
  return { type: "moment", M: l.M * 1e6 * factor, x: l.x * 1000 };
}

/** Коэффициент C1 по форме эпюры моментов на участке (≈ Cb, AISC 360 F1-1). */
export function c1FromDiagram(x: number[], M: number[], a: number, b: number): number {
  const at = (xx: number) => {
    let best = 0, d = Infinity;
    x.forEach((xi, i) => { const di = Math.abs(xi - xx); if (di < d) { d = di; best = Math.abs(M[i]); } });
    return best;
  };
  let mmax = 0;
  x.forEach((xi, i) => { if (xi >= a - 1e-6 && xi <= b + 1e-6) mmax = Math.max(mmax, Math.abs(M[i])); });
  if (mmax === 0) return 1;
  const L = b - a;
  const cb = (12.5 * mmax) / (2.5 * mmax + 3 * at(a + L / 4) + 4 * at(a + L / 2) + 3 * at(a + (3 * L) / 4));
  return Math.min(cb, 2.5);
}

// Кэш загружений: без упругих опор M и Q не зависят от EI, прогиб ∝ 1/EI — считаем один раз для EI = 1.
const partCache = new Map<string, BeamResult>();
function partResult(model: { spans: number[]; supports: SupportType[]; springs?: number[]; EI: number }, load: BeamLoad, keys: number[]): BeamResult {
  const elastic = model.supports.includes("spring");
  const key = JSON.stringify([model.spans, model.supports, elastic ? [model.springs, model.EI] : 0, keys, load]);
  let r = partCache.get(key);
  if (!r) {
    if (partCache.size > 500) partCache.clear();
    r = analyzeBeam({ ...model, EI: elastic ? model.EI : 1, loads: [load], extraKeys: keys });
    partCache.set(key, r);
  }
  if (elastic) return r;
  const k = 1 / model.EI;
  return { ...r, w: r.w.map((v) => v * k), spanDeflections: r.spanDeflections.map((d) => ({ ...d, w: d.w * k })) };
}

export function designBeam(inp: BeamDesignInput, section: Section): BeamDesignResult {
  const st = steel(inp.steel);
  const EI = st.E * section.Iy;
  const spans = inp.spans.map((s) => s * 1000);
  const Ltot = spans.reduce((a, b) => a + b, 0);
  const sw: UserLoad[] = inp.selfWeight ? [{ type: "udl", cat: "G", q: (section.mass * 9.81) / 1000, label: "g_sw" }] : [];
  const all = [...inp.loads, ...sw];
  const model = { spans, supports: inp.supports, springs: inp.springs, EI };

  // Линейная задача: считаем каждое загружение отдельно на общей сетке и комбинируем (суперпозиция)
  const keys = all.flatMap((l) => (l.type === "udl" ? [(l.from ?? 0) * 1000, l.to != null ? l.to * 1000 : Ltot] : [l.x * 1000]));
  const parts = all.length
    ? all.map((l) => partResult(model, toCore(l, 1), keys))
    : [analyzeBeam({ ...model, loads: [] })];
  const influence = parts.map((r) => Math.max(Math.abs(r.Mmax), Math.abs(r.Mmin)));
  const combos = all.length
    ? buildCombinations(all.map((l) => ({ cat: l.cat, label: l.label, group: l.group, gf: l.gf, gfe: l.gfe, psi0: l.psi0 })),
      { code: inp.code, gammaG: inp.gammaG, gammaQ: inp.gammaQ, influence })
    : [{ kind: "ULS" as const, factors: [0], text: "—" }, { kind: "SLS" as const, factors: [0], text: "—" }];
  const res = combos.map((c) => combineResults(parts, c.factors, spans, inp.supports));
  const resultant = (l: UserLoad) => (l.type === "udl"
    ? ((l.q + (l.q2 ?? l.q)) / 2) * ((l.to ?? Ltot / 1000) - (l.from ?? 0)) : l.type === "point" ? l.P : 0);

  const mAbs = (b: BeamResult) => Math.max(Math.abs(b.Mmax), Math.abs(b.Mmin));
  const limitFor = (Lref: number) =>
    inp.deflectionLimit > 0 ? inp.deflectionLimit : inp.code === "DBN" ? deflectionLimitDSTU(Lref / 1000) : 250;
  const ratio = (b: BeamResult) => Math.max(...b.spanDeflections.map((d) => (Math.abs(d.w) * limitFor(d.Lref)) / d.Lref));

  const strength = combos.map((c, i) => (c.kind !== "SLS" ? i : -1)).filter((i) => i >= 0);
  const service = combos.map((c, i) => (c.kind === "SLS" ? i : -1)).filter((i) => i >= 0);
  const argmax = (idx: number[], f: (b: BeamResult) => number) => idx.reduce((a, i) => (f(res[i]) > f(res[a]) ? i : a), idx[0]);
  const gM = argmax(strength, mAbs);
  const gSag = argmax(strength, (b) => b.Mmax);
  const gHog = argmax(strength, (b) => -b.Mmin);
  const gV = argmax(strength, (b) => b.Vabs);
  const gW = service.length ? argmax(service, ratio) : gM;
  const sls = res[gW];
  const worst = sls.spanDeflections.reduce((a, b) =>
    Math.abs(b.w) * limitFor(b.Lref) / b.Lref > Math.abs(a.w) * limitFor(a.Lref) / a.Lref ? b : a);
  const VEd = res[gV].Vabs;

  const bounds = [0];
  for (const L of spans) bounds.push(bounds[bounds.length - 1] + L);
  const hasUdl = all.some((l) => l.type === "udl");
  const C2 = hasUdl ? 0.454 : 0.63;

  // Проверки для сочетания ci: ПФУ по пролету с наибольшим |M|, направление нагрузки — по знаку равнодействующей
  const memberFor = (ci: number) => {
    const uls = res[ci];
    let crit = 0, cm = -1;
    spans.forEach((_, i) => {
      let m = 0;
      uls.x.forEach((x, k) => { if (x >= bounds[i] && x <= bounds[i + 1]) m = Math.max(m, Math.abs(uls.M[k])); });
      if (m > cm) { cm = m; crit = i; }
    });
    const net = all.reduce((acc, l, i) => acc + combos[ci].factors[i] * resultant(l), 0);
    const uplift = net < 0;
    const isCant = inp.supports[crit] === "free" || inp.supports[crit + 1] === "free";
    const nRes = inp.ltb.restraints ?? 0;
    const LcrLT = inp.ltb.Lcr != null && inp.ltb.Lcr > 0
      ? inp.ltb.Lcr * 1000
      : isCant ? (inp.code === "DBN" ? spans[crit] : 2 * spans[crit]) : spans[crit] / (nRes + 1);
    const C1 = isCant ? 1 : c1FromDiagram(uls.x, uls.M, bounds[crit], bounds[crit + 1]);
    // при отрыве сжат нижний пояс, а нагрузка приложена к растянутому
    const loadAt = uplift ? (inp.ltb.loadAt === "top" ? "bottom" : inp.ltb.loadAt === "bottom" ? "top" : "center") : inp.ltb.loadAt;
    const psiCase: PsiCase = {
      cantilever: isCant,
      load: hasUdl ? "uniform" : "point",
      flange: isCant ? (loadAt === "bottom" ? "compressed" : "tension") : (loadAt === "bottom" ? "tension" : "compressed"),
      restraints: isCant ? 0 : nRes,
    };
    const memberInput = {
      code: inp.code, section, steel: inp.steel, gammaC: inp.gammaC, gammaN: inp.gammaN,
      MEd: mAbs(uls), VEd: ci === gM ? Math.max(uls.Vabs, VEd) : uls.Vabs, NEd: inp.axial ? inp.axial.NEd * 1000 : 0,
      ltb: { restrained: inp.ltb.restrained, Lcr: LcrLT, C1, C2, loadAt, dbn: psiCase },
      buckling: inp.axial ? { Lcr_y: inp.axial.Lcr_y * 1000, Lcr_z: inp.axial.Lcr_z * 1000 } : undefined,
      deflection: { w: worst.w, Lref: worst.Lref, limit: limitFor(worst.Lref) },
    };
    const member = inp.code === "EN" ? checkMemberEN(memberInput) : checkMemberDBN(memberInput);
    return { member, C1, LcrLT, uplift };
  };

  // Несколько кандидатов (max M, max пролетный, max опорный, max Q); по каждой проверке — худший
  const cand = [...new Set([gM, gSag, gHog, gV])];
  const runs = cand.map((ci) => ({ ci, ...memberFor(ci) }));
  const main = runs[0];
  const checks = main.member.checks.map((c) => {
    let best = c;
    for (const r of runs.slice(1)) {
      const o = r.member.checks.find((x) => x.key === c.key);
      if (o && o.util > best.util) best = o;
    }
    return best;
  });
  for (const r of runs.slice(1)) for (const c of r.member.checks) if (!checks.some((x) => x.key === c.key)) checks.push(c);
  const member: MemberResult = finalize(checks, main.member.values);

  const envelope = {
    x: res[0].x,
    Mmax: res[0].x.map((_, k) => Math.max(...strength.map((i) => res[i].M[k]))),
    Mmin: res[0].x.map((_, k) => Math.min(...strength.map((i) => res[i].M[k]))),
    Vmax: res[0].x.map((_, k) => Math.max(...strength.map((i) => res[i].V[k]))),
    Vmin: res[0].x.map((_, k) => Math.min(...strength.map((i) => res[i].V[k]))),
  };
  return {
    section, uls: res[gM], sls, member, C1: main.C1, C2, LcrLT: main.LcrLT, uplift: main.uplift,
    combos, govern: { M: gM, V: gV, w: gW }, envelope,
  };
}

export interface SelectionResult {
  best?: BeamDesignResult;
  tried: { name: string; mass: number; util: number }[];
}

/** Подбор: самый легкий профиль семейства, проходящий все проверки. */
export function selectBeam(inp: BeamDesignInput, family: string): SelectionResult {
  const tried: SelectionResult["tried"] = [];
  for (const s of familySections(family)) {
    const r = designBeam(inp, s);
    tried.push({ name: s.name, mass: s.mass, util: r.member.maxUtil });
    if (r.member.ok) return { best: r, tried };
  }
  return { tried };
}
