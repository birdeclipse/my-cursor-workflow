import type { EdaFlowAdapter } from "../flowAdapter.js";
import { buildOpenLaneConfig, buildSdc, buildWrapperVerilog } from "../../emit/edaTargets.js";

export const openLaneAdapter: EdaFlowAdapter = {
  id: "openlane",
  emit(spec) {
    return [
      {
        fileName: `${spec.macro.name}_wrapper.v`,
        contents: buildWrapperVerilog(spec),
        adapterId: "openlane",
        kind: "rtl",
      },
      {
        fileName: "openlane.config.json",
        contents: `${JSON.stringify(buildOpenLaneConfig(spec), null, 2)}\n`,
        adapterId: "openlane",
        kind: "config",
      },
      {
        fileName: "base.sdc",
        contents: buildSdc(spec),
        adapterId: "openlane",
        kind: "constraint",
      },
    ];
  },
  qualityRules() {
    return [];
  },
  toolProbes() {
    return [{ tool: "openlane", command: "openlane --version" }];
  },
  smokePlan(run) {
    return { name: "openlane-version", cwd: run.macroDir, command: "openlane", args: ["--version"] };
  },
  classifyLog() {
    return [];
  },
};
