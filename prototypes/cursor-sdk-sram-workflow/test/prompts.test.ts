import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { extractStructuredSpec } from "../src/extract/sram22.js";
import type { ResolvedHumanIntent } from "../src/human-intent/schema.js";
import { buildPlanningPrompt, buildSvaTranslationPrompt } from "../src/sdk/prompts.js";

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

    expect(prompt).toContain("Human intent (not source evidence");
    expect(prompt).toContain("Prioritize exhaustive write-mask verification.");
    expect(prompt).toContain("Never treat human intent as provenance");
  });

  test("translation prompt includes verification priorities", async () => {
    const spec = await extractStructuredSpec({ macroName: "sram22_64x32m4w8", macrosRoot, repoRoot });
    const prompt = buildSvaTranslationPrompt(spec, humanIntent);

    expect(prompt).toContain('"wmask"');
    expect(prompt).toContain('"coverage"');
  });
});
