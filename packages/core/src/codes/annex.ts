// Національні додатки до Єврокодів: параметри, що визначаються на національному рівні (NDP).
// Формули EN однакові в усіх країнах; країна змінює лише ці числа. Активний додаток — один на застосунок
// (екран перераховується при зміні країни). Для ДБН не використовується.

export type AnnexId = "EU";

export interface Annex {
  id: AnnexId;
  /** назва країни (uk, ru, en) і позначення стандартів, напр. «PN-EN» */
  name: [string, string, string];
  prefix: string;
  e1990: {
    /** γ_G,sup, γ_G,inf, γ_Q; ξ (6.10b); формула сполучення ULS */
    gG: number; gGinf: number; gQ: number; xi: number; eq: "6.10" | "6.10ab";
    /** ψ0 для супутніх змінних за замовчуванням */
    psi0: number;
  };
  e1992: {
    gc: number; gs: number; acc: number; act: number;
    /** C_Rd,c = cRdc/γ_c; v_min = vminK·k^1.5·√f_ck; k1 при σ_cp */
    cRdc: number; vminK: number; k1: number;
    /** продавлювання: k для u_out,ef (6.4.5 (4)); наближені β для середньої, крайньої, кутової (6.4.3 (6)) */
    kOut: number; beta: [number, number, number];
  };
  e1993: { gM0: number; gM1: number; gM2: number };
  /** параметри, звірені з текстом національного додатка; решта — рекомендовані EN */
  verified: string[];
  sources: string[];
}

const EU: Annex = {
  id: "EU", name: ["EN — рекомендовані значення", "EN — рекомендуемые значения", "EN — recommended values"], prefix: "EN",
  e1990: { gG: 1.35, gGinf: 1.0, gQ: 1.5, xi: 0.85, eq: "6.10", psi0: 0.7 },
  e1992: { gc: 1.5, gs: 1.15, acc: 1.0, act: 1.0, cRdc: 0.18, vminK: 0.035, k1: 0.15, kOut: 1.5, beta: [1.15, 1.4, 1.5] },
  e1993: { gM0: 1.0, gM1: 1.0, gM2: 1.25 },
  verified: [], sources: ["EN 1990:2002+A1, EN 1992-1-1:2004+AC, EN 1993-1-1:2005, EN 1993-1-8:2005 — рекомендовані значення"],
};

export const ANNEXES: Record<AnnexId, Annex> = { EU };

let current: Annex = EU;
/** активний національний додаток */
export const annex = (): Annex => current;
export function setAnnex(id: AnnexId) { current = ANNEXES[id] ?? EU; }
