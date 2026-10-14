import { pct, utilState } from "./Results";

export function TriedList({ tried, t }: { tried: { name: string; mass: number; util: number }[]; t: (k: string) => string }) {
  return (
    <details className="panel">
      <summary>{t("tried")} ({tried.length})</summary>
      <div className="tried">
        {tried.map((x) => (
          <div key={x.name} className={`tried-row ${utilState(x.util)}`}>
            <span>{x.name}</span><span>{x.mass.toFixed(1)} kg/m</span><span>{pct(x.util)}</span>
          </div>
        ))}
      </div>
    </details>
  );
}
