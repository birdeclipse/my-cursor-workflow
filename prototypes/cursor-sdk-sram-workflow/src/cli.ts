#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";

import { selectEdaFlowAdapters } from "./eda-adapters/index.js";

import { batchExtractAndEmit } from "./extract/batch.js";
import { emitWorkflowArtifacts, writeFlowSmokeReportJson } from "./emit/workflow.js";
import { classifyOpenRoadLogWithAdapters } from "./eda-adapters/runtime.js";
import { DEFAULT_SRAM_SOURCE_ADAPTER } from "./sram-sources/index.js";
import {
  narrativeForRunId,
  writeBatchIterationReport,
  writeIterationReportMarkdown,
} from "./emit/iterationReport.js";
import type { WorkflowRunReportPayload } from "./emit/runReport.js";
import { isSpecReviewClean, reviewSpecTraceability } from "./review/checks.js";
import { analyzeEmittedFlowArtifacts } from "./review/flowArtifactQuality.js";
import { runOpenRoadSmokeExec, writeOpenRoadSmokeExecReport } from "./smoke/openRoadSmokeRun.js";
import { runSdkPlanningAndReview, type SdkPlanningAndReviewResult } from "./sdk/agentRunner.js";
import {
  buildPlanningPrompt,
  buildReviewPrompt,
  buildSpecIntentPrompt,
  buildSpecReviewerPrompt,
  buildSvaTranslationPrompt,
  buildVerificationCollateralPrompt,
} from "./sdk/prompts.js";
import type { EmittedArtifacts, StructuredSramSpec } from "./spec/types.js";
import { emitVerificationCollateralBundle } from "./verification-collateral/emit.js";
import {
  buildDefaultPropertyProposals,
  buildVerificationIntent,
  normalizePropertyCatalog,
} from "./verification-collateral/normalize.js";
import { defaultHumanIntent, loadHumanIntentRequirements } from "./human-intent/load.js";
import { resolveHumanIntent, type ResolvedHumanIntentContext } from "./human-intent/resolve.js";
import { writeHumanIntentArtifacts } from "./human-intent/write.js";
import type { HumanIntentSource, ResolvedHumanIntent } from "./human-intent/schema.js";
import { runTuiChatSession } from "./tui/session.js";

interface CommonOptions {
  repoRoot?: string;
  macrosRoot?: string;
  outputRoot?: string;
  runId?: string;
}

const DEFAULT_MACRO = "sram22_64x32m4w8";

const DEFAULT_EMITTED_ADAPTER_IDS: readonly string[] = ["hammer", "openlane", "verification", "openroad"];

async function readEmittedAdapterIdsFromRun(runDir: string): Promise<readonly string[]> {
  try {
    const raw = await readFile(path.join(runDir, "human-intent.json"), "utf8");
    const parsed = JSON.parse(raw) as { edaTargets?: string[] };
    if (Array.isArray(parsed.edaTargets) && parsed.edaTargets.length > 0) {
      return parsed.edaTargets;
    }
  } catch {
    // No human-intent file or parse error: assume full default emit set.
  }
  return DEFAULT_EMITTED_ADAPTER_IDS;
}

function mergeHumanIntentSource(base: HumanIntentSource, ctx: ResolvedHumanIntentContext): HumanIntentSource {
  if (!ctx.usedInteractiveDisambiguation) return base;
  return {
    ...base,
    sourceKind: "merged",
    interactiveFields: [...base.interactiveFields, "macro.resolvedName"],
  };
}

function resolvePaths(options: CommonOptions): Required<CommonOptions> {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  return {
    repoRoot,
    macrosRoot: path.resolve(options.macrosRoot ?? path.join(repoRoot, "data/tier3_generators/sram22_macros")),
    outputRoot: path.resolve(options.outputRoot ?? path.join(repoRoot, "outputs")),
    runId: options.runId ?? new Date().toISOString().replace(/[:.]/g, "-"),
  };
}

async function extractAndEmit(macroName: string, options: CommonOptions) {
  const paths = resolvePaths(options);
  const discovered = (await DEFAULT_SRAM_SOURCE_ADAPTER.discover(paths.macrosRoot)).find(
    (macro) => macro.name === macroName,
  );
  if (discovered === undefined) {
    throw new Error(`Macro ${macroName} not found by ${DEFAULT_SRAM_SOURCE_ADAPTER.id} source adapter`);
  }
  const spec = await DEFAULT_SRAM_SOURCE_ADAPTER.extract(discovered, { repoRoot: paths.repoRoot });
  const artifacts = await emitWorkflowArtifacts({
    spec,
    outputRoot: paths.outputRoot,
    runId: paths.runId,
    repoRoot: paths.repoRoot,
  });
  return { paths, spec, artifacts };
}

async function writeAgentConvergenceArtifacts(options: {
  spec: StructuredSramSpec;
  artifacts: EmittedArtifacts;
  sdkResult: SdkPlanningAndReviewResult;
  humanIntent?: ResolvedHumanIntent;
}): Promise<string> {
  const convergenceRoot = path.join(options.artifacts.runDir, "convergence");
  const finalDir = path.join(convergenceRoot, "final");
  const intent = buildVerificationIntent(options.spec);
  const proposals = buildDefaultPropertyProposals(options.spec);
  const normalized = normalizePropertyCatalog(options.spec, proposals);
  const bundle = emitVerificationCollateralBundle(options.spec, normalized.catalog);

  await mkdir(finalDir, { recursive: true });

  for (const iteration of options.sdkResult.convergence?.iterations ?? []) {
    const iterationDir = path.join(convergenceRoot, `iteration-${iteration.iteration}`);
    await mkdir(iterationDir, { recursive: true });
    await writeFile(
      path.join(iterationDir, "intent.json"),
      `${JSON.stringify({ ...intent, agentResult: iteration.intent.result }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      path.join(iterationDir, "proposals.json"),
      `${JSON.stringify({ schemaVersion: "0.1.0", macro: options.spec.macro.name, proposals, agentResult: iteration.proposal.result }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      path.join(iterationDir, "review.json"),
      `${JSON.stringify({ decision: iteration.decision, agentResult: iteration.review.result }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(path.join(iterationDir, "quality.json"), `${JSON.stringify(normalized.findings, null, 2)}\n`, "utf8");
  }

  await writeFile(path.join(finalDir, "properties.json"), bundle.propertiesJson, "utf8");
  await writeFile(
    path.join(finalDir, `${options.spec.macro.name}_protocol_assumptions.sv`),
    bundle.protocolAssumptionsSv,
    "utf8",
  );
  await writeFile(
    path.join(finalDir, `${options.spec.macro.name}_protocol_assertions.sv`),
    bundle.protocolAssertionsSv,
    "utf8",
  );
  await writeFile(
    path.join(finalDir, `${options.spec.macro.name}_protocol_covers.sv`),
    bundle.protocolCoversSv,
    "utf8",
  );
  await writeFile(
    path.join(finalDir, `${options.spec.macro.name}_memory_scoreboard.sv`),
    bundle.memoryScoreboardSv,
    "utf8",
  );
  await writeFile(path.join(finalDir, `${options.spec.macro.name}_bind.sv`), bundle.bindSv, "utf8");

  const reportPath = path.join(options.artifacts.runDir, "agent-convergence-report.md");
  const status = options.sdkResult.convergence?.status ?? "blocked";
  const humanSection =
    options.humanIntent === undefined
      ? ""
      : (() => {
          const hi = options.humanIntent;
          const notesRendered =
            hi.notes.length > 0 ? hi.notes.map((note) => `  - ${note}`).join("\n") : "  - (none)";
          return `

## Human intent

- Designer goal: ${hi.designerGoal}
- EDA targets: ${hi.edaTargets.join(", ")}
- Verification priorities: ${hi.verification.priority.join(", ")}
- Max convergence iterations: ${String(hi.verification.maxConvergenceIterations)}
- Notes:
${notesRendered}
`;
        })();
  await writeFile(
    reportPath,
    `# SVA Convergence Report

- Macro: ${options.spec.macro.name}
- Status: ${status}
- Iterations: ${options.sdkResult.convergence?.iterations.length ?? 0}
- Normalized properties: ${normalized.catalog.properties.length}
- Normalizer errors: ${normalized.findings.filter((finding) => finding.severity === "error").length}
${humanSection}
## Why Improve

The previous deterministic SVA bundle was useful but mixed assumptions, assertions, covers, and scoreboard logic in compatibility files. This convergence bundle records role-specific agent passes and renders final SVA only from normalized structured property metadata.

## How Improve

The loop separates spec intent extraction, SVA translation, and spec review. The deterministic normalizer enforces provenance, confidence, non-tautological bodies, and full write-mask lane coverage before writing final artifacts.

## Final Artifacts

- \`convergence/final/properties.json\`
- \`convergence/final/${options.spec.macro.name}_protocol_assumptions.sv\`
- \`convergence/final/${options.spec.macro.name}_protocol_assertions.sv\`
- \`convergence/final/${options.spec.macro.name}_protocol_covers.sv\`
- \`convergence/final/${options.spec.macro.name}_memory_scoreboard.sv\`
- \`convergence/final/${options.spec.macro.name}_bind.sv\`
`,
    "utf8",
  );

  return reportPath;
}

const program = new Command();

program
  .name("sram-workflow")
  .description("Cursor SDK prototype for SRAM22 spec extraction and EDA flow setup emission.")
  .option("--repo-root <path>", "repository root", process.cwd())
  .option("--macros-root <path>", "SRAM22 macro root")
  .option("--output-root <path>", "output root")
  .option("--run-id <id>", "stable run id");

const discoverCmd = program.command("discover").description("List SRAM22 macros and detected view files.");
discoverCmd.action(async () => {
  const options = program.opts<CommonOptions>();
  const paths = resolvePaths(options);
  const macros = await DEFAULT_SRAM_SOURCE_ADAPTER.discover(paths.macrosRoot);
  process.stdout.write(`${JSON.stringify(macros, null, 2)}\n`);
});

const extractCmd = program
  .command("extract")
  .description("Extract a macro spec and emit EDA setup artifacts.")
  .option("--all", "extract and emit for every discovered SRAM22 macro")
  .option("--summary", "print compact JSON (summary fields only)")
  .argument("[macro]", "SRAM22 macro name (ignored when --all)", DEFAULT_MACRO);

extractCmd.action(async (macro: string) => {
  const globalOpts = program.opts<CommonOptions>();
  const paths = resolvePaths(globalOpts);
  const cmdOpts = extractCmd.opts<{ all?: boolean; summary?: boolean }>();

  if (cmdOpts.all === true) {
    const batch = await batchExtractAndEmit({
      macrosRoot: paths.macrosRoot,
      repoRoot: paths.repoRoot,
      outputRoot: paths.outputRoot,
      runId: paths.runId,
    });
    const runReportPath = path.join(paths.outputRoot, paths.runId, "run-report.json");
    const payload =
      cmdOpts.summary === true
        ? {
            runId: paths.runId,
            runReportPath,
            summary: {
              total: batch.results.length,
              ok: batch.results.filter((r) => r.status === "ok").length,
              skippedMissingViews: batch.results.filter((r) => r.status === "skipped_missing_views").length,
              failed: batch.results.filter((r) => r.status === "failed").length,
              ready: batch.results.filter((r) => r.readiness === "ready").length,
              blockedMissingGds: batch.results.filter((r) => r.readiness === "blocked_missing_gds").length,
            },
            macros: batch.results.map((r) =>
              r.status === "ok"
                ? {
                    macro: r.macro,
                    status: r.status,
                    readiness: r.readiness,
                    validationIssueCodes: r.validationIssueCodes,
                    traceIssueCodes: r.traceIssueCodes,
                  }
                : { macro: r.macro, status: r.status, missingViews: r.missingViews, error: r.error },
            ),
          }
        : { runId: paths.runId, runReportPath, results: batch.results };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const { paths: runPaths, spec, artifacts } = await extractAndEmit(macro, globalOpts);
  const traceIssues = reviewSpecTraceability(spec);

  if (cmdOpts.summary === true) {
    process.stdout.write(
      `${JSON.stringify(
        {
          macro: spec.macro.name,
          runId: runPaths.runId,
          runReportPath: path.join(artifacts.runDir, "run-report.json"),
          readiness: spec.validationIssues.some((i) => i.code === "missing_gds")
            ? "blocked_missing_gds"
            : "ready",
          validationIssueCodes: spec.validationIssues.map((i) => i.code),
          traceIssueCodes: traceIssues.map((i) => i.code),
          deterministicReviewClean: isSpecReviewClean(spec),
          artifactPaths: {
            specJson: artifacts.specJson,
            hammerCacheJson: artifacts.hammerCacheJson,
            openLaneConfigJson: artifacts.openLaneConfigJson,
            iterationReport: artifacts.iterationReport,
          },
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        macro: spec.macro.name,
        artifacts,
        validationIssues: spec.validationIssues,
        traceIssues,
        deterministicReviewClean: isSpecReviewClean(spec),
      },
      null,
      2,
    )}\n`,
  );
});

const agentRunCmd = program
  .command("agent-run")
  .description("Run deterministic extraction plus Cursor SDK self-planning and self-review.")
  .option("--requirements <path>", "YAML/JSON human flow requirements loaded before extraction")
  .option("--interactive", "Resolve ambiguous macro selection interactively in the terminal")
  .argument("[macro]", "SRAM22 macro name (default when no requirements macro is set)", DEFAULT_MACRO);

const chatCmd = program
  .command("chat")
  .description("Start a minimal interactive TUI chat session with SDK streaming and clarification loops.")
  .option("--requirements <path>", "YAML/JSON human flow requirements loaded before extraction")
  .option("--interactive", "Resolve ambiguous macro selection interactively in the terminal")
  .argument("[macro]", "SRAM22 macro name (default when no requirements macro is set)", DEFAULT_MACRO);

function buildTuiInitialPrompt(spec: StructuredSramSpec, artifacts: EmittedArtifacts, intent: ResolvedHumanIntent): string {
  return `You are assisting an SRAM workflow operator in an interactive terminal session.

Context:
- Macro: ${spec.macro.name}
- Run directory: ${artifacts.runDir}
- Designer goal: ${intent.designerGoal}
- EDA targets: ${intent.edaTargets.join(", ")}
- Verification priorities: ${intent.verification.priority.join(", ")}

Rules:
1. Ask clarification whenever requirements or key decisions are ambiguous.
2. For required clarification, output this exact machine block:
CLARIFICATION_REQUEST:
question: <single concise question>
choices: <choice1>|<choice2>|...
required: true
3. For optional clarification, set required to false.
4. Keep every response concise and source-backed.

Start by briefly summarizing what you understand and list the next decisions that may need user confirmation.`;
}

agentRunCmd.action(async (macro: string) => {
  const apiKey = process.env.CURSOR_API_KEY;
  if (apiKey === undefined || apiKey.trim() === "") {
    throw new Error("CURSOR_API_KEY is required for agent-run; use extract for API-free deterministic emission.");
  }
  const globalOpts = program.opts<CommonOptions>();
  const agentOpts = agentRunCmd.opts<{ requirements?: string; interactive?: boolean }>();
  const paths = resolvePaths(globalOpts);
  const discovered = await DEFAULT_SRAM_SOURCE_ADAPTER.discover(paths.macrosRoot);
  const loaded =
    agentOpts.requirements !== undefined
      ? await loadHumanIntentRequirements(path.resolve(agentOpts.requirements))
      : defaultHumanIntent(macro);
  const resolvedCtx = await resolveHumanIntent({
    loaded,
    discovered,
    interactive: agentOpts.interactive === true,
  });
  const spec = await DEFAULT_SRAM_SOURCE_ADAPTER.extract(resolvedCtx.selectedMacro, { repoRoot: paths.repoRoot });
  const adapters = selectEdaFlowAdapters(resolvedCtx.intent.edaTargets);
  let artifacts = await emitWorkflowArtifacts({
    spec,
    outputRoot: paths.outputRoot,
    runId: paths.runId,
    repoRoot: paths.repoRoot,
    edaAdapters: adapters,
  });
  const intentSource = mergeHumanIntentSource(loaded.source, resolvedCtx);
  const humanPaths = await writeHumanIntentArtifacts({
    runDir: artifacts.runDir,
    intent: resolvedCtx.intent,
    source: intentSource,
  });
  artifacts = {
    ...artifacts,
    humanIntentJson: humanPaths.intentJson,
    humanIntentSourceJson: humanPaths.sourceJson,
  };
  const agentVerificationCollateralMd = path.join(artifacts.runDir, "agent-verification-collateral.md");
  const humanIntent = resolvedCtx.intent;
  const sdkResult = await runSdkPlanningAndReview({
    apiKey,
    cwd: paths.repoRoot,
    planningPrompt: buildPlanningPrompt(spec, humanIntent),
    collateralPrompt: buildVerificationCollateralPrompt(spec, artifacts, humanIntent),
    reviewPrompt: buildReviewPrompt(spec, artifacts, humanIntent),
    eventLogPath: path.join(artifacts.runDir, "agent-events.jsonl"),
    convergence: {
      maxIterations: humanIntent.verification.maxConvergenceIterations,
      intentPrompt: buildSpecIntentPrompt(spec, humanIntent),
      translationPrompt: buildSvaTranslationPrompt(spec, humanIntent),
      reviewerPrompt: buildSpecReviewerPrompt(spec, humanIntent),
      decideIteration: () => {
        const normalized = normalizePropertyCatalog(spec, buildDefaultPropertyProposals(spec));
        const errorCount = normalized.findings.filter((finding) => finding.severity === "error").length;
        return errorCount === 0
          ? { status: "accept", rationale: "deterministic normalizer accepted source-backed property catalog" }
          : {
              status: "revise",
              rationale: "deterministic normalizer found fixable collateral issues",
              repeatedFindingCodes: normalized.findings
                .filter((finding) => finding.severity === "error")
                .map((finding) => finding.code),
            };
      },
    },
  });
  await writeFile(agentVerificationCollateralMd, `${sdkResult.verificationCollateral.result ?? ""}\n`, "utf8");
  const agentConvergenceReport = await writeAgentConvergenceArtifacts({
    spec,
    artifacts,
    sdkResult,
    humanIntent,
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        spec: spec.macro.name,
        artifacts: { ...artifacts, agentVerificationCollateralMd, agentConvergenceReport },
        sdkResult,
      },
      null,
      2,
    )}\n`,
  );
});

chatCmd.action(async (macro: string) => {
  const apiKey = process.env.CURSOR_API_KEY;
  if (apiKey === undefined || apiKey.trim() === "") {
    throw new Error("CURSOR_API_KEY is required for chat.");
  }
  const globalOpts = program.opts<CommonOptions>();
  const chatOpts = chatCmd.opts<{ requirements?: string; interactive?: boolean }>();
  const paths = resolvePaths(globalOpts);
  const discovered = await DEFAULT_SRAM_SOURCE_ADAPTER.discover(paths.macrosRoot);
  const loaded =
    chatOpts.requirements !== undefined
      ? await loadHumanIntentRequirements(path.resolve(chatOpts.requirements))
      : defaultHumanIntent(macro);
  const resolvedCtx = await resolveHumanIntent({
    loaded,
    discovered,
    interactive: chatOpts.interactive === true,
  });
  const spec = await DEFAULT_SRAM_SOURCE_ADAPTER.extract(resolvedCtx.selectedMacro, { repoRoot: paths.repoRoot });
  const adapters = selectEdaFlowAdapters(resolvedCtx.intent.edaTargets);
  let artifacts = await emitWorkflowArtifacts({
    spec,
    outputRoot: paths.outputRoot,
    runId: paths.runId,
    repoRoot: paths.repoRoot,
    edaAdapters: adapters,
  });
  const intentSource = mergeHumanIntentSource(loaded.source, resolvedCtx);
  const humanPaths = await writeHumanIntentArtifacts({
    runDir: artifacts.runDir,
    intent: resolvedCtx.intent,
    source: intentSource,
  });
  artifacts = {
    ...artifacts,
    humanIntentJson: humanPaths.intentJson,
    humanIntentSourceJson: humanPaths.sourceJson,
  };

  await runTuiChatSession({
    apiKey,
    cwd: paths.repoRoot,
    eventLogPath: path.join(artifacts.runDir, "chat-events.jsonl"),
    initialPrompt: buildTuiInitialPrompt(spec, artifacts, resolvedCtx.intent),
  });
});

const flowQualityCmd = program
  .command("flow-quality")
  .description("Re-run deterministic flow-quality checks on outputs/<run-id>.")
  .argument("<run-id>", "Run id under the output root")
  .option("--write", "Rewrite iteration-report.md from fresh analysis");

const smokeRunCmd = program
  .command("smoke-run")
  .description(
    "Attempt OpenROAD smoke execution for outputs/<run-id> (single-macro run-report), refresh openroad-smoke-log-report.json, write openroad-smoke-exec-report.json.",
  )
  .argument("<run-id>", "Run id under the output root")
  .option("--docker-image <image>", "Optional Docker image to run run-openroad-smoke.sh inside (requires Docker CLI)")
  .option("--timeout-ms <n>", "Runner timeout in milliseconds", "120000");

smokeRunCmd.action(async (runId: string) => {
  const globalOpts = program.opts<CommonOptions>();
  const paths = resolvePaths({ ...globalOpts, runId });
  const smokeOpts = smokeRunCmd.opts<{ dockerImage?: string; timeoutMs?: string }>();
  const timeoutParsed =
    smokeOpts.timeoutMs === undefined ? 120_000 : Number.parseInt(smokeOpts.timeoutMs, 10);
  const timeoutMs = Number.isFinite(timeoutParsed) ? timeoutParsed : 120_000;

  const report = await runOpenRoadSmokeExec({
    outputRoot: paths.outputRoot,
    runId: paths.runId,
    dockerImage: smokeOpts.dockerImage,
    timeoutMs,
    logClassifier: classifyOpenRoadLogWithAdapters,
  });

  if (report.execution.mode !== "skipped_batch_run") {
    const macroDir = path.join(paths.outputRoot, paths.runId, report.macro);
    await writeFile(
      path.join(macroDir, "openroad-smoke-log-report.json"),
      `${JSON.stringify(report.logClassification, null, 2)}\n`,
      "utf8",
    );
    await writeOpenRoadSmokeExecReport(macroDir, report);
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
});

flowQualityCmd.action(async (runId: string) => {
  const globalOpts = program.opts<CommonOptions>();
  const paths = resolvePaths({ ...globalOpts, runId });
  const q = flowQualityCmd.opts<{ write?: boolean }>();
  const runDir = path.join(paths.outputRoot, paths.runId);
  const reportRaw = await readFile(path.join(runDir, "run-report.json"), "utf8");
  const report = JSON.parse(reportRaw) as WorkflowRunReportPayload;

  if (report.mode === "single") {
    const macroDir = path.join(runDir, report.macro);
    const spec = JSON.parse(await readFile(path.join(macroDir, "spec.json"), "utf8")) as StructuredSramSpec;
    const artifacts: EmittedArtifacts = {
      runDir,
      macroDir,
      specYaml: path.join(macroDir, "spec.yaml"),
      specJson: path.join(macroDir, "spec.json"),
      hammerCacheJson: path.join(macroDir, "sram-cache.json"),
      wrapperVerilog: path.join(macroDir, `${report.macro}_wrapper.v`),
      protocolAssumptionsSv: path.join(macroDir, `${report.macro}_protocol_assumptions.sv`),
      memorySemanticsCheckerSv: path.join(macroDir, `${report.macro}_memory_semantics_checker.sv`),
      verificationPropertiesJson: path.join(macroDir, "properties.json"),
      protocolAssertionsSv: path.join(macroDir, `${report.macro}_protocol_assertions.sv`),
      protocolCoversSv: path.join(macroDir, `${report.macro}_protocol_covers.sv`),
      memoryScoreboardSv: path.join(macroDir, `${report.macro}_memory_scoreboard.sv`),
      verificationBindSv: path.join(macroDir, `${report.macro}_bind.sv`),
      flowSmokeReportJson: path.join(macroDir, "flow-smoke-report.json"),
      openRoadSmokeTcl: path.join(macroDir, "openroad-smoke.tcl"),
      openRoadSmokeRunnerSh: path.join(macroDir, "run-openroad-smoke.sh"),
      openRoadSmokeLogReportJson: path.join(macroDir, "openroad-smoke-log-report.json"),
      openLaneConfigJson: path.join(macroDir, "openlane.config.json"),
      openLaneSdc: path.join(macroDir, "base.sdc"),
      openRoadReadme: path.join(macroDir, "openroad-setup.md"),
      runReportJson: path.join(runDir, "run-report.json"),
      emittedAdapterIds: await readEmittedAdapterIdsFromRun(runDir),
    };
    const clock = spec.ports.clock.value[0];
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
      paths.repoRoot,
      clock,
      { emittedAdapterIds: artifacts.emittedAdapterIds },
    );
    await writeFlowSmokeReportJson({ artifacts, spec, runId: paths.runId, repoRoot: paths.repoRoot, analysis });
    let iterationReport: string | undefined;
    if (q.write === true) {
      iterationReport = await writeIterationReportMarkdown({
        runDir,
        macroDir,
        runId: paths.runId,
        spec,
        analysis,
        narrative: narrativeForRunId(paths.runId),
        verificationCommands: [
          "npm test",
          "npm run typecheck",
          `npm run demo:extract -- ${report.macro} --run-id ${paths.runId}`,
          `npm run flow:quality -- ${paths.runId}`,
          `npm run flow:quality -- ${paths.runId} --write`,
          `npm run smoke-run -- ${paths.runId}`,
        ],
        repoRoot: paths.repoRoot,
      });
    }
    process.stdout.write(
      `${JSON.stringify({ runId: paths.runId, mode: "single", analysis, iterationReport }, null, 2)}\n`,
    );
    return;
  }

  if (q.write === true) {
    const iterationReport = await writeBatchIterationReport({
      runDir,
      runId: paths.runId,
      repoRoot: paths.repoRoot,
      results: report.macros,
      narrative: narrativeForRunId(paths.runId),
    });
    process.stdout.write(`${JSON.stringify({ runId: paths.runId, mode: "batch", iterationReport }, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        runId: paths.runId,
        mode: "batch",
        hint: "Batch mode: pass --write to regenerate iteration-report.md from on-disk artifacts.",
      },
      null,
      2,
    )}\n`,
  );
});

await program.parseAsync(process.argv);
