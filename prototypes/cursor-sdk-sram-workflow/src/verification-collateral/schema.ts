import type { StructuredSramSpec } from "../spec/types.js";

export type PropertyRole = "assume" | "assert" | "cover" | "scoreboard";
export type PropertyCategory = "protocol" | "wmask" | "memory_semantics" | "environment" | "coverage" | "bind";
export type PropertyStrictness = "strict_spec" | "derived_invariant" | "optional_environment";
export type ConvergenceDecisionStatus = "accept" | "revise" | "blocked";

export interface VerificationIntent {
  schemaVersion: "0.1.0";
  macro: string;
  generatedFrom: "spec" | "agent";
  protocolSignals: {
    clock: string;
    chipEnable: string;
    reset: string;
    writeEnable: string;
    address: string;
    dataIn: string;
    dataOut: string;
    writeMask: string;
  };
  lanes: Array<{ index: number; lsb: number; msb: number }>;
  nonDerivableBoundaries: string[];
  sourceRefs: string[];
}

export interface PropertyProposal {
  id: string;
  role: PropertyRole;
  category: PropertyCategory;
  strictness: PropertyStrictness;
  confidence: number;
  sourceRefs: string[];
  svaBody: string;
  description: string;
}

export interface NormalizedProperty extends PropertyProposal {
  normalizedId: string;
}

export interface PropertyCatalog {
  schemaVersion: "0.1.0";
  macro: string;
  specSummary: {
    depth: number;
    dataWidth: number;
    addressWidth: number;
    writeMaskWidth: number;
    writeSize: number;
  };
  sourceRefs: string[];
  properties: NormalizedProperty[];
}

export interface CollateralFinding {
  code:
    | "duplicate_property_id"
    | "invalid_property_id"
    | "invalid_role"
    | "invalid_category"
    | "invalid_strictness"
    | "invalid_confidence"
    | "missing_source_refs"
    | "tautological_property"
    | "unsupported_sva_expression"
    | "missing_lane_assertion"
    | "missing_lane_cover"
    | "missing_role";
  severity: "info" | "warning" | "error";
  message: string;
  propertyId?: string;
}

export interface NormalizationResult {
  catalog: PropertyCatalog;
  findings: CollateralFinding[];
}

export interface ConvergenceIteration {
  iteration: number;
  intent?: VerificationIntent;
  proposals?: PropertyProposal[];
  catalog?: PropertyCatalog;
  findings: CollateralFinding[];
  reviewerDecision?: ConvergenceDecision;
}

export interface ConvergenceDecision {
  status: ConvergenceDecisionStatus;
  rationale: string;
  repeatedFindingCodes?: string[];
}

export interface VerificationCollateralBundle {
  propertiesJson: string;
  protocolAssumptionsSv: string;
  protocolAssertionsSv: string;
  protocolCoversSv: string;
  memoryScoreboardSv: string;
  bindSv: string;
  legacyProtocolAssumptionsSv: string;
  legacyMemorySemanticsCheckerSv: string;
}

export function specSummary(spec: StructuredSramSpec): PropertyCatalog["specSummary"] {
  return {
    depth: spec.parameters.words.value,
    dataWidth: spec.parameters.width.value,
    addressWidth: spec.parameters.addrWidth.value,
    writeMaskWidth: spec.parameters.wmaskWidth.value,
    writeSize: spec.parameters.writeSize.value,
  };
}
