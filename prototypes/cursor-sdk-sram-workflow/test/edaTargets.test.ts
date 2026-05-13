import { describe, expect, test } from "vitest";

import {
  DEFAULT_EDA_TARGETS,
  buildMemorySemanticsCheckerSv,
  buildOpenRoadSmokeRunnerSh,
  buildOpenRoadSmokeTcl,
  buildProtocolAssumptionsSv,
} from "../src/emit/edaTargets.js";
import { extractStructuredSpec } from "../src/extract/sram22.js";

const macrosRoot = "data/tier3_generators/sram22_macros";
const repoRoot = process.cwd();

describe("EDA targets registry", () => {
  test("has stable ids for each registered flow emitters", () => {
    const ids = DEFAULT_EDA_TARGETS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("hammer_sram_cache_json");
    expect(ids).toContain("openlane_wrapper_verilog");
    expect(ids).toContain("openlane_config_json");
    expect(ids).toContain("sram_protocol_assumptions_sv");
    expect(ids).toContain("sram_memory_semantics_checker_sv");
    expect(ids).toContain("openroad_smoke_tcl");
    expect(ids).toContain("openroad_smoke_runner_sh");
  });

  test("buildOpenRoadSmokeTcl emits source-view read and link commands", () => {
    const tcl = buildOpenRoadSmokeTcl({
      macro: { name: "sram22_64x32m4w8", source: "sram22", family: "1rw", process: "sky130" },
      views: {
        lef: "/views/sram22_64x32m4w8.lef",
        liberty: { tt: "/views/tt.lib" },
        verilog: "/views/sram22_64x32m4w8.v",
      },
      ports: { clock: { value: ["clk"], confidence: 1, sources: [] } },
    } as never);

    expect(tcl).toContain("read_lef /views/sram22_64x32m4w8.lef");
    expect(tcl).toContain("read_liberty /views/tt.lib");
    expect(tcl).toContain("read_verilog sram22_64x32m4w8_wrapper.v");
    expect(tcl).toContain("read_verilog /views/sram22_64x32m4w8.v");
    expect(tcl).toContain("link_design sram22_64x32m4w8_wrapper");
    expect(tcl).toContain("read_sdc base.sdc");
  });

  test("buildOpenRoadSmokeRunnerSh emits a cwd-safe logging runner", () => {
    const sh = buildOpenRoadSmokeRunnerSh();
    expect(sh).toContain("command -v openroad");
    expect(sh).toContain('cd "$SCRIPT_DIR"');
    expect(sh).toContain("openroad -exit openroad-smoke.tcl");
    expect(sh).toContain("tee openroad-smoke.log");
  });

  test("buildProtocolAssumptionsSv expands all source-derived protocol and cover properties", async () => {
    const spec = await extractStructuredSpec({ macroName: "sram22_64x32m4w8", macrosRoot, repoRoot });
    const sv = buildProtocolAssumptionsSv(spec);

    expect(sv).toContain("localparam int SRAM_DEPTH = 64;");
    expect(sv).toContain("wire logic active_cycle = ce && rstb;");
    expect(sv).toContain("p_write_cycle_definition: assert property");
    expect(sv).toContain("p_read_cycle_definition: assert property");
    for (let value = 0; value < 16; value += 1) {
      expect(sv).toContain(`p_cover_wmask_${value}: cover property`);
    }
    for (const lane of spec.interfaceProtocol.wmask.lanes) {
      expect(sv).toContain(`p_lane_${lane.laneIndex}_write_updates_reference: assert property`);
      expect(sv).toContain(`p_cover_lane_${lane.laneIndex}_write: cover property`);
    }
  });

  test("buildMemorySemanticsCheckerSv emits a lane-aware boundary scoreboard", async () => {
    const spec = await extractStructuredSpec({ macroName: "sram22_64x32m4w8", macrosRoot, repoRoot });
    const sv = buildMemorySemanticsCheckerSv(spec);

    expect(sv).toContain("logic [31:0] reference_mem [0:63];");
    expect(sv).toContain("logic [3:0] reference_lane_valid [0:63];");
    expect(sv).toContain("reference_mem[init_addr] = 'x;");
    expect(sv).not.toContain("reference_mem[init_addr] = '0;");
    expect(sv).toContain("expected_read_valid <= 1'b1;");
    for (const lane of spec.interfaceProtocol.wmask.lanes) {
      expect(sv).toContain(`p_read_lane_${lane.laneIndex}_matches_reference: assert property`);
      expect(sv).toContain(`reference_lane_valid[expected_read_addr][${lane.laneIndex}]`);
    }
  });
});
