import type { SupportType, UserLoad } from "@structcalc/core";

// Расчетная схема: балка, опоры, нагрузки, размеры пролетов.
export function Scheme({ spans, supports, loads, t }: { spans: number[]; supports: SupportType[]; loads: UserLoad[]; t: (k: string) => string }) {
  const W = 720, pad = 48;
  const L = spans.reduce((a, b) => a + b, 0) || 1;
  const sx = (x: number) => pad + ((W - 2 * pad) * x) / L;
  const xs = [0];
  spans.forEach((s) => xs.push(xs[xs.length - 1] + s));

  const udls = loads.filter((l): l is Extract<UserLoad, { type: "udl" }> => l.type === "udl");
  const qAbs = (l: Extract<UserLoad, { type: "udl" }>) => Math.max(Math.abs(l.q), Math.abs(l.q2 ?? l.q));
  const qmax = Math.max(1e-9, ...udls.map(qAbs));
  const fmt = (v: number) => (Math.round(v * 100) / 100).toString();
  // Распределенные нагрузки рисуются стопкой: каждая следующая — над предыдущей с подписью.
  const bandH = udls.map((l) => 12 + 24 * (qAbs(l) / qmax));
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
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="s-load-fill" />
        </marker>
      </defs>

      {udls.map((l, i) => {
        const a = sx(l.from ?? 0), b = sx(l.to ?? L);
        const top = tops[i];
        const n = Math.max(2, Math.round((b - a) / 28));
        return (
          <g key={`u${i}`} className={l.cat === "G" ? "s-load g" : "s-load q"}>
            {(() => {
              // трапеция: высота стрелок пропорциональна интенсивности в точке
              const q1 = l.q, q2 = l.q2 ?? l.q, qm = Math.max(1e-9, Math.abs(q1), Math.abs(q2));
              const h = (x: number) => Math.max(4, bandH[i] * Math.abs(q1 + ((q2 - q1) * (x - a)) / Math.max(b - a, 1e-9)) / qm);
              const bot = top + bandH[i];
              const up = q1 + q2 < 0;
              return (
                <>
                  <path d={`M ${a} ${bot} L ${a} ${bot - h(a)} L ${b} ${bot - h(b)} L ${b} ${bot} Z`} className="s-udl" />
                  {Array.from({ length: n + 1 }, (_, k) => {
                    const x = a + ((b - a) * k) / n;
                    return up
                      ? <line key={k} x1={x} y1={bot} x2={x} y2={bot - h(x) + 2} markerEnd="url(#arr)" />
                      : <line key={k} x1={x} y1={bot - h(x)} x2={x} y2={bot - 2} markerEnd="url(#arr)" />;
                  })}
                  <text x={(a + b) / 2} y={top - 5} textAnchor="middle" className="s-text">
                    {l.label ? `${l.label}: ` : ""}{l.cat === "G" ? "g" : "q"} = {l.q2 != null && l.q2 !== l.q ? `${fmt(q1)}…${fmt(q2)}` : fmt(q1)} kN/m
                  </text>
                </>
              );
            })()}
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
        if (s === "slide") {
          // скользящая заделка: поворот запрещен, вертикальное перемещение свободно
          const dir = i === 0 ? -1 : 1;
          return (
            <g key={`s${i}`} className="s-support">
              <line x1={x} y1={beamY - 16} x2={x} y2={beamY + 16} strokeWidth={2.5} />
              <circle cx={x + dir * 5} cy={beamY - 9} r={3.5} fill="none" />
              <circle cx={x + dir * 5} cy={beamY + 9} r={3.5} fill="none" />
              <line x1={x + dir * 10} y1={beamY - 20} x2={x + dir * 10} y2={beamY + 20} />
            </g>
          );
        }
        if (s === "spring") {
          const z = Array.from({ length: 7 }, (_, k) => `${x + (k % 2 ? 7 : -7)} ${beamY + 6 + k * 3}`).join(" L ");
          return (
            <g key={`s${i}`} className="s-support">
              <path d={`M ${x} ${beamY + 2} L ${x} ${beamY + 5} L ${z} L ${x} ${beamY + 28}`} fill="none" />
              <line x1={x - 12} y1={beamY + 30} x2={x + 12} y2={beamY + 30} />
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
