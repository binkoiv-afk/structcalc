import { describe, expect, it } from "vitest";
import { CITIES_UA, snowDBN, snowGammaFm, snowGammaFe, windCh, windDBN, windGammaFm, snowEN, windEN, designBeam, findSection } from "../src";

describe("ДБН В.1.2-2 — сніг і вітер", () => {
  it("додаток Е: Київ, Львів", () => {
    expect(CITIES_UA.length).toBe(164);
    expect(CITIES_UA.find((c) => c[0] === "Київ")?.slice(2)).toEqual([370, 1550, 19, 160]);
    expect(CITIES_UA.find((c) => c[0] === "Львів")?.slice(2)).toEqual([520, 1310, 15, 240]);
  });
  it("табл. 8.1, 8.3, 9.1 з інтерполяцією", () => {
    expect(snowGammaFm(100)).toBeCloseTo(1.14, 6);
    expect(snowGammaFm(70)).toBeCloseTo(1.07, 6); // між 60 (1.04) і 80 (1.10)
    expect(snowGammaFe(0.02)).toBeCloseTo(0.49, 6);
    expect(windGammaFm(60)).toBeCloseTo(1.035, 6);
  });
  it("сніг, Київ, T = 100 років, α = 10°", () => {
    const r = snowDBN({ S0: 1550, alpha: 10, T: 100 });
    expect(r.mu).toBe(1);
    expect(r.Sm).toBeCloseTo(1767, 0);
    expect(r.Se).toBeCloseTo(759.5, 1);
  });
  it("μ схеми 1 та Calt", () => {
    expect(snowDBN({ S0: 1000, alpha: 42.5, T: 50 }).mu).toBeCloseTo(0.5, 6);
    expect(snowDBN({ S0: 1000, alpha: 25, T: 50, uneven: true }).mu).toBeCloseTo(1.25, 6);
    expect(snowDBN({ S0: 1000, alpha: 0, T: 50, H: 1 }).Calt).toBeCloseTo(1.7, 6);
  });
  it("Ch за табл. 9.01 / 9.02", () => {
    expect(windCh(3, "III")).toBe(0.4);
    expect(windCh(15, "II")).toBeCloseTo(1.025, 6);
    expect(windCh(30, "IV", true)).toBeCloseTo(1.675, 6);
  });
  it("вітер, Київ, z = 10 м, тип III, навітряна стіна", () => {
    const r = windDBN({ W0: 370, z: 10, terrain: "III", Caer: 0.8, T: 100 });
    expect(r.C).toBeCloseTo(0.48, 6);
    expect(r.Wm).toBeCloseTo(202.46, 1);
  });
});

describe("EN 1991", () => {
  it("snow μ1", () => {
    expect(snowEN({ sk: 1000, alpha: 45 }).s).toBeCloseTo(400, 6);
  });
  it("wind qp: vb = 25 m/s, z = 10 m, terrain II → ce ≈ 2.35", () => {
    const r = windEN({ vb: 25, z: 10, terrain: "II", cpe: 1 });
    expect(r.ce).toBeCloseTo(2.35, 1);
    expect(r.qp).toBeCloseTo(918.7, 0);
  });
});

describe("Балка з власними γf навантаження", () => {
  it("γf і γfe навантаження перекривають γQ і 1", () => {
    const sec = findSection("IPE", "IPE 200")!;
    const base = {
      code: "DBN" as const, steel: "C245", spans: [6], supports: ["pin", "pin"] as ("pin")[], selfWeight: false,
      gammaG: 1.1, gammaQ: 1.3, ltb: { restrained: true, loadAt: "top" as const }, deflectionLimit: 0,
    };
    const r = designBeam({ ...base, loads: [{ type: "udl", cat: "Q", q: 2, gf: 1.14, gfe: 0.49 }] }, sec);
    expect(r.uls.Mmax / 1e6).toBeCloseTo((2 * 1.14 * 36) / 8, 3);
    const r1 = designBeam({ ...base, loads: [{ type: "udl", cat: "Q", q: 2 * 0.49 }] }, sec);
    expect(r.sls.spanDeflections[0].w).toBeCloseTo(r1.sls.spanDeflections[0].w, 6);
  });
});

describe("Сніг і відсмоктування вітру не складаються", () => {
  const sec = findSection("IPE", "IPE 200")!;
  const base = {
    code: "DBN" as const, steel: "C245", spans: [6], supports: ["pin", "pin"] as ("pin")[], selfWeight: false,
    gammaG: 1.1, gammaQ: 1.3, ltb: { restrained: true, loadAt: "top" as const }, deflectionLimit: 0,
  };
  it("гравітаційне сполучення не зменшується відсмоктуванням", () => {
    const r = designBeam({ ...base, loads: [{ type: "udl", cat: "G", q: 1 }, { type: "udl", cat: "Q", q: 4, gf: 1.14 }, { type: "udl", cat: "Q", q: -1, gf: 1.14 }] }, sec);
    expect(r.uplift).toBe(false);
    expect(r.uls.Mmax / 1e6).toBeCloseTo(((1.1 + 4 * 1.14) * 36) / 8, 3);
  });
  it("відрив: 0.9·G + вітер вгору", () => {
    const r = designBeam({ ...base, loads: [{ type: "udl", cat: "G", q: 0.5 }, { type: "udl", cat: "Q", q: -3, gf: 1.14 }] }, sec);
    expect(r.uplift).toBe(true);
    expect(r.uls.Mmin / 1e6).toBeCloseTo(((0.45 - 3 * 1.14) * 36) / 8, 3);
  });
});
