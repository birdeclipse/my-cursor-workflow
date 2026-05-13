import type { EdaFlowAdapter } from "../flowAdapter.js";
import { emitVerificationCollateralBundle } from "../../verification-collateral/emit.js";
import { buildDefaultPropertyProposals, normalizePropertyCatalog } from "../../verification-collateral/normalize.js";

export const verificationAdapter: EdaFlowAdapter = {
  id: "verification",
  emit(spec) {
    const normalized = normalizePropertyCatalog(spec, buildDefaultPropertyProposals(spec));
    const split = emitVerificationCollateralBundle(spec, normalized.catalog);
    return [
      {
        fileName: `${spec.macro.name}_protocol_assumptions.sv`,
        contents: split.protocolAssumptionsSv,
        adapterId: "verification",
        kind: "rtl",
      },
      {
        fileName: `${spec.macro.name}_memory_semantics_checker.sv`,
        contents: split.legacyMemorySemanticsCheckerSv,
        adapterId: "verification",
        kind: "rtl",
      },
      {
        fileName: "properties.json",
        contents: split.propertiesJson,
        adapterId: "verification",
        kind: "report",
      },
      {
        fileName: `${spec.macro.name}_protocol_assertions.sv`,
        contents: split.protocolAssertionsSv,
        adapterId: "verification",
        kind: "rtl",
      },
      {
        fileName: `${spec.macro.name}_protocol_covers.sv`,
        contents: split.protocolCoversSv,
        adapterId: "verification",
        kind: "rtl",
      },
      {
        fileName: `${spec.macro.name}_memory_scoreboard.sv`,
        contents: split.memoryScoreboardSv,
        adapterId: "verification",
        kind: "rtl",
      },
      {
        fileName: `${spec.macro.name}_bind.sv`,
        contents: split.bindSv,
        adapterId: "verification",
        kind: "rtl",
      },
    ];
  },
  qualityRules() {
    return [];
  },
  toolProbes() {
    return [{ tool: "verilator", command: "verilator --version" }];
  },
  smokePlan(run) {
    return { name: "verification-syntax", cwd: run.macroDir, command: "verilator", args: ["--version"] };
  },
  classifyLog() {
    return [];
  },
};
