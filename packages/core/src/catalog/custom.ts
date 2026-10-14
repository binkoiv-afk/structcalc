// Користувацькі матеріали і перерізи: зберігаються в застосунку, тут лише реєструються в каталогах.

import { chsSection, iSection, rhsSection, Section } from "../geometry/sections";
import type { CodeId } from "../codes/types";
import { STEELS, SteelGrade } from "./materials";
import { FAMILIES, resetFamilyCache } from "./profiles";

export interface CustomMaterialDef {
  id: string;
  /** модуль пружності, МПа */
  E: number;
  /** модуль зсуву, МПа (за замовчуванням E / 2.6) */
  G?: number;
  /** характеристичний опір за границею текучості Ryn / fy, МПа */
  fy: number;
  /** тимчасовий опір Run / fu, МПа */
  fu: number;
  /** ДБН: коефіцієнт надійності за матеріалом γm (Ry = Ryn/γm) */
  gammaM: number;
  /** густина, кг/м³ */
  rho?: number;
}

export function customSteel(d: CustomMaterialDef, code: CodeId): SteelGrade {
  const gm = code === "DBN" ? d.gammaM || 1 : 1;
  return {
    id: d.id, code, E: d.E, G: d.G || d.E / 2.6, gammaM: gm, custom: true, density: d.rho || 7850,
    source: "користувацький матеріал",
    yieldChar: () => d.fy, strength: () => d.fy / gm, ultimate: () => d.fu,
  };
}

/** Замінює набір користувацьких матеріалів у каталозі (для обох норм). */
export function setCustomMaterials(defs: CustomMaterialDef[]) {
  for (let i = STEELS.length - 1; i >= 0; i--) if (STEELS[i].custom) STEELS.splice(i, 1);
  for (const d of defs) if (d.id.trim()) { STEELS.push(customSteel(d, "DBN")); STEELS.push(customSteel(d, "EN")); }
}

export function steelsFor(code: CodeId): SteelGrade[] {
  return STEELS.filter((x) => x.code === code);
}

export type CustomSectionType = "weldedI" | "rolledI" | "rhs" | "chs";
export interface CustomSectionDef {
  name: string;
  type: CustomSectionType;
  h: number; b: number; tw: number; tf: number; r?: number; t?: number; d?: number;
  /** RHS/CHS: гарячекатаний (інакше гнутий) */
  hot?: boolean;
}

export const CUSTOM_FAMILY = "CUSTOM";

export function buildCustomSection(d: CustomSectionDef): Section {
  const opts = { family: CUSTOM_FAMILY };
  switch (d.type) {
    case "weldedI": return iSection(d.name, d.h, d.b, d.tw, d.tf, 0, { ...opts, fabrication: "welded" });
    case "rolledI": return iSection(d.name, d.h, d.b, d.tw, d.tf, d.r ?? 0, { ...opts, fabrication: "hot" });
    case "rhs": return rhsSection(d.name, d.h, d.b, d.t ?? 4, { ...opts, fabrication: d.hot ? "hot" : "cold" });
    case "chs": return chsSection(d.name, d.d ?? d.h, d.t ?? 4, { ...opts, fabrication: d.hot ? "hot" : "cold" });
  }
}

let customSections: CustomSectionDef[] = [];
export function setCustomSections(defs: CustomSectionDef[]) {
  customSections = defs.filter((d) => d.name.trim());
  const i = FAMILIES.findIndex((f) => f.id === CUSTOM_FAMILY);
  if (i >= 0) FAMILIES.splice(i, 1);
  if (customSections.length) {
    FAMILIES.push({ id: CUSTOM_FAMILY, standard: "—", build: () => customSections.map((d) => buildCustomSection(d)) });
  }
  resetFamilyCache(CUSTOM_FAMILY);
}
