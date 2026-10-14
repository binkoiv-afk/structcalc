// Эпюра: заливка, нулевая линия, отметки опор, экстремумы с подписями.
// invert — положительные значения рисуются вниз (моменты по растянутому волокну, прогибы).
export function Diagram({ x, y, title, unit, supportsX, invert = false }: {
  x: number[]; y: number[]; title: string; unit: string; supportsX: number[]; invert?: boolean;
}) {
  const W = 720, H = 150, pad = 48, top = 22, bottom = 22;
  const L = Math.max(...x) || 1;
  const ymax = Math.max(...y.map(Math.abs)) || 1;
  const mid = top + (H - top - bottom) / 2;
  const amp = (H - top - bottom) / 2;
  const sx = (v: number) => pad + ((W - 2 * pad) * v) / L;
  const sy = (v: number) => mid + ((invert ? 1 : -1) * amp * v) / ymax;
  const line = x.map((xi, i) => `${i ? "L" : "M"} ${sx(xi).toFixed(1)} ${sy(y[i]).toFixed(1)}`).join(" ");
  const area = `M ${sx(x[0])} ${mid} ` + x.map((xi, i) => `L ${sx(xi).toFixed(1)} ${sy(y[i]).toFixed(1)}`).join(" ") + ` L ${sx(x[x.length - 1])} ${mid} Z`;

  let iMax = 0, iMin = 0;
  y.forEach((v, i) => { if (v > y[iMax]) iMax = i; if (v < y[iMin]) iMin = i; });
  const marks = [iMax, iMin].filter((i, k, a) => a.indexOf(i) === k && Math.abs(y[i]) > ymax * 1e-6);

  return (
    <figure className="diagram">
      <figcaption><span>{title}</span><span className="unit">{unit}</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {supportsX.map((sxv, i) => <line key={i} x1={sx(sxv)} y1={top - 8} x2={sx(sxv)} y2={H - bottom + 8} className="d-grid" />)}
        <path d={area} className="d-area" />
        <path d={line} className="d-line" />
        <line x1={sx(0)} y1={mid} x2={sx(L)} y2={mid} className="d-axis" />
        {marks.map((i) => {
          const px = sx(x[i]), py = sy(y[i]);
          const below = py > mid;
          const anchor = px < pad + 30 ? "start" : px > W - pad - 30 ? "end" : "middle";
          return (
            <g key={i}>
              <circle cx={px} cy={py} r={3} className="d-dot" />
              <text x={px} y={below ? py + 15 : py - 7} textAnchor={anchor} className="d-label">{y[i].toFixed(2)}</text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
