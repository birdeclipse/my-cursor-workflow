import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";

import { DEFAULT_EDA_FLOW_ADAPTERS, adaptersMatchingIds } from "../eda-adapters/index.js";
import { probeToolsForAdapters } from "../eda-adapters/runtime.js";
import { narrativeForRunId, writeIterationReportMarkdown } from "./iterationReport.js";
import { buildSingleRunReport, writeRunReportJson } from "./runReport.js";
import {
  analyzeEmittedFlowArtifacts,
  type FlowArtifactAnalysis,
  type OpenRoadProbeResult,
} from "../review/flowArtifactQuality.js";
import {
  buildFlowSmokeReport,
  buildOpenRoadSmokeLogReport,
  runVerilatorSyntaxChecks,
  type ToolProbeResult,
} from "../review/flowSmoke.js";
import type { EmitWorkflowOptions, EmittedArtifacts, StructuredSramSpec } from "../spec/types.js";

/**
 * Writes spec + EDA target artifacts for one macro (no run-report).
 * Use for batch runs; finish with `writeRunReportJson` for the aggregate report.
 */
export async function emitMacroArtifacts(options: EmitWorkflowOptions): Promise<EmittedArtifacts> {
  const runDir = path.join(options.outputRoot, options.runId);
  const macroDir = path.join(runDir, options.spec.macro.name);
  await mkdir(macroDir, { recursive: true });

  const adapters = options.edaAdapters ?? DEFAULT_EDA_FLOW_ADAPTERS;
  const emittedAdapterIds = adapters.map((adapter) => adapter.id);

  const artifacts: EmittedArtifacts = {
    runDir,
    macroDir,
    specYaml: path.join(macroDir, "spec.yaml"),
    specJson: path.join(macroDir, "spec.json"),
    hammerCacheJson: path.join(macroDir, "sram-cache.json"),
    wrapperVerilog: path.join(macroDir, `${options.spec.macro.name}_wrapper.v`),
    protocolAssumptionsSv: path.join(macroDir, `${options.spec.macro.name}_protocol_assumptions.sv`),
    memorySemanticsCheckerSv: path.join(macroDir, `${options.spec.macro.name}_memory_semantics_checker.sv`),
    verificationPropertiesJson: path.join(macroDir, "properties.json"),
    protocolAssertionsSv: path.join(macroDir, `${options.spec.macro.name}_protocol_assertions.sv`),
    protocolCoversSv: path.join(macroDir, `${options.spec.macro.name}_protocol_covers.sv`),
    memoryScoreboardSv: path.join(macroDir, `${options.spec.macro.name}_memory_scoreboard.sv`),
    verificationBindSv: path.join(macroDir, `${options.spec.macro.name}_bind.sv`),
    flowSmokeReportJson: path.join(macroDir, "flow-smoke-report.json"),
    openRoadSmokeTcl: path.join(macroDir, "openroad-smoke.tcl"),
    openRoadSmokeRunnerSh: path.join(macroDir, "run-openroad-smoke.sh"),
    openRoadSmokeLogReportJson: path.join(macroDir, "openroad-smoke-log-report.json"),
    openLaneConfigJson: path.join(macroDir, "openlane.config.json"),
    openLaneSdc: path.join(macroDir, "base.sdc"),
    openRoadReadme: path.join(macroDir, "openroad-setup.md"),
    runReportJson: path.join(runDir, "run-report.json"),
    emittedAdapterIds,
  };

  const writes: Promise<void>[] = [
    writeFile(artifacts.specYaml, stringifyYaml(options.spec), "utf8"),
    writeFile(artifacts.specJson, `${JSON.stringify(options.spec, null, 2)}\n`, "utf8"),
  ];

  for (const adapter of adapters) {
    for (const file of adapter.emit(options.spec)) {
      writes.push(writeFile(path.join(macroDir, file.fileName), file.contents, "utf8"));
    }
  }

  await Promise.all(writes);
  if (emittedAdapterIds.includes("openroad")) {
    await chmod(artifacts.openRoadSmokeRunnerSh, 0o755);
  }
  return artifacts;
}

function countStaticQuality(analysis: FlowArtifactAnalysis): { errors: number; warnings: number; info: number } {
  const counts = analysis.findings.reduce(
    (acc, finding) => {
      acc[finding.severity] += 1;
      return acc;
    },
    { error: 0, warning: 0, info: 0 },
  );
  return { errors: counts.error, warnings: counts.warning, info: counts.info };
}

export async function writeFlowSmokeReportJson(options: {
  artifacts: EmittedArtifacts;
  spec: StructuredSramSpec;
  runId: string;
  repoRoot?: string;
  analysis?: FlowArtifactAnalysis;
  tools?: ToolProbeResult[];
  runSyntaxChecks?: boolean;
  openRoadProbe?: OpenRoadProbeResult;
}): Promise<string> {
  const clockPort = options.spec.ports.clock.value[0];
  const analysis =
    options.analysis ??
    (await analyzeEmittedFlowArtifacts(
      {
        openLaneConfigJson: options.artifacts.openLaneConfigJson,
        openLaneSdc: options.artifacts.openLaneSdc,
        wrapperVerilog: options.artifacts.wrapperVerilog,
        openRoadReadme: options.artifacts.openRoadReadme,
        openRoadSmokeTcl: options.artifacts.openRoadSmokeTcl,
        openRoadSmokeRunnerSh: options.artifacts.openRoadSmokeRunnerSh,
        protocolAssumptionsSv: options.artifacts.protocolAssumptionsSv,
        memorySemanticsCheckerSv: options.artifacts.memorySemanticsCheckerSv,
        verificationPropertiesJson: options.artifacts.verificationPropertiesJson,
        protocolAssertionsSv: options.artifacts.protocolAssertionsSv,
        protocolCoversSv: options.artifacts.protocolCoversSv,
        memoryScoreboardSv: options.artifacts.memoryScoreboardSv,
        verificationBindSv: options.artifacts.verificationBindSv,
      },
      options.repoRoot,
      clockPort,
      {
        openRoadProbe: options.openRoadProbe,
        emittedAdapterIds: options.artifacts.emittedAdapterIds,
      },
    ));
  const probeAdapters = adaptersMatchingIds([...options.artifacts.emittedAdapterIds]);
  const tools = options.tools ?? (await probeToolsForAdapters(probeAdapters));
  const verificationEmitted = options.artifacts.emittedAdapterIds.includes("verification");
  const syntaxChecks =
    options.runSyntaxChecks === false ||
    !verificationEmitted ||
    options.spec.views.verilog === undefined
      ? []
      : await runVerilatorSyntaxChecks({
          macro: options.spec.macro.name,
          wrapperVerilog: options.artifacts.wrapperVerilog,
          blackboxVerilog: options.spec.views.verilog,
          protocolAssumptionsSv: options.artifacts.protocolAssumptionsSv,
          memorySemanticsCheckerSv: options.artifacts.memorySemanticsCheckerSv,
          protocolAssertionsSv: options.artifacts.protocolAssertionsSv,
          protocolCoversSv: options.artifacts.protocolCoversSv,
          memoryScoreboardSv: options.artifacts.memoryScoreboardSv,
          verificationBindSv: options.artifacts.verificationBindSv,
          verilatorAvailable: tools.some((tool) => tool.tool === "verilator" && tool.available),
        });
  const flowSmokeReport = buildFlowSmokeReport({
    runId: options.runId,
    macro: options.spec.macro.name,
    tools,
    syntaxChecks,
    staticQuality: countStaticQuality(analysis),
  });
  await writeFile(options.artifacts.flowSmokeReportJson, `${JSON.stringify(flowSmokeReport, null, 2)}\n`, "utf8");
  let logText: string | undefined;
  try {
    logText = await readFile(path.join(options.artifacts.macroDir, "openroad-smoke.log"), "utf8");
  } catch {
    logText = undefined;
  }
  const logReport = buildOpenRoadSmokeLogReport({
    runId: options.runId,
    macro: options.spec.macro.name,
    logPath: "openroad-smoke.log",
    logText,
  });
  await writeFile(options.artifacts.openRoadSmokeLogReportJson, `${JSON.stringify(logReport, null, 2)}\n`, "utf8");
  return options.artifacts.flowSmokeReportJson;
}

export async function emitWorkflowArtifacts(options: EmitWorkflowOptions): Promise<EmittedArtifacts> {
  const artifacts = await emitMacroArtifacts(options);
  await writeRunReportJson(artifacts.runDir, buildSingleRunReport({ ...options, artifacts }));
  const clockPort = options.spec.ports.clock.value[0];
  const analysis = await analyzeEmittedFlowArtifacts(
    {
      openLaneConfigJson: artifacts.openLaneConfigJson,
      openLaneSdc: artifacts.openLaneSdc,
      wrapperVerilog: artifacts.wrapperVerilog,
      openRoadReadme: artifacts.openRoadReadme,
      openRoadSmokeTcl: artifacts.openRoadSmokeTcl,
      openRoadSmokeRunnerSh: artifacts.openRoadSmokeRunnerSh,
      protocolAssumptionsSv: artifacts.protocolAssumptionsSv,
      memorySemanticsCheckerSv: artifacts.memorySemanticsCheckerSv,
      verificationPropertiesJson: artifacts.verificationPropertiesJson,
      protocolAssertionsSv: artifacts.protocolAssertionsSv,
      protocolCoversSv: artifacts.protocolCoversSv,
      memoryScoreboardSv: artifacts.memoryScoreboardSv,
      verificationBindSv: artifacts.verificationBindSv,
    },
    options.repoRoot,
    clockPort,
    { emittedAdapterIds: artifacts.emittedAdapterIds },
  );
  await writeFlowSmokeReportJson({ ...options, artifacts, analysis });
  const iterationReport = await writeIterationReportMarkdown({
    runDir: artifacts.runDir,
    macroDir: artifacts.macroDir,
    runId: options.runId,
    spec: options.spec,
    analysis,
    narrative: narrativeForRunId(options.runId),
    verificationCommands: [
      "npm test",
      "npm run typecheck",
      `npm run demo:extract -- ${options.spec.macro.name} --run-id ${options.runId}`,
      `npm run flow:quality -- ${options.runId}`,
      `npm run flow:quality -- ${options.runId} --write`,
      `npm run smoke-run -- ${options.runId}`,
    ],
    repoRoot: options.repoRoot,
  });
  return { ...artifacts, iterationReport };
}

/** Re-export helpers for tests and callers that build artifacts without full emit. */
export {
  buildHammerCacheEntry,
  buildOpenLaneConfig,
  buildOpenRoadReadme,
  buildOpenRoadSmokeTcl,
  buildOpenRoadSmokeRunnerSh,
  buildSdc,
  buildWrapperVerilog,
} from "./edaTargets.js";
