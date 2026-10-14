import type { CodeId, Section } from "@structcalc/core";

/** Чертеж сечения по его контурам (центр тяжести в начале координат) с осями и габаритами. */
export function SectionDrawing({ s, code, size = 200 }: { s: Section; code: CodeId; size?: number }) {
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const l of s.loops) for (const p of l) {
    xmin = Math.min(xmin, p.x); xmax = Math.max(xmax, p.x); ymin = Math.min(ymin, p.y); ymax = Math.max(ymax, p.y);
  }
  const pad = 34;
  const k = (size - 2 * pad) / Math.max(xmax - xmin, ymax - ymin);
  const X = (x: number) => size / 2 + x * k - ((xmax + xmin) / 2) * k;
  const Y = (y: number) => size / 2 - y * k + ((ymax + ymin) / 2) * k;
  const d = s.loops.map((l) => "M" + l.map((p) => `${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(" L") + " Z").join(" ");
  const ax = code === "DBN" ? ["x", "y"] : ["y", "z"];
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="section-drawing" role="img" aria-label={s.name}>
      <line x1={8} x2={size - 8} y1={Y(0)} y2={Y(0)} className="sd-axis" />
      <line y1={8} y2={size - 8} x1={X(0)} x2={X(0)} className="sd-axis" />
      <text x={size - 10} y={Y(0) - 4} className="sd-lbl" textAnchor="end">{ax[0]}</text>
      <text x={X(0) + 4} y={14} className="sd-lbl">{ax[1]}</text>
      <path d={d} className="sd-shape" fillRule="evenodd" />
      <text x={X(xmin) - 6} y={(Y(ymax) + Y(0)) / 2} className="sd-dim" textAnchor="end">{s.h.toFixed(0)}</text>
      <text x={(X(xmin) + X(xmax)) / 2} y={Y(ymin) + 16} className="sd-dim" textAnchor="middle">{s.b.toFixed(0)}</text>
    </svg>
  );
}
