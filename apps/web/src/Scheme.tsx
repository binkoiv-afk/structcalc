import type { SupportType, UserLoad } from "@structcalc/core";

// Расчетная схема: балка, опоры, нагрузки, размеры пролетов.
export function Scheme({ spans, supports, loads, t }: { spans: number[]; supports: SupportType[]; loads: UserLoad[]; t: (k: string) => string }) {
  const W = 720, pad = 48;
  const L = spans.reduce((a, b) => a + b, 0) || 1;
  const sx = (x: number) => pad + ((W - 2 * pad) * x) / L;
  const xs = [0];
  spans.forEach((s) => xs.push(xs[xs.length - 1] + s));

  const udls = loads.filter((l): l is Extract<UserLoad, { type: "udl" }> => l.type === "udl");
  const qmax = Math.max(1e-9, ...udls.map((l) => Math.abs(l.q)));
  const fmt = (v: number) => (Math.round(v * 100) / 100).toString();
  // Распределенные нагрузки рисуются стопкой: каждая следующая — над предыдущей с подписью.
  const bandH = udls.map((l) => 12 + 24 * (Math.abs(l.q) / qmax));
  const stackH = bandH.reduce((a, h) => a + h + 18, 0);
  const hasPoint = loads.some((l) => l.type === "point");
  const beamY = Math.max(stackH, hasPoint ? 76 : 30) + 16;
  const H = beamY + 64;
  const tops: number[] = [];
  let base = beamY - 6;
  bandH.forEach((h) => { tops.push(base - h); base = base - h - 18; });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="scheme" role="img" aria-label={t("scheme")}>
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="5" refY="9" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L5,10 L10,0 z" className="s-load-fill" />
        </marker>
      </defs>

      {udls.map((l, i) => {
        const a = sx(l.from ?? 0), b = sx(l.to ?? L);
        const top = tops[i];
        const n = Math.max(2, Math.round((b - a) / 28));
        return (
          <g key={`u${i}`} className={l.cat === "G" ? "s-load g" : "s-load q"}>
            <rect x={a} y={top} width={b - a} height={bandH[i]} className="s-udl" />
            {Array.from({ length: n + 1 }, (_, k) => {
              const x = a + ((b - a) * k) / n;
              return <line key={k} x1={x} y1={top} x2={x} y2={top + bandH[i] - 2} markerEnd="url(#arr)" />;
            })}
            <text x={(a + b) / 2} y={top - 5} textAnchor="middle" className="s-text">
              {l.cat === "G" ? "g" : "q"} = {fmt(l.q)} kN/m
            </text>
          </g>
        );
      })}

      {loads.map((l, i) => {
        if (l.type === "point") {
          const x = sx(l.x);
          return (
            <g key={`p${i}`} className={l.cat === "G" ? "s-load g" : "s-load q"}>
              <line x1={x} y1={beamY - 64} x2={x} y2={beamY - 8} strokeWidth={2} markerEnd="url(#arr)" />
              <text x={x + 6} y={beamY - 56} className="s-text">P = {fmt(l.P)} kN</text>
            </g>
          );
        }
        if (l.type === "moment") {
          const x = sx(l.x);
          return (
            <g key={`m${i}`} className="s-load q">
              <path d={`M ${x - 14} ${beamY + 8} A 16 16 0 1 1 ${x + 14} ${beamY + 8}`} fill="none" markerEnd="url(#arr)" />
              <text x={x + 18} y={beamY - 14} className="s-text">M = {fmt(l.M)} kN·m</text>
            </g>
          );
        }
        return null;
      })}

      <line x1={sx(0)} y1={beamY} x2={sx(L)} y2={beamY} className="s-beam" />

      {supports.map((s, i) => {
        const x = sx(xs[i]);
        if (s === "pin") {
          return (
            <g key={`s${i}`} className="s-support">
              <path d={`M ${x} ${beamY + 2} L ${x - 10} ${beamY + 18} L ${x + 10} ${beamY + 18} Z`} />
              <line x1={x - 14} y1={beamY + 21} x2={x + 14} y2={beamY + 21} />
            </g>
          );
        }
        if (s === "fixed") {
          const dir = i === 0 ? -1 : 1;
          return (
            <g key={`s${i}`} className="s-support">
              <line x1={x} y1={beamY - 18} x2={x} y2={beamY + 18} strokeWidth={2.5} />
              {Array.from({ length: 6 }, (_, k) => (
                <line key={k} x1={x} y1={beamY - 16 + k * 7} x2={x + dir * 8} y2={beamY - 22 + k * 7} />
              ))}
            </g>
          );
        }
        return null;
      })}

      {spans.map((s, i) => {
        const a = sx(xs[i]), b = sx(xs[i + 1]), y = beamY + 44;
        return (
          <g key={`d${i}`} className="s-dim">
            <line x1={a} y1={y - 6} x2={a} y2={y + 6} />
            <line x1={b} y1={y - 6} x2={b} y2={y + 6} />
            <line x1={a} y1={y} x2={b} y2={y} />
            <text x={(a + b) / 2} y={y - 5} textAnchor="middle" className="s-text">{fmt(s * 1000)} mm</text>
          </g>
        );
      })}
    </svg>
  );
}
