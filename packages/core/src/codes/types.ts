import type { Section } from "../geometry/sections";

export type CodeId = "DBN" | "EN";

/** Одна проверка нормы — она же строка отчета. */
export interface Check {
  /** ключ перевода названия проверки */
  key: string;
  /** ссылка на пункт/формулу норм */
  clause: string;
  /** формула в общем виде */
  formula: string;
  /** подстановка чисел */
  subst: string;
  /** коэффициент использования; NaN — проверка не может быть выполнена */
  util: number;
  ok: boolean;
  /** ключи примечаний (переводятся в UI) */
  notes?: string[];
}

export interface Intermediate {
  key: string;
  symbol: string;
  value: number;
  unit: string;
}

export interface MemberInput {
  code: CodeId;
  section: Section;
  steel: string;
  /** ДБН: коэффициент условий работы γc */
  gammaC?: number;
  /** ДБН: коэффициент надежности по ответственности γn */
  gammaN?: number;
  /** EN: частные коэффициенты */
  gammaM0?: number;
  gammaM1?: number;
  /** расчетные усилия (абсолютные максимумы), Н и Н·мм; N > 0 — сжатие */
  MEd?: number;
  VEd?: number;
  NEd?: number;
  /** изгибно-крутильная форма потери устойчивости */
  ltb?: {
    restrained: boolean;
    /** расчетная длина между закреплениями сжатого пояса, мм */
    Lcr: number;
    C1: number;
    C2: number;
    /** точка приложения нагрузки: верхний пояс / центр / нижний пояс */
    loadAt: "top" | "center" | "bottom";
    /** ДБН, прил. Н: расчетный случай для коэффициента ψ */
    dbn?: import("./dbn198").PsiCase;
  };
  /** расчетные длины при продольном изгибе, мм */
  buckling?: { Lcr_y: number; Lcr_z: number };
  /** прогиб от нормативной нагрузки */
  deflection?: { w: number; Lref: number; limit: number };
  /** коэффициент эквивалентного момента для N+M (EN, Прил. B) */
  Cmy?: number;
}

export interface MemberResult {
  checks: Check[];
  values: Intermediate[];
  maxUtil: number;
  ok: boolean;
}

export function finalize(checks: Check[], values: Intermediate[]): MemberResult {
  const utils = checks.map((c) => c.util);
  const maxUtil = utils.some((u) => Number.isNaN(u)) ? NaN : Math.max(0, ...utils);
  return { checks, values, maxUtil, ok: checks.every((c) => c.ok) };
}

export function mkCheck(key: string, clause: string, formula: string, subst: string, util: number, notes?: string[]): Check {
  return { key, clause, formula, subst, util, ok: Number.isFinite(util) && util <= 1 + 1e-9, notes };
}

export const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—");
export const kNm = (Nmm: number) => Nmm / 1e6;
export const kN = (N: number) => N / 1e3;
export const cm3 = (mm3: number) => mm3 / 1e3;
export const cm4 = (mm4: number) => mm4 / 1e4;
export const cm2 = (mm2: number) => mm2 / 1e2;

export function maxThickness(s: Section): number {
  return Math.max(...s.elements.map((e) => e.t), s.dims.t ?? 0, s.dims.tf ?? 0);
}

/** Критический момент упругой изгибно-крутильной потери устойчивости для
 *  двоякосимметричного сечения (формула NCCI SN003, k = kw = 1). */
export function mcrDoublySymmetric(s: Section, E: number, G: number, L: number, C1: number, C2: number, loadAt: "top" | "center" | "bottom"): number {
  const zg = loadAt === "top" ? s.h / 2 : loadAt === "bottom" ? -s.h / 2 : 0;
  const pe = (Math.PI ** 2 * E * s.Iz) / (L * L);
  const t = s.Iw / s.Iz + (L * L * G * s.It) / (Math.PI ** 2 * E * s.Iz) + (C2 * zg) ** 2;
  return C1 * pe * (Math.sqrt(t) - C2 * zg);
}
