// «Мої розрахунки»: збережені розрахунки в браузері і обмін файлами *.structcalc.json
import type { CodeId } from "@structcalc/core";
import type { Screen } from "./Home";

export interface SavedCalc { id: string; name: string; screen: Screen; code: CodeId; date: number; data: Record<string, unknown> }
export interface CalcFile { format: "structcalc"; version: 1; items: SavedCalc[]; lib?: { materials?: unknown[]; sections?: unknown[] } }

const PKEY = "structcalc.projects";

export function loadSaved(): SavedCalc[] {
  try { const a = JSON.parse(localStorage.getItem(PKEY) ?? "[]"); return Array.isArray(a) ? a : []; } catch { return []; }
}
export function storeSaved(list: SavedCalc[]): boolean {
  try { localStorage.setItem(PKEY, JSON.stringify(list)); return true; } catch { return false; }
}
export const newId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// латиниця в імені файлу: не всі браузери зберігають кириличну назву (тоді файл стає «download» без розширення)
const TR: Record<string, string> = { а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ё: "e", ж: "zh", з: "z", и: "y", і: "i", ї: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "iu", я: "ia", "'": "", "’": "" };
const latin = (s: string) => [...s].map((c) => { const l = c.toLowerCase(), r = TR[l]; return r === undefined ? c : c === l ? r : r.charAt(0).toUpperCase() + r.slice(1); }).join("").replace(/[^\x20-\x7e]+/g, "-");
const safeName = (s: string) => latin(s).replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "structcalc";

export function downloadFile(items: SavedCalc[], lib: CalcFile["lib"]) {
  const f: CalcFile = { format: "structcalc", version: 1, items, lib };
  const blob = new Blob([JSON.stringify(f, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${safeName(items.length === 1 ? items[0].name : "structcalc")}.structcalc.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Розбір файлу; null — не файл StructCalc */
export function parseFile(text: string): CalcFile | null {
  try {
    const o = JSON.parse(text);
    if (o?.format !== "structcalc" || !Array.isArray(o.items)) return null;
    const items = (o.items as SavedCalc[]).filter((x) => x && typeof x.screen === "string" && x.data && typeof x.data === "object")
      .map((x) => ({ ...x, id: newId(), name: String(x.name ?? "—"), date: Number(x.date) || Date.now() }));
    return { format: "structcalc", version: 1, items, lib: o.lib };
  } catch { return null; }
}
