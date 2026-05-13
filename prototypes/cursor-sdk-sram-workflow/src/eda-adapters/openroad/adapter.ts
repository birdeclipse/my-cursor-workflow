import type { EdaFlowAdapter } from "../flowAdapter.js";
import { buildOpenRoadReadme, buildOpenRoadSmokeRunnerSh, buildOpenRoadSmokeTcl } from "../../emit/edaTargets.js";
import { classifyOpenRoadSmokeLog } from "../../review/flowSmoke.js";

export const openRoadAdapter: EdaFlowAdapter = {
  id: "openroad",
  emit(spec) {
    return [
      {
        fileName: "openroad-smoke.tcl",
        contents: buildOpenRoadSmokeTcl(spec),
        adapterId: "openroad",
        kind: "script",
      },
      {
        fileName: "run-openroad-smoke.sh",
        contents: buildOpenRoadSmokeRunnerSh(),
        adapterId: "openroad",
        kind: "script",
      },
      {
        fileName: "openroad-setup.md",
        contents: buildOpenRoadReadme(spec),
        adapterId: "openroad",
        kind: "documentation",
      },
    ];
  },
  qualityRules() {
    return [];
  },
  toolProbes() {
    return [
      { tool: "openroad", command: "openroad -version" },
      { tool: "yosys", command: "yosys -V" },
    ];
  },
  smokePlan(run) {
    return { name: "openroad-smoke", cwd: run.macroDir, command: "bash", args: ["run-openroad-smoke.sh"] };
  },
  classifyLog(logText) {
    return classifyOpenRoadSmokeLog(logText);
  },
};
