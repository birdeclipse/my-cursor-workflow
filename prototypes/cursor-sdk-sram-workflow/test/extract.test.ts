import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { discoverSram22Macros } from "../src/extract/discover.js";
import { extractStructuredSpec, parseMacroName } from "../src/extract/sram22.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const macrosRoot = path.join(repoRoot, "data/tier3_generators/sram22_macros");

describe("SRAM22 extraction", () => {
  test("parses the encoded macro name with the required regex", () => {
    expect(parseMacroName("sram22_64x32m4w8")).toEqual({
      name: "sram22_64x32m4w8",
      words: 64,
      width: 32,
      mux: 4,
      writeSize: 8,
    });
  });

  test("rejects unsupported macro names instead of guessing", () => {
    expect(() => parseMacroName("sky130_sram_1kbyte_1rw1r_32x256_8")).toThrow(
      "Unsupported SRAM22 macro name",
    );
  });

  test("discovers SRAM22 macro directories and available views", async () => {
    const macros = await discoverSram22Macros(macrosRoot);
    const target = macros.find((macro) => macro.name === "sram22_64x32m4w8");

    expect(macros.length).toBeGreaterThan(10);
    expect(target?.views.verilog).toMatch(/sram22_64x32m4w8\.v$/);
    expect(target?.views.lef).toMatch(/sram22_64x32m4w8\.lef$/);
    expect(target?.views.spice).toMatch(/sram22_64x32m4w8\.spice$/);
    expect(target?.views.liberty.tt).toMatch(/tt_025C_1v80\.lib$/);
    expect(target?.views.gds).toMatch(/sram22_64x32m4w8\.gds\.gz$/);
  });

  test("extracts a provenance-rich structured spec from macro views", async () => {
    const spec = await extractStructuredSpec({
      macroName: "sram22_64x32m4w8",
      macrosRoot,
      repoRoot,
    });

    expect(spec.macro.name).toBe("sram22_64x32m4w8");
    expect(spec.parameters.words.value).toBe(64);
    expect(spec.parameters.width.value).toBe(32);
    expect(spec.parameters.addrWidth.value).toBe(6);
    expect(spec.parameters.wmaskWidth.value).toBe(4);
    expect(spec.physical.widthMicrons.value).toBe(360.32);
    expect(spec.physical.heightMicrons.value).toBe(191);
    expect(spec.timing.clockPeriodNs.value).toBeCloseTo(4.86579, 5);
    expect(spec.timing.clockPeriodNs.sources.some((src) => src.path.endsWith("_ss_100C_1v60.lib"))).toBe(true);
    expect(new Set(spec.timing.clockPeriodNs.sources.map((src) => `${src.path}:${src.line ?? ""}`)).size).toBe(
      spec.timing.clockPeriodNs.sources.length,
    );
    expect(spec.ports.power.value).toEqual(["vdd"]);
    expect(spec.ports.ground.value).toEqual(["vss"]);
    expect(spec.interfaceProtocol.clock.samplingEdge.value).toBe("posedge");
    expect(spec.interfaceProtocol.resetBar.resetsMemoryInModel.value).toBe(false);
    expect(spec.interfaceProtocol.wmask.lanes).toHaveLength(spec.parameters.wmaskWidth.value);
    expect(spec.validationIssues.map((issue) => issue.code)).not.toContain("missing_gds");
    expect(spec.parameters.width.sources[0]?.path).toContain("sram22_64x32m4w8");
  });
});
