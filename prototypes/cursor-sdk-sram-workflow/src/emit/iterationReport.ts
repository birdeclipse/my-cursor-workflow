import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  analyzeEmittedFlowArtifacts,
  probeOpenRoadBinary,
  type FlowArtifactAnalysis,
  type FlowQualityFinding,
} from "../review/flowArtifactQuality.js";
import { DEFAULT_EDA_FLOW_ADAPTERS } from "../eda-adapters/index.js";
import type { BatchMacroResult } from "./runReport.js";
import type { StructuredSramSpec } from "../spec/types.js";

export interface IterationNarrative {
  goal: string;
  evidenceAndResearchBasis: string;
  changesMadeThisIteration: string;
  whyImprove: string;
  howImprove: string;
}

const RALPH_OPENROAD_ITERATION_1: IterationNarrative = {
  goal:
    "Extend the Cursor SDK SRAM workflow with a repeatable Ralph-loop artifact: per-run markdown that records goals, research basis, deterministic OpenLane/OpenROAD-oriented quality checks, and verification commands. This iteration targets static validation against local `data/eda_flow_refs` expectations and optional OpenROAD CLI discovery.",
  evidenceAndResearchBasis:
    "- OpenLane **required** configuration variables (`DESIGN_NAME`, `VERILOG_FILES`, `CLOCK_PERIOD`, `CLOCK_NET`, `CLOCK_PORT`) are taken from `data/eda_flow_refs/OpenLane/docs/source/reference/configuration.md`.\n" +
    "- Macro integration guidance (`EXTRA_LEFS`, `EXTRA_LIBS`, `EXTRA_GDS_FILES`, `VERILOG_FILES_BLACKBOX`) appears in the same document and in `data/eda_flow_refs/OpenLane/docs/source/usage/hardening_macros.md`.\n" +
    "- Hammer + OpenROAD getting-started context: `data/eda_flow_refs/hammer/doc/Examples/openroad-sky130.md` (used when OpenROAD binary is missing to document static-only mode).",
  changesMadeThisIteration:
    "- Added `prototypes/cursor-sdk-sram-workflow/src/review/flowArtifactQuality.ts` — JSON/SDC/readme parsers, view path readability checks, OpenLane required-key audit, optional OpenROAD `openroad -version` probe.\n" +
    "- Added `prototypes/cursor-sdk-sram-workflow/src/emit/iterationReport.ts` and wired it into `emitWorkflowArtifacts`.\n" +
    "- CLI: `flow-quality` to re-scan a prior run directory; npm script `flow:quality`.\n" +
    "- Batch extract now writes `iteration-report.md` summarizing per-macro findings.\n" +
    "- Vitest coverage for deterministic parsers.",
  whyImprove:
    "Flow stubs (`openlane.config.json`, `base.sdc`, `openroad-setup.md`) are easy to generate but hard to trust without machine-checkable gates. Prior output lacked a single report tying research references, missing OpenLane-required fields, low-confidence timing placeholders, and runtime tool availability.",
  howImprove:
    "Encode OpenLane required keys and prototype-extension keys as deterministic audits; parse SDC `create_clock` against `CLOCK_PORT`; verify referenced view files resolve under `repoRoot`; probe OpenROAD once per batch; emit a structured `iteration-report.md` beside `run-report.json` for humans and Ralph loops.",
};

export function narrativeForRunId(runId: string): IterationNarrative {
  if (runId === "ralph-openroad-iteration-1") {
    return { ...RALPH_OPENROAD_ITERATION_1 };
  }
  if (runId === "ralph-openroad-iteration-2") {
    return {
      goal:
        "Close the OpenLane quality gaps found in iteration 1 by emitting a minimal wrapper RTL and complete required OpenLane clock / Verilog fields.",
      evidenceAndResearchBasis:
        "- Iteration 1 reported missing `VERILOG_FILES` and `CLOCK_NET` against `data/eda_flow_refs/OpenLane/docs/source/reference/configuration.md`.\n" +
        "- Macro integration still follows `VERILOG_FILES_BLACKBOX`, `EXTRA_LEFS`, `EXTRA_LIBS`, and `EXTRA_GDS_FILES` guidance from the OpenLane macro hardening docs.",
      changesMadeThisIteration:
        "- Added generated `<macro>_wrapper.v` that instantiates the SRAM22 macro using traced port names and widths.\n" +
        "- Added `VERILOG_FILES`, `VERILOG_FILES_BLACKBOX`, and `CLOCK_NET` to `openlane.config.json`.\n" +
        "- Extended flow-quality path checks to validate wrapper RTL and blackbox Verilog references.",
      whyImprove:
        "A config that passes required-key checks is much closer to a runnable OpenLane/OpenROAD smoke folder. Keeping the wrapper generated from the structured spec also tests that extracted ports and widths are useful beyond documentation.",
      howImprove:
        "Generate deterministic wrapper RTL beside each macro output, point OpenLane `VERILOG_FILES` at that wrapper, keep the SRAM macro Verilog as `VERILOG_FILES_BLACKBOX`, and re-run the static flow-quality analyzer.",
    };
  }
  if (runId === "ralph-openroad-iteration-3") {
    return {
      goal:
        "Replace the prototype default clock period with a traced Liberty `minimum_period` value so generated OpenLane/SDC timing is source-backed.",
      evidenceAndResearchBasis:
        "- Iteration 2 left only low-confidence clock warnings after required OpenLane keys and wrapper RTL were added.\n" +
        "- SRAM22 Liberty files contain `timing_type : minimum_period` constraints on `pin (clk)` across TT/FF/SS corners.",
      changesMadeThisIteration:
        "- Extracted per-corner Liberty `minimum_period` values and selected the worst available clock period.\n" +
        "- Added `timing.clockPeriodNs` to the structured spec schema with provenance.\n" +
        "- Emitted `CLOCK_PERIOD` and `base.sdc create_clock` from that traced timing value instead of the 10 ns prototype default.",
      whyImprove:
        "A fabricated or placeholder clock period prevents meaningful flow-script quality review. A Liberty-backed period makes the OpenLane config and SDC reproducible from source views and removes the known low-confidence timing warning.",
      howImprove:
        "Parse numeric values from Liberty `minimum_period` timing blocks, preserve source references, compute the maximum across available process corners, and propagate the traced value into OpenLane and SDC artifacts.",
    };
  }
  if (runId === "ralph-openroad-iteration-4") {
    return {
      goal:
        "Enrich the structured SRAM KB with explicit pin protocol semantics from behavioral Verilog (posedge clock sampling, CE/WE/rstb gating, wmask lane mapping) and emit bindable SystemVerilog assertion sidecars for OpenROAD/OpenLane-adjacent verification workflows.",
      evidenceAndResearchBasis:
        "- SRAM22 behavioral `always @(posedge clk)` with `if (ce && rstb)` gating, `if (we)` masked writes, and `if (!we)` reads in each macro `.v` under `data/tier3_generators/sram22_macros/`.\n" +
        "- Port comments on `rstb` (reset bar / active low) and per-bit `wmask[k]` routing to `mem`/`din` slices in the same sources.\n" +
        "- Structural triangulation from macro-name `w<writeSize>`, `WMASK_WIDTH`, and `DATA_WIDTH` localparams.",
      changesMadeThisIteration:
        "- Added `interfaceProtocol` to the structured spec with `SourceRef`/`TracedValue` provenance.\n" +
        "- Extended deterministic Verilog parsing for protocol evidence (clock edge, gating expr, WE branches, wmask lane extraction).\n" +
        "- Emitted per-macro `${macro}_protocol_assumptions.sv` and `${macro}_memory_semantics_checker.sv` (semantics file is an explicit TODO scaffold for blackbox flows).\n" +
        "- Extended flow-quality static analysis for SVA presence and basic module/property structure.",
      whyImprove:
        "OpenLane/OpenROAD configs tell you *which files to use*, not how control pins compose during active cycles. Encoding protocol semantics makes the KB usable for formal property tying, VIP assumptions, and scoreboards without re-deriving Verilog by hand each iteration.",
      howImprove:
        "Lift textual and structural facts into `interfaceProtocol`, mirror them into generated SVA modules parameterized by extracted widths, and gate Ralph progress with deterministic SVA hygiene checks (module/property/IO) alongside existing JSON/SDC audits.",
    };
  }
  if (runId === "ralph-openroad-iteration-5") {
    return {
      goal:
        "Add a planner-ready flow smoke report that probes local EDA tool availability and classifies whether the emitted OpenLane/OpenROAD setup can advance from static checks to dynamic execution.",
      evidenceAndResearchBasis:
        "- `outputs/ralph-research-iteration-4/academic-research-and-optimization-plan.md` recommends executable flow smoke plus structured tool-feedback after pin semantics/SVA.\n" +
        "- Prior iteration reports repeatedly showed `openroad` unavailable, so the loop needs a saved machine-readable reason instead of only prose in markdown.",
      changesMadeThisIteration:
        "- Added `flow-smoke-report.json` beside each macro output.\n" +
        "- Probed OpenROAD/OpenLane/Yosys/Verilator versions and classified missing/timeouts/errors into planner feedback.\n" +
        "- Preserved static flow-quality counts inside the smoke report so future Ralph planners can distinguish tool absence from generated artifact errors.",
      whyImprove:
        "Without a saved tool-feedback artifact, each iteration rediscovers that dynamic OpenROAD/OpenLane execution is unavailable. A structured smoke report lets the next planner choose between installing a pinned container, improving static checks, or running dynamic elaboration when tools exist.",
      howImprove:
        "Run lightweight version probes after artifact emission, combine the probe results with static JSON/SDC/SVA quality counts, and write a deterministic JSON report that future iterations can consume before proposing fixes.",
    };
  }
  if (runId === "ralph-openroad-iteration-6") {
    return {
      goal:
        "Use the locally available Verilator tool to run syntax smoke checks on generated wrapper RTL and SVA sidecars, while OpenROAD/OpenLane remain unavailable.",
      evidenceAndResearchBasis:
        "- Iteration 5 `flow-smoke-report.json` showed `verilator` available but `openroad`, `openlane`, and `yosys` missing.\n" +
        "- The iteration 4 research scan recommends a progressive assertion pipeline with syntax/tool feedback before deeper OpenLane/OpenROAD execution.",
      changesMadeThisIteration:
        "- Added per-top Verilator lint plans for wrapper RTL, protocol SVA, and memory-semantics SVA.\n" +
        "- Wrote syntax-check results into `flow-smoke-report.json` so the next planner sees which generated HDL artifacts are tool-parseable.\n" +
        "- Avoided false `MULTITOP` failures by linting each generated top separately.",
      whyImprove:
        "Static JSON/SDC checks can say paths and keys are coherent, but they cannot prove generated Verilog/SVA parses in an HDL tool. Verilator lint gives a cheap executable gate before investing in full OpenLane/OpenROAD containers.",
      howImprove:
        "Detect Verilator availability from the existing smoke probe, run `verilator --lint-only --sv --top-module ...` separately for wrapper/protocol/semantics artifacts, classify pass/fail/skipped outcomes, and save them into the smoke report.",
    };
  }
  if (runId === "ralph-openroad-iteration-7") {
    return {
      goal:
        "Emit a concrete OpenROAD smoke TCL script and statically audit it so the workflow has a ready command surface once OpenROAD/OpenLane/Yosys are available.",
      evidenceAndResearchBasis:
        "- Iteration 6 proved generated wrapper/SVA syntax with Verilator but still could not execute OpenROAD because the binary is unavailable.\n" +
        "- OpenROAD/Hammer references under `data/eda_flow_refs/hammer/doc/Examples/openroad-sky130.md` show the flow needs explicit view-loading and design-link steps before timing reports.",
      changesMadeThisIteration:
        "- Added `openroad-smoke.tcl` to per-macro outputs.\n" +
        "- The script reads LEF, Liberty, wrapper RTL, macro Verilog, links the wrapper top, reads `base.sdc`, and requests `report_checks`.\n" +
        "- Extended flow-quality to statically fail if required OpenROAD TCL setup commands are missing.",
      whyImprove:
        "Tool probes explain why dynamic execution is blocked, but they do not improve the flow package itself. A checked OpenROAD TCL entrypoint turns the emitted directory into a more runnable artifact and gives future containerized runs a deterministic script to execute.",
      howImprove:
        "Generate `openroad-smoke.tcl` directly from traced view paths and wrapper naming, add deterministic command-presence checks, list the script in iteration outputs, and keep dynamic execution gated by tool availability.",
    };
  }
  if (runId === "ralph-openroad-iteration-8") {
    return {
      goal:
        "Add a cwd-safe OpenROAD smoke runner script that executes the generated TCL and captures logs when OpenROAD becomes available.",
      evidenceAndResearchBasis:
        "- Iteration 7 emitted and audited `openroad-smoke.tcl`, but dynamic execution still required users or future agents to know the correct working directory and log-capture convention.\n" +
        "- Iteration 5/6 smoke reports recommend a pinned flow container or installed tools before dynamic execution; a runner gives that environment a deterministic command surface.",
      changesMadeThisIteration:
        "- Added `run-openroad-smoke.sh` beside each macro output.\n" +
        "- The runner checks for `openroad`, changes to the macro output directory, executes `openroad -exit openroad-smoke.tcl`, and tees output to `openroad-smoke.log`.\n" +
        "- Extended flow-quality to fail if runner safety/logging commands are missing.",
      whyImprove:
        "A TCL file alone is easy to run from the wrong directory and lose logs from. A checked runner makes future OpenROAD execution reproducible and gives Ralph a stable log path to classify in the next optimization loop.",
      howImprove:
        "Emit a small strict-mode shell runner, add deterministic static checks for path safety and log capture, list it in saved outputs, and keep dynamic status gated by tool probes.",
    };
  }
  if (runId === "ralph-openroad-iteration-9") {
    return {
      goal:
        "Add a machine-readable OpenROAD smoke log classification report so future dynamic runs feed actionable failure classes back into the Ralph planner.",
      evidenceAndResearchBasis:
        "- Iteration 8 created `run-openroad-smoke.sh` and the stable `openroad-smoke.log` path, but without a classifier the next loop would still need to interpret raw logs manually.\n" +
        "- The research scan recommends backend-aware/tool-feedback loops that classify EDA failures before proposing one corrective template or KB change.",
      changesMadeThisIteration:
        "- Added `openroad-smoke-log-report.json` beside each macro output.\n" +
        "- The report records `not_run` when no log exists and classifies missing input, link failure, error, and warning patterns when a log is present.\n" +
        "- The report includes next-planner hints for rerunning flow-quality after an OpenROAD-capable smoke run.",
      whyImprove:
        "A saved runner gets OpenROAD output onto disk, but raw logs are not planner-ready. Classifying log signatures creates a stable interface from dynamic EDA execution back to agent planning and keeps fixes focused on one failure class at a time.",
      howImprove:
        "Generate a JSON report during emission/quality refresh, read `openroad-smoke.log` if present, map known diagnostics to explicit codes, and preserve `not_run` status while OpenROAD is unavailable.",
    };
  }
  if (runId === "ralph-openroad-iteration-10") {
    return {
      goal:
        "Add a repeatable CLI step that attempts dynamic OpenROAD smoke execution against a prior emitted macro folder, captures bounded stdout/stderr, refreshes log classification JSON, and emits a planner-facing exec report—without hanging when tools are missing.",
      evidenceAndResearchBasis:
        "- Iteration 9 classified logs once written but still required manual shell invocation to produce `openroad-smoke.log`.\n" +
        "- The Ralph research loop calls for tool-aware automation that honestly records `not_run` / skip reasons when OpenROAD or Docker is unavailable, and structured JSON for downstream planners.",
      changesMadeThisIteration:
        "- Added `smoke-run` CLI command plus npm script `smoke-run`.\n" +
        "- Host path: probe `openroad -version`, run `bash run-openroad-smoke.sh` under the macro directory with a configurable timeout and capped process output capture.\n" +
        "- Optional conservative Docker path: `--docker-image <ref>` runs `docker run ... bash ./run-openroad-smoke.sh` only when the Docker CLI responds.\n" +
        "- Writes/refreshes `openroad-smoke-log-report.json` from disk via `buildOpenRoadSmokeLogReport` and adds `openroad-smoke-exec-report.json` for execution metadata.\n" +
        "- When no smoke log exists yet, log-report `nextPlannerHints` now name the exact `npm run smoke-run -- <run-id>` / `npm run flow:quality -- <run-id>` refresh sequence (plus manual shell fallback).",
      whyImprove:
        "Classification alone does not close the loop from agent to EDA tools; the workflow needed an idempotent command that either executes smoke safely or explains why it could not, using the same deterministic log classifier as flow-quality.",
      howImprove:
        "Centralize resolve-run → probe tools → bounded subprocess execution → re-read log → rebuild classification JSON → persist exec envelope; surface everything as one stdout JSON object for harness consumption.",
    };
  }
  return {
    goal:
      "Run the SRAM22 extraction + EDA stub emission and capture flow-quality findings in iteration-report.md.",
    evidenceAndResearchBasis:
      "Checks derive from OpenLane configuration reference and local `data/eda_flow_refs` (OpenLane + Hammer OpenROAD examples).",
    changesMadeThisIteration:
      "See earlier iteration reports under `outputs/<run-id>/iteration-report.md` when comparing runs.",
    whyImprove:
      "Automated quality notes reduce manual diff review of generated flow files.",
    howImprove:
      "The workflow runs deterministic parsers after emission and records results in markdown.",
  };
}

function formatInterpretation(findings: FlowQualityFinding[]): string {
  const hasMissingRequired = findings.some((f) => f.code === "openlane_missing_required_or_empty");
  const hasUnreadablePath = findings.some((f) => f.code === "referenced_view_path_unreadable");
  const hasLowConfidenceClock = findings.some((f) =>
    f.code === "low_confidence_clock_period" || f.code === "clock_period_not_from_views",
  );
  const lines: string[] = [];
  if (hasMissingRequired) {
    lines.push(
      "- **Missing OpenLane required keys** mean the stub is **not** a complete OpenLane design folder yet; add wrapper RTL paths and CTS clock net naming before `flow.tcl`.",
    );
  } else {
    lines.push("- **OpenLane required keys** are present and non-empty in the generated config.");
  }
  if (hasLowConfidenceClock) {
    lines.push("- **Low confidence clock** flags are expected until timing is traced from Liberty / user constraints.");
  }
  if (hasUnreadablePath) {
    lines.push("- **Unreadable referenced paths** indicate emission or working-directory mismatch versus `repoRoot` / macro output directory.");
  } else {
    lines.push("- **Referenced view and RTL paths** resolved successfully during static quality checks.");
  }
  return lines.join("\n");
}

function countBySeverity(findings: FlowQualityFinding[]): { error: number; warning: number; info: number } {
  return findings.reduce(
    (acc, f) => {
      acc[f.severity] += 1;
      return acc;
    },
    { error: 0, warning: 0, info: 0 },
  );
}

function formatFindingsTable(findings: FlowQualityFinding[]): string {
  if (findings.length === 0) return "| Severity | Code | Message | File | Field |\n| --- | --- | --- | --- | --- |\n| — | — | No findings | — | — |";
  const rows = findings.map((f) => {
    const msg = f.message.replace(/\|/g, "\\|");
    return `| ${f.severity} | ${f.code} | ${msg} | ${f.file ?? "—"} | ${f.field ?? "—"} |`;
  });
  return ["| Severity | Code | Message | File | Field |", "| --- | --- | --- | --- | --- |", ...rows].join("\n");
}

function relativeFromRepo(abs: string, repoRoot: string | undefined): string {
  if (repoRoot === undefined) return abs;
  const r = path.relative(repoRoot, abs);
  return r.startsWith("..") ? abs : r;
}

function formatAdapterCommandSurfaces(spec: StructuredSramSpec): string {
  const rows = DEFAULT_EDA_FLOW_ADAPTERS.map((adapter) => {
    const files = adapter.emit(spec).map((file) => file.fileName).join(", ");
    const probes = adapter.toolProbes().map((probe) => probe.command).join(", ");
    return `| ${adapter.id} | ${files === "" ? "—" : files} | ${probes === "" ? "—" : probes} |`;
  });
  return [
    "| Adapter | Emitted files | Local tool probes |",
    "| --- | --- | --- |",
    ...rows,
  ].join("\n");
}

async function formatFlowSmokeSummary(flowSmokePath: string): Promise<string> {
  try {
    const raw = await readFile(flowSmokePath, "utf8");
    const report = JSON.parse(raw) as {
      status?: string;
      syntaxChecks?: Array<{ name: string; status: string; topModule: string }>;
      nextPlannerHints?: string[];
    };
    const syntax = report.syntaxChecks ?? [];
    const syntaxRows =
      syntax.length === 0
        ? "- No syntax checks recorded."
        : syntax.map((check) => `- ${check.name}: ${check.status} (\`${check.topModule}\`)`).join("\n");
    const hints =
      report.nextPlannerHints === undefined || report.nextPlannerHints.length === 0
        ? "- No next-planner hints recorded."
        : report.nextPlannerHints.map((hint) => `- ${hint}`).join("\n");
    return `### Flow smoke report\n\n- _Status:_ **${report.status ?? "unknown"}**\n\n#### Syntax checks\n\n${syntaxRows}\n\n#### Next planner hints\n\n${hints}`;
  } catch {
    return "### Flow smoke report\n\n- _Status:_ unavailable (flow-smoke-report.json not readable).";
  }
}

export async function writeIterationReportMarkdown(options: {
  runDir: string;
  macroDir: string;
  runId: string;
  spec: StructuredSramSpec;
  analysis: FlowArtifactAnalysis;
  narrative: IterationNarrative;
  verificationCommands: string[];
  repoRoot?: string;
}): Promise<string> {
  const outPath = path.join(options.runDir, "iteration-report.md");
  const counts = countBySeverity(options.analysis.findings);
  const rr = options.repoRoot;

  const artifactLines = [
    relativeFromRepo(path.join(options.macroDir, "spec.yaml"), rr),
    relativeFromRepo(path.join(options.macroDir, "spec.json"), rr),
    relativeFromRepo(path.join(options.macroDir, "sram-cache.json"), rr),
    relativeFromRepo(path.join(options.macroDir, `${options.spec.macro.name}_wrapper.v`), rr),
    relativeFromRepo(path.join(options.macroDir, `${options.spec.macro.name}_protocol_assumptions.sv`), rr),
    relativeFromRepo(path.join(options.macroDir, `${options.spec.macro.name}_memory_semantics_checker.sv`), rr),
    relativeFromRepo(path.join(options.macroDir, "flow-smoke-report.json"), rr),
    relativeFromRepo(path.join(options.macroDir, "openroad-smoke.tcl"), rr),
    relativeFromRepo(path.join(options.macroDir, "run-openroad-smoke.sh"), rr),
    relativeFromRepo(path.join(options.macroDir, "openroad-smoke-log-report.json"), rr),
    relativeFromRepo(path.join(options.macroDir, "openroad-smoke-exec-report.json"), rr),
    relativeFromRepo(path.join(options.macroDir, "openlane.config.json"), rr),
    relativeFromRepo(path.join(options.macroDir, "base.sdc"), rr),
    relativeFromRepo(path.join(options.macroDir, "openroad-setup.md"), rr),
    relativeFromRepo(path.join(options.runDir, "run-report.json"), rr),
  ];

  const vfence = "```";
  const cmds = options.verificationCommands.map((c) => `    ${c}`).join("\n");
  const detailFence = options.analysis.openRoad.detail.replace(/```/g, "'''");
  const flowSmokeSummary = await formatFlowSmokeSummary(path.join(options.macroDir, "flow-smoke-report.json"));

  const body = `# SRAM workflow iteration report

## Run metadata
- **Run ID:** ${options.runId}
- **Macro:** ${options.spec.macro.name}
- **Generated (UTC):** ${new Date().toISOString()}

## 1. Goal

${options.narrative.goal}

## 2. Evidence / research basis

${options.narrative.evidenceAndResearchBasis}

## 3. Changes made (this iteration)

${options.narrative.changesMadeThisIteration}

## 4. Why improve

${options.narrative.whyImprove}

## 5. How improve

${options.narrative.howImprove}

## 6. Generated outputs

${artifactLines.map((l) => `- \`${l}\``).join("\n")}

### EDA adapter command surfaces

${formatAdapterCommandSurfaces(options.spec)}

## 7. OpenROAD / OpenLane script quality review

### OpenROAD binary

- _Available:_ **${String(options.analysis.openRoad.available)}**

${vfence}
${detailFence}
${vfence}

When OpenROAD is unavailable, validation stays **static** (parsed JSON/SDC/readme + file existence). See Hammer OpenROAD tutorial under \`data/eda_flow_refs/hammer/doc/Examples/openroad-sky130.md\` for installing tools.

### OpenLane / SDC / OpenROAD notes — findings

_Counts — error: ${String(counts.error)}, warning: ${String(counts.warning)}, info: ${String(counts.info)}_

${formatFindingsTable(options.analysis.findings)}

### Interpretation

${formatInterpretation(options.analysis.findings)}

${flowSmokeSummary}

## 8. Verification commands

${vfence}bash
${cmds}
${vfence}
`;

  await writeFile(outPath, body, "utf8");
  return outPath;
}

async function readClockFromOpenLaneJson(macroDir: string): Promise<string | undefined> {
  try {
    const raw = await readFile(path.join(macroDir, "openlane.config.json"), "utf8");
    const o = JSON.parse(raw) as Record<string, unknown>;
    const p = o.CLOCK_PORT;
    return typeof p === "string" ? p : undefined;
  } catch {
    return undefined;
  }
}

export async function writeBatchIterationReport(options: {
  runDir: string;
  runId: string;
  repoRoot: string;
  results: BatchMacroResult[];
  narrative: IterationNarrative;
}): Promise<string> {
  const outPath = path.join(options.runDir, "iteration-report.md");
  const ok = options.results.filter((r) => r.status === "ok");
  const openRoadProbe = await probeOpenRoadBinary();

  const sections: string[] = [];
  const allFindings: FlowQualityFinding[] = [];

  for (const r of ok) {
    const macroDir = path.join(options.runDir, r.macro);
    const clock = await readClockFromOpenLaneJson(macroDir);
    const analysis = await analyzeEmittedFlowArtifacts(
      {
        openLaneConfigJson: path.join(macroDir, "openlane.config.json"),
        openLaneSdc: path.join(macroDir, "base.sdc"),
        openRoadReadme: path.join(macroDir, "openroad-setup.md"),
        openRoadSmokeTcl: path.join(macroDir, "openroad-smoke.tcl"),
        openRoadSmokeRunnerSh: path.join(macroDir, "run-openroad-smoke.sh"),
        protocolAssumptionsSv: path.join(macroDir, `${r.macro}_protocol_assumptions.sv`),
        memorySemanticsCheckerSv: path.join(macroDir, `${r.macro}_memory_semantics_checker.sv`),
      },
      options.repoRoot,
      clock,
      { openRoadProbe },
    );
    const c = countBySeverity(analysis.findings);
    allFindings.push(...analysis.findings);
    sections.push(
      `### ${r.macro}\n\n` +
        `_finding counts — errors: ${String(c.error)}, warnings: ${String(c.warning)}, info: ${String(c.info)}_\n\n` +
        `${formatFindingsTable(analysis.findings)}\n`,
    );
  }

  const totalCounts = countBySeverity(allFindings);
  const vfence = "```";

  const body = `# SRAM workflow iteration report (batch)

## Run metadata
- **Run ID:** ${options.runId}
- **Mode:** batch (${String(ok.length)} ok macros)
- **Generated (UTC):** ${new Date().toISOString()}

## 1. Goal

${options.narrative.goal}

## 2. Evidence / research basis

${options.narrative.evidenceAndResearchBasis}

## 3. Changes made (this iteration)

${options.narrative.changesMadeThisIteration}

## 4. Why improve

${options.narrative.whyImprove}

## 5. How improve

${options.narrative.howImprove}

## 6. Generated outputs

Per macro: \`outputs/${options.runId}/<macro>/\` plus shared \`run-report.json\`.

## 7. OpenROAD / OpenLane script quality review

### OpenROAD binary (shared probe)

- _Available:_ **${String(openRoadProbe.available)}**

${vfence}
${openRoadProbe.detail.replace(/```/g, "'''")}
${vfence}

### Aggregate finding counts

_errors: ${String(totalCounts.error)}, warnings: ${String(totalCounts.warning)}, info: ${String(totalCounts.info)}_

## Per-macro findings

${sections.length > 0 ? sections.join("\n") : "_No successful macro emits in this batch._"}

## 8. Verification commands

${vfence}bash
    npm test
    npm run typecheck
    npm run demo:extract-all
${vfence}
`;

  await writeFile(outPath, body, "utf8");
  return outPath;
}
