// Розріджена симетрична додатно визначена система в профільному (оболонковому) зберіганні за рядками:
// розклад Холецького L·Lᵀ і розв'язок для кількох правих частин. Нульовий або від'ємний ведучий елемент — механізм.

export class SkyMatrix {
  rows: Map<number, number>[];
  constructor(public n: number) { this.rows = Array.from({ length: n }, () => new Map()); }
  /** додати v до A[i][j] (і симетрично) — зберігається лише нижній трикутник */
  add(i: number, j: number, v: number) {
    if (!v) return;
    if (j > i) [i, j] = [j, i];
    const r = this.rows[i];
    r.set(j, (r.get(j) ?? 0) + v);
  }
}

export interface SkyFactor { first: Int32Array; L: Float64Array[] }

/** Розклад; null — механізм (ведучий елемент ≤ tol · початкове діагональне значення) */
export function skyFactor(A: SkyMatrix, tol = 1e-10): SkyFactor | null {
  const n = A.n, first = new Int32Array(n), L: Float64Array[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let fi = i;
    for (const j of A.rows[i].keys()) if (j < fi) fi = j;
    first[i] = fi;
    const row = new Float64Array(i - fi + 1);
    for (const [j, v] of A.rows[i]) row[j - fi] = v;
    const d0 = row[i - fi];
    for (let j = fi; j <= i; j++) {
      const fj = first[j], Lj = L[j] ?? row, k0 = Math.max(fi, fj);
      let s = row[j - fi];
      if (j < i) { for (let k = k0; k < j; k++) s -= row[k - fi] * Lj[k - fj]; row[j - fi] = s / Lj[j - fj]; }
      else {
        for (let k = fi; k < i; k++) s -= row[k - fi] * row[k - fi];
        if (!(s > tol * Math.abs(d0)) || !(d0 > 0)) return null;
        row[i - fi] = Math.sqrt(s);
      }
    }
    L[i] = row;
  }
  return { first, L };
}

export function skySolve(F: SkyFactor, b: ArrayLike<number>): Float64Array {
  const n = F.first.length, y = Float64Array.from(b);
  for (let i = 0; i < n; i++) {
    const fi = F.first[i], r = F.L[i];
    let s = y[i];
    for (let k = fi; k < i; k++) s -= r[k - fi] * y[k];
    y[i] = s / r[i - fi];
  }
  for (let i = n - 1; i >= 0; i--) {
    const fi = F.first[i], r = F.L[i];
    y[i] /= r[i - fi];
    const xi = y[i];
    for (let k = fi; k < i; k++) y[k] -= r[k - fi] * xi;
  }
  return y;
}

/** Зворотний алгоритм Катхілла–Макхі: порядок вузлів графа, що зменшує профіль */
export function rcmOrder(adj: Set<number>[]): number[] {
  const n = adj.length, seen = new Uint8Array(n), order: number[] = [];
  const deg = (v: number) => adj[v].size;
  const byDeg = [...Array(n).keys()].sort((a, b) => deg(a) - deg(b));
  for (const s of byDeg) {
    if (seen[s]) continue;
    seen[s] = 1;
    const q = [s];
    for (let h = 0; h < q.length; h++) {
      const nb = [...adj[q[h]]].filter((v) => !seen[v]).sort((a, b) => deg(a) - deg(b));
      for (const v of nb) { seen[v] = 1; q.push(v); }
    }
    order.push(...q);
  }
  return order.reverse();
}
