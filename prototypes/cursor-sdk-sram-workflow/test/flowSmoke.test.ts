import { describe, expect, test } from "vitest";

import {
  buildVerilatorSyntaxCheckPlans,
  buildFlowSmokeReport,
  buildOpenRoadSmokeLogReport,
  classifyOpenRoadSmokeLog,
  classifyToolProbe,
  type SyntaxSmokeResult,
  type ToolProbeResult,
} from "../src/review/flowSmoke.js";

describe("flowSmoke", () => {
  test("classifies missing EDA binaries from spawn ENOENT details", () => {
    expect(classifyToolProbe({ tool: "openroad", available: false, detail: "spawn openroad ENOENT" })).toEqual({
      code: "tool_missing",
      severity: "warning",
      message: "openroad binary is unavailable; flow smoke is static-only until the tool is installed.",
    });
  });

  test("buildFlowSmokeReport turns tool probes into planner-ready feedback", () => {
    const tools: ToolProbeResult[] = [
      { tool: "openroad", command: "openroad -version", available: false, detail: "spawn openroad ENOENT" },
      { tool: "yosys", command: "yosys -V", available: true, detail: "Yosys 0.45" },
    ];
    const report = buildFlowSmokeReport({
      runId: "ralph-openroad-iteration-5",
      macro: "sram22_64x32m4w8",
      tools,
      staticQuality: { errors: 0, warnings: 0, info: 4 },
    });

    expect(report.status).toBe("static_only");
    expect(report.feedback.some((item) => item.code === "tool_missing" && item.tool === "openroad")).toBe(true);
    expect(report.nextPlannerHints).toContain("Install/provide OpenROAD/OpenLane/Yosys/Verilator or run inside a pinned flow container before dynamic flow execution.");
  });

  test("buildVerilatorSyntaxCheckPlans lints generated modules as separate tops", () => {
    const plans = buildVerilatorSyntaxCheckPlans({
      macro: "sram22_64x32m4w8",
      wrapperVerilog: "sram22_64x32m4w8_wrapper.v",
      blackboxVerilog: "sram22_64x32m4w8.v",
      protocolAssumptionsSv: "sram22_64x32m4w8_protocol_assumptions.sv",
      memorySemanticsCheckerSv: "sram22_64x32m4w8_memory_semantics_checker.sv",
    });

    expect(plans.map((plan) => plan.topModule)).toEqual([
      "sram22_64x32m4w8_wrapper",
      "sram22_64x32m4w8_protocol_assumptions",
      "sram22_64x32m4w8_memory_semantics_checker",
    ]);
    expect(plans[0].files).toEqual(["sram22_64x32m4w8_wrapper.v", "sram22_64x32m4w8.v"]);
    expect(plans.every((plan) => plan.args.includes("--lint-only") && plan.args.includes("--sv"))).toBe(true);
  });

  test("buildVerilatorSyntaxCheckPlans includes split SVA files when available", () => {
    const plans = buildVerilatorSyntaxCheckPlans({
      macro: "sram22_64x32m4w8",
      wrapperVerilog: "sram22_64x32m4w8_wrapper.v",
      blackboxVerilog: "sram22_64x32m4w8.v",
      protocolAssumptionsSv: "sram22_64x32m4w8_protocol_assumptions.sv",
      memorySemanticsCheckerSv: "sram22_64x32m4w8_memory_semantics_checker.sv",
      protocolAssertionsSv: "sram22_64x32m4w8_protocol_assertions.sv",
      protocolCoversSv: "sram22_64x32m4w8_protocol_covers.sv",
      memoryScoreboardSv: "sram22_64x32m4w8_memory_scoreboard.sv",
      verificationBindSv: "sram22_64x32m4w8_bind.sv",
    });

    expect(plans.map((plan) => plan.name)).toEqual([
      "wrapper_rtl",
      "protocol_sva",
      "memory_semantics_sva",
      "protocol_assertions_sva",
      "protocol_covers_sva",
      "memory_scoreboard_sva",
      "bind_sva",
    ]);
  });

  test("buildFlowSmokeReport carries syntax checks and blocks on lint failure", () => {
    const tools: ToolProbeResult[] = [
      { tool: "openroad", command: "openroad -version", available: true, detail: "OpenROAD" },
      { tool: "openlane", command: "openlane --version", available: true, detail: "OpenLane" },
      { tool: "verilator", command: "verilator --version", available: true, detail: "Verilator 5.028" },
    ];
    const syntaxChecks: SyntaxSmokeResult[] = [
      {
        tool: "verilator",
        name: "protocol_sva",
        topModule: "sram22_64x32m4w8_protocol_assumptions",
        command: "verilator --lint-only --sv --top-module sram22_64x32m4w8_protocol_assumptions x.sv",
        files: ["x.sv"],
        status: "failed",
        detail: "%Error: syntax error",
      },
    ];
    const report = buildFlowSmokeReport({
      runId: "ralph-openroad-iteration-6",
      macro: "sram22_64x32m4w8",
      tools,
      syntaxChecks,
      staticQuality: { errors: 0, warnings: 0, info: 4 },
    });

    expect(report.status).toBe("blocked");
    expect(report.syntaxChecks).toEqual(syntaxChecks);
    expect(report.nextPlannerHints).toContain("Fix generated Verilog/SVA lint failures before OpenLane/OpenROAD execution.");
  });

  test("buildFlowSmokeReport stays static-only when Verilator syntax checks are skipped", () => {
    const tools: ToolProbeResult[] = [
      { tool: "openroad", command: "openroad -version", available: true, detail: "OpenROAD" },
      { tool: "openlane", command: "openlane --version", available: true, detail: "OpenLane" },
      { tool: "yosys", command: "yosys -V", available: true, detail: "Yosys" },
      { tool: "verilator", command: "verilator --version", available: false, detail: "spawn verilator ENOENT" },
    ];
    const report = buildFlowSmokeReport({
      runId: "ralph-openroad-iteration-6",
      macro: "sram22_64x32m4w8",
      tools,
      syntaxChecks: [
        {
          tool: "verilator",
          name: "wrapper_rtl",
          topModule: "sram22_64x32m4w8_wrapper",
          command: "verilator --lint-only --sv --top-module sram22_64x32m4w8_wrapper wrapper.v macro.v",
          files: ["wrapper.v", "macro.v"],
          status: "skipped",
          detail: "verilator unavailable; syntax lint skipped.",
        },
      ],
      staticQuality: { errors: 0, warnings: 0, info: 0 },
    });

    expect(report.status).toBe("static_only");
    expect(report.nextPlannerHints).toContain("Install/provide OpenROAD/OpenLane/Yosys/Verilator or run inside a pinned flow container before dynamic flow execution.");
    expect(report.nextPlannerHints).not.toContain("Next Ralph iteration can run elaboration/synthesis smoke and classify returned logs.");
  });

  test("classifyOpenRoadSmokeLog extracts planner-ready failure classes", () => {
    const findings = classifyOpenRoadSmokeLog([
      "Error: cannot open file missing.lef",
      "Warning: timing graph has unconstrained endpoints",
      "link_design failed: module sram22_64x32m4w8_wrapper not found",
    ].join("\n"));
    const codes = new Set(findings.map((finding) => finding.code));
    expect(codes.has("openroad_missing_input")).toBe(true);
    expect(codes.has("openroad_link_failure")).toBe(true);
    expect(codes.has("openroad_warning")).toBe(true);
  });

  test("buildOpenRoadSmokeLogReport records not-run state when no log exists", () => {
    const report = buildOpenRoadSmokeLogReport({
      runId: "ralph-openroad-iteration-9",
      macro: "sram22_64x32m4w8",
      logPath: "openroad-smoke.log",
    });

    expect(report.status).toBe("not_run");
    expect(report.findings).toEqual([]);
    expect(report.nextPlannerHints.join(" ")).toContain("npm run smoke-run -- ralph-openroad-iteration-9");
    expect(report.nextPlannerHints.join(" ")).toContain("npm run flow:quality -- ralph-openroad-iteration-9");
    expect(report.nextPlannerHints.some((h) => h.includes("run-openroad-smoke.sh"))).toBe(true);
  });
});
