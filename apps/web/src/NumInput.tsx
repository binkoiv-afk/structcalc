// Числове поле для інженера: кома або крапка, вирази (6*1,2; (3+2)/2; 2^3), стрілки ↑↓ з кроком (Shift — ×10),
// без «стрибка в нуль» під час набору і без зміни значення коліщатком миші.
import { InputHTMLAttributes, KeyboardEvent, useState } from "react";

type Ev = { target: { value: string } };
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "type" | "value" | "step" | "min" | "max"> & {
  value?: number | string; onChange?: (e: Ev) => void; step?: number | string; min?: number | string; max?: number | string;
};

/** Обчислення простого арифметичного виразу без eval; NaN — вираз неповний або помилковий */
export function evalExpr(src: string): number {
  const s = src.replace(/\s+/g, "").replace(/,/g, ".").replace(/[×·]/g, "*").replace(/[÷:]/g, "/").replace(/−/g, "-");
  if (!s) return NaN;
  let i = 0;
  const peek = () => s[i];
  const num = (): number => {
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
    if (!m) return NaN;
    i += m[0].length;
    return Number(m[0]);
  };
  const atom = (): number => {
    if (peek() === "-") { i++; return -atom(); }
    if (peek() === "+") { i++; return atom(); }
    if (peek() === "(") { i++; const v = sum(); if (peek() !== ")") return NaN; i++; return v; }
    return num();
  };
  const pow = (): number => { const b = atom(); if (peek() === "^") { i++; return b ** pow(); } return b; };
  const prod = (): number => {
    let v = pow();
    while (peek() === "*" || peek() === "/") { const op = s[i++]; const r = pow(); v = op === "*" ? v * r : v / r; }
    return v;
  };
  const sum = (): number => {
    let v = prod();
    while (peek() === "+" || peek() === "-") { const op = s[i++]; const r = prod(); v = op === "+" ? v + r : v - r; }
    return v;
  };
  const v = sum();
  return i === s.length && Number.isFinite(v) ? v : NaN;
}

const fmt = (v: number | string | undefined) => (v === undefined || v === "" ? "" : typeof v === "number" ? (Number.isFinite(v) ? String(+v.toPrecision(12)) : "") : String(v));

export function NumInput({ value, onChange, step, min, max, className, onBlur, onKeyDown, ...rest }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? fmt(value);
  const isExpr = draft !== null && /[-+*/^()×÷:]/.test(draft.replace(/^\s*[-+]/, "").replace(/e[-+]/i, ""));
  const val = draft === null ? NaN : evalExpr(draft);
  const bad = draft !== null && draft.trim() !== "" && !Number.isFinite(val);
  const clamp = (v: number) => Math.min(max === undefined ? Infinity : Number(max), Math.max(min === undefined ? -Infinity : Number(min), v));
  const send = (v: string) => onChange?.({ target: { value: v } });
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e);
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const st = Number(step) > 0 ? Number(step) : 1, cur = evalExpr(shown);
      const n = clamp(+((Number.isFinite(cur) ? cur : 0) + (e.key === "ArrowUp" ? 1 : -1) * st * (e.shiftKey ? 10 : 1)).toPrecision(12));
      setDraft(String(n));
      send(String(n));
    } else if (e.key === "Enter") {
      if (Number.isFinite(val)) setDraft(fmt(val));
    } else if (e.key === "Escape") setDraft(null);
  };
  return (
    <input {...rest} type="text" inputMode="decimal" autoComplete="off" spellCheck={false} value={shown}
      className={[className, bad ? "num-bad" : "", isExpr && !bad ? "num-expr" : ""].filter(Boolean).join(" ") || undefined}
      title={isExpr && !bad ? `= ${fmt(val)}` : rest.title}
      data-result={isExpr && !bad ? `= ${fmt(val)}` : undefined}
      onChange={(e) => {
        const tx = e.target.value;
        setDraft(tx);
        if (tx.trim() === "") send("");
        else { const v = evalExpr(tx); if (Number.isFinite(v)) send(String(v)); }
      }}
      onBlur={(e) => { setDraft(null); onBlur?.(e); }}
      onKeyDown={key} />
  );
}
