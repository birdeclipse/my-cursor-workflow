import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { FlowQualitySeverity } from "./flowArtifactQuality.js";

const execFileAsync = promisify(execFile);

export type FlowSmokeStatus = "dynamic_ready" | "static_only" | "blocked";
export type ToolName = "openroad" | "openlane" | "yosys" | "verilator";
export type OpenRoadLogStatus = "not_run" | "passed" | "failed";

export interface ToolProbeResult {
  tool: ToolName;
  command: string;
  available: boolean;
  detail: string;
}

export interface ToolFeedback {
  tool: ToolName;
  code: "tool_available" | "tool_missing" | "tool_timeout" | "tool_error";
  severity: FlowQualitySeverity;
  message: string;
}

export type SyntaxSmokeStatus = "passed" | "failed" | "skipped";

export interface SyntaxSmokePlan {
  tool: "verilator";
  name:
    | "wrapper_rtl"
    | "protocol_sva"
    | "memory_semantics_sva"
    | "protocol_assertions_sva"
    | "protocol_covers_sva"
    | "memory_scoreboard_sva"
    | "bind_sva";
  topModule: string;
  args: string[];
  command: string;
  files: string[];
}

export interface SyntaxSmokeResult extends Omit<SyntaxSmokePlan, "args"> {
  status: SyntaxSmokeStatus;
  detail: string;
}

export interface FlowSmokeReport {
  schemaVersion: "0.1.0";
  runId: string;
  macro: string;
  status: FlowSmokeStatus;
  generatedUtc: string;
  tools: ToolProbeResult[];
  feedback: ToolFeedback[];
  syntaxChecks: SyntaxSmokeResult[];
  staticQuality: {
    errors: number;
    warnings: number;
    info: number;
  };
  nextPlannerHints: string[];
}

export interface OpenRoadLogFinding {
  code: "openroad_missing_input" | "openroad_link_failure" | "openroad_error" | "openroad_warning";
  severity: FlowQualitySeverity;
  message: string;
}

export interface OpenRoadSmokeLogReport {
  schemaVersion: "0.1.0";
  runId: string;
  macro: string;
  status: OpenRoadLogStatus;
  generatedUtc: string;
  logPath: string;
  findings: OpenRoadLogFinding[];
  nextPlannerHints: string[];
}

const TOOL_COMMANDS: Record<ToolName, readonly string[]> = {
  openroad: ["-version"],
  openlane: ["--version"],
  yosys: ["-V"],
  verilator: ["--version"],
};

function verilatorPlan(name: SyntaxSmokePlan["name"], topModule: string, files: string[]): SyntaxSmokePlan {
  const args = ["--lint-only", "--sv", "--top-module", topModule, ...files];
  return {
    tool: "verilator",
    name,
    topModule,
    args,
    command: ["verilator", ...args].join(" "),
    files,
  };
}

export function buildVerilatorSyntaxCheckPlans(options: {
  macro: string;
  wrapperVerilog: string;
  blackboxVerilog: string;
  protocolAssumptionsSv: string;
  memorySemanticsCheckerSv: string;
  protocolAssertionsSv?: string;
  protocolCoversSv?: string;
  memoryScoreboardSv?: string;
  verificationBindSv?: string;
}): SyntaxSmokePlan[] {
  const plans = [
    verilatorPlan("wrapper_rtl", `${options.macro}_wrapper`, [options.wrapperVerilog, options.blackboxVerilog]),
    verilatorPlan("protocol_sva", `${options.macro}_protocol_assumptions`, [options.protocolAssumptionsSv]),
    verilatorPlan("memory_semantics_sva", `${options.macro}_memory_semantics_checker`, [
      options.memorySemanticsCheckerSv,
    ]),
  ];
  if (options.protocolAssertionsSv !== undefined) {
    plans.push(verilatorPlan("protocol_assertions_sva", `${options.macro}_protocol_assertions`, [options.protocolAssertionsSv]));
  }
  if (options.protocolCoversSv !== undefined) {
    plans.push(verilatorPlan("protocol_covers_sva", `${options.macro}_protocol_covers`, [options.protocolCoversSv]));
  }
  if (options.memoryScoreboardSv !== undefined) {
    plans.push(verilatorPlan("memory_scoreboard_sva", `${options.macro}_memory_scoreboard`, [options.memoryScoreboardSv]));
  }
  if (
    options.verificationBindSv !== undefined &&
    options.protocolAssertionsSv !== undefined &&
    options.protocolCoversSv !== undefined &&
    options.memoryScoreboardSv !== undefined
  ) {
    plans.push(
      verilatorPlan("bind_sva", `${options.macro}_wrapper`, [
        options.wrapperVerilog,
        options.blackboxVerilog,
        options.protocolAssumptionsSv,
        options.protocolAssertionsSv,
        options.protocolCoversSv,
        options.memoryScoreboardSv,
        options.verificationBindSv,
      ]),
    );
  }
  return plans;
}

export function classifyToolProbe(probe: Pick<ToolProbeResult, "tool" | "available" | "detail">): Omit<ToolFeedback, "tool"> {
  if (probe.available) {
    return {
      code: "tool_available",
      severity: "info",
      message: `${probe.tool} is available for dynamic flow smoke checks.`,
    };
  }
  if (/ENOENT|not found|command not found|spawn .* ENOENT/i.test(probe.detail)) {
    return {
      code: "tool_missing",
      severity: "warning",
      message: `${probe.tool} binary is unavailable; flow smoke is static-only until the tool is installed.`,
    };
  }
  if (/timeout|timed out|SIGTERM/i.test(probe.detail)) {
    return {
      code: "tool_timeout",
      severity: "warning",
      message: `${probe.tool} probe timed out; dynamic flow smoke cannot trust this tool state.`,
    };
  }
  return {
    code: "tool_error",
    severity: "error",
    message: `${probe.tool} probe failed unexpectedly; inspect detail before dynamic flow execution.`,
  };
}

export async function probeTool(tool: ToolName, timeoutMs = 3_000): Promise<ToolProbeResult> {
  const args = TOOL_COMMANDS[tool];
  const command = [tool, ...args].join(" ");
  try {
    const { stdout, stderr } = await execFileAsync(tool, [...args], {
      timeout: timeoutMs,
      maxBuffer: 1_000_000,
    });
    return { tool, command, available: true, detail: `${stdout}${stderr}`.trim().slice(0, 1_000) };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { tool, command, available: false, detail };
  }
}

export async function probeDefaultFlowTools(): Promise<ToolProbeResult[]> {
  return Promise.all((["openroad", "openlane", "yosys", "verilator"] as const).map((tool) => probeTool(tool)));
}

export async function runVerilatorSyntaxChecks(
  options: Parameters<typeof buildVerilatorSyntaxCheckPlans>[0] & { verilatorAvailable: boolean },
): Promise<SyntaxSmokeResult[]> {
  const plans = buildVerilatorSyntaxCheckPlans(options);
  if (!options.verilatorAvailable) {
    return plans.map(({ args: _args, ...plan }) => ({
      ...plan,
      status: "skipped",
      detail: "verilator unavailable; syntax lint skipped.",
    }));
  }
  return Promise.all(
    plans.map(async (plan) => {
      try {
        const { stdout, stderr } = await execFileAsync("verilator", plan.args, {
          timeout: 15_000,
          maxBuffer: 2_000_000,
        });
        const { args: _args, ...resultBase } = plan;
        return {
          ...resultBase,
          status: "passed" as const,
          detail: `${stdout}${stderr}`.trim().slice(0, 2_000),
        };
      } catch (err) {
        const { args: _args, ...resultBase } = plan;
        const detail = err instanceof Error ? err.message : String(err);
        return {
          ...resultBase,
          status: "failed" as const,
          detail: detail.slice(0, 2_000),
        };
      }
    }),
  );
}

export function classifyOpenRoadSmokeLog(logText: string): OpenRoadLogFinding[] {
  const out: OpenRoadLogFinding[] = [];
  if (/(cannot open|can't open|can't read|no such file|missing\.\w+)/i.test(logText)) {
    out.push({
      code: "openroad_missing_input",
      severity: "error",
      message: "OpenROAD log indicates one or more input files could not be opened.",
    });
  }
  if (/(link_design.*(fail|error)|module .*not found|top .*not found)/i.test(logText)) {
    out.push({
      code: "openroad_link_failure",
      severity: "error",
      message: "OpenROAD log indicates link_design/top-module resolution failed.",
    });
  }
  if (/(^|\n)\s*(%?Error|ERROR|Error):/m.test(logText)) {
    out.push({
      code: "openroad_error",
      severity: "error",
      message: "OpenROAD log contains an error diagnostic.",
    });
  }
  if (/(^|\n)\s*(%?Warning|WARNING|Warning):/m.test(logText)) {
    out.push({
      code: "openroad_warning",
      severity: "warning",
      message: "OpenROAD log contains a warning diagnostic.",
    });
  }
  return out;
}

export function buildOpenRoadSmokeLogReport(options: {
  runId: string;
  macro: string;
  logPath: string;
  logText?: string;
  classifyLog?: (logText: string) => OpenRoadLogFinding[];
  generatedUtc?: string;
}): OpenRoadSmokeLogReport {
  if (options.logText === undefined) {
    return {
      schemaVersion: "0.1.0",
      runId: options.runId,
      macro: options.macro,
      status: "not_run",
      generatedUtc: options.generatedUtc ?? new Date().toISOString(),
      logPath: options.logPath,
      findings: [],
      nextPlannerHints: [
        `Run \`npm run smoke-run -- ${options.runId}\` to probe OpenROAD/Docker, bounded-run ./run-openroad-smoke.sh when possible, and refresh openroad-smoke-log-report.json plus openroad-smoke-exec-report.json.`,
        `Run \`npm run flow:quality -- ${options.runId}\` (add \`--write\` to regenerate iteration-report.md) so flow-smoke-report.json stays aligned with the latest log classification.`,
        "Manual fallback: from the macro output directory, run ./run-openroad-smoke.sh when OpenROAD is on PATH.",
      ],
    };
  }
  const findings = (options.classifyLog ?? classifyOpenRoadSmokeLog)(options.logText);
  const hasError = findings.some((finding) => finding.severity === "error");
  return {
    schemaVersion: "0.1.0",
    runId: options.runId,
    macro: options.macro,
    status: hasError ? "failed" : "passed",
    generatedUtc: options.generatedUtc ?? new Date().toISOString(),
    logPath: options.logPath,
    findings,
    nextPlannerHints: hasError
      ? ["Use OpenROAD log classifications to choose one corrective flow-template or emitted-artifact fix."]
      : ["OpenROAD smoke log has no classified blocking errors; inspect timing reports before treating as signoff."],
  };
}

export function buildFlowSmokeReport(options: {
  runId: string;
  macro: string;
  tools: ToolProbeResult[];
  syntaxChecks?: SyntaxSmokeResult[];
  staticQuality: FlowSmokeReport["staticQuality"];
  generatedUtc?: string;
}): FlowSmokeReport {
  const feedback = options.tools.map((tool) => ({ tool: tool.tool, ...classifyToolProbe(tool) }));
  const dynamicPrerequisiteTools: ToolName[] = ["openroad", "openlane", "yosys", "verilator"];
  const unavailablePrerequisite = feedback.some(
    (item) =>
      dynamicPrerequisiteTools.includes(item.tool) &&
      (item.code === "tool_missing" || item.code === "tool_timeout"),
  );
  const syntaxFailed = (options.syntaxChecks ?? []).some((check) => check.status === "failed");
  const syntaxSkipped = (options.syntaxChecks ?? []).some((check) => check.status === "skipped");
  const hardError = feedback.some((item) => item.severity === "error") || options.staticQuality.errors > 0 || syntaxFailed;
  const status: FlowSmokeStatus = hardError ? "blocked" : unavailablePrerequisite || syntaxSkipped ? "static_only" : "dynamic_ready";
  const nextPlannerHints = [
    ...(status === "static_only"
      ? ["Install/provide OpenROAD/OpenLane/Yosys/Verilator or run inside a pinned flow container before dynamic flow execution."]
      : []),
    ...(options.staticQuality.warnings > 0
      ? ["Resolve static flow-quality warnings before treating smoke results as signoff-oriented."]
      : []),
    ...(syntaxFailed ? ["Fix generated Verilog/SVA lint failures before OpenLane/OpenROAD execution."] : []),
    ...(options.syntaxChecks !== undefined &&
    options.syntaxChecks.length > 0 &&
    options.syntaxChecks.every((check) => check.status === "passed")
      ? ["Generated wrapper and SVA sidecars pass Verilator syntax lint."]
      : []),
    ...(status === "dynamic_ready"
      ? ["Next Ralph iteration can run elaboration/synthesis smoke and classify returned logs."]
      : []),
  ];

  return {
    schemaVersion: "0.1.0",
    runId: options.runId,
    macro: options.macro,
    status,
    generatedUtc: options.generatedUtc ?? new Date().toISOString(),
    tools: options.tools,
    feedback,
    syntaxChecks: options.syntaxChecks ?? [],
    staticQuality: options.staticQuality,
    nextPlannerHints,
  };
}
