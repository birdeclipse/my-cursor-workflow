import type { EdaFlowAdapter } from "../flowAdapter.js";
import { buildHammerCacheEntry } from "../../emit/edaTargets.js";

export const hammerAdapter: EdaFlowAdapter = {
  id: "hammer",
  emit(spec) {
    return [
      {
        fileName: "sram-cache.json",
        contents: `${JSON.stringify([buildHammerCacheEntry(spec)], null, 2)}\n`,
        adapterId: "hammer",
        kind: "config",
      },
    ];
  },
  qualityRules() {
    return [];
  },
  toolProbes() {
    return [];
  },
  smokePlan(run) {
    return { name: "hammer-static", cwd: run.macroDir, command: "true", args: [] };
  },
  classifyLog() {
    return [];
  },
};
