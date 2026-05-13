import type { ResolvedHumanIntent } from "../human-intent/schema.js";
import type { EmittedArtifacts, StructuredSramSpec } from "../spec/types.js";

function humanIntentBlock(intent: ResolvedHumanIntent | undefined): string {
  if (intent === undefined) return "";
  return `Human intent (not source evidence — do not cite as proof of hardware facts):
${JSON.stringify(intent, null, 2)}

Human intent rules:
- Use human intent to prioritize flow generation, SVA focus, and review emphasis.
- Never treat human intent as provenance for numeric timing, physical, or on-silicon facts.
- If human intent conflicts with the structured spec, the structured spec wins.
- The reviewer must flag any place human intent was treated as fabricated source evidence.

`;
}

export function buildPlanningPrompt(spec: StructuredSramSpec, humanIntent?: ResolvedHumanIntent): string {
  return `Create a concise JSON workflow plan for extracting and emitting EDA setup for ${spec.macro.name}.

Rules:
- Do not invent numeric values.
- Use only values present in the structured spec.
- Call out any validationIssues as blockers or warnings.
- Prefer deterministic parser output over model interpretation.

${humanIntentBlock(humanIntent)}Structured spec:
${JSON.stringify(spec, null, 2)}
`;
}

export function buildVerificationCollateralPrompt(
  spec: StructuredSramSpec,
  artifacts: EmittedArtifacts,
  humanIntent?: ResolvedHumanIntent,
): string {
  return `Generate the richest possible source-backed verification collateral for ${spec.macro.name}.

Goal:
- Derive as many useful SystemVerilog assumptions, assertions, covers, and scoreboard checks as possible from the structured spec.
- Stay strictly within source-backed facts in the spec. If a property requires an assumption not in the spec, label it as optional and low confidence.
- Prefer concrete SVA/checker snippets over prose.

Must include:
- protocol properties for clock edge, active-cycle gating, read/write partition, known controls, and valid active-cycle inputs;
- lane-aware write-mask properties for every interfaceProtocol.wmask.lanes entry;
- read/write cover properties for each lane and common mask combinations;
- a boundary-observable reference scoreboard strategy that does not require binding to internal mem[];
- a short "not derivable from this spec" section.

Generated artifacts available for context:
${JSON.stringify(artifacts, null, 2)}

${humanIntentBlock(humanIntent)}Structured spec:
${JSON.stringify(spec, null, 2)}
`;
}

export function buildReviewPrompt(
  spec: StructuredSramSpec,
  artifacts: EmittedArtifacts,
  humanIntent?: ResolvedHumanIntent,
): string {
  return `Self-review the SRAM spec-to-EDA workflow output for ${spec.macro.name}.

Check:
- every numeric value has source provenance or confidence below 1.0;
- Hammer cache fields agree with macro parameters;
- OpenLane setup includes LEF, Liberty, GDS when available, SDC, and PDN hooks;
- OpenROAD setup does not claim signoff readiness when views are missing;
- no generated artifact claims facts not present in the source views;
- human intent (if present) did not become fabricated provenance for hardware facts.

Generated artifacts:
${JSON.stringify(artifacts, null, 2)}

${humanIntentBlock(humanIntent)}Structured spec:
${JSON.stringify(spec, null, 2)}
`;
}

export function buildSpecIntentPrompt(spec: StructuredSramSpec, humanIntent?: ResolvedHumanIntent): string {
  return `Role: spec-intention-extractor.

Output strict JSON only. Extract verification intent for ${spec.macro.name} from the structured spec.

Required JSON shape:
{
  "schemaVersion": "0.1.0",
  "macro": "${spec.macro.name}",
  "protocols": [],
  "lanes": [],
  "nonDerivableBoundaries": [],
  "optionalAssumptions": [],
  "sourceRefs": []
}

Rules:
- Use source-backed facts only.
- Include every interfaceProtocol.wmask.lanes entry.
- Explicitly list facts that are not derivable, especially power-up memory contents and unproven latency/timing claims.

${humanIntentBlock(humanIntent)}Structured spec:
${JSON.stringify(spec, null, 2)}
`;
}

export function buildSvaTranslationPrompt(spec: StructuredSramSpec, humanIntent?: ResolvedHumanIntent): string {
  const priorityHint =
    humanIntent === undefined
      ? ""
      : `Designer verification priority (guidance only): ${JSON.stringify(humanIntent.verification.priority, null, 2)}
`;
  return `Role: sva-translator.

Output strict JSON only. Translate accepted verification intent for ${spec.macro.name} into property proposals.

Each proposal must include:
- id
- role: assume | assert | cover | scoreboard
- category
- confidence
- sourceRefs
- strictness: strict_spec | derived_invariant | optional_environment
- svaBody
- description

Rules:
- Generate as much source-backed collateral as possible.
- Include assertions and covers for every write-mask lane.
- Include covers for every write-mask combination when the mask width is small enough; this macro has ${spec.parameters.wmaskWidth.value} mask bits.
- Do not write final SVA files; final SVA is rendered only by the deterministic normalizer.

${priorityHint}${humanIntentBlock(humanIntent)}Structured spec:
${JSON.stringify(spec, null, 2)}
`;
}

export function buildSpecReviewerPrompt(spec: StructuredSramSpec, humanIntent?: ResolvedHumanIntent): string {
  return `Role: spec-reviewer.

Review the proposed verification properties for ${spec.macro.name}.

Output strict JSON only:
{
  "status": "accept" | "revise" | "blocked",
  "rationale": "...",
  "repeatedFindingCodes": []
}

Reject proposals that are tautological, unsourced, overclaiming, not lintable, missing lane coverage, or claiming unsupported reset/read-latency behavior.
Reject any proposal whose sourceRefs cite human intent text as if it were a view file.
${humanIntentBlock(humanIntent)}Structured spec:
${JSON.stringify(spec, null, 2)}
`;
}
