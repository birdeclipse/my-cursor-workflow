import { describe, expect, test } from "vitest";

import { listMissingCriticalViews } from "../src/extract/readiness.js";
import { validateStructuredSpec } from "../src/spec/validateSpec.js";
import { extractStructuredSpec } from "../src/extract/sram22.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const macrosRoot = path.join(repoRoot, "data/tier3_generators/sram22_macros");

describe("spec schema validation", () => {
  test("accepts a real extracted spec", async () => {
    const spec = await extractStructuredSpec({
      macroName: "sram22_64x32m4w8",
      macrosRoot,
      repoRoot,
    });
    expect(() => validateStructuredSpec(spec)).not.toThrow();
  });

  test("rejects impossible confidence", async () => {
    const spec = await extractStructuredSpec({
      macroName: "sram22_64x32m4w8",
      macrosRoot,
      repoRoot,
    });
    const broken = structuredClone(spec);
    broken.parameters.words = { ...broken.parameters.words, confidence: 1.5 };
    expect(() => validateStructuredSpec(broken)).toThrow(/schema validation/);
  });
});

describe("view readiness", () => {
  test("lists missing critical views", () => {
    expect(
      listMissingCriticalViews({
        liberty: {},
      }),
    ).toEqual(["verilog", "lef", "liberty_tt"]);

    expect(
      listMissingCriticalViews({
        verilog: "/a.v",
        lef: "/a.lef",
        liberty: { tt: "/a.lib" },
      }),
    ).toEqual([]);
  });
});
