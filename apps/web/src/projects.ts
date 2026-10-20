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

type Saver = { save: (r: { filename: string; data: string }) => Promise<unknown> } | null;
/** Опубліковану сторінку claude.ai браузер не пускає до завантажень — там файл віддається через її можливість «downloads» */
let saver: Promise<Saver> | null = null;
const getSaver = () => {
  const c = (window as unknown as { claude?: { use?: (n: string) => Promise<Saver> } }).claude;
  if (!c?.use) return Promise.resolve(null);
  return (saver ??= c.use("downloads").catch(() => null));
};

/** "ok" — збережено, "declined" — користувач відмовився, "fail" — не вдалося */
export async function downloadFile(items: SavedCalc[], lib: CalcFile["lib"]): Promise<"ok" | "declined" | "fail"> {
  const f: CalcFile = { format: "structcalc", version: 1, items, lib };
  const text = JSON.stringify(f, null, 1);
  const filename = `${safeName(items.length === 1 ? items[0].name : "structcalc")}.structcalc.json`;
  const sv = await getSaver();
  if (sv) {
    try { await sv.save({ filename, data: text }); return "ok"; }
    catch (e) { return (e as { code?: string })?.code === "declined" ? "declined" : "fail"; }
  }
  try {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return "ok";
  } catch { return "fail"; }
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
