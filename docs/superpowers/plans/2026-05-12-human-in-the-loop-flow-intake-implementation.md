# Human-In-The-Loop Flow Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pre-extraction human intent entry point so designers can steer macro selection, EDA targets, verification priorities, and reporting before the agentic workflow runs.

**Architecture:** Introduce a small `human-intent` domain module that loads YAML/JSON requirements, applies defaults, validates adapter IDs and convergence bounds, resolves one SRAM macro before extraction, and records `human-intent.json` plus provenance under the run directory. Existing `extract` behavior stays unchanged; `agent-run` gains `--requirements` and `--interactive`, passes resolved human intent into all SDK prompt builders, and filters EDA adapters according to the resolved target list.

**Tech Stack:** TypeScript, Node.js `fs/promises`, `yaml`, Commander, Vitest, existing SRAM source adapter / EDA adapter registries / Cursor SDK runner.

---

## File Structure

Create:

- `prototypes/cursor-sdk-sram-workflow/src/human-intent/schema.ts`  
  Types for raw requirements, resolved intent, source metadata, validation findings, and macro selection constraints.

- `prototypes/cursor-sdk-sram-workflow/src/human-intent/load.ts`  
  Reads YAML/JSON requirements, parses content, applies defaults, validates values, and returns a normalized raw intent object plus source metadata.

- `prototypes/cursor-sdk-sram-workflow/src/human-intent/resolve.ts`  
  Resolves the raw intent against discovered SRAM macros and registered EDA adapters. This is where explicit macro and constraint-based macro selection are checked.

- `prototypes/cursor-sdk-sram-workflow/src/human-intent/write.ts`  
  Writes `human-intent.json` and `human-intent-source.json` to the run directory.

- `prototypes/cursor-sdk-sram-workflow/test/humanIntent.test.ts`  
  Unit tests for loading, defaults, validation, macro selection, and artifact serialization.

Modify:

- `prototypes/cursor-sdk-sram-workflow/src/cli.ts`  
  Add `agent-run --requirements <path>` and `--interactive`, resolve intent before extraction, use selected macro/adapter set, and write intent artifacts.

- `prototypes/cursor-sdk-sram-workflow/src/emit/workflow.ts`  
  Allow emit functions to accept an adapter list instead of always using `DEFAULT_EDA_FLOW_ADAPTERS`.

- `prototypes/cursor-sdk-sram-workflow/src/eda-adapters/index.ts`  
  Add lookup helpers for adapter IDs.

- `prototypes/cursor-sdk-sram-workflow/src/sdk/prompts.ts`  
  Add optional `humanIntent` argument to each prompt builder and render a clearly labeled section before `Structured spec:`.

- `prototypes/cursor-sdk-sram-workflow/src/sdk/agentRunner.ts`  
  No behavior change required unless prompt option types need clearer naming. Preserve existing phase order.

- `prototypes/cursor-sdk-sram-workflow/test/agentRunner.test.ts`  
  Add prompt-order tests that assert human intent text is included in sent phase prompts.

- `prototypes/cursor-sdk-sram-workflow/test/emit.test.ts` and/or a new CLI-level test if one exists  
  Verify resolved intent artifacts are written during `agent-run`-style orchestration without requiring real SDK calls.

- `outputs/cursor-sdk-internal-prompts-report.html` or report generation path only if a report generator exists  
  Add human-intent section manually only after code behavior is verified; do not make report updates block the core feature.

---

## Task 1: Add Human Intent Schema

**Files:**

- Create: `prototypes/cursor-sdk-sram-workflow/src/human-intent/schema.ts`
- Test: `prototypes/cursor-sdk-sram-workflow/test/humanIntent.test.ts`

- [ ] **Step 1: Write failing schema/default tests**

Add this first test block to `test/humanIntent.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import {
  DEFAULT_HUMAN_INTENT,
  applyHumanIntentDefaults,
  type RawHumanIntent,
} from "../src/human-intent/schema.js";

describe("human intent schema", () => {
  test("applies stable defaults for omitted optional fields", () => {
    const raw: RawHumanIntent = {
      schemaVersion: "0.1.0",
      designerGoal: "Generate source-backed flow collateral for a 64x32 SRAM.",
      macro: { name: "sram22_64x32m4w8" },
    };

    const resolved = applyHumanIntentDefaults(raw);

    expect(resolved.edaTargets).toEqual(["hammer", "openlane", "verification", "openroad"]);
    expect(resolved.verification.priority).toEqual(["protocol", "wmask", "memory_scoreboard", "coverage"]);
    expect(resolved.verification.strictness).toBe("source_backed");
    expect(resolved.verification.allowOptionalEnvironmentAssumptions).toBe(true);
    expect(resolved.verification.maxConvergenceIterations).toBe(3);
    expect(resolved.reporting).toEqual(DEFAULT_HUMAN_INTENT.reporting);
    expect(resolved.notes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- prototypes/cursor-sdk-sram-workflow/test/humanIntent.test.ts
```

Expected: fail because `../src/human-intent/schema.js` does not exist.

- [ ] **Step 3: Implement schema defaults**

Create `src/human-intent/schema.ts`:

```ts
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
    edaTargets: raw.edaTargets ?? [...DEFAULT_HUMAN_INTENT.edaTargets],
    verification: {
      priority: raw.verification?.priority ?? [...DEFAULT_HUMAN_INTENT.verification.priority],
      strictness: raw.verification?.strictness ?? DEFAULT_HUMAN_INTENT.verification.strictness,
      allowOptionalEnvironmentAssumptions:
        raw.verification?.allowOptionalEnvironmentAssumptions ??
        DEFAULT_HUMAN_INTENT.verification.allowOptionalEnvironmentAssumptions,
      maxConvergenceIterations:
        raw.verification?.maxConvergenceIterations ??
        DEFAULT_HUMAN_INTENT.verification.maxConvergenceIterations,
    },
    reporting: {
      includePromptReport:
        raw.reporting?.includePromptReport ?? DEFAULT_HUMAN_INTENT.reporting.includePromptReport,
      includeFlowCharts:
        raw.reporting?.includeFlowCharts ?? DEFAULT_HUMAN_INTENT.reporting.includeFlowCharts,
      explainSkippedTools:
        raw.reporting?.explainSkippedTools ?? DEFAULT_HUMAN_INTENT.reporting.explainSkippedTools,
    },
    notes: raw.notes ?? [],
  };
}
```

- [ ] **Step 4: Run schema test**

Run:

```bash
npm test -- prototypes/cursor-sdk-sram-workflow/test/humanIntent.test.ts
```

Expected: pass.

---

## Task 2: Load YAML/JSON Requirements And Validate Values

**Files:**

- Modify: `prototypes/cursor-sdk-sram-workflow/src/human-intent/schema.ts`
- Create: `prototypes/cursor-sdk-sram-workflow/src/human-intent/load.ts`
- Test: `prototypes/cursor-sdk-sram-workflow/test/humanIntent.test.ts`

- [ ] **Step 1: Add failing load/validation tests**

Append tests:

```ts
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadHumanIntentRequirements, validateHumanIntent } from "../src/human-intent/load.js";

test("loads human intent from YAML requirements", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "human-intent-"));
  try {
    const file = path.join(dir, "flow-requirements.yaml");
    await writeFile(
      file,
      [
        "schemaVersion: 0.1.0",
        "designerGoal: Generate OpenROAD collateral for byte-masked SRAM",
        "macro:",
        "  name: sram22_64x32m4w8",
        "edaTargets:",
        "  - openlane",
        "  - verification",
      ].join("\n"),
      "utf8",
    );

    const loaded = await loadHumanIntentRequirements(file);

    expect(loaded.intent.macro.name).toBe("sram22_64x32m4w8");
    expect(loaded.intent.edaTargets).toEqual(["openlane", "verification"]);
    expect(loaded.source.sourceKind).toBe("requirements_file");
    expect(loaded.source.requirementsPath).toBe(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects unknown adapter ids and invalid convergence bounds", () => {
  const intent = applyHumanIntentDefaults({
    schemaVersion: "0.1.0",
    designerGoal: "Bad adapter",
    macro: { name: "sram22_64x32m4w8" },
    edaTargets: ["openlane", "not-a-flow"] as never,
    verification: { maxConvergenceIterations: 99 },
  });

  const findings = validateHumanIntent(intent);

  expect(findings.some((finding) => finding.code === "unknown_eda_target")).toBe(true);
  expect(findings.some((finding) => finding.code === "invalid_max_convergence_iterations")).toBe(true);
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
npm test -- prototypes/cursor-sdk-sram-workflow/test/humanIntent.test.ts
```

Expected: fail because `load.ts` does not exist.

- [ ] **Step 3: Implement loader and validator**

Create `src/human-intent/load.ts`:

```ts
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
} from "./schema.js";

const KNOWN_EDA_TARGETS = new Set<EdaTargetId>(["hammer", "openlane", "verification", "openroad"]);

export interface LoadedHumanIntent {
  intent: ResolvedHumanIntent;
  source: HumanIntentSource;
  findings: HumanIntentValidationFinding[];
}

export function parseHumanIntentRequirements(text: string, fileName = "requirements.yaml"): RawHumanIntent {
  const ext = path.extname(fileName).toLowerCase();
  const parsed = ext === ".json" ? JSON.parse(text) : parseYaml(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Human intent requirements must parse to an object.");
  }
  return parsed as RawHumanIntent;
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
        message: `Unknown EDA target '${adapterId}'.`,
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
  if ((intent.macro.name ?? "").trim() === "" && (intent.designerGoal ?? "").trim() === "") {
    findings.push({
      code: "missing_designer_goal",
      severity: "error",
      field: "designerGoal",
      message: "designerGoal is required when no explicit macro name is provided.",
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
      defaultedFields: [],
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
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- prototypes/cursor-sdk-sram-workflow/test/humanIntent.test.ts
```

Expected: pass.

---

## Task 3: Resolve Macro Selection Before Extraction

**Files:**

- Create: `prototypes/cursor-sdk-sram-workflow/src/human-intent/resolve.ts`
- Test: `prototypes/cursor-sdk-sram-workflow/test/humanIntent.test.ts`

- [ ] **Step 1: Add failing macro resolution tests**

Append:

```ts
import { resolveHumanIntent } from "../src/human-intent/resolve.js";

const discoveredMacros = [
  {
    name: "sram22_64x32m4w8",
    dir: "/macros/sram22_64x32m4w8",
    views: { liberty: {}, verilog: "a.v", lef: "a.lef", gds: "a.gds" },
  },
  {
    name: "sram22_128x32m4w8",
    dir: "/macros/sram22_128x32m4w8",
    views: { liberty: {}, verilog: "b.v", lef: "b.lef", gds: "b.gds" },
  },
] as never;

test("resolves explicit macro name", () => {
  const loaded = defaultHumanIntent("sram22_64x32m4w8");
  const resolved = resolveHumanIntent({
    loaded,
    discovered: discoveredMacros,
    interactive: false,
  });

  expect(resolved.selectedMacro.name).toBe("sram22_64x32m4w8");
  expect(resolved.intent.macro.resolvedName).toBe("sram22_64x32m4w8");
});

test("rejects ambiguous macro constraints without interactive mode", () => {
  const loaded = {
    intent: applyHumanIntentDefaults({
      schemaVersion: "0.1.0",
      designerGoal: "Find a byte-masked SRAM",
      macro: { selection: { minWords: 64, minWidth: 32, requiresWriteMask: true } },
    }),
    source: {
      schemaVersion: "0.1.0" as const,
      sourceKind: "requirements_file" as const,
      defaultedFields: [],
      interactiveFields: [],
    },
    findings: [],
  };

  expect(() =>
    resolveHumanIntent({
      loaded,
      discovered: discoveredMacros,
      interactive: false,
    }),
  ).toThrow(/matched multiple macros/);
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
npm test -- prototypes/cursor-sdk-sram-workflow/test/humanIntent.test.ts
```

Expected: fail because `resolve.ts` does not exist.

- [ ] **Step 3: Implement macro resolver**

Create `src/human-intent/resolve.ts`:

```ts
import type { DiscoveredMacro } from "../spec/types.js";
import type { LoadedHumanIntent } from "./load.js";
import type { ResolvedHumanIntent } from "./schema.js";

export interface ResolveHumanIntentOptions {
  loaded: LoadedHumanIntent;
  discovered: readonly DiscoveredMacro[];
  interactive: boolean;
}

export interface ResolvedHumanIntentContext {
  intent: ResolvedHumanIntent;
  selectedMacro: DiscoveredMacro;
}

function parseMacroName(name: string): { words: number; width: number; mux: number; writeSize: number } | undefined {
  const match = /^sram22_(\d+)x(\d+)m(\d+)w(\d+)$/.exec(name);
  if (match === null) return undefined;
  return {
    words: Number.parseInt(match[1], 10),
    width: Number.parseInt(match[2], 10),
    mux: Number.parseInt(match[3], 10),
    writeSize: Number.parseInt(match[4], 10),
  };
}

function matchesSelection(intent: ResolvedHumanIntent, macro: DiscoveredMacro): boolean {
  const selection = intent.macro.selection;
  if (selection === undefined) return false;
  const parsed = parseMacroName(macro.name);
  if (parsed === undefined) return false;
  if (selection.minWords !== undefined && parsed.words < selection.minWords) return false;
  if (selection.minWidth !== undefined && parsed.width < selection.minWidth) return false;
  if (selection.preferredMux !== undefined && parsed.mux !== selection.preferredMux) return false;
  if (selection.requiresWriteMask === true && parsed.writeSize <= 0) return false;
  return true;
}

export function resolveHumanIntent(options: ResolveHumanIntentOptions): ResolvedHumanIntentContext {
  const errors = options.loaded.findings.filter((finding) => finding.severity === "error");
  if (errors.length > 0) {
    throw new Error(`Human intent validation failed: ${errors.map((finding) => finding.code).join(", ")}`);
  }

  const explicitName = options.loaded.intent.macro.name;
  if (explicitName !== undefined && explicitName.trim() !== "") {
    const selected = options.discovered.find((macro) => macro.name === explicitName);
    if (selected === undefined) throw new Error(`Human intent macro '${explicitName}' was not discovered.`);
    return {
      intent: { ...options.loaded.intent, macro: { ...options.loaded.intent.macro, resolvedName: selected.name } },
      selectedMacro: selected,
    };
  }

  const matches = options.discovered.filter((macro) => matchesSelection(options.loaded.intent, macro));
  if (matches.length === 0) throw new Error("Human intent macro selection matched zero macros.");
  if (matches.length > 1) {
    throw new Error(
      `Human intent macro selection matched multiple macros: ${matches.map((macro) => macro.name).join(", ")}`,
    );
  }

  return {
    intent: { ...options.loaded.intent, macro: { ...options.loaded.intent.macro, resolvedName: matches[0].name } },
    selectedMacro: matches[0],
  };
}
```

- [ ] **Step 4: Run macro resolver tests**

Run:

```bash
npm test -- prototypes/cursor-sdk-sram-workflow/test/humanIntent.test.ts
```

Expected: pass.

---

## Task 4: Add Adapter Lookup And Filtered Emission

**Files:**

- Modify: `prototypes/cursor-sdk-sram-workflow/src/eda-adapters/index.ts`
- Modify: `prototypes/cursor-sdk-sram-workflow/src/emit/workflow.ts`
- Test: `prototypes/cursor-sdk-sram-workflow/test/edaFlowAdapters.test.ts`
- Test: `prototypes/cursor-sdk-sram-workflow/test/emit.test.ts`

- [ ] **Step 1: Add failing adapter lookup test**

Append to `edaFlowAdapters.test.ts`:

```ts
import { adaptersById, selectEdaFlowAdapters } from "../src/eda-adapters/index.js";

test("selectEdaFlowAdapters preserves requested order and rejects unknown ids", () => {
  expect(adaptersById().get("openlane")?.id).toBe("openlane");
  expect(selectEdaFlowAdapters(["verification", "openlane"]).map((adapter) => adapter.id)).toEqual([
    "verification",
    "openlane",
  ]);
  expect(() => selectEdaFlowAdapters(["missing"] as never)).toThrow(/Unknown EDA adapter/);
});
```

- [ ] **Step 2: Run failing adapter test**

Run:

```bash
npm test -- prototypes/cursor-sdk-sram-workflow/test/edaFlowAdapters.test.ts
```

Expected: fail because lookup helpers do not exist.

- [ ] **Step 3: Implement adapter lookup**

Modify `src/eda-adapters/index.ts`:

```ts
export function adaptersById(adapters: readonly EdaFlowAdapter[] = DEFAULT_EDA_FLOW_ADAPTERS): Map<string, EdaFlowAdapter> {
  return new Map(adapters.map((adapter) => [adapter.id, adapter]));
}

export function selectEdaFlowAdapters(ids: readonly string[]): EdaFlowAdapter[] {
  const byId = adaptersById();
  return ids.map((id) => {
    const adapter = byId.get(id);
    if (adapter === undefined) throw new Error(`Unknown EDA adapter '${id}'.`);
    return adapter;
  });
}
```

- [ ] **Step 4: Add failing filtered emission test**

Add to `emit.test.ts` inside the existing test setup or as a new test:

```ts
test("emitMacroArtifacts can emit a selected adapter subset", async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "sram-workflow-"));
  const spec = await extractStructuredSpec({ macroName: "sram22_64x32m4w8", macrosRoot, repoRoot });

  try {
    const emitted = await emitMacroArtifacts({
      spec,
      outputRoot,
      runId: "subset-run",
      repoRoot,
      edaAdapters: [openLaneAdapter],
    });

    expect(await readFile(emitted.openLaneConfigJson, "utf8")).toContain("sram22_64x32m4w8_wrapper");
    await expect(readFile(emitted.hammerCacheJson, "utf8")).rejects.toThrow();
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});
```

Import `openLaneAdapter` and `emitMacroArtifacts` in `emit.test.ts`. Use `emitMacroArtifacts` for this first subset test because it only verifies file emission. Full workflow quality for selected adapters is covered in the next step.

- [ ] **Step 5: Extend workflow options**

Modify `src/spec/types.ts`:

```ts
import type { EdaFlowAdapter } from "../eda-adapters/flowAdapter.js";

export interface EmitWorkflowOptions {
  spec: StructuredSramSpec;
  outputRoot: string;
  runId: string;
  repoRoot?: string;
  edaAdapters?: readonly EdaFlowAdapter[];
}
```

If this import creates a cycle, instead define a minimal local type:

```ts
export interface EmitArtifactAdapter {
  id: string;
  emit(spec: StructuredSramSpec): Array<{ fileName: string; contents: string }>;
}
```

and use `edaAdapters?: readonly EmitArtifactAdapter[]`.

Extend `EmittedArtifacts` with adapter metadata so later quality/smoke steps know which families were intentionally emitted:

```ts
export interface EmittedArtifacts {
  // existing fields...
  emittedAdapterIds?: string[];
}
```

- [ ] **Step 6: Use selected adapters in `emitMacroArtifacts`**

Modify `src/emit/workflow.ts`:

```ts
const adapters = options.edaAdapters ?? DEFAULT_EDA_FLOW_ADAPTERS;
artifacts.emittedAdapterIds = adapters.map((adapter) => adapter.id);
for (const adapter of adapters) {
  for (const file of adapter.emit(options.spec)) {
    writes.push(writeFile(path.join(macroDir, file.fileName), file.contents, "utf8"));
  }
}
```

Keep artifact path fields in `EmittedArtifacts` unchanged. A selected subset may leave some path fields pointing to files that were not written; downstream quality code must use `emittedAdapterIds` to distinguish intentionally skipped targets from missing generated files.

Guard the existing executable-bit change so subset emission does not fail when OpenROAD was not emitted:

```ts
if (artifacts.emittedAdapterIds.includes("openroad")) {
  await chmod(artifacts.openRoadSmokeRunnerSh, 0o755);
}
```

- [ ] **Step 7: Make flow quality respect selected adapters**

Modify `src/review/flowArtifactQuality.ts` and `src/emit/workflow.ts` so `emitWorkflowArtifacts({ edaAdapters: [openLaneAdapter] })` does not produce missing OpenROAD or verification errors.

Add an option:

```ts
export interface AnalyzeEmittedFlowArtifactsOptions {
  openRoadProbe?: OpenRoadProbeResult;
  emittedAdapterIds?: readonly string[];
}
```

Then change `analyzeEmittedFlowArtifacts` to use booleans:

```ts
const enabled = new Set(options?.emittedAdapterIds ?? ["hammer", "openlane", "verification", "openroad"]);
const checkOpenLane = enabled.has("openlane");
const checkOpenRoad = enabled.has("openroad");
const checkVerification = enabled.has("verification");
```

Only read `openLaneConfigJson` and `openLaneSdc` when `checkOpenLane` is true. Only read `openRoadReadme`, `openRoadSmokeTcl`, and `openRoadSmokeRunnerSh` when `checkOpenRoad` is true. Only analyze SVA sidecars and `properties.json` when `checkVerification` is true. If a family is disabled, omit that family from quality findings rather than emitting a missing-file error.

In `writeFlowSmokeReportJson`, pass:

```ts
{ openRoadProbe: options.openRoadProbe, emittedAdapterIds: options.artifacts.emittedAdapterIds }
```

to `analyzeEmittedFlowArtifacts`, and use the emitted adapters for tool probing when possible:

```ts
const adapters = options.edaAdapters ?? DEFAULT_EDA_FLOW_ADAPTERS;
const tools = options.tools ?? (await probeToolsForAdapters(adapters));
```

Extend the `writeFlowSmokeReportJson` option type with `edaAdapters?: readonly EdaFlowAdapter[]` or the minimal `EmitArtifactAdapter[]` type from `spec/types.ts`.

- [ ] **Step 8: Add full selected-adapter workflow test**

Add to `emit.test.ts`:

```ts
test("emitWorkflowArtifacts quality pass skips intentionally unselected adapter families", async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "sram-workflow-"));
  const spec = await extractStructuredSpec({ macroName: "sram22_64x32m4w8", macrosRoot, repoRoot });

  try {
    const emitted = await emitWorkflowArtifacts({
      spec,
      outputRoot,
      runId: "subset-quality-run",
      repoRoot,
      edaAdapters: [openLaneAdapter],
    });

    const report = JSON.parse(await readFile(emitted.flowSmokeReportJson, "utf8"));
    expect(emitted.emittedAdapterIds).toEqual(["openlane"]);
    expect(report.staticQuality.errors).toBe(0);
    await expect(readFile(emitted.openRoadSmokeTcl, "utf8")).rejects.toThrow();
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 9: Run adapter/emission tests**

Run:

```bash
npm test -- prototypes/cursor-sdk-sram-workflow/test/edaFlowAdapters.test.ts prototypes/cursor-sdk-sram-workflow/test/emit.test.ts
```

Expected: pass.

---

## Task 5: Inject Human Intent Into SDK Prompts

**Files:**

- Modify: `prototypes/cursor-sdk-sram-workflow/src/sdk/prompts.ts`
- Test: create `prototypes/cursor-sdk-sram-workflow/test/prompts.test.ts` or extend existing prompt tests if present

- [ ] **Step 1: Write failing prompt tests**

Create `test/prompts.test.ts`:

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { extractStructuredSpec } from "../src/extract/sram22.js";
import { buildPlanningPrompt, buildSvaTranslationPrompt } from "../src/sdk/prompts.js";
import type { ResolvedHumanIntent } from "../src/human-intent/schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const macrosRoot = path.join(repoRoot, "data/tier3_generators/sram22_macros");

const humanIntent: ResolvedHumanIntent = {
  schemaVersion: "0.1.0",
  designerGoal: "Prioritize exhaustive write-mask verification.",
  macro: { name: "sram22_64x32m4w8", resolvedName: "sram22_64x32m4w8" },
  edaTargets: ["verification", "openlane"],
  verification: {
    priority: ["wmask", "coverage"],
    strictness: "source_backed",
    allowOptionalEnvironmentAssumptions: true,
    maxConvergenceIterations: 2,
  },
  reporting: {
    includePromptReport: true,
    includeFlowCharts: true,
    explainSkippedTools: true,
  },
  notes: ["Do not treat human notes as source evidence."],
};

describe("SDK prompts with human intent", () => {
  test("labels human intent separately from source evidence", async () => {
    const spec = await extractStructuredSpec({ macroName: "sram22_64x32m4w8", macrosRoot, repoRoot });
    const prompt = buildPlanningPrompt(spec, humanIntent);

    expect(prompt).toContain("Human intent (not source evidence):");
    expect(prompt).toContain("Prioritize exhaustive write-mask verification.");
    expect(prompt).toContain("Do not cite human intent as hardware source evidence.");
  });

  test("translation prompt includes verification priorities", async () => {
    const spec = await extractStructuredSpec({ macroName: "sram22_64x32m4w8", macrosRoot, repoRoot });
    const prompt = buildSvaTranslationPrompt(spec, humanIntent);

    expect(prompt).toContain("\"priority\"");
    expect(prompt).toContain("\"wmask\"");
    expect(prompt).toContain("\"coverage\"");
  });
});
```

- [ ] **Step 2: Run failing prompt tests**

Run:

```bash
npm test -- prototypes/cursor-sdk-sram-workflow/test/prompts.test.ts
```

Expected: fail because prompt builders do not accept `humanIntent`.

- [ ] **Step 3: Add prompt helper**

Modify `src/sdk/prompts.ts`:

```ts
import type { ResolvedHumanIntent } from "../human-intent/schema.js";

function formatHumanIntent(intent: ResolvedHumanIntent | undefined): string {
  if (intent === undefined) return "";
  return `Human intent (not source evidence):
${JSON.stringify(intent, null, 2)}

Rules for human intent:
- Use human intent to prioritize flow generation and review.
- Do not cite human intent as hardware source evidence.
- If human intent conflicts with source evidence, source evidence wins.
`;
}
```

Update each prompt builder signature:

```ts
export function buildPlanningPrompt(spec: StructuredSramSpec, humanIntent?: ResolvedHumanIntent): string
```

Then insert:

```ts
${formatHumanIntent(humanIntent)}
```

before the `Structured spec:` block in all six prompt builders.

- [ ] **Step 4: Run prompt tests and SDK tests**

Run:

```bash
npm test -- prototypes/cursor-sdk-sram-workflow/test/prompts.test.ts prototypes/cursor-sdk-sram-workflow/test/agentRunner.test.ts
```

Expected: pass.

---

## Task 6: Wire Human Intent Into `agent-run`

**Files:**

- Modify: `prototypes/cursor-sdk-sram-workflow/src/cli.ts`
- Create or modify tests depending on current CLI test coverage: prefer `test/humanIntent.test.ts` for helper-level logic and add one lightweight CLI-adjacent helper test rather than invoking real SDK.

- [ ] **Step 1: Extract reusable agent-run orchestration helper**

Before adding flags, reduce CLI action complexity by creating a helper in `cli.ts`:

```ts
async function resolveAgentRunInputs(macroArg: string, options: CommonOptions & {
  requirements?: string;
  interactive?: boolean;
}) {
  const paths = resolvePaths(options);
  const discovered = await DEFAULT_SRAM_SOURCE_ADAPTER.discover(paths.macrosRoot);
  const loaded =
    options.requirements === undefined
      ? defaultHumanIntent(macroArg)
      : await loadHumanIntentRequirements(path.resolve(options.requirements));
  const resolved = resolveHumanIntent({ loaded, discovered, interactive: options.interactive === true });
  return { paths, discovered, loaded, resolved };
}
```

Export this helper only if tests need it. If exported, keep the name explicit:

```ts
export async function resolveAgentRunInputsForTest(...)
```

- [ ] **Step 2: Add failing test for helper**

In `test/humanIntent.test.ts`, add:

```ts
test("default agent-run intent resolves the macro argument", async () => {
  const discovered = await discoverSram22Macros(macrosRoot);
  const loaded = defaultHumanIntent("sram22_64x32m4w8");
  const resolved = resolveHumanIntent({ loaded, discovered, interactive: false });

  expect(resolved.selectedMacro.name).toBe("sram22_64x32m4w8");
  expect(resolved.intent.macro.resolvedName).toBe("sram22_64x32m4w8");
});
```

Import `discoverSram22Macros`, `macrosRoot`, and helper functions as needed.

- [ ] **Step 3: Add CLI flags**

Modify `agent-run` command in `src/cli.ts`:

```ts
program
  .command("agent-run")
  .description("Run deterministic extraction plus Cursor SDK self-planning and self-review.")
  .option("--requirements <path>", "YAML/JSON human flow requirements loaded before extraction")
  .option("--interactive", "Interactively fill missing human intent fields before extraction")
  .argument("[macro]", "SRAM22 macro name", DEFAULT_MACRO)
```

Inside action:

```ts
const cmdOpts = agentRunCmd.opts<{ requirements?: string; interactive?: boolean }>();
const { paths, loaded, resolved } = await resolveAgentRunInputs(macro, { ...options, ...cmdOpts });
const spec = await DEFAULT_SRAM_SOURCE_ADAPTER.extract(resolved.selectedMacro, { repoRoot: paths.repoRoot });
const selectedAdapters = selectEdaFlowAdapters(resolved.intent.edaTargets);
const artifacts = await emitWorkflowArtifacts({
  spec,
  outputRoot: paths.outputRoot,
  runId: paths.runId,
  repoRoot: paths.repoRoot,
  edaAdapters: selectedAdapters,
});
```

Pass `resolved.intent` into all prompt builders:

```ts
planningPrompt: buildPlanningPrompt(spec, resolved.intent),
collateralPrompt: buildVerificationCollateralPrompt(spec, artifacts, resolved.intent),
reviewPrompt: buildReviewPrompt(spec, artifacts, resolved.intent),
intentPrompt: buildSpecIntentPrompt(spec, resolved.intent),
translationPrompt: buildSvaTranslationPrompt(spec, resolved.intent),
reviewerPrompt: buildSpecReviewerPrompt(spec, resolved.intent),
```

Use `resolved.intent.verification.maxConvergenceIterations` for `maxIterations`.

- [ ] **Step 4: Add fail-fast validation handling**

When loaded intent contains validation errors, throw before extraction:

```ts
const errors = loaded.findings.filter((finding) => finding.severity === "error");
if (errors.length > 0) {
  throw new Error(`Human intent validation failed: ${errors.map((finding) => finding.message).join("; ")}`);
}
```

This may already be handled by `resolveHumanIntent`; keep the error message clear.

- [ ] **Step 5: Run targeted tests**

Run:

```bash
npm test -- prototypes/cursor-sdk-sram-workflow/test/humanIntent.test.ts prototypes/cursor-sdk-sram-workflow/test/prompts.test.ts prototypes/cursor-sdk-sram-workflow/test/agentRunner.test.ts
```

Expected: pass.

---

## Task 7: Write Human Intent Artifacts

**Files:**

- Create: `prototypes/cursor-sdk-sram-workflow/src/human-intent/write.ts`
- Modify: `prototypes/cursor-sdk-sram-workflow/src/cli.ts`
- Test: `prototypes/cursor-sdk-sram-workflow/test/humanIntent.test.ts`

- [ ] **Step 1: Add failing artifact writer test**

Append:

```ts
import { writeHumanIntentArtifacts } from "../src/human-intent/write.js";

test("writes human-intent and source artifacts", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "human-intent-write-"));
  try {
    const loaded = defaultHumanIntent("sram22_64x32m4w8");
    const resolved = {
      ...loaded.intent,
      macro: { ...loaded.intent.macro, resolvedName: "sram22_64x32m4w8" },
    };

    const paths = await writeHumanIntentArtifacts({
      runDir: dir,
      intent: resolved,
      source: loaded.source,
    });

    expect(JSON.parse(await readFile(paths.intentJson, "utf8")).macro.resolvedName).toBe("sram22_64x32m4w8");
    expect(JSON.parse(await readFile(paths.sourceJson, "utf8")).sourceKind).toBe("defaults");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npm test -- prototypes/cursor-sdk-sram-workflow/test/humanIntent.test.ts
```

Expected: fail because writer does not exist.

- [ ] **Step 3: Implement writer**

Create `src/human-intent/write.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HumanIntentSource, ResolvedHumanIntent } from "./schema.js";

export interface WriteHumanIntentArtifactsOptions {
  runDir: string;
  intent: ResolvedHumanIntent;
  source: HumanIntentSource;
}

export interface HumanIntentArtifactPaths {
  intentJson: string;
  sourceJson: string;
}

export async function writeHumanIntentArtifacts(
  options: WriteHumanIntentArtifactsOptions,
): Promise<HumanIntentArtifactPaths> {
  await mkdir(options.runDir, { recursive: true });
  const intentJson = path.join(options.runDir, "human-intent.json");
  const sourceJson = path.join(options.runDir, "human-intent-source.json");
  await Promise.all([
    writeFile(intentJson, `${JSON.stringify(options.intent, null, 2)}\n`, "utf8"),
    writeFile(sourceJson, `${JSON.stringify(options.source, null, 2)}\n`, "utf8"),
  ]);
  return { intentJson, sourceJson };
}
```

- [ ] **Step 4: Call writer from `agent-run`**

In `cli.ts`, after `artifacts` is available:

```ts
const humanIntentArtifacts = await writeHumanIntentArtifacts({
  runDir: artifacts.runDir,
  intent: resolved.intent,
  source: loaded.source,
});
```

Include paths in stdout payload:

```ts
artifacts: {
  ...artifacts,
  humanIntentJson: humanIntentArtifacts.intentJson,
  humanIntentSourceJson: humanIntentArtifacts.sourceJson,
  agentVerificationCollateralMd,
  agentConvergenceReport,
}
```

- [ ] **Step 5: Run writer tests**

Run:

```bash
npm test -- prototypes/cursor-sdk-sram-workflow/test/humanIntent.test.ts
```

Expected: pass.

---

## Task 8: Reflect Human Intent In Convergence Artifacts And Reports

**Files:**

- Modify: `prototypes/cursor-sdk-sram-workflow/src/cli.ts`
- Optionally modify: `outputs/cursor-sdk-internal-prompts-report.html` after implementation verification
- Test: focused test in `test/humanIntent.test.ts` or `test/prompts.test.ts`

- [ ] **Step 1: Include human intent in `agent-convergence-report.md` writer**

Modify `writeAgentConvergenceArtifacts` options:

```ts
async function writeAgentConvergenceArtifacts(options: {
  spec: StructuredSramSpec;
  artifacts: EmittedArtifacts;
  sdkResult: SdkPlanningAndReviewResult;
  humanIntent?: ResolvedHumanIntent;
})
```

Add a section to the markdown:

```md
## Human Intent

- Goal: ...
- EDA targets: ...
- Verification priority: ...
- Notes:
  - ...
```

Use `"not provided"` only for legacy/default runs, not as an implementation placeholder.

- [ ] **Step 2: Add test for report text helper if extracted**

If the report generation remains embedded in `cli.ts`, extract a pure helper:

```ts
export function formatHumanIntentMarkdown(intent: ResolvedHumanIntent | undefined): string
```

Test:

```ts
expect(formatHumanIntentMarkdown(humanIntent)).toContain("Prioritize exhaustive write-mask verification.");
expect(formatHumanIntentMarkdown(humanIntent)).toContain("verification, openlane");
```

- [ ] **Step 3: Update HTML prompt report manually**

After tests pass, update:

```text
outputs/cursor-sdk-internal-prompts-report.html
```

Add one section:

```html
<section>
  <h2>Human Intent Injection Point</h2>
  <p>...</p>
</section>
```

This report update should be informational only; do not make it a dependency of CLI behavior.

- [ ] **Step 4: Run report-related tests**

Run:

```bash
npm test -- prototypes/cursor-sdk-sram-workflow/test/humanIntent.test.ts prototypes/cursor-sdk-sram-workflow/test/prompts.test.ts
```

Expected: pass.

---

## Task 9: Add Example Requirements File

**Files:**

- Create: `prototypes/cursor-sdk-sram-workflow/examples/flow-requirements.sram22-64x32.yaml`
- Optionally document in: `docs/workflow-prototype.md`

- [ ] **Step 1: Add example file**

Create:

```yaml
schemaVersion: 0.1.0
designerGoal: Generate a source-backed OpenLane/OpenROAD setup and rich SVA collateral for a 64x32 byte-masked SRAM macro.
macro:
  name: sram22_64x32m4w8
edaTargets:
  - hammer
  - openlane
  - verification
  - openroad
verification:
  priority:
    - protocol
    - wmask
    - memory_scoreboard
    - coverage
  strictness: source_backed
  allowOptionalEnvironmentAssumptions: true
  maxConvergenceIterations: 3
reporting:
  includePromptReport: true
  includeFlowCharts: true
  explainSkippedTools: true
notes:
  - Do not infer reset-clears-memory behavior unless source evidence exists.
  - Prefer exhaustive write-mask covers when mask width is small.
```

- [ ] **Step 2: Add documentation snippet**

Modify `docs/workflow-prototype.md` with:

```md
### Human-in-the-loop requirements

`agent-run` can load a pre-extraction requirements file:

```bash
npm run agent:run -- --requirements prototypes/cursor-sdk-sram-workflow/examples/flow-requirements.sram22-64x32.yaml --run-id hitl-demo
```

The resolved intent is saved as `outputs/<run-id>/human-intent.json`.
```

- [ ] **Step 3: Run documentation-adjacent tests**

Run:

```bash
npm test -- prototypes/cursor-sdk-sram-workflow/test/humanIntent.test.ts
```

Expected: pass.

---

## Task 10: End-To-End Verification

**Files:**

- No new files unless failures require fixes.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- prototypes/cursor-sdk-sram-workflow/test/humanIntent.test.ts prototypes/cursor-sdk-sram-workflow/test/prompts.test.ts prototypes/cursor-sdk-sram-workflow/test/agentRunner.test.ts prototypes/cursor-sdk-sram-workflow/test/edaFlowAdapters.test.ts prototypes/cursor-sdk-sram-workflow/test/emit.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run full tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 4: Run deterministic extraction with defaults**

Run:

```bash
npm run demo:extract -- sram22_64x32m4w8 --run-id hitl-default-regression --summary
```

Expected: current deterministic `extract` output remains valid and unchanged in command shape.

- [ ] **Step 5: Run requirements-backed agent E2E if `CURSOR_API_KEY` is available**

Run:

```bash
zsh -ic 'npm run agent:run -- --requirements prototypes/cursor-sdk-sram-workflow/examples/flow-requirements.sram22-64x32.yaml --run-id hitl-agent-e2e'
```

Expected:

- `outputs/hitl-agent-e2e/human-intent.json` exists.
- `outputs/hitl-agent-e2e/human-intent-source.json` exists.
- `outputs/hitl-agent-e2e/agent-events.jsonl` exists.
- `outputs/hitl-agent-e2e/convergence/final/properties.json` exists.

If `CURSOR_API_KEY` is unavailable, record the skip honestly and run the deterministic parts.

- [ ] **Step 6: Run flow-quality and smoke-run on E2E output**

Run:

```bash
npm run flow:quality -- hitl-agent-e2e --write
npm run smoke-run -- hitl-agent-e2e
```

Expected:

- Flow quality has no errors.
- OpenROAD/OpenLane/Yosys may be unavailable and reported honestly.
- Verilator SVA sidecars pass when Verilator is available.

- [ ] **Step 7: Read lints for changed files**

Run IDE diagnostics or use the Cursor lints tool for:

```text
prototypes/cursor-sdk-sram-workflow/src/human-intent
prototypes/cursor-sdk-sram-workflow/src/cli.ts
prototypes/cursor-sdk-sram-workflow/src/sdk/prompts.ts
prototypes/cursor-sdk-sram-workflow/src/emit/workflow.ts
```

Expected: no new diagnostics.

---

## Self-Review Checklist

- Spec coverage:
  - Requirements file loading: Task 2.
  - Interactive flag surface: Task 6.
  - Resolved `human-intent.json`: Task 7.
  - Prompt integration: Task 5.
  - Macro selection before extraction: Task 3 and Task 6.
  - Adapter selection: Task 4 and Task 6.
  - Report visibility: Task 8.
  - Tests and E2E: Task 10.

- Placeholder scan:
  - No unresolved placeholder wording is used.
  - The only optional path is explicitly scoped to report cosmetics and is not needed for core behavior.

- Type consistency:
  - `RawHumanIntent`, `ResolvedHumanIntent`, and `HumanIntentSource` are defined before use.
  - `LoadedHumanIntent` is returned by the loader and consumed by resolver/CLI.
  - `ResolvedHumanIntent` is passed to prompt builders.

- Scope control:
  - `extract` remains unchanged.
  - Human intent can guide prioritization and target selection, but cannot become source evidence.
  - Full interactive terminal question flow is intentionally minimal in version 1; ambiguous selection without interactive mode fails fast.

---

## Execution Handoff

Plan complete. Recommended execution mode: **Subagent-Driven** if subagent quota is available, because tasks split cleanly into schema/load, resolver, adapter emission, prompt integration, CLI wiring, and verification. Use **Inline Execution** if API quota is constrained.
