import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { DEFAULT_EDA_FLOW_ADAPTERS, adaptersById, adaptersMatchingIds, selectEdaFlowAdapters } from "../src/eda-adapters/index.js";
import { hammerAdapter } from "../src/eda-adapters/hammer/adapter.js";
import { openLaneAdapter } from "../src/eda-adapters/openlane/adapter.js";
import { openRoadAdapter } from "../src/eda-adapters/openroad/adapter.js";
import { classifyLogWithAdapter, toolNamesForAdapters } from "../src/eda-adapters/runtime.js";
import { verificationAdapter } from "../src/eda-adapters/verification/adapter.js";
import { extractStructuredSpec } from "../src/extract/sram22.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const macrosRoot = path.join(repoRoot, "data/tier3_generators/sram22_macros");

describe("EDA flow adapters", () => {
  test("adaptersMatchingIds preserves order and rejects unknown ids", () => {
    expect(adaptersById().get("openlane")?.id).toBe("openlane");
    expect(adaptersMatchingIds(["verification", "openlane"]).map((adapter) => adapter.id)).toEqual([
      "verification",
      "openlane",
    ]);
    expect(() => selectEdaFlowAdapters(["missing"])).toThrow(/Unknown EDA adapter/);
  });

  test("default adapter registry has stable ids", () => {
    expect(DEFAULT_EDA_FLOW_ADAPTERS.map((adapter) => adapter.id)).toEqual([
      "hammer",
      "openlane",
      "verification",
      "openroad",
    ]);
  });

  test("adapters emit the current flow artifact families", async () => {
    const spec = await extractStructuredSpec({ macroName: "sram22_64x32m4w8", macrosRoot, repoRoot });

    expect(hammerAdapter.emit(spec).map((file) => file.fileName)).toEqual(["sram-cache.json"]);
    expect(openLaneAdapter.emit(spec).map((file) => file.fileName)).toEqual([
      "sram22_64x32m4w8_wrapper.v",
      "openlane.config.json",
      "base.sdc",
    ]);
    expect(verificationAdapter.emit(spec).map((file) => file.fileName)).toEqual([
      "sram22_64x32m4w8_protocol_assumptions.sv",
      "sram22_64x32m4w8_memory_semantics_checker.sv",
      "properties.json",
      "sram22_64x32m4w8_protocol_assertions.sv",
      "sram22_64x32m4w8_protocol_covers.sv",
      "sram22_64x32m4w8_memory_scoreboard.sv",
      "sram22_64x32m4w8_bind.sv",
    ]);
    expect(openRoadAdapter.emit(spec).map((file) => file.fileName)).toEqual([
      "openroad-smoke.tcl",
      "run-openroad-smoke.sh",
      "openroad-setup.md",
    ]);
  });

  test("OpenROAD adapter classifies logs through the adapter boundary", () => {
    const findings = openRoadAdapter.classifyLog("Error: cannot open missing.lef\n");
    expect(findings.some((finding) => finding.code === "openroad_missing_input")).toBe(true);
  });

  test("adapter runtime derives known local tool probes from registered adapters", () => {
    expect(toolNamesForAdapters(DEFAULT_EDA_FLOW_ADAPTERS)).toEqual([
      "openroad",
      "openlane",
      "yosys",
      "verilator",
    ]);
  });

  test("adapter runtime exposes log classification by adapter id", () => {
    const findings = classifyLogWithAdapter("openroad", "Error: cannot open missing.lef\n", DEFAULT_EDA_FLOW_ADAPTERS);
    expect(findings.some((finding) => finding.code === "openroad_missing_input")).toBe(true);
  });
});
