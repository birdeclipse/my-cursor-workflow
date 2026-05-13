# Human-In-The-Loop Flow Intake Design

## Goal

Add a first-class pre-extraction entry point where a designer can state flow requirements before the SRAM source adapter, EDA adapters, and SVA convergence loop run.

## Background

The current workflow starts from a macro name and deterministic source extraction:

```text
macro name -> source adapter extraction -> EDA adapter emission -> Cursor SDK planning/collateral/review -> SVA convergence
```

That works for fixed SRAM22 experiments, but it does not let a designer express intent before extraction. Important choices such as target EDA flow, macro selection constraints, verification priorities, assumption strictness, and desired output depth are currently implicit in code or prompts.

## Recommended Approach

Use a hybrid human-in-the-loop intake:

1. Accept a structured requirements file when the user already knows what they want.
2. Allow an interactive mode to fill missing fields before extraction.
3. Save the resolved result as `human-intent.json` under the run directory.
4. Feed `human-intent.json` into prompt construction, macro selection, EDA adapter selection, and SVA convergence policy.

This gives the designer a clear entry point while preserving reproducibility.

## Proposed User Flow

```text
Human requirement input
  -> intent schema validation
  -> optional interactive completion
  -> resolved human-intent.json
  -> source adapter discovery and macro selection
  -> deterministic extraction
  -> selected EDA adapter emission
  -> Cursor SDK prompts with human intent included
  -> SVA convergence loop
  -> reports that cite both source evidence and human intent
```

## CLI Shape

The existing commands remain valid. New behavior is additive.

```bash
npm run agent:run -- --requirements flow-requirements.yaml
npm run agent:run -- --requirements flow-requirements.yaml --interactive
npm run agent:run -- --interactive
```

Expected behavior:

- `--requirements <path>` loads user-authored YAML or JSON.
- `--interactive` asks only for missing required fields.
- If neither flag is provided, current defaults continue to work.
- Every `agent-run` writes the resolved intent to:

```text
outputs/<run-id>/human-intent.json
```

## First-Version Intent Schema

The first schema should be intentionally small and source-compatible.

```json
{
  "schemaVersion": "0.1.0",
  "designerGoal": "Generate a source-backed OpenLane/OpenROAD setup and rich SVA collateral for a 64x32 SRAM macro.",
  "macro": {
    "name": "sram22_64x32m4w8",
    "selection": {
      "minWords": 64,
      "minWidth": 32,
      "requiresWriteMask": true,
      "preferredMux": 4
    }
  },
  "edaTargets": ["openlane", "openroad", "hammer", "verification"],
  "verification": {
    "priority": ["protocol", "wmask", "memory_scoreboard", "coverage"],
    "strictness": "source_backed",
    "allowOptionalEnvironmentAssumptions": true,
    "maxConvergenceIterations": 3
  },
  "reporting": {
    "includePromptReport": true,
    "includeFlowCharts": true,
    "explainSkippedTools": true
  },
  "notes": [
    "Do not infer reset-clears-memory behavior unless source evidence exists.",
    "Prefer exhaustive write-mask covers when mask width is small."
  ]
}
```

## Field Semantics

### `designerGoal`

Human-readable goal text. This should be included in SDK prompts so agents know why the flow is being run.

### `macro`

Supports either an explicit macro name or constraints for macro selection. Version 1 should allow both but require that selection resolves to exactly one macro before extraction proceeds.

If multiple macros match, the workflow should stop with a clear message unless `--interactive` is enabled.

### `edaTargets`

Controls which EDA adapters emit artifacts. Version 1 should support the existing adapter IDs:

- `hammer`
- `openlane`
- `openroad`
- `verification`

If omitted, use the current default set.

### `verification`

Controls SVA convergence policy:

- `priority` tells the translator which collateral areas matter most.
- `strictness` starts as `source_backed`.
- `allowOptionalEnvironmentAssumptions` decides whether low-confidence assumptions may appear in metadata.
- `maxConvergenceIterations` controls the bounded agent loop.

### `reporting`

Controls generated report depth. Version 1 should only use these flags to decide which reports are written; it should not change source extraction or EDA emission semantics.

### `notes`

Free-form designer constraints. These are not trusted as source evidence, but they should be visible to agents and reports as human intent.

## Data Ownership

The workflow must distinguish three classes of facts:

| Fact class | Example | Can drive final numeric output? |
|---|---|---|
| Source evidence | Liberty minimum period, Verilog lane slices | Yes |
| Human intent | “Prioritize exhaustive wmask coverage” | Yes for prioritization, no for source facts |
| Agent proposal | “Add a read-after-write property” | Only after deterministic normalization |

Human intent may guide what to generate, but it must not become fabricated source evidence.

## Prompt Integration

Each phase prompt should receive a compact `humanIntent` section before `spec.json`.

Affected prompt builders:

- `buildPlanningPrompt`
- `buildVerificationCollateralPrompt`
- `buildSpecIntentPrompt`
- `buildSvaTranslationPrompt`
- `buildSpecReviewerPrompt`
- `buildReviewPrompt`

Prompt rules:

- Human intent should be labeled separately from source evidence.
- Agents may use human intent to prioritize work.
- Agents must not cite human intent as proof of a hardware fact.
- Reviewer prompts should explicitly check that human intent did not become fabricated provenance.

## Validation Rules

The intent loader should reject:

- Unknown schema versions.
- Unknown EDA adapter IDs.
- Empty `designerGoal` when no explicit macro name is given.
- `maxConvergenceIterations` outside a small bounded range, initially `1..5`.
- Macro selection constraints that match zero macros.
- Macro selection constraints that match multiple macros unless interactive mode is enabled.

The loader should warn, not reject:

- Missing `reporting`.
- Missing `notes`.
- Omitted `edaTargets`, because defaults are available.

## Artifact Layout

For every `agent-run`:

```text
outputs/<run-id>/human-intent.json
outputs/<run-id>/human-intent-source.json
outputs/<run-id>/agent-events.jsonl
outputs/<run-id>/agent-verification-collateral.md
outputs/<run-id>/convergence/...
```

`human-intent-source.json` should record whether the intent came from:

- requirements file,
- interactive answers,
- defaults,
- or a merge of those sources.

## Error Handling

Fail fast before extraction when:

- Requirements file cannot be parsed.
- Intent schema is invalid.
- Macro selection is ambiguous without interactive mode.
- Requested adapter is unknown.

Keep current local-only EDA behavior:

- Missing OpenROAD/OpenLane/Yosys should be reported honestly.
- Verilator checks should run when available.
- Missing dynamic tools must not block intent capture or deterministic artifact generation.

## Testing Strategy

Add tests around:

- Loading YAML and JSON requirements.
- Applying defaults.
- Rejecting unknown adapter IDs.
- Selecting an explicit macro.
- Selecting a macro by constraints.
- Stopping on ambiguous macro selection without interactive mode.
- Writing `human-intent.json` during `agent-run`.
- Including human intent in prompt text.
- Ensuring human intent is not treated as source provenance in normalized SVA metadata.

## Open Questions

1. Should interactive mode be terminal prompts, or should it first emit a draft requirements file for the user to edit?
2. Should `extract` also accept human intent, or only `agent-run`?
3. Should macro selection support ranking, or require exactly one match in version 1?

## Recommended Version 1 Decisions

For the first implementation:

- Support `agent-run --requirements <path>`.
- Support `agent-run --interactive` only for missing or ambiguous macro selection.
- Write `human-intent.json` and `human-intent-source.json`.
- Require exactly one selected macro before extraction.
- Keep `extract` unchanged.
- Pass human intent into all SDK prompt builders.
- Add report sections showing how user intent affected the run.
