import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import {
  HUMAN_INTENT_SCHEMA_VERSION,
  applyHumanIntentDefaults,
  type EdaTargetId,
  type HumanIntentSource,
  type HumanIntentValidationFinding,
  type RawHumanIntent,
  type ResolvedHumanIntent,
  type VerificationPriority,
} from "./schema.js";

const KNOWN_EDA_TARGETS = new Set<EdaTargetId>(["hammer", "openlane", "verification", "openroad"]);
const KNOWN_PRIORITIES = new Set<VerificationPriority>([
  "protocol",
  "wmask",
  "memory_scoreboard",
  "coverage",
]);

export interface LoadedHumanIntent {
  intent: ResolvedHumanIntent;
  source: HumanIntentSource;
  findings: HumanIntentValidationFinding[];
}

export function parseHumanIntentRequirements(text: string, fileName = "requirements.yaml"): RawHumanIntent {
  const ext = path.extname(fileName).toLowerCase();
  const parsed = ext === ".json" ? (JSON.parse(text) as unknown) : parseYaml(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Human intent requirements must parse to an object.");
  }
  return parsed as RawHumanIntent;
}

function collectDefaultedFields(raw: RawHumanIntent): string[] {
  const defaulted: string[] = [];
  if (raw.designerGoal === undefined) defaulted.push("designerGoal");
  if (raw.macro === undefined) defaulted.push("macro");
  if (raw.edaTargets === undefined) defaulted.push("edaTargets");
  if (raw.verification === undefined) defaulted.push("verification");
  else {
    if (raw.verification.priority === undefined) defaulted.push("verification.priority");
    if (raw.verification.strictness === undefined) defaulted.push("verification.strictness");
    if (raw.verification.allowOptionalEnvironmentAssumptions === undefined) {
      defaulted.push("verification.allowOptionalEnvironmentAssumptions");
    }
    if (raw.verification.maxConvergenceIterations === undefined) {
      defaulted.push("verification.maxConvergenceIterations");
    }
  }
  if (raw.reporting === undefined) defaulted.push("reporting");
  else {
    if (raw.reporting.includePromptReport === undefined) defaulted.push("reporting.includePromptReport");
    if (raw.reporting.includeFlowCharts === undefined) defaulted.push("reporting.includeFlowCharts");
    if (raw.reporting.explainSkippedTools === undefined) defaulted.push("reporting.explainSkippedTools");
  }
  if (raw.notes === undefined) defaulted.push("notes");
  return defaulted;
}

export function validateHumanIntent(intent: ResolvedHumanIntent): HumanIntentValidationFinding[] {
  const findings: HumanIntentValidationFinding[] = [];
  if (intent.schemaVersion !== HUMAN_INTENT_SCHEMA_VERSION) {
    findings.push({
      code: "unknown_schema_version",
      severity: "error",
      field: "schemaVersion",
      message: `Unsupported human intent schemaVersion '${String(intent.schemaVersion)}'.`,
    });
  }
  for (const adapterId of intent.edaTargets) {
    if (!KNOWN_EDA_TARGETS.has(adapterId)) {
      findings.push({
        code: "unknown_eda_target",
        severity: "error",
        field: "edaTargets",
        message: `Unknown EDA target '${String(adapterId)}'.`,
      });
    }
  }
  for (let i = 0; i < intent.verification.priority.length; i += 1) {
    const p = intent.verification.priority[i];
    if (!KNOWN_PRIORITIES.has(p)) {
      findings.push({
        code: "unknown_verification_priority",
        severity: "error",
        field: `verification.priority[${i}]`,
        message: `Unknown verification priority '${String(p)}'.`,
      });
    }
  }
  if (
    !Number.isInteger(intent.verification.maxConvergenceIterations) ||
    intent.verification.maxConvergenceIterations < 1 ||
    intent.verification.maxConvergenceIterations > 5
  ) {
    findings.push({
      code: "invalid_max_convergence_iterations",
      severity: "error",
      field: "verification.maxConvergenceIterations",
      message: "maxConvergenceIterations must be an integer from 1 through 5.",
    });
  }
  const explicitName = (intent.macro.name ?? "").trim();
  const hasSelection = intent.macro.selection !== undefined;
  if (explicitName === "" && !hasSelection) {
    findings.push({
      code: "missing_macro",
      severity: "error",
      field: "macro",
      message: "macro.name or macro.selection is required.",
    });
  }
  if (explicitName === "" && hasSelection && intent.designerGoal.trim() === "") {
    findings.push({
      code: "missing_designer_goal",
      severity: "error",
      field: "designerGoal",
      message: "designerGoal is required when using macro.selection without macro.name.",
    });
  }
  return findings;
}

export async function loadHumanIntentRequirements(requirementsPath: string): Promise<LoadedHumanIntent> {
  const text = await readFile(requirementsPath, "utf8");
  const raw = parseHumanIntentRequirements(text, requirementsPath);
  const intent = applyHumanIntentDefaults(raw);
  return {
    intent,
    source: {
      schemaVersion: HUMAN_INTENT_SCHEMA_VERSION,
      sourceKind: "requirements_file",
      requirementsPath,
      defaultedFields: collectDefaultedFields(raw),
      interactiveFields: [],
    },
    findings: validateHumanIntent(intent),
  };
}

export function defaultHumanIntent(macroName: string): LoadedHumanIntent {
  const intent = applyHumanIntentDefaults({
    schemaVersion: HUMAN_INTENT_SCHEMA_VERSION,
    designerGoal: `Run the default source-backed SRAM workflow for ${macroName}.`,
    macro: { name: macroName },
  });
  return {
    intent,
    source: {
      schemaVersion: HUMAN_INTENT_SCHEMA_VERSION,
      sourceKind: "defaults",
      defaultedFields: ["designerGoal", "edaTargets", "verification", "reporting", "notes"],
      interactiveFields: [],
    },
    findings: validateHumanIntent(intent),
  };
}
