import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { discoverSram22Macros } from "../src/extract/discover.js";
import { defaultHumanIntent, loadHumanIntentRequirements, validateHumanIntent } from "../src/human-intent/load.js";
import { resolveHumanIntent } from "../src/human-intent/resolve.js";
import {
  DEFAULT_HUMAN_INTENT,
  applyHumanIntentDefaults,
  type RawHumanIntent,
} from "../src/human-intent/schema.js";
import { writeHumanIntentArtifacts } from "../src/human-intent/write.js";
import type { DiscoveredMacro } from "../src/spec/types.js";

const fakeDiscovered: DiscoveredMacro[] = [
  { name: "sram22_64x32m4w8", dir: "/a", views: { liberty: {} } },
  { name: "sram22_128x32m4w8", dir: "/b", views: { liberty: {} } },
];

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

describe("human intent load and validate", () => {
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
});

describe("human intent resolve", () => {
  test("resolves explicit macro name", async () => {
    const loaded = defaultHumanIntent("sram22_64x32m4w8");
    const resolved = await resolveHumanIntent({
      loaded,
      discovered: fakeDiscovered,
      interactive: false,
    });

    expect(resolved.selectedMacro.name).toBe("sram22_64x32m4w8");
    expect(resolved.intent.macro.resolvedName).toBe("sram22_64x32m4w8");
    expect(resolved.usedInteractiveDisambiguation).toBe(false);
  });

  test("rejects ambiguous macro constraints without interactive mode", async () => {
    const loaded = {
      intent: applyHumanIntentDefaults({
        schemaVersion: "0.1.0",
        designerGoal: "Find a byte-masked SRAM",
        macro: { selection: { minWords: 64, minWidth: 32, requiresWriteMask: true, preferredMux: 4 } },
      }),
      source: {
        schemaVersion: "0.1.0" as const,
        sourceKind: "requirements_file" as const,
        defaultedFields: [],
        interactiveFields: [],
      },
      findings: [],
    };

    await expect(
      resolveHumanIntent({
        loaded,
        discovered: fakeDiscovered,
        interactive: false,
      }),
    ).rejects.toThrow(/matched multiple macros/);
  });

  test("interactive disambiguation uses chooseMacro hook", async () => {
    const loaded = {
      intent: applyHumanIntentDefaults({
        schemaVersion: "0.1.0",
        designerGoal: "Pick one",
        macro: { selection: { minWords: 64, minWidth: 32, requiresWriteMask: true, preferredMux: 4 } },
      }),
      source: {
        schemaVersion: "0.1.0" as const,
        sourceKind: "requirements_file" as const,
        defaultedFields: [],
        interactiveFields: [],
      },
      findings: [],
    };

    const resolved = await resolveHumanIntent({
      loaded,
      discovered: fakeDiscovered,
      interactive: true,
      chooseMacro: async (matches) => matches[0]!,
    });

    expect(resolved.selectedMacro.name).toBe("sram22_64x32m4w8");
    expect(resolved.usedInteractiveDisambiguation).toBe(true);
  });

  test("default agent-run intent resolves against real discovery", async () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    const macrosRoot = path.join(repoRoot, "data/tier3_generators/sram22_macros");
    const discovered = await discoverSram22Macros(macrosRoot);
    const loaded = defaultHumanIntent("sram22_64x32m4w8");
    const resolved = await resolveHumanIntent({ loaded, discovered, interactive: false });

    expect(resolved.selectedMacro.name).toBe("sram22_64x32m4w8");
    expect(resolved.intent.macro.resolvedName).toBe("sram22_64x32m4w8");
  });
});

describe("human intent artifacts", () => {
  test("writes human-intent and source artifacts", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "human-intent-write-"));
    try {
      const loaded = defaultHumanIntent("sram22_64x32m4w8");
      const intent = {
        ...loaded.intent,
        macro: { ...loaded.intent.macro, resolvedName: "sram22_64x32m4w8" },
      };

      const paths = await writeHumanIntentArtifacts({
        runDir: dir,
        intent,
        source: loaded.source,
      });

      expect(JSON.parse(await readFile(paths.intentJson, "utf8")).macro.resolvedName).toBe("sram22_64x32m4w8");
      expect(JSON.parse(await readFile(paths.sourceJson, "utf8")).sourceKind).toBe("defaults");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
