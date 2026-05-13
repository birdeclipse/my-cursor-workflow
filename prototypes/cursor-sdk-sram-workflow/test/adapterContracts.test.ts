import { describe, expect, test } from "vitest";

import type { EmittedFile, EmittedRun } from "../src/core/artifacts.js";
import { countFindingsBySeverity, type QualityFinding } from "../src/core/quality.js";
import type { SmokeExecutionResult, ToolProbe } from "../src/core/smoke.js";
import type { CanonicalSramSpec } from "../src/domains/sram/types.js";
import type { SramSourceAdapter } from "../src/domains/sram/sourceAdapter.js";
import type { EdaFlowAdapter } from "../src/adapters/eda/flowAdapter.js";

describe("adapter contracts", () => {
  test("core artifact contracts describe emitted files and runs", () => {
    const file: EmittedFile = {
      fileName: "openlane.config.json",
      contents: "{}\n",
      adapterId: "openlane",
      kind: "config",
    };
    const run: EmittedRun = {
      runId: "adapter-contract-test",
      macroName: "sram22_64x32m4w8",
      macroDir: "/tmp/adapter-contract-test/sram22_64x32m4w8",
      files: [file],
    };

    expect(run.files[0]).toEqual(file);
  });

  test("quality helpers count findings by severity", () => {
    const findings: QualityFinding[] = [
      { severity: "error", code: "missing_config", message: "missing config" },
      { severity: "warning", code: "tool_missing", message: "tool missing" },
      { severity: "info", code: "prototype_metadata", message: "prototype metadata" },
    ];

    expect(countFindingsBySeverity(findings)).toEqual({ errors: 1, warnings: 1, info: 1 });
  });

  test("SRAM source and EDA flow adapters can be represented without concrete implementations", async () => {
    const spec = { macro: { name: "sram22_64x32m4w8" } } as CanonicalSramSpec;
    const sourceAdapter: SramSourceAdapter = {
      id: "sram22",
      async discover() {
        return [{ name: "sram22_64x32m4w8", dir: "/tmp/sram22_64x32m4w8", views: { liberty: {} } }];
      },
      async extract() {
        return spec;
      },
      validate() {
        return [];
      },
    };
    const flowAdapter: EdaFlowAdapter = {
      id: "openlane",
      emit(input) {
        return [{ fileName: `${input.macro.name}.json`, contents: "{}\n", adapterId: "openlane", kind: "config" }];
      },
      qualityRules() {
        return [];
      },
      toolProbes(): ToolProbe[] {
        return [{ tool: "openlane", command: "openlane --version" }];
      },
      smokePlan(run) {
        return { name: "openlane-smoke", cwd: run.macroDir, command: "openlane", args: ["--version"] };
      },
      classifyLog() {
        return [];
      },
    };
    const discovered = await sourceAdapter.discover("/tmp");
    const extracted = await sourceAdapter.extract(discovered[0], { repoRoot: "/tmp" });
    const files = flowAdapter.emit(extracted);
    const smoke: SmokeExecutionResult = {
      status: "skipped",
      command: "openlane --version",
      detail: "not executed in contract test",
    };

    expect(files[0].fileName).toBe("sram22_64x32m4w8.json");
    expect(flowAdapter.toolProbes()[0].tool).toBe("openlane");
    expect(smoke.status).toBe("skipped");
  });
});
