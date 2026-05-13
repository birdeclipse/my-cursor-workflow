import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { batchExtractAndEmit } from "../src/extract/batch.js";
import { discoverSram22Macros } from "../src/extract/discover.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const macrosRoot = path.join(repoRoot, "data/tier3_generators/sram22_macros");

describe("batch extraction", () => {
  test("processes every discovered macro and writes an aggregate run report", async () => {
    const discovered = await discoverSram22Macros(macrosRoot);
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "sram-batch-"));
    const runId = "batch-test-run";

    try {
      const { results } = await batchExtractAndEmit({
        macrosRoot,
        repoRoot,
        outputRoot,
        runId,
      });

      expect(results.length).toBe(discovered.length);

      const reportPath = path.join(outputRoot, runId, "run-report.json");
      const report = JSON.parse(await readFile(reportPath, "utf8"));
      expect(report.mode).toBe("batch");
      expect(report.summary.totalDiscovered).toBe(discovered.length);

      expect(
        report.summary.succeeded + report.summary.failed + report.summary.skippedMissingViews,
      ).toBe(discovered.length);
      expect(report.summary.succeeded).toBeGreaterThan(0);

      const failed = results.filter((r) => r.status === "failed");
      if (failed.length > 0) {
        expect(failed.every((r) => typeof r.error === "string" && r.error.length > 0)).toBe(true);
      }

      const macroDirs = (await readdir(path.join(outputRoot, runId))).filter(
        (n) => n !== "run-report.json" && n !== "iteration-report.md",
      );
      expect(macroDirs.length).toBe(report.summary.succeeded);
      const firstOk = results.find((r) => r.status === "ok");
      expect(firstOk).toBeDefined();
      const smokePath = path.join(outputRoot, runId, firstOk!.macro, "flow-smoke-report.json");
      const smokeReport = JSON.parse(await readFile(smokePath, "utf8"));
      expect(smokeReport.macro).toBe(firstOk!.macro);
      expect(["dynamic_ready", "static_only", "blocked"]).toContain(smokeReport.status);

      const iterReport = path.join(outputRoot, runId, "iteration-report.md");
      const iterText = await readFile(iterReport, "utf8");
      expect(iterText).toContain("OpenROAD");
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });
});
