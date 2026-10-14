// Сочетания нагрузок.
// ДБН В.1.2-2, 4.18: Cm = Pd + (ψl1·Pl1 + ψl2·Pl2 + …) + (ψt1·Pt1 + ψt2·Pt2 + …),
//   ψl1 = 1, ψl2… = 0.95 (4.3); ψt1 = 1, ψt2 = 0.9, ψt3… = 0.7 (4.4); Cs = Cm + Ps (4.2).
// EN 1990: ULS (6.10) ΣγG·G + γQ·Q1 + ΣγQ·ψ0,i·Qi; SLS характеристическое G + Q1 + Σψ0,i·Qi;
//   аварийное (6.11b) G + Ad + ψ1,1·Q1 + Σψ2,i·Qi.

import type { CodeId } from "../codes/types";

/** вид нагрузки: постоянная, длительная, кратковременная, особая (аварийная) */
export type LoadCategory = "G" | "L" | "Q" | "A";

export interface CombLoad {
  cat: LoadCategory;
  label?: string;
  /** взаимоисключающие нагрузки имеют одинаковую группу (напр. ветер слева/справа, давление/отсос) */
  group?: string;
  gf?: number;
  gfe?: number;
  /** EN: ψ0 (по умолчанию 0.7) */
  psi0?: number;
}

export interface Combination {
  kind: "ULS" | "SLS" | "ACC";
  /** множитель к характеристическому значению каждой нагрузки (0 — не входит) */
  factors: number[];
  /** человекочитаемая запись */
  text: string;
}

export interface CombOptions {
  code: CodeId;
  gammaG: number;
  gammaQ: number;
  /** коэффициент для благоприятно действующих постоянных: ДБН 0.9, EN 1.0 */
  gammaGfav?: number;
  /** «степень влияния» каждой нагрузки (напр. max|M| от нее) — для назначения ψ1, ψ2, … по убыванию */
  influence?: number[];
}

const PSI_L = (i: number) => (i === 0 ? 1 : 0.95);
const PSI_T = (i: number) => (i === 0 ? 1 : i === 1 ? 0.9 : 0.7);

/** Действия: независимые переменные нагрузки; внутри одной группы — альтернативы (входит одна). */
function actions(loads: CombLoad[], cats: LoadCategory[]): number[][] {
  const groups = new Map<string, number[]>();
  loads.forEach((l, i) => {
    if (!cats.includes(l.cat)) return;
    const key = l.group?.trim() ? `${l.cat}:${l.group.trim()}` : `#${i}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });
  return [...groups.values()];
}

/** Все выборы: для каждого действия — «нет» или одна из альтернатив. */
function choices(acts: number[][]): number[][] {
  let out: number[][] = [[]];
  for (const alts of acts) {
    const next: number[][] = [];
    for (const c of out) {
      next.push(c);
      for (const a of alts) next.push([...c, a]);
    }
    out = next;
  }
  return out;
}

const fmtF = (f: number) => (Math.round(f * 1000) / 1000).toString();

export function buildCombinations(loads: CombLoad[], o: CombOptions): Combination[] {
  const n = loads.length;
  const G = loads.map((l, i) => (l.cat === "G" ? i : -1)).filter((i) => i >= 0);
  const name = (i: number) => loads[i].label ?? `${loads[i].cat}${i + 1}`;
  const gf = (i: number) => loads[i].gf ?? (loads[i].cat === "G" ? o.gammaG : o.gammaQ);
  const gFav = o.gammaGfav ?? (o.code === "DBN" ? 0.9 : 1.0);
  const out: Combination[] = [];
  const seen = new Set<string>();
  const push = (kind: Combination["kind"], f: number[]) => {
    const key = kind + f.map((x) => x.toFixed(4)).join(",");
    if (seen.has(key)) return;
    seen.add(key);
    const text = f.map((x, i) => (x ? `${fmtF(x)}·${name(i)}` : "")).filter(Boolean).join(" + ") || "—";
    out.push({ kind, factors: f, text });
  };

  const longActs = actions(loads, o.code === "DBN" ? ["L"] : []);
  const shortActs = actions(loads, o.code === "DBN" ? ["Q"] : ["L", "Q"]);
  const accLoads = loads.map((l, i) => (l.cat === "A" ? i : -1)).filter((i) => i >= 0);
  const infl = (i: number) => Math.abs(o.influence?.[i] ?? 0) * gf(i);
  const byInfluence = (c: number[]) => [...c].sort((a, b) => infl(b) - infl(a));

  for (const gMode of ["unfav", "fav"] as const) {
    const base = (sls: boolean) => {
      const f = new Array(n).fill(0);
      for (const i of G) f[i] = sls ? loads[i].gfe ?? 1 : gMode === "fav" ? gFav : gf(i);
      return f;
    };
    for (const lc of choices(longActs)) {
      for (const sc of choices(shortActs)) {
        // ψ1 — основной по степени влияния нагрузке, далее по убыванию (4.18)
        const L = byInfluence(lc), S = byInfluence(sc);
        {
          if (o.code === "DBN") {
            const fu = base(false), fs = base(true);
            L.forEach((i, k) => { fu[i] = PSI_L(k) * gf(i); fs[i] = PSI_L(k) * (loads[i].gfe ?? 1); });
            S.forEach((i, k) => { fu[i] = PSI_T(k) * gf(i); fs[i] = PSI_T(k) * (loads[i].gfe ?? 1); });
            push("ULS", fu);
            if (gMode === "unfav") push("SLS", fs);
            for (const a of accLoads) { const fa = [...fu]; fa[a] = loads[a].gf ?? 1; push("ACC", fa); }
          } else {
            const fu = base(false), fs = base(true);
            S.forEach((i, k) => {
              const psi = k === 0 ? 1 : loads[i].psi0 ?? 0.7;
              fu[i] = psi * gf(i); fs[i] = psi;
            });
            push("ULS", fu);
            if (gMode === "unfav") push("SLS", fs);
            for (const a of accLoads) {
              const fa = base(true);
              for (const i of G) fa[i] = 1;
              S.forEach((i, k) => { fa[i] = k === 0 ? 0.5 : 0.3; }); // ψ1,1 / ψ2 (кат. A по умолчанию)
              fa[a] = loads[a].gf ?? 1;
              push("ACC", fa);
            }
          }
        }
      }
    }
  }
  return out;
}
