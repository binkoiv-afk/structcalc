// Переклади: «Мої розрахунки», меню «Файл», відкат змін, пошук (uk, ru, en)
type Dict = Record<string, string>;

const uk: Dict = {
  fm_title: "Файл", fm_name: "Назва розрахунку", fm_save: "Зберегти", fm_update: "Зберегти зміни", fm_saveAs: "Зберегти як новий",
  fm_hint: "Зберігається в цьому браузері, у «Моїх розрахунках» на головній. Ctrl+S — швидке збереження.",
  fm_download: "Завантажити файл (.json)", fm_reset: "Скинути до типових значень", fm_resetSure: "Точно скинути? Натисніть ще раз",
  fm_resetDone: "Скинуто. Ctrl+Z — повернути", fm_saved: "Збережено", fm_full: "Не вдалося зберегти: сховище браузера заповнене",
  fm_badFile: "Це не файл StructCalc", fm_imported: "Додано розрахунків: {n}",
  fm_undo: "Скасувати", fm_redo: "Повторити",
  fm_search: "Пошук розрахунку: балка, болт, сейсміка…", fm_openFile: "Відкрити файл", fm_nothing: "Нічого не знайдено.",
  fm_mine: "Мої розрахунки", fm_delete: "Видалити", fm_deleteSure: "Видалити?", fm_more: "Показати всі", fm_less: "Згорнути", fm_downloadAll: "Завантажити всі одним файлом",
  mod_dynamic: "Сейсміка", mod_dynamic_d: "Власні частоти і форми, спектральний метод ДБН В.1.1-12 / EN 1998-1 — відкриється рама з увімкненою сейсмікою",
};
const ru: Dict = {
  fm_title: "Файл", fm_name: "Название расчёта", fm_save: "Сохранить", fm_update: "Сохранить изменения", fm_saveAs: "Сохранить как новый",
  fm_hint: "Сохраняется в этом браузере, в «Моих расчётах» на главной. Ctrl+S — быстрое сохранение.",
  fm_download: "Скачать файл (.json)", fm_reset: "Сбросить к типовым значениям", fm_resetSure: "Точно сбросить? Нажмите ещё раз",
  fm_resetDone: "Сброшено. Ctrl+Z — вернуть", fm_saved: "Сохранено", fm_full: "Не удалось сохранить: хранилище браузера заполнено",
  fm_badFile: "Это не файл StructCalc", fm_imported: "Добавлено расчётов: {n}",
  fm_undo: "Отменить", fm_redo: "Повторить",
  fm_search: "Поиск расчёта: балка, болт, сейсмика…", fm_openFile: "Открыть файл", fm_nothing: "Ничего не найдено.",
  fm_mine: "Мои расчёты", fm_delete: "Удалить", fm_deleteSure: "Удалить?", fm_more: "Показать все", fm_less: "Свернуть", fm_downloadAll: "Скачать все одним файлом",
  mod_dynamic: "Сейсмика", mod_dynamic_d: "Собственные частоты и формы, спектральный метод ДБН В.1.1-12 / EN 1998-1 — откроется рама с включённой сейсмикой",
};
const en: Dict = {
  fm_title: "File", fm_name: "Calculation name", fm_save: "Save", fm_update: "Save changes", fm_saveAs: "Save as new",
  fm_hint: "Saved in this browser, under “My calculations” on the home screen. Ctrl+S saves quickly.",
  fm_download: "Download file (.json)", fm_reset: "Reset to defaults", fm_resetSure: "Really reset? Click again",
  fm_resetDone: "Reset. Ctrl+Z to undo", fm_saved: "Saved", fm_full: "Could not save: browser storage is full",
  fm_badFile: "Not a StructCalc file", fm_imported: "Calculations added: {n}",
  fm_undo: "Undo", fm_redo: "Redo",
  fm_search: "Find a calculation: beam, bolt, seismic…", fm_openFile: "Open file", fm_nothing: "Nothing found.",
  fm_mine: "My calculations", fm_delete: "Delete", fm_deleteSure: "Delete?", fm_more: "Show all", fm_less: "Collapse", fm_downloadAll: "Download all as one file",
  mod_dynamic: "Seismic", mod_dynamic_d: "Natural frequencies and modes, response spectrum per DBN V.1.1-12 / EN 1998-1; opens a frame with seismic on",
};
export const UX = { uk, ru, en };
