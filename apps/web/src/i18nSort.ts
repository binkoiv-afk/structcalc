// Переклади сортаменту і своїх перерізів (uk, ru, en; інші мови — англійською)
type Dict = Record<string, string>;

const uk: Dict = {
  mod_section: "Сортамент", mod_section_d: "Вітчизняний (ДСТУ/ГОСТ), європейський (EN) і свої перерізи: таблиці, креслення, A, I, W, i",
  sort_all: "Усі", sort_UA: "Вітчизняні", sort_EU: "Європейські", sort_my: "Мої",
  shp_I: "Двотаври", shp_C: "Швелери", shp_L: "Кутики", shp_RHS: "Труби прямокутні", shp_CHS: "Труби круглі",
  sort_table: "таблиця розмірів", sort_verify: "Розміри цього сортаменту введено вручну — звірте з чинним стандартом перед використанням.",
  sec_mono: "Полиці різні: центр ваги зміщено, W для розтягнутої і стиснутої полиць різні (в таблиці — мінімальний).",
  ms_new: "Свій переріз", ms_type: "Тип", ms_name: "Назва", ms_save: "Зберегти в «Мої»", ms_edit: "Змінити", cancel: "Скасувати",
  ms_bad: "Розміри неможливі — перевірте товщини і ширини.",
  msf_h: "Висота h, mm", msf_b: "Ширина верхньої полиці b, mm", msf_tf: "Товщина верхньої полиці t_f, mm",
  msf_b2: "Ширина нижньої полиці b₂, mm", msf_tf2: "Товщина нижньої полиці t_f2, mm", msf_tw: "Товщина стінки t_w, mm",
  msf_r: "Радіус заокруглення r, mm", msf_rw: "Катет поясних швів, mm", msf_t: "Товщина t, mm", msf_ro: "Зовнішній радіус r_o, mm", msf_d: "Діаметр D, mm",
  ms_hint_weldedI: "Полиці можуть бути різної ширини і товщини (несиметричний двотавр).",
  ms_hint_rolledI: "Прокатний двотавр із радіусом переходу стінки в полицю.",
  ms_hint_channel: "Швелер з паралельними гранями полиць.", ms_hint_angle: "Кутик: h і b — довжини полиць (рівнополичний, якщо h = b).",
  ms_hint_rhs: "Гнута або гарячекатана труба; r_o — зовнішній радіус кута.", ms_hint_chs: "Кругла труба.",
  cst_channel: "Швелер", cst_angle: "Кутик",
};
const ru: Dict = {
  mod_section: "Сортамент", mod_section_d: "Отечественный (ДСТУ/ГОСТ), европейский (EN) и свои сечения: таблицы, чертежи, A, I, W, i",
  sort_all: "Все", sort_UA: "Отечественные", sort_EU: "Европейские", sort_my: "Мои",
  shp_I: "Двутавры", shp_C: "Швеллеры", shp_L: "Уголки", shp_RHS: "Трубы прямоугольные", shp_CHS: "Трубы круглые",
  sort_table: "таблица размеров", sort_verify: "Размеры этого сортамента введены вручную — сверьте с действующим стандартом перед использованием.",
  sec_mono: "Полки разные: центр тяжести смещён, W для растянутой и сжатой полок разные (в таблице — минимальный).",
  ms_new: "Своё сечение", ms_type: "Тип", ms_name: "Название", ms_save: "Сохранить в «Мои»", ms_edit: "Изменить", cancel: "Отмена",
  ms_bad: "Размеры невозможны — проверьте толщины и ширины.",
  msf_h: "Высота h, mm", msf_b: "Ширина верхней полки b, mm", msf_tf: "Толщина верхней полки t_f, mm",
  msf_b2: "Ширина нижней полки b₂, mm", msf_tf2: "Толщина нижней полки t_f2, mm", msf_tw: "Толщина стенки t_w, mm",
  msf_r: "Радиус скругления r, mm", msf_rw: "Катет поясных швов, mm", msf_t: "Толщина t, mm", msf_ro: "Наружный радиус r_o, mm", msf_d: "Диаметр D, mm",
  ms_hint_weldedI: "Полки могут быть разной ширины и толщины (несимметричный двутавр).",
  ms_hint_rolledI: "Прокатный двутавр с радиусом перехода стенки в полку.",
  ms_hint_channel: "Швеллер с параллельными гранями полок.", ms_hint_angle: "Уголок: h и b — длины полок (равнополочный, если h = b).",
  ms_hint_rhs: "Гнутая или горячекатаная труба; r_o — наружный радиус угла.", ms_hint_chs: "Круглая труба.",
  cst_channel: "Швеллер", cst_angle: "Уголок",
};
const en: Dict = {
  mod_section: "Section catalogue", mod_section_d: "Ukrainian (DSTU/GOST), European (EN) and own sections: tables, drawings, A, I, W, i",
  sort_all: "All", sort_UA: "Ukrainian", sort_EU: "European", sort_my: "Mine",
  shp_I: "I-sections", shp_C: "Channels", shp_L: "Angles", shp_RHS: "Rectangular hollow", shp_CHS: "Circular hollow",
  sort_table: "size table", sort_verify: "Dimensions of this catalogue were entered manually — check against the current standard before use.",
  sec_mono: "Unequal flanges: centroid shifted, W differs for the two flanges (the table shows the minimum).",
  ms_new: "Own section", ms_type: "Type", ms_name: "Name", ms_save: "Save to “Mine”", ms_edit: "Edit", cancel: "Cancel",
  ms_bad: "Impossible dimensions — check thicknesses and widths.",
  msf_h: "Depth h, mm", msf_b: "Top flange width b, mm", msf_tf: "Top flange thickness t_f, mm",
  msf_b2: "Bottom flange width b₂, mm", msf_tf2: "Bottom flange thickness t_f2, mm", msf_tw: "Web thickness t_w, mm",
  msf_r: "Root radius r, mm", msf_rw: "Flange weld leg, mm", msf_t: "Thickness t, mm", msf_ro: "Outer radius r_o, mm", msf_d: "Diameter D, mm",
  ms_hint_weldedI: "Flanges may differ in width and thickness (mono-symmetric I).",
  ms_hint_rolledI: "Rolled I-section with web-to-flange root radius.",
  ms_hint_channel: "Parallel-flange channel.", ms_hint_angle: "Angle: h and b are leg lengths (equal angle if h = b).",
  ms_hint_rhs: "Cold-formed or hot-finished tube; r_o is the outer corner radius.", ms_hint_chs: "Circular tube.",
  cst_channel: "Channel", cst_angle: "Angle",
};

export const SORT: Record<string, Dict> = { uk, ru, en };
