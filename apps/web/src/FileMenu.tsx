// Меню «Файл» у верхній панелі: зберегти в «Мої розрахунки», зберегти як новий, завантажити файл, скинути до типових.
import { useEffect, useRef, useState } from "react";

export function FileMenu({ t, name, defName, onSave, onDownload, onReset }: {
  t: (k: string) => string; name?: string; defName: () => string;
  onSave: (name: string, asNew: boolean) => void; onDownload: () => void; onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [nm, setNm] = useState("");
  const [sure, setSure] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    setNm(name ?? defName()); setSure(false);
    const out = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", out); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", out); document.removeEventListener("keydown", esc); };
  }, [open]);
  // Ctrl+S — швидке збереження під поточною назвою
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); onSave(name ?? defName(), false); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  return (
    <div className="file-menu" ref={box}>
      <button id="fm-btn" className={`fm-btn ${open ? "on" : ""}`} onClick={() => setOpen(!open)} aria-expanded={open} title={`${t("fm_title")} (Ctrl+S)`}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 3h11l3 3v15H5z M8 3v6h8V3 M8 21v-7h8v7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
        <span className="fm-label">{name ? name : t("fm_title")}</span>
      </button>
      {open && (
        <div className="fm-pop" role="dialog">
          <label><span className="lbl">{t("fm_name")}</span>
            <input id="fm-name" value={nm} onChange={(e) => setNm(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { onSave(nm, false); setOpen(false); } }} autoFocus /></label>
          <div className="fm-row">
            <button id="fm-save" className="primary" onClick={() => { onSave(nm, false); setOpen(false); }}>{name ? t("fm_update") : t("fm_save")}</button>
            {name && <button id="fm-saveas" onClick={() => { onSave(nm, true); setOpen(false); }}>{t("fm_saveAs")}</button>}
          </div>
          <p className="hint">{t("fm_hint")}</p>
          <hr />
          <button id="fm-download" className="fm-item" onClick={() => { onDownload(); setOpen(false); }}>⤓ {t("fm_download")}</button>
          <button id="fm-reset" className={`fm-item ${sure ? "danger" : ""}`} onClick={() => { if (!sure) { setSure(true); return; } onReset(); setOpen(false); }}>
            ⟲ {sure ? t("fm_resetSure") : t("fm_reset")}</button>
        </div>
      )}
    </div>
  );
}
