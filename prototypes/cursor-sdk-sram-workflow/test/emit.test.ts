import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { describe, expect, test } from "vitest";

import { emitMacroArtifacts, emitWorkflowArtifacts } from "../src/emit/workflow.js";
import { extractStructuredSpec } from "../src/extract/sram22.js";
import { openLaneAdapter } from "../src/eda-adapters/openlane/adapter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const macrosRoot = path.join(repoRoot, "data/tier3_generators/sram22_macros");

describe("EDA flow emitters", () => {
  test("emits structured spec, Hammer cache, OpenLane setup, and OpenROAD report", async () => {
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "sram-workflow-"));
    const spec = await extractStructuredSpec({
      macroName: "sram22_64x32m4w8",
      macrosRoot,
      repoRoot,
    });

    try {
      const emitted = await emitWorkflowArtifacts({
        spec,
        outputRoot,
        runId: "test-run",
        repoRoot,
      });

      const specYaml = parseYaml(await readFile(emitted.specYaml, "utf8"));
      const hammerCache = JSON.parse(await readFile(emitted.hammerCacheJson, "utf8"));
      const openLaneConfig = JSON.parse(await readFile(emitted.openLaneConfigJson, "utf8"));
      const wrapperRtl = await readFile(emitted.wrapperVerilog, "utf8");
      const openRoadSmokeTcl = await readFile(emitted.openRoadSmokeTcl, "utf8");
      const openRoadSmokeRunner = await readFile(emitted.openRoadSmokeRunnerSh, "utf8");
      const openRoadReadme = await readFile(emitted.openRoadReadme, "utf8");

      expect(specYaml.macro.name).toBe("sram22_64x32m4w8");
      expect(hammerCache).toEqual([
        expect.objectContaining({
          type: "sram",
          name: "sram22_64x32m4w8",
          source: "sram22",
          depth: "64",
          width: 32,
          mux: 4,
        }),
      ]);
      expect(openLaneConfig.EXTRA_LEFS).toMatch(/sram22_64x32m4w8\.lef$/);
      expect(openLaneConfig.EXTRA_LIBS).toMatch(/tt_025C_1v80\.lib$/);
      expect(openLaneConfig.EXTRA_GDS_FILES).toMatch(/sram22_64x32m4w8\.gds\.gz$/);
      expect(openLaneConfig.VERILOG_FILES).toMatch(/sram22_64x32m4w8_wrapper\.v$/);
      expect(openLaneConfig.VERILOG_FILES_BLACKBOX).toMatch(/sram22_64x32m4w8\.v$/);
      expect(openLaneConfig.CLOCK_NET).toBe("clk");
      expect(openLaneConfig.READINESS_STATUS).toBe("ready");
      expect(openLaneConfig.CLOCK_PERIOD).toBeCloseTo(4.86579, 5);
      expect(openLaneConfig.CLOCK_PERIOD_CONFIDENCE).toBe(1);
      expect(openLaneConfig.CLOCK_PERIOD_SOURCE).toMatch(/sram22_64x32m4w8_ss_100C_1v60\.lib/);
      expect(wrapperRtl).toContain("module sram22_64x32m4w8_wrapper");
      expect(wrapperRtl).toContain("sram22_64x32m4w8 u_sram22_64x32m4w8");
      expect(openRoadSmokeTcl).toContain("link_design sram22_64x32m4w8_wrapper");
      expect(openRoadSmokeTcl).toContain("report_checks -path_delay min_max");
      expect(openRoadSmokeRunner).toContain("openroad -exit openroad-smoke.tcl");
      expect(openRoadSmokeRunner).toContain("openroad-smoke.log");
      expect((await stat(emitted.openRoadSmokeRunnerSh)).mode & 0o111).not.toBe(0);
      const protocolSv = await readFile(emitted.protocolAssumptionsSv, "utf8");
      const semanticsSv = await readFile(emitted.memorySemanticsCheckerSv, "utf8");
      const properties = JSON.parse(await readFile(emitted.verificationPropertiesJson!, "utf8"));
      const assertionsSv = await readFile(emitted.protocolAssertionsSv!, "utf8");
      const coversSv = await readFile(emitted.protocolCoversSv!, "utf8");
      const scoreboardSv = await readFile(emitted.memoryScoreboardSv!, "utf8");
      const bindSv = await readFile(emitted.verificationBindSv!, "utf8");
      expect(protocolSv).toContain("module sram22_64x32m4w8_protocol_assumptions");
      expect(protocolSv).toContain("assume property");
      expect(protocolSv).not.toContain("p_cover_wmask_15");
      expect(semanticsSv).toContain("logic [31:0] reference_mem [0:63];");
      expect(semanticsSv).toContain("p_read_lane_0_matches_reference: assert property");
      expect(semanticsSv).toContain("sram22_64x32m4w8_memory_semantics_checker");
      expect(properties.properties.some((property: { id: string }) => property.id === "p_scoreboard_unknown_powerup")).toBe(true);
      expect(assertionsSv).toContain("p_write_cycle_definition: assert property");
      expect(coversSv).toContain("p_cover_wmask_15: cover property");
      expect(scoreboardSv).toContain("module sram22_64x32m4w8_memory_scoreboard");
      expect(bindSv).toContain("bind sram22_64x32m4w8_wrapper");
      expect(openRoadReadme).toContain("sram22_64x32m4w8");
      expect(openRoadReadme).toContain("no blocking issues detected");

      const runReport = JSON.parse(await readFile(emitted.runReportJson, "utf8"));
      expect(runReport.mode).toBe("single");
      expect(runReport.readinessAggregate.ready).toBe(1);
      expect(runReport.readinessAggregate.blockedMissingGds).toBe(0);
      const flowSmokeReport = JSON.parse(await readFile(emitted.flowSmokeReportJson, "utf8"));
      expect(flowSmokeReport.macro).toBe("sram22_64x32m4w8");
      expect(flowSmokeReport.staticQuality.errors).toBe(0);
      expect(["dynamic_ready", "static_only", "blocked"]).toContain(flowSmokeReport.status);
      expect(flowSmokeReport.tools.map((tool: { tool: string }) => tool.tool)).toEqual([
        "openroad",
        "openlane",
        "yosys",
        "verilator",
      ]);
      expect(flowSmokeReport.feedback.length).toBe(flowSmokeReport.tools.length);
      expect(flowSmokeReport.syntaxChecks.map((check: { name: string }) => check.name)).toEqual([
        "wrapper_rtl",
        "protocol_sva",
        "memory_semantics_sva",
        "protocol_assertions_sva",
        "protocol_covers_sva",
        "memory_scoreboard_sva",
        "bind_sva",
      ]);
      const verilatorAvailable = flowSmokeReport.tools.some(
        (tool: { tool: string; available: boolean }) => tool.tool === "verilator" && tool.available,
      );
      expect(
        flowSmokeReport.syntaxChecks.every(
          (check: { status: string }) => check.status === (verilatorAvailable ? "passed" : "skipped"),
        ),
      ).toBe(true);
      const logReport = JSON.parse(await readFile(emitted.openRoadSmokeLogReportJson, "utf8"));
      expect(logReport.macro).toBe("sram22_64x32m4w8");
      expect(logReport.logPath).toBe("openroad-smoke.log");
      expect(logReport.status).toBe("not_run");

      expect(emitted.iterationReport).toBeDefined();
      const iterationText = await readFile(emitted.iterationReport!, "utf8");
      expect(iterationText).toContain("flow-smoke-report.json");
      expect(iterationText).toContain("OpenROAD binary");
      expect(iterationText).toContain("EDA adapter command surfaces");
      expect(iterationText).toContain("openroad");
      expect(iterationText).toContain("openroad -version");
      expect(iterationText).not.toContain("openlane_missing_required_or_empty");
      expect(iterationText).not.toContain("referenced_view_path_unreadable");
      expect(iterationText).not.toContain("low_confidence_clock_period");
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  test("emitMacroArtifacts can emit a selected adapter subset", async () => {
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "sram-workflow-"));
    const spec = await extractStructuredSpec({
      macroName: "sram22_64x32m4w8",
      macrosRoot,
      repoRoot,
    });

    try {
      const emitted = await emitMacroArtifacts({
        spec,
        outputRoot,
        runId: "subset-run",
        repoRoot,
        edaAdapters: [openLaneAdapter],
      });

      expect(emitted.emittedAdapterIds).toEqual(["openlane"]);
      expect(await readFile(emitted.openLaneConfigJson, "utf8")).toContain("sram22_64x32m4w8_wrapper");
      await expect(readFile(emitted.hammerCacheJson, "utf8")).rejects.toThrow();
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  test("emitWorkflowArtifacts quality pass skips unselected adapter families", async () => {
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "sram-workflow-"));
    const spec = await extractStructuredSpec({
      macroName: "sram22_64x32m4w8",
      macrosRoot,
      repoRoot,
    });

    try {
      const emitted = await emitWorkflowArtifacts({
        spec,
        outputRoot,
        runId: "subset-quality-run",
        repoRoot,
        edaAdapters: [openLaneAdapter],
      });

      const report = JSON.parse(await readFile(emitted.flowSmokeReportJson, "utf8"));
      expect(emitted.emittedAdapterIds).toEqual(["openlane"]);
      expect(report.staticQuality.errors).toBe(0);
      await expect(readFile(emitted.openRoadSmokeTcl, "utf8")).rejects.toThrow();
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });
});
