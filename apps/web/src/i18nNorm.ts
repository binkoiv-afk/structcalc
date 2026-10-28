// Вибір норм і країни: тексти
type Dict = Record<string, string>;
const uk: Dict = {
  norm_dbn: "Україна — ДБН",
};
const ru: Dict = {
  norm_dbn: "Украина — ДБН",
};
const en: Dict = {
  norm_dbn: "Ukraine — ДБН",
};
export const NORMI: Record<"uk" | "ru" | "en", Dict> = { uk, ru, en };
