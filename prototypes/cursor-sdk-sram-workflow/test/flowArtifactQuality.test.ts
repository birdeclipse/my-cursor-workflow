import { describe, expect, test } from "vitest";

import {
  analyzeFlowArtifactConsistency,
  analyzeOpenLaneConfigContent,
  analyzeOpenRoadReadme,
  analyzeOpenRoadSmokeRunnerSh,
  analyzeOpenRoadSmokeTcl,
  analyzePropertyMetadataContent,
  analyzeSdc,
  analyzeSvaContent,
} from "../src/review/flowArtifactQuality.js";

describe("flowArtifactQuality", () => {
  test("analyzeOpenLaneConfigContent flags missing OpenLane required keys", () => {
    const json = JSON.stringify({
      DESIGN_NAME: "top",
      CLOCK_PERIOD: 10,
      CLOCK_PORT: "clk",
    });
    const f = analyzeOpenLaneConfigContent(json);
    const missing = f.filter((x) => x.code === "openlane_missing_required_or_empty");
    const fields = new Set(missing.map((m) => m.field));
    expect(fields.has("VERILOG_FILES")).toBe(true);
    expect(fields.has("CLOCK_NET")).toBe(true);
    expect(missing.every((m) => m.severity === "error")).toBe(true);
  });

  test("analyzeOpenLaneConfigContent flags prototype clock confidence", () => {
    const json = JSON.stringify({
      DESIGN_NAME: "top",
      VERILOG_FILES: "a.v",
      CLOCK_PERIOD: 10,
      CLOCK_NET: "clk",
      CLOCK_PORT: "clk",
      CLOCK_PERIOD_CONFIDENCE: 0.25,
      CLOCK_PERIOD_SOURCE: "prototype_default_not_from_sram22_views",
    });
    const f = analyzeOpenLaneConfigContent(json);
    expect(f.some((x) => x.code === "low_confidence_clock_period")).toBe(true);
    expect(f.some((x) => x.code === "clock_period_not_from_views")).toBe(true);
  });

  test("analyzeSdc matches create_clock target port", () => {
    const ok = analyzeSdc(
      "create_clock -name core_clk -period 10 [get_ports clk]\nset_input_delay 0 -clock core_clk [all_inputs]\n",
      "clk",
    );
    expect(ok.some((x) => x.code === "sdc_clock_name_mismatch")).toBe(false);
  });

  test("analyzeSdc warns on clock port mismatch", () => {
    const f = analyzeSdc("create_clock -name clk -period 10 [get_ports clk_wrong]\n", "clk");
    expect(f.some((x) => x.code === "sdc_clock_name_mismatch")).toBe(true);
  });

  test("analyzeSvaContent flags missing module", () => {
    const f = analyzeSvaContent("// empty", "x.sv", "protocol");
    expect(f.some((x) => x.code === "sva_missing_module")).toBe(true);
  });

  test("analyzeSvaContent accepts protocol checker with module and properties", () => {
    const text = `
module m_protocol_assumptions(input wire logic clk);
  property p;
    @(posedge clk) 1'b1;
  endproperty
  assume property (p);
endmodule
`;
    const f = analyzeSvaContent(text, "m.sv", "protocol");
    expect(f.some((x) => x.severity === "error")).toBe(false);
  });

  test("analyzeSvaContent treats cover properties as useful split collateral", () => {
    const text = `
module m_protocol_covers(input logic clk);
  p_cover: cover property (@(posedge clk) 1'b1);
endmodule
`;
    const f = analyzeSvaContent(text, "m_covers.sv", "protocol");
    expect(f.some((x) => x.code === "sva_missing_property_primitives")).toBe(false);
  });

  test("analyzePropertyMetadataContent cross-checks metadata ids against split SVA", () => {
    const f = analyzePropertyMetadataContent(
      JSON.stringify({
        schemaVersion: "0.1.0",
        properties: [
          { id: "p_present", role: "assert", sourceRefs: ["a"], confidence: 1 },
          { id: "p_missing", role: "cover", sourceRefs: ["a"], confidence: 1 },
        ],
      }),
      {
        "a_assertions.sv": "p_present: assert property (@(posedge clk) 1'b1);",
        "a_covers.sv": "",
      },
    );

    expect(f.some((x) => x.code === "property_metadata_id_missing_from_sva")).toBe(true);
  });

  test("analyzeOpenRoadSmokeTcl flags missing setup commands", () => {
    const f = analyzeOpenRoadSmokeTcl("read_lef macro.lef\nlink_design top\n", "openroad-smoke.tcl");
    const codes = new Set(f.map((x) => x.code));
    expect(codes.has("openroad_tcl_missing_read_liberty")).toBe(true);
    expect(codes.has("openroad_tcl_missing_read_verilog")).toBe(true);
    expect(codes.has("openroad_tcl_missing_wrapper_and_macro_verilog")).toBe(true);
    expect(codes.has("openroad_tcl_missing_read_sdc")).toBe(true);
  });

  test("analyzeOpenRoadSmokeTcl accepts minimal wrapper smoke script", () => {
    const f = analyzeOpenRoadSmokeTcl(
      [
        "read_lef macro.lef",
        "read_liberty tt.lib",
        "read_verilog sram22_64x32m4w8_wrapper.v",
        "read_verilog sram22_64x32m4w8.v",
        "link_design sram22_64x32m4w8_wrapper",
        "read_sdc base.sdc",
        "report_checks -path_delay min_max",
      ].join("\n"),
      "openroad-smoke.tcl",
    );
    expect(f.some((x) => x.severity === "error")).toBe(false);
  });

  test("analyzeOpenRoadSmokeTcl flags SDC load before linked design", () => {
    const f = analyzeOpenRoadSmokeTcl(
      [
        "read_lef macro.lef",
        "read_liberty tt.lib",
        "read_verilog sram22_64x32m4w8_wrapper.v",
        "read_verilog sram22_64x32m4w8.v",
        "read_sdc base.sdc",
        "link_design sram22_64x32m4w8_wrapper",
        "report_checks -path_delay min_max",
      ].join("\n"),
      "openroad-smoke.tcl",
    );

    expect(f.some((x) => x.code === "openroad_tcl_read_sdc_before_link_design")).toBe(true);
  });

  test("analyzeFlowArtifactConsistency cross-checks wrapper, OpenLane config, and OpenROAD TCL", () => {
    const f = analyzeFlowArtifactConsistency({
      openLaneConfigText: JSON.stringify({
        DESIGN_NAME: "sram22_64x32m4w8_wrapper",
        VERILOG_FILES: "sram22_64x32m4w8_wrapper.v",
        CLOCK_PERIOD: 4.86579,
        CLOCK_NET: "clk",
        CLOCK_PORT: "clk",
      }),
      openRoadSmokeTclText: [
        "read_verilog wrong_wrapper.v",
        "link_design wrong_top",
        "read_sdc base.sdc",
      ].join("\n"),
      wrapperVerilogText: "module sram22_64x32m4w8_wrapper(input clk); endmodule\n",
    });
    const codes = new Set(f.map((x) => x.code));

    expect(codes.has("flow_tcl_missing_openlane_wrapper_verilog")).toBe(true);
    expect(codes.has("flow_tcl_link_design_mismatch")).toBe(true);
  });

  test("analyzeOpenRoadSmokeRunnerSh flags missing runner safety commands", () => {
    const f = analyzeOpenRoadSmokeRunnerSh("openroad openroad-smoke.tcl\n", "run-openroad-smoke.sh");
    const codes = new Set(f.map((x) => x.code));
    expect(codes.has("openroad_runner_missing_tool_check")).toBe(true);
    expect(codes.has("openroad_runner_missing_macro_dir_cd")).toBe(true);
    expect(codes.has("openroad_runner_missing_exit_mode")).toBe(true);
    expect(codes.has("openroad_runner_missing_log_capture")).toBe(true);
  });

  test("analyzeOpenRoadSmokeRunnerSh accepts cwd-safe logging runner", () => {
    const f = analyzeOpenRoadSmokeRunnerSh(
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "SCRIPT_DIR=\"$(cd \"$(dirname \"${BASH_SOURCE[0]}\")\" && pwd)\"",
        "cd \"$SCRIPT_DIR\"",
        "command -v openroad >/dev/null 2>&1",
        "openroad -exit openroad-smoke.tcl 2>&1 | tee openroad-smoke.log",
      ].join("\n"),
      "run-openroad-smoke.sh",
    );
    expect(f.some((x) => x.severity === "error")).toBe(false);
  });
});
