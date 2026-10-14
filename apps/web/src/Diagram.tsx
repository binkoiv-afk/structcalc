// Эпюра в SVG. invert — положительные значения рисуются вниз (моменты, прогибы).
export function Diagram({ x, y, title, invert = false }: { x: number[]; y: number[]; title: string; invert?: boolean }) {
  const W = 640, H = 140, pad = 28;
  const L = Math.max(...x) || 1;
  const ymax = Math.max(...y.map(Math.abs)) || 1;
  const sx = (v: number) => pad + ((W - 2 * pad) * v) / L;
  const sy = (v: number) => H / 2 + ((invert ? 1 : -1) * (H / 2 - 18) * v) / ymax;
  const path = `M ${sx(x[0])} ${H / 2} ` + x.map((xi, i) => `L ${sx(xi)} ${sy(y[i])}`).join(" ") + ` L ${sx(x[x.length - 1])} ${H / 2} Z`;
  let iMax = 0, iMin = 0;
  y.forEach((v, i) => { if (v > y[iMax]) iMax = i; if (v < y[iMin]) iMin = i; });
  const label = (i: number) => (
    <text x={sx(x[i])} y={sy(y[i]) + (invert === y[i] > 0 ? 12 : -4)} textAnchor="middle" className="dlabel">{y[i].toFixed(2)}</text>
  );
  return (
    <figure className="diagram">
      <figcaption>{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxHeight: 160 }}>
        <path d={path} className="dfill" />
        <line x1={sx(0)} y1={H / 2} x2={sx(L)} y2={H / 2} className="daxis" />
        {Math.abs(y[iMax]) > 1e-9 && label(iMax)}
        {iMin !== iMax && Math.abs(y[iMin]) > 1e-9 && label(iMin)}
      </svg>
    </figure>
  );
}
