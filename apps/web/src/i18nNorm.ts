// Вибір норм і країни: тексти
type Dict = Record<string, string>;
const uk: Dict = {
  lc_li: "0",
  lc_cityEN: "Місто (зони за національним додатком)",
  lc_zoneS: "Снігова зона",
  lc_zoneW: "Вітрова зона",
  lc_alt: "Висота над рівнем моря A, м",
  lc_zManual: "— вручну —",
  lc_cdir: "c_dir·c_season",
  lc_hintNA: "s_k і v_b,0 — за зоною і висотою з національного додатка; зону для конкретної ділянки перевіряйте за картою.",
  norm_dbn: "Україна — ДБН",
};
const ru: Dict = {
  lc_li: "1",
  lc_cityEN: "Город (зоны по национальному приложению)",
  lc_zoneS: "Снеговая зона",
  lc_zoneW: "Ветровая зона",
  lc_alt: "Высота над уровнем моря A, м",
  lc_zManual: "— вручную —",
  lc_cdir: "c_dir·c_season",
  lc_hintNA: "s_k и v_b,0 — по зоне и высоте из национального приложения; зону конкретной площадки проверяйте по карте.",
  norm_dbn: "Украина — ДБН",
};
const en: Dict = {
  lc_li: "2",
  lc_cityEN: "City (zones from the National Annex)",
  lc_zoneS: "Snow zone",
  lc_zoneW: "Wind zone",
  lc_alt: "Altitude above sea level A, m",
  lc_zManual: "— manual —",
  lc_cdir: "c_dir·c_season",
  lc_hintNA: "s_k and v_b,0 from the zone and altitude of the National Annex; check the zone of the actual site on the map.",
  norm_dbn: "Ukraine — ДБН",
};
export const NORMI: Record<"uk" | "ru" | "en", Dict> = { uk, ru, en };
