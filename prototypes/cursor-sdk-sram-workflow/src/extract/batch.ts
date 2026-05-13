import { mkdir } from "node:fs/promises";
import path from "node:path";

import { narrativeForRunId, writeBatchIterationReport } from "../emit/iterationReport.js";
import { emitMacroArtifacts, writeFlowSmokeReportJson } from "../emit/workflow.js";
import {
  buildBatchRunReport,
  writeRunReportJson,
  type BatchMacroResult,
} from "../emit/runReport.js";
import { probeToolsForAdapters } from "../eda-adapters/runtime.js";
import { reviewSpecTraceability } from "../review/checks.js";
import { DEFAULT_SRAM_SOURCE_ADAPTER } from "../sram-sources/index.js";
import { listMissingCriticalViews, macroReadinessFromSpec } from "./readiness.js";

export interface BatchExtractEmitOptions {
  macrosRoot: string;
  repoRoot: string;
  outputRoot: string;
  runId: string;
  /** When false, stop after first extraction/emit failure. Default true. */
  continueOnError?: boolean;
}

export interface BatchExtractEmitResult {
  results: BatchMacroResult[];
}

export async function batchExtractAndEmit(options: BatchExtractEmitOptions): Promise<BatchExtractEmitResult> {
  const continueOnError = options.continueOnError ?? true;
  const runDir = path.join(options.outputRoot, options.runId);
  await mkdir(runDir, { recursive: true });

  const macros = await DEFAULT_SRAM_SOURCE_ADAPTER.discover(options.macrosRoot);
  const results: BatchMacroResult[] = [];
  const flowTools = await probeToolsForAdapters();
  const openRoadTool = flowTools.find((tool) => tool.tool === "openroad");
  const openRoadProbe =
    openRoadTool === undefined ? undefined : { available: openRoadTool.available, detail: openRoadTool.detail };

  for (const discovered of macros) {
    const missing = listMissingCriticalViews(discovered.views);
    if (missing.length > 0) {
      results.push({
        macro: discovered.name,
        status: "skipped_missing_views",
        missingViews: missing,
      });
      continue;
    }

    try {
      const spec = await DEFAULT_SRAM_SOURCE_ADAPTER.extract(discovered, { repoRoot: options.repoRoot });
      const artifacts = await emitMacroArtifacts({
        spec,
        outputRoot: options.outputRoot,
        runId: options.runId,
        repoRoot: options.repoRoot,
      });
      await writeFlowSmokeReportJson({
        artifacts,
        spec,
        runId: options.runId,
        repoRoot: options.repoRoot,
        analysis: { openRoad: openRoadProbe ?? { available: false, detail: "openroad probe unavailable" }, findings: [] },
        tools: flowTools,
        runSyntaxChecks: false,
        openRoadProbe,
      });
      const traceIssues = reviewSpecTraceability(spec);
      results.push({
        macro: discovered.name,
        status: "ok",
        readiness: macroReadinessFromSpec(spec.validationIssues),
        validationIssueCodes: spec.validationIssues.map((i) => i.code),
        traceIssueCodes: traceIssues.map((i) => i.code),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        macro: discovered.name,
        status: "failed",
        error: message,
      });
      if (!continueOnError) break;
    }
  }

  await writeRunReportJson(runDir, buildBatchRunReport(options.runId, results, macros.length));
  await writeBatchIterationReport({
    runDir,
    runId: options.runId,
    repoRoot: options.repoRoot,
    results,
    narrative: narrativeForRunId(options.runId),
  });

  return { results };
}
