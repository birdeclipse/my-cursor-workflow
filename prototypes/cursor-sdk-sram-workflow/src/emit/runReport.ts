import { writeFile } from "node:fs/promises";

import { macroReadinessFromSpec } from "../extract/readiness.js";
import type { EmittedArtifacts, StructuredSramSpec, ValidationIssue } from "../spec/types.js";

export interface RunReportReadinessAggregate {
  ready: number;
  blockedMissingGds: number;
}

export interface BatchMacroResult {
  macro: string;
  status: "ok" | "skipped_missing_views" | "failed";
  readiness?: "ready" | "blocked_missing_gds";
  missingViews?: string[];
  error?: string;
  validationIssueCodes?: string[];
  traceIssueCodes?: string[];
}

export interface SingleRunReportPayload {
  mode: "single";
  runId: string;
  macro: string;
  readiness: "ready" | "blocked_missing_gds";
  artifacts: EmittedArtifacts;
  validationIssues: ValidationIssue[];
  readinessAggregate: RunReportReadinessAggregate;
}

export interface BatchRunReportPayload {
  mode: "batch";
  runId: string;
  summary: {
    /** Macros returned by discover (directory scan). */
    totalDiscovered: number;
    /** Rows in `macros` (one per discovered macro, including skips/failures). */
    recorded: number;
    skippedMissingViews: number;
    failed: number;
    succeeded: number;
    readiness: RunReportReadinessAggregate;
  };
  macros: BatchMacroResult[];
}

export type WorkflowRunReportPayload = SingleRunReportPayload | BatchRunReportPayload;

export function buildReadinessAggregateFromValidation(issues: ValidationIssue[]): RunReportReadinessAggregate {
  const blocked = issues.some((i) => i.code === "missing_gds");
  return {
    ready: blocked ? 0 : 1,
    blockedMissingGds: blocked ? 1 : 0,
  };
}

export function buildReadinessAggregateBatch(results: BatchMacroResult[]): RunReportReadinessAggregate {
  let ready = 0;
  let blockedMissingGds = 0;
  for (const r of results) {
    if (r.status !== "ok" || r.readiness === undefined) continue;
    if (r.readiness === "ready") ready += 1;
    else blockedMissingGds += 1;
  }
  return { ready, blockedMissingGds };
}

export function buildSingleRunReport(options: {
  runId: string;
  spec: StructuredSramSpec;
  artifacts: EmittedArtifacts;
}): SingleRunReportPayload {
  const readiness = macroReadinessFromSpec(options.spec.validationIssues);
  return {
    mode: "single",
    runId: options.runId,
    macro: options.spec.macro.name,
    readiness,
    artifacts: options.artifacts,
    validationIssues: options.spec.validationIssues,
    readinessAggregate: buildReadinessAggregateFromValidation(options.spec.validationIssues),
  };
}

export function buildBatchRunReport(
  runId: string,
  results: BatchMacroResult[],
  totalDiscovered: number,
): BatchRunReportPayload {
  const succeeded = results.filter((m) => m.status === "ok").length;
  const failed = results.filter((m) => m.status === "failed").length;
  const skippedMissingViews = results.filter((m) => m.status === "skipped_missing_views").length;
  return {
    mode: "batch",
    runId,
    summary: {
      totalDiscovered,
      recorded: results.length,
      skippedMissingViews,
      failed,
      succeeded,
      readiness: buildReadinessAggregateBatch(results),
    },
    macros: results,
  };
}

export async function writeRunReportJson(runDir: string, payload: WorkflowRunReportPayload): Promise<string> {
  const runReportJson = `${runDir}/run-report.json`;
  await writeFile(runReportJson, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return runReportJson;
}
