// Пакет вузла («пиріг»): шари між опорною плитою і основою та сумісність різнорідних матеріалів.
// Метали деталей (профіль, плита, анкери, металеві прокладки) перевіряються на контактну (гальванічну) корозію
// і зварюваність; неметалеві шари — на зминання і на те, як вони змінюють роботу анкерів (плече зсуву, тертя).
// Джерела: EN 1999-1-1, додаток D (контакт алюмінію з іншими матеріалами); EN ISO 9223 (категорії середовища);
// EN 1992-4, 6.2.2.3 (зсув з плечем); EN 1993-1-8, 6.2.2(6) і 6.2.5(7) (тертя, підливка).

/** Метал деталі: чорна сталь (з фарбуванням), оцинкована, нержавійна, алюміній */
export type Metal = "carbon" | "galv" | "stainless" | "aluminium";
/** Середовище: сухе опалюване приміщення (C1–C2), зовні / неопалюване (C3), агресивне — море, хімія (C4–C5) */
export type Exposure = "dry" | "outdoor" | "aggressive";

export type LayerGroup = "metal" | "grout" | "elastomer" | "plastic" | "timber" | "insulation";

export interface LayerMaterial {
  id: string;
  group: LayerGroup;
  /** метал шару (для group = metal) */
  metal?: Metal;
  /** розрахунковий опір зминанню, МПа (орієнтовно; задається користувачем за даними виробника) */
  fd: number;
  /** чи є шар жорстким (не дає плиті «плавати»): метали, підливка, розчин */
  rigid: boolean;
  /** лужний (свіжий бетон, розчин, підливка) — важливо для алюмінію */
  alkaline?: boolean;
  /** електроізолятор — розриває гальванічний контакт */
  insulator?: boolean;
  /** звідки взято fd */
  ref: string;
}

export const LAYER_MATERIALS: LayerMaterial[] = [
  { id: "grout", group: "grout", fd: 40 / 1.5, rigid: true, alkaline: true, ref: "безусадкова підливка f_ck ≥ 40 МПа: f_d = f_ck/1.5" },
  { id: "mortar", group: "grout", fd: 10 / 1.5, rigid: true, alkaline: true, ref: "цементно-піщаний розчин М100: f_d ≈ 10/1.5" },
  { id: "steelShim", group: "metal", metal: "carbon", fd: Infinity, rigid: true, ref: "сталь" },
  { id: "galvShim", group: "metal", metal: "galv", fd: Infinity, rigid: true, ref: "сталь оцинкована" },
  { id: "stainlessShim", group: "metal", metal: "stainless", fd: Infinity, rigid: true, ref: "нержавійна сталь" },
  { id: "aluShim", group: "metal", metal: "aluminium", fd: Infinity, rigid: true, ref: "алюміній" },
  { id: "paronite", group: "plastic", fd: 25, rigid: false, insulator: true, ref: "пароніт ПОН: орієнтовно 25 МПа" },
  { id: "thermalPad", group: "plastic", fd: 20, rigid: false, insulator: true, ref: "термопрокладка (поліамід / склопластик): орієнтовно 20 МПа, за даними виробника" },
  { id: "pvc", group: "plastic", fd: 8, rigid: false, insulator: true, ref: "ПВХ: орієнтовно 8 МПа" },
  { id: "epdm", group: "elastomer", fd: 3, rigid: false, insulator: true, ref: "EPDM 60–70 Shore A: орієнтовно 3 МПа" },
  { id: "neoprene", group: "elastomer", fd: 7, rigid: false, insulator: true, ref: "хлоропренова (неопренова) опорна прокладка: орієнтовно 7 МПа" },
  { id: "timber", group: "timber", fd: (0.8 * 2.5) / 1.3, rigid: false, insulator: true, ref: "сосна C24 поперек волокон: k_mod·f_c,90,k/γ_M = 0.8·2.5/1.3" },
  { id: "xps", group: "insulation", fd: 0.3 / 1.5, rigid: false, insulator: true, ref: "XPS 300 кПа: 0.3/1.5" },
  { id: "mineralWool", group: "insulation", fd: 0.04, rigid: false, insulator: true, ref: "мінеральна вата 40 кПа — не несучий шар" },
];

export interface StackLayer {
  mat: string;
  t: number;
  /** свій розрахунковий опір зминанню, МПа (замість типового) */
  fd?: number;
  /** розміри прокладки в плані, мм (якщо менша за плиту) */
  L?: number; B?: number;
}

export function layerMat(id: string): LayerMaterial {
  const m = LAYER_MATERIALS.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown layer material ${id}`);
  return m;
}

/** Що пакет змінює в роботі вузла */
export function stackEffect(stack: StackLayer[], d: number) {
  const mats = stack.map((l) => ({ ...l, m: layerMat(l.mat) }));
  const soft = mats.filter((l) => !l.m.rigid);
  const tSoft = soft.reduce((a, l) => a + l.t, 0);
  const tGrout = mats.filter((l) => l.m.group === "grout").reduce((a, l) => a + l.t, 0);
  const tAll = mats.reduce((a, l) => a + l.t, 0);
  // з піддатливим шаром плита не затиснута: анкер працює на зсув з плечем через увесь неметалевий пакет, α_M = 1;
  // без нього — правило підливки: плече, якщо підливка товща за d/2 (EN 1992-4, 6.2.2.3), α_M = 2
  const tNonMetal = mats.filter((l) => l.m.group !== "metal").reduce((a, l) => a + l.t, 0);
  const standoff = tSoft > 0 ? tNonMetal : tGrout > d / 2 ? tGrout : 0;
  const alphaM = tSoft > 0 ? 1 : 2;
  // тертя: лише по жорсткому контакту (сталь — бетон / підливка / сталь)
  const frictionOk = tSoft === 0;
  return { tSoft, tGrout, tAll, standoff, alphaM, frictionOk, layers: mats };
}

/** Порядок «благородності» в гальванічному ряду (морська вода, В відн. н.к.е.):
 *  цинк −1.03, алюміній −0.80, сталь −0.61, нержавійна (пасивна) −0.08 */
export const METAL_POTENTIAL: Record<Metal, number> = { galv: -1.03, aluminium: -0.8, carbon: -0.61, stainless: -0.08 };

/** Ризик контактної корозії пари металів: 0 — без заходів, 1 — потрібна ізоляція / захист, 2 — недопустимо без ізоляції.
 *  Індекси — сухе / зовні / агресивне середовище (за EN 1999-1-1, табл. D.2–D.3, і практикою для сталей). */
const PAIR: Record<string, [number, number, number]> = {
  "carbon|galv": [0, 0, 1],
  "carbon|stainless": [0, 1, 2],
  "aluminium|carbon": [0, 1, 2],
  "galv|stainless": [0, 1, 2],
  "aluminium|galv": [0, 0, 1],
  "aluminium|stainless": [0, 1, 2],
};
const EXP = { dry: 0, outdoor: 1, aggressive: 2 } as const;

export function pairRisk(a: Metal, b: Metal, env: Exposure): number {
  if (a === b) return 0;
  return PAIR[[a, b].sort().join("|")]?.[EXP[env]] ?? 0;
}

export interface CompatNote {
  level: "bad" | "warn" | "info";
  key: string;
  /** назви учасників (ключі i18n: part_*, metal_*, lay_*) */
  a?: string; b?: string;
  v?: string;
}

export interface CompatInput {
  env: Exposure;
  profile: Metal;
  plate: Metal;
  anchors: Metal;
  /** ізолюючі втулки і шайби на анкерах */
  anchorsIsolated?: boolean;
  /** профіль приварено до плити (інакше — болти) */
  welded: boolean;
  stack: StackLayer[];
  /** основа: бетон / цегла (лужна) */
  base: "concrete";
}

/** Сумісність матеріалів вузла: зварюваність, контактна корозія, лужне середовище, піддатливі шари */
export function jointCompat(i: CompatInput): CompatNote[] {
  const out: CompatNote[] = [];
  const m = (x: Metal) => `metal_${x}`;
  // 1. профіль — плита
  if (i.welded && i.profile !== i.plate) {
    const pair = [i.profile, i.plate];
    if (pair.includes("aluminium")) out.push({ level: "bad", key: "weldAlSteel", a: m(i.profile), b: m(i.plate) });
    else if (pair.includes("stainless")) out.push({ level: "warn", key: "weldDissimilar", a: m(i.profile), b: m(i.plate) });
  }
  if (i.welded && (i.profile === "galv" || i.plate === "galv")) out.push({ level: "warn", key: "weldGalv" });
  if (i.welded && i.profile === "aluminium" && i.plate === "aluminium") out.push({ level: "info", key: "weldAlHaz" });
  const contact = (a: Metal, b: Metal, an: string, bn: string, small?: "a" | "b") => {
    let r = pairRisk(a, b, i.env);
    if (r === 0 && a !== b && i.env !== "dry") return;
    if (small && r > 0) {
      // малий анод (кріплення менш благородне) — небезпечно; малий катод — допустимо
      const sa = small === "a" ? a : b, big = small === "a" ? b : a;
      r = METAL_POTENTIAL[sa] < METAL_POTENTIAL[big] ? Math.min(2, r + 1) : r - 1;
    }
    if (r >= 2) out.push({ level: "bad", key: "galvanic", a: an, b: bn });
    else if (r === 1) out.push({ level: "warn", key: "galvanic", a: an, b: bn });
  };
  if (i.profile !== i.plate) contact(i.profile, i.plate, "part_profile", "part_plate");
  // 2. плита — шари — основа, зверху вниз
  type Node = { name: string; metal?: Metal; alkaline?: boolean; insulator?: boolean; group?: string };
  const seq: Node[] = [{ name: "part_plate", metal: i.plate }];
  i.stack.forEach((l, k) => {
    const lm = layerMat(l.mat);
    seq.push({ name: `lay_${l.mat}#${k + 1}`, metal: lm.metal, alkaline: lm.alkaline, insulator: lm.insulator, group: lm.group });
  });
  seq.push({ name: "part_concrete", alkaline: true });
  for (let k = 0; k + 1 < seq.length; k++) {
    const a = seq[k], b = seq[k + 1];
    if (a.metal && b.metal) contact(a.metal, b.metal, a.name, b.name);
    const al = a.metal === "aluminium" ? a : b.metal === "aluminium" ? b : null, other = al === a ? b : a;
    if (al && other.alkaline) out.push({ level: i.env === "dry" ? "info" : "warn", key: "alAlkaline", a: al.name, b: other.name });
    if (al && other.group === "timber" && i.env !== "dry") out.push({ level: "warn", key: "alTimber", a: al.name, b: other.name });
  }
  // ізолюючий шар між двома металами, що інакше конфліктували б
  for (let k = 1; k + 1 < seq.length; k++) {
    if (!seq[k].insulator) continue;
    const up = seq.slice(0, k).reverse().find((x) => x.metal), dn = seq.slice(k + 1).find((x) => x.metal);
    if (up?.metal && dn?.metal && pairRisk(up.metal, dn.metal, i.env) > 0) out.push({ level: "info", key: "isolates", a: seq[k].name, b: `${up.name}|${dn.name}` });
  }
  // 3. анкери проходять крізь плиту і всі металеві шари
  const metals = seq.filter((x) => x.metal);
  if (i.anchorsIsolated) {
    if (metals.some((x) => pairRisk(i.anchors, x.metal!, i.env) > 0)) out.push({ level: "info", key: "anchorsIsolated" });
  } else for (const x of metals) contact(i.anchors, x.metal!, "part_anchors", x.name, "a");
  // 4. піддатливі і не несучі шари
  const soft = i.stack.filter((l) => !layerMat(l.mat).rigid);
  if (soft.length) {
    out.push({ level: "info", key: "softStandoff" });
    out.push({ level: "info", key: "softPreload" });
  }
  i.stack.forEach((l, k) => { if (layerMat(l.mat).group === "insulation") out.push({ level: "bad", key: "insulationBearing", a: `lay_${l.mat}#${k + 1}` }); });
  // 5. корозія самого металу в середовищі
  const all: [Metal, string][] = [[i.profile, "part_profile"], [i.plate, "part_plate"], [i.anchors, "part_anchors"]];
  const bare = all.filter(([mt]) => mt === "carbon").map(([, nm]) => nm);
  if (bare.length && i.env !== "dry") out.push({ level: "info", key: "carbonCoating", a: bare.join(",") });
  // однакові повідомлення — один раз
  const seen = new Set<string>();
  return out.filter((n) => { const id = `${n.level}|${n.key}|${n.a}|${n.b}`; if (seen.has(id)) return false; seen.add(id); return true; });
}
