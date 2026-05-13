export const HUMAN_INTENT_SCHEMA_VERSION = "0.1.0" as const;

export type HumanIntentSchemaVersion = typeof HUMAN_INTENT_SCHEMA_VERSION;
export type EdaTargetId = "hammer" | "openlane" | "verification" | "openroad";
export type VerificationPriority = "protocol" | "wmask" | "memory_scoreboard" | "coverage";
export type VerificationStrictness = "source_backed";
export type HumanIntentSourceKind = "defaults" | "requirements_file" | "interactive" | "merged";

export interface MacroSelectionConstraints {
  minWords?: number;
  minWidth?: number;
  requiresWriteMask?: boolean;
  preferredMux?: number;
}

export interface RawHumanIntent {
  schemaVersion: HumanIntentSchemaVersion;
  designerGoal?: string;
  macro?: {
    name?: string;
    selection?: MacroSelectionConstraints;
  };
  edaTargets?: EdaTargetId[];
  verification?: Partial<ResolvedHumanIntent["verification"]>;
  reporting?: Partial<ResolvedHumanIntent["reporting"]>;
  notes?: string[];
}

export interface ResolvedHumanIntent {
  schemaVersion: HumanIntentSchemaVersion;
  designerGoal: string;
  macro: {
    name?: string;
    selection?: MacroSelectionConstraints;
    resolvedName?: string;
  };
  edaTargets: EdaTargetId[];
  verification: {
    priority: VerificationPriority[];
    strictness: VerificationStrictness;
    allowOptionalEnvironmentAssumptions: boolean;
    maxConvergenceIterations: number;
  };
  reporting: {
    includePromptReport: boolean;
    includeFlowCharts: boolean;
    explainSkippedTools: boolean;
  };
  notes: string[];
}

export interface HumanIntentSource {
  schemaVersion: HumanIntentSchemaVersion;
  sourceKind: HumanIntentSourceKind;
  requirementsPath?: string;
  defaultedFields: string[];
  interactiveFields: string[];
}

export interface HumanIntentValidationFinding {
  code: string;
  severity: "warning" | "error";
  message: string;
  field?: string;
}

export const DEFAULT_HUMAN_INTENT = {
  edaTargets: ["hammer", "openlane", "verification", "openroad"] as const,
  verification: {
    priority: ["protocol", "wmask", "memory_scoreboard", "coverage"] as const,
    strictness: "source_backed" as const,
    allowOptionalEnvironmentAssumptions: true,
    maxConvergenceIterations: 3,
  },
  reporting: {
    includePromptReport: true,
    includeFlowCharts: true,
    explainSkippedTools: true,
  },
};

export function applyHumanIntentDefaults(raw: RawHumanIntent): ResolvedHumanIntent {
  return {
    schemaVersion: raw.schemaVersion,
    designerGoal: raw.designerGoal ?? "",
    macro: raw.macro ?? {},
    edaTargets: raw.edaTargets ? [...raw.edaTargets] : [...DEFAULT_HUMAN_INTENT.edaTargets],
    verification: {
      priority: raw.verification?.priority ?? [...DEFAULT_HUMAN_INTENT.verification.priority],
      strictness: raw.verification?.strictness ?? DEFAULT_HUMAN_INTENT.verification.strictness,
      allowOptionalEnvironmentAssumptions:
        raw.verification?.allowOptionalEnvironmentAssumptions ??
        DEFAULT_HUMAN_INTENT.verification.allowOptionalEnvironmentAssumptions,
      maxConvergenceIterations:
        raw.verification?.maxConvergenceIterations ?? DEFAULT_HUMAN_INTENT.verification.maxConvergenceIterations,
    },
    reporting: {
      includePromptReport:
        raw.reporting?.includePromptReport ?? DEFAULT_HUMAN_INTENT.reporting.includePromptReport,
      includeFlowCharts: raw.reporting?.includeFlowCharts ?? DEFAULT_HUMAN_INTENT.reporting.includeFlowCharts,
      explainSkippedTools:
        raw.reporting?.explainSkippedTools ?? DEFAULT_HUMAN_INTENT.reporting.explainSkippedTools,
    },
    notes: raw.notes ?? [],
  };
}
