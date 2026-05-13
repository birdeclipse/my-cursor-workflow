import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { parseSram22MacroName, sram22SourceAdapter } from "../src/sram-sources/sram22/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const macrosRoot = path.join(repoRoot, "data/tier3_generators/sram22_macros");

describe("sram22SourceAdapter", () => {
  test("parses SRAM22 names through the source adapter boundary", () => {
    expect(parseSram22MacroName("sram22_64x32m4w8")).toEqual({
      name: "sram22_64x32m4w8",
      words: 64,
      width: 32,
      mux: 4,
      writeSize: 8,
    });
  });

  test("discovers and extracts the golden SRAM22 macro", async () => {
    const discovered = await sram22SourceAdapter.discover(macrosRoot);
    const target = discovered.find((macro) => macro.name === "sram22_64x32m4w8");

    expect(sram22SourceAdapter.id).toBe("sram22");
    expect(target).toBeDefined();
    expect(target?.views.gds).toMatch(/sram22_64x32m4w8\.gds\.gz$/);

    const spec = await sram22SourceAdapter.extract(target!, { repoRoot });
    const issues = sram22SourceAdapter.validate(spec);

    expect(spec.macro.name).toBe("sram22_64x32m4w8");
    expect(spec.macro.source).toBe("sram22");
    expect(spec.parameters.width.value).toBe(32);
    expect(spec.timing.clockPeriodNs.value).toBeCloseTo(4.86579, 5);
    expect(issues.map((issue) => issue.code)).not.toContain("missing_gds");
  });
});
