import type { SourceRef, StructuredSramSpec, TracedValue } from "../spec/types.js";
import {
  type CollateralFinding,
  type NormalizationResult,
  type NormalizedProperty,
  type PropertyCatalog,
  type PropertyCategory,
  type PropertyProposal,
  type PropertyRole,
  type PropertyStrictness,
  type VerificationIntent,
  specSummary,
} from "./schema.js";

const PROPERTY_ID_RE = /^[a-z][a-z0-9_]*$/;
const ROLES = new Set<PropertyRole>(["assume", "assert", "cover", "scoreboard"]);
const CATEGORIES = new Set<PropertyCategory>(["protocol", "wmask", "memory_semantics", "environment", "coverage", "bind"]);
const STRICTNESSES = new Set<PropertyStrictness>(["strict_spec", "derived_invariant", "optional_environment"]);

function finding(f: CollateralFinding): CollateralFinding {
  return f;
}

function stringifyRef(ref: SourceRef): string {
  return ref.line === undefined ? `${ref.path}: ${ref.evidence}` : `${ref.path}:${ref.line}: ${ref.evidence}`;
}

function refsFrom<T>(traced: TracedValue<T>): string[] {
  return traced.sources.map(stringifyRef);
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function protocolRefs(spec: StructuredSramSpec): string[] {
  return unique([
    ...refsFrom(spec.interfaceProtocol.gating.activeCycleExpression),
    ...refsFrom(spec.interfaceProtocol.readWrite.writeCondition),
    ...refsFrom(spec.interfaceProtocol.readWrite.readCondition),
    ...refsFrom(spec.interfaceProtocol.wmask.laneBitWidth),
    ...spec.interfaceProtocol.wmask.lanes.flatMap((lane) => refsFrom(lane.verilogSliceAgrees)),
  ]);
}

export function buildVerificationIntent(spec: StructuredSramSpec): VerificationIntent {
  const lanes = spec.interfaceProtocol.wmask.lanes.map((lane) => ({
    index: lane.laneIndex,
    lsb: lane.lsb,
    msb: lane.msb,
  }));
  return {
    schemaVersion: "0.1.0",
    macro: spec.macro.name,
    generatedFrom: "spec",
    protocolSignals: {
      clock: spec.ports.clock.value[0],
      chipEnable: spec.ports.chipEnable.value[0],
      reset: spec.ports.reset.value[0],
      writeEnable: spec.ports.writeEnable.value[0],
      address: spec.ports.address.value[0],
      dataIn: spec.ports.input.value[0],
      dataOut: spec.ports.output.value[0],
      writeMask: spec.ports.writeMask.value[0],
    },
    lanes,
    nonDerivableBoundaries: [
      "No power-up memory contents are derivable from SRAM22 behavioral Verilog; scoreboards must use unknown data until written.",
      "Timing arcs and physical signoff behavior are not inferred by SVA collateral.",
    ],
    sourceRefs: protocolRefs(spec),
  };
}

function proposal(
  id: string,
  role: PropertyRole,
  category: PropertyCategory,
  strictness: PropertyStrictness,
  confidence: number,
  sourceRefs: string[],
  svaBody: string,
  description: string,
): PropertyProposal {
  return { id, role, category, strictness, confidence, sourceRefs, svaBody, description };
}

export function buildDefaultPropertyProposals(spec: StructuredSramSpec): PropertyProposal[] {
  const refs = protocolRefs(spec);
  const summary = specSummary(spec);
  const wmaskCombos = Array.from({ length: 2 ** summary.writeMaskWidth }, (_, value) => value);
  const lanes = spec.interfaceProtocol.wmask.lanes;

  return [
    proposal("p_active_cycle_definition", "assert", "protocol", "derived_invariant", 1, refs, "active_cycle == (ce && rstb)", "Active cycles follow the behavioral gating expression."),
    proposal("p_write_cycle_definition", "assert", "protocol", "strict_spec", 1, refs, "write_cycle == (active_cycle && we)", "Write behavior is gated by active cycle and write enable."),
    proposal("p_read_cycle_definition", "assert", "protocol", "strict_spec", 1, refs, "read_cycle == (active_cycle && !we)", "Read behavior is gated by active cycle and deasserted write enable."),
    proposal("p_addr_known_when_active", "assume", "environment", "optional_environment", 0.75, refs, "active_cycle |-> !$isunknown(addr)", "Constrain formal environment to known addresses only during active access."),
    proposal("p_wmask_known_when_write", "assume", "environment", "optional_environment", 0.75, refs, "write_cycle |-> !$isunknown(wmask)", "Constrain formal environment to known mask bits during writes."),
    ...lanes.flatMap((lane) => [
      proposal(
        `p_lane_${lane.laneIndex}_write_updates_reference`,
        "assert",
        "wmask",
        "strict_spec",
        1,
        refsFrom(lane.verilogSliceAgrees),
        `write_cycle && wmask[${lane.laneIndex}] |-> !$isunknown(din[${lane.msb}:${lane.lsb}])`,
        `Lane ${lane.laneIndex} writes use known input data for the selected byte lane.`,
      ),
      proposal(
        `p_cover_lane_${lane.laneIndex}_write`,
        "cover",
        "coverage",
        "derived_invariant",
        1,
        refsFrom(lane.verilogSliceAgrees),
        `write_cycle && wmask[${lane.laneIndex}]`,
        `Cover writes touching lane ${lane.laneIndex}.`,
      ),
    ]),
    ...wmaskCombos.map((value) =>
      proposal(
        `p_cover_wmask_${value}`,
        "cover",
        "coverage",
        "derived_invariant",
        1,
        refs,
        `write_cycle && wmask == ${summary.writeMaskWidth}'d${value}`,
        `Cover write-mask combination ${value}.`,
      ),
    ),
    proposal("p_scoreboard_unknown_powerup", "scoreboard", "memory_semantics", "strict_spec", 1, refs, "reference_mem initialized to 'x and lane valid bits initialized to 0", "Scoreboard does not invent power-up memory contents."),
    proposal("p_scoreboard_lane_valid_gating", "scoreboard", "memory_semantics", "strict_spec", 1, refs, "read comparisons are gated by reference_lane_valid[read_addr][lane]", "Read comparisons apply only to lanes previously written through the boundary."),
  ];
}

function hasUnsupportedExpression(svaBody: string): boolean {
  return /\b(force|release|assign\s+#|\$system|initial\s+forever)\b/i.test(svaBody);
}

function isTautological(svaBody: string): boolean {
  const normalized = svaBody.replace(/\s+/g, " ").trim();
  const eq = normalized.match(/^\(?(.+?)\)?\s*==\s*\(?\1\)?$/);
  const implication = normalized.match(/^\(?(.+?)\)?\s*\|->\s*\(?\1\)?$/);
  return eq !== null || implication !== null;
}

function validateProposal(proposal: PropertyProposal, seenIds: Set<string>): CollateralFinding[] {
  const out: CollateralFinding[] = [];
  if (!PROPERTY_ID_RE.test(proposal.id)) {
    out.push(finding({ code: "invalid_property_id", severity: "error", propertyId: proposal.id, message: "Property id must be lowercase snake_case." }));
  }
  if (seenIds.has(proposal.id)) {
    out.push(finding({ code: "duplicate_property_id", severity: "error", propertyId: proposal.id, message: "Property id is duplicated." }));
  }
  if (!ROLES.has(proposal.role)) {
    out.push(finding({ code: "invalid_role", severity: "error", propertyId: proposal.id, message: `Unsupported property role '${proposal.role}'.` }));
  }
  if (!CATEGORIES.has(proposal.category)) {
    out.push(finding({ code: "invalid_category", severity: "error", propertyId: proposal.id, message: `Unsupported property category '${proposal.category}'.` }));
  }
  if (!STRICTNESSES.has(proposal.strictness)) {
    out.push(finding({ code: "invalid_strictness", severity: "error", propertyId: proposal.id, message: `Unsupported property strictness '${proposal.strictness}'.` }));
  }
  if (!Number.isFinite(proposal.confidence) || proposal.confidence <= 0 || proposal.confidence > 1) {
    out.push(finding({ code: "invalid_confidence", severity: "error", propertyId: proposal.id, message: "Confidence must be in the interval (0, 1]." }));
  }
  if (proposal.sourceRefs.length === 0) {
    out.push(finding({ code: "missing_source_refs", severity: "error", propertyId: proposal.id, message: "Property proposals must include source references." }));
  }
  if (isTautological(proposal.svaBody)) {
    out.push(finding({ code: "tautological_property", severity: "error", propertyId: proposal.id, message: "Property body is tautological and does not check design behavior." }));
  }
  if (hasUnsupportedExpression(proposal.svaBody)) {
    out.push(finding({ code: "unsupported_sva_expression", severity: "error", propertyId: proposal.id, message: "Property body contains unsupported procedural or side-effecting syntax." }));
  }
  return out;
}

function laneCoverageFindings(spec: StructuredSramSpec, properties: NormalizedProperty[]): CollateralFinding[] {
  const out: CollateralFinding[] = [];
  for (const lane of spec.interfaceProtocol.wmask.lanes) {
    const assertion = properties.some(
      (property) =>
        property.role === "assert" &&
        property.category === "wmask" &&
        property.id.includes(`lane_${lane.laneIndex}`),
    );
    const cover = properties.some(
      (property) =>
        property.role === "cover" &&
        property.id.includes(`lane_${lane.laneIndex}`),
    );
    if (!assertion) {
      out.push(finding({ code: "missing_lane_assertion", severity: "error", message: `Missing assertion coverage for write-mask lane ${lane.laneIndex}.` }));
    }
    if (!cover) {
      out.push(finding({ code: "missing_lane_cover", severity: "error", message: `Missing cover coverage for write-mask lane ${lane.laneIndex}.` }));
    }
  }
  return out;
}

function requiredRoleFindings(properties: NormalizedProperty[]): CollateralFinding[] {
  const required: PropertyRole[] = ["assume", "assert", "cover", "scoreboard"];
  return required.flatMap((role) =>
    properties.some((property) => property.role === role)
      ? []
      : [finding({ code: "missing_role", severity: "error", message: `No normalized properties with role '${role}'.` })],
  );
}

export function normalizePropertyCatalog(
  spec: StructuredSramSpec,
  proposals: readonly PropertyProposal[] = buildDefaultPropertyProposals(spec),
): NormalizationResult {
  const seenIds = new Set<string>();
  const findings: CollateralFinding[] = [];
  const properties: NormalizedProperty[] = [];

  for (const item of proposals) {
    const proposalFindings = validateProposal(item, seenIds);
    seenIds.add(item.id);
    findings.push(...proposalFindings);
    if (proposalFindings.every((proposalFinding) => proposalFinding.severity !== "error")) {
      properties.push({ ...item, normalizedId: item.id });
    }
  }

  findings.push(...laneCoverageFindings(spec, properties), ...requiredRoleFindings(properties));

  const catalog: PropertyCatalog = {
    schemaVersion: "0.1.0",
    macro: spec.macro.name,
    specSummary: specSummary(spec),
    sourceRefs: protocolRefs(spec),
    properties,
  };

  return { catalog, findings };
}
