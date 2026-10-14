import type { CodeId, UserLoad } from "@structcalc/core";
import { CollectorState, LoadCollector } from "./LoadCollector";

export function LoadsModule({ code, c, set, onAdd, t }: {
  code: CodeId; c: CollectorState; set: (p: Partial<CollectorState>) => void; onAdd: (l: UserLoad) => void; t: (k: string) => string;
}) {
  return (
    <main className="layout narrow">
      <div className="inputs">
        <p className="hint">{t("loadsIntro")}</p>
        <LoadCollector code={code} c={c} set={set} onAdd={onAdd} t={t} />
      </div>
    </main>
  );
}
