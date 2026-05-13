import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { WorkflowRunReportPayload } from "../src/emit/runReport.js";
import { runOpenRoadSmokeExec, type ExecFileLike } from "../src/smoke/openRoadSmokeRun.js";

function fakeExecAlways(ok: {
  beforeResolve?: (cwd: string) => Promise<void>;
}): ExecFileLike {
  return async (_file, _args, opts) => {
    const cwd = opts.cwd ?? process.cwd();
    if (ok.beforeResolve !== undefined) {
      await ok.beforeResolve(cwd);
    }
    return { stdout: "", stderr: "" };
  };
}

describe("openRoadSmokeRun", () => {
  test("skipped_batch_run when run-report is batch mode", async () => {
    const outputRoot = await mkdtemp(path.join(tmpdir(), "sram-smoke-"));
    const runId = "ralph-batch-test";
    await mkdir(path.join(outputRoot, runId), { recursive: true });
    const batchReport: WorkflowRunReportPayload = {
      mode: "batch",
      runId,
      summary: {
        totalDiscovered: 1,
        recorded: 1,
        skippedMissingViews: 0,
        failed: 0,
        succeeded: 1,
        readiness: { ready: 1, blockedMissingGds: 0 },
      },
      macros: [{ macro: "sram22_64x32m4w8", status: "ok", readiness: "ready" }],
    };
    await writeFile(path.join(outputRoot, runId, "run-report.json"), `${JSON.stringify(batchReport, null, 2)}\n`, "utf8");

    const report = await runOpenRoadSmokeExec({
      outputRoot,
      runId,
      deps: { execFile: fakeExecAlways({}) },
      logClassifier: () => [
        {
          code: "openroad_warning",
          severity: "warning",
          message: "classified by adapter",
        },
      ],
      generatedUtc: "2026-01-01T00:00:00.000Z",
    });

    expect(report.execution.mode).toBe("skipped_batch_run");
    expect(report.execution.commandAttempted).toBeNull();
    expect(report.macro).toBe("unknown");
    expect(report.logClassification.status).toBe("not_run");
  });

  test("skipped_missing_runner_script when run-openroad-smoke.sh is absent", async () => {
    const outputRoot = await mkdtemp(path.join(tmpdir(), "sram-smoke-"));
    const runId = "ralph-single-test";
    const macro = "sram22_64x32m4w8";
    const macroDir = path.join(outputRoot, runId, macro);
    await mkdir(macroDir, { recursive: true });

    const singleReport: WorkflowRunReportPayload = {
      mode: "single",
      runId,
      macro,
      readiness: "ready",
      artifacts: {} as never,
      validationIssues: [],
      readinessAggregate: { ready: 1, blockedMissingGds: 0 },
    };
    await writeFile(path.join(outputRoot, runId, "run-report.json"), `${JSON.stringify(singleReport, null, 2)}\n`, "utf8");

    const report = await runOpenRoadSmokeExec({
      outputRoot,
      runId,
      deps: { execFile: fakeExecAlways({}) },
      generatedUtc: "2026-01-01T00:00:00.000Z",
    });

    expect(report.execution.mode).toBe("skipped_missing_runner_script");
    expect(report.macro).toBe(macro);
  });

  test("skipped_openroad_unavailable when OpenROAD missing and no docker image", async () => {
    const outputRoot = await mkdtemp(path.join(tmpdir(), "sram-smoke-"));
    const runId = "ralph-single-test";
    const macro = "sram22_64x32m4w8";
    const macroDir = path.join(outputRoot, runId, macro);
    await mkdir(macroDir, { recursive: true });
    await writeFile(path.join(macroDir, "run-openroad-smoke.sh"), "#!/usr/bin/env bash\necho noop\n", "utf8");

    const singleReport: WorkflowRunReportPayload = {
      mode: "single",
      runId,
      macro,
      readiness: "ready",
      artifacts: {} as never,
      validationIssues: [],
      readinessAggregate: { ready: 1, blockedMissingGds: 0 },
    };
    await writeFile(path.join(outputRoot, runId, "run-report.json"), `${JSON.stringify(singleReport, null, 2)}\n`, "utf8");

    const report = await runOpenRoadSmokeExec({
      outputRoot,
      runId,
      deps: {
        execFile: async (file, args) => {
          if (file === "openroad" && args?.[0] === "-version") {
            throw new Error("spawn openroad ENOENT");
          }
          return { stdout: "", stderr: "" };
        },
      },
      generatedUtc: "2026-01-01T00:00:00.000Z",
    });

    expect(report.execution.mode).toBe("skipped_openroad_unavailable");
    expect(report.execution.commandAttempted).toBeNull();
  });

  test("host_bash refreshes log classification after mocked runner success", async () => {
    const outputRoot = await mkdtemp(path.join(tmpdir(), "sram-smoke-"));
    const runId = "ralph-single-test";
    const macro = "sram22_64x32m4w8";
    const macroDir = path.join(outputRoot, runId, macro);
    await mkdir(macroDir, { recursive: true });
    const runnerPath = path.join(macroDir, "run-openroad-smoke.sh");
    await writeFile(runnerPath, "#!/usr/bin/env bash\necho noop\n", "utf8");

    const singleReport: WorkflowRunReportPayload = {
      mode: "single",
      runId,
      macro,
      readiness: "ready",
      artifacts: {} as never,
      validationIssues: [],
      readinessAggregate: { ready: 1, blockedMissingGds: 0 },
    };
    await writeFile(path.join(outputRoot, runId, "run-report.json"), `${JSON.stringify(singleReport, null, 2)}\n`, "utf8");

    const report = await runOpenRoadSmokeExec({
      outputRoot,
      runId,
      deps: {
        execFile: async (file, args, opts) => {
          if (file === "openroad" && args?.[0] === "-version") {
            return { stdout: "OpenROAD v\n", stderr: "" };
          }
          if (file === "bash" && args?.includes(runnerPath)) {
            const cwd = opts.cwd ?? macroDir;
            await writeFile(path.join(cwd, "openroad-smoke.log"), "Smoke completed without errors.\n", "utf8");
            return { stdout: "ok\n", stderr: "" };
          }
          return { stdout: "", stderr: "" };
        },
      },
      logClassifier: () => [
        {
          code: "openroad_link_failure",
          severity: "error",
          message: "classified by adapter",
        },
      ],
      generatedUtc: "2026-01-01T00:00:00.000Z",
    });

    expect(report.execution.mode).toBe("host_bash");
    expect(report.execution.exitCode).toBe(0);
    expect(report.logClassification.status).toBe("failed");
    expect(report.logClassification.findings.some((finding) => finding.code === "openroad_link_failure")).toBe(true);
  });

  test("runner_failed captures non-zero exit and still classifies log", async () => {
    const outputRoot = await mkdtemp(path.join(tmpdir(), "sram-smoke-"));
    const runId = "ralph-single-test";
    const macro = "sram22_64x32m4w8";
    const macroDir = path.join(outputRoot, runId, macro);
    await mkdir(macroDir, { recursive: true });
    const runnerPath = path.join(macroDir, "run-openroad-smoke.sh");
    await writeFile(runnerPath, "#!/usr/bin/env bash\necho noop\n", "utf8");

    const singleReport: WorkflowRunReportPayload = {
      mode: "single",
      runId,
      macro,
      readiness: "ready",
      artifacts: {} as never,
      validationIssues: [],
      readinessAggregate: { ready: 1, blockedMissingGds: 0 },
    };
    await writeFile(path.join(outputRoot, runId, "run-report.json"), `${JSON.stringify(singleReport, null, 2)}\n`, "utf8");

    const err = new Error("Command failed") as Error & { code?: number };
    err.code = 1;

    const report = await runOpenRoadSmokeExec({
      outputRoot,
      runId,
      deps: {
        execFile: async (file, args) => {
          if (file === "openroad" && args?.[0] === "-version") {
            return { stdout: "OpenROAD v\n", stderr: "" };
          }
          if (file === "bash") {
            await writeFile(path.join(macroDir, "openroad-smoke.log"), "Error: cannot open missing.lef\n", "utf8");
            throw err;
          }
          return { stdout: "", stderr: "" };
        },
      },
      generatedUtc: "2026-01-01T00:00:00.000Z",
    });

    expect(report.execution.mode).toBe("runner_failed");
    expect(report.execution.exitCode).toBe(1);
    expect(report.logClassification.findings.some((f) => f.code === "openroad_missing_input")).toBe(true);
  });

  test("timeout mode when exec rejects with killed message", async () => {
    const outputRoot = await mkdtemp(path.join(tmpdir(), "sram-smoke-"));
    const runId = "ralph-single-test";
    const macro = "sram22_64x32m4w8";
    const macroDir = path.join(outputRoot, runId, macro);
    await mkdir(macroDir, { recursive: true });
    await writeFile(path.join(macroDir, "run-openroad-smoke.sh"), "#!/usr/bin/env bash\necho noop\n", "utf8");

    const singleReport: WorkflowRunReportPayload = {
      mode: "single",
      runId,
      macro,
      readiness: "ready",
      artifacts: {} as never,
      validationIssues: [],
      readinessAggregate: { ready: 1, blockedMissingGds: 0 },
    };
    await writeFile(path.join(outputRoot, runId, "run-report.json"), `${JSON.stringify(singleReport, null, 2)}\n`, "utf8");

    const report = await runOpenRoadSmokeExec({
      outputRoot,
      runId,
      timeoutMs: 100,
      deps: {
        execFile: async (file, args) => {
          if (file === "openroad" && args?.[0] === "-version") {
            return { stdout: "OpenROAD v\n", stderr: "" };
          }
          if (file === "bash") {
            throw new Error("spawn bash SIGTERM");
          }
          return { stdout: "", stderr: "" };
        },
      },
      generatedUtc: "2026-01-01T00:00:00.000Z",
    });

    expect(report.execution.mode).toBe("timeout");
  });

  test("docker mode attempts docker run when image provided and docker CLI ok", async () => {
    const outputRoot = await mkdtemp(path.join(tmpdir(), "sram-smoke-"));
    const runId = "ralph-single-test";
    const macro = "sram22_64x32m4w8";
    const macroDir = path.join(outputRoot, runId, macro);
    await mkdir(macroDir, { recursive: true });
    await writeFile(path.join(macroDir, "run-openroad-smoke.sh"), "#!/usr/bin/env bash\necho noop\n", "utf8");

    const singleReport: WorkflowRunReportPayload = {
      mode: "single",
      runId,
      macro,
      readiness: "ready",
      artifacts: {} as never,
      validationIssues: [],
      readinessAggregate: { ready: 1, blockedMissingGds: 0 },
    };
    await writeFile(path.join(outputRoot, runId, "run-report.json"), `${JSON.stringify(singleReport, null, 2)}\n`, "utf8");

    const report = await runOpenRoadSmokeExec({
      outputRoot,
      runId,
      dockerImage: "openroad/test:latest",
      deps: {
        execFile: async (file, args) => {
          if (file === "docker" && args?.[0] === "version") {
            return { stdout: "Docker ok\n", stderr: "" };
          }
          if (file === "docker" && args?.[0] === "run") {
            await writeFile(path.join(macroDir, "openroad-smoke.log"), "container smoke ok\n", "utf8");
            return { stdout: "done\n", stderr: "" };
          }
          return { stdout: "", stderr: "" };
        },
      },
      generatedUtc: "2026-01-01T00:00:00.000Z",
    });

    expect(report.execution.mode).toBe("docker");
    expect(report.execution.dockerImage).toBe("openroad/test:latest");
    expect(report.execution.commandAttempted).toContain("docker");
    expect(report.execution.commandAttempted).toContain("openroad/test:latest");
  });

  test("skipped_docker_cli_unavailable when docker image set but docker missing", async () => {
    const outputRoot = await mkdtemp(path.join(tmpdir(), "sram-smoke-"));
    const runId = "ralph-single-test";
    const macro = "sram22_64x32m4w8";
    const macroDir = path.join(outputRoot, runId, macro);
    await mkdir(macroDir, { recursive: true });
    await writeFile(path.join(macroDir, "run-openroad-smoke.sh"), "#!/usr/bin/env bash\necho noop\n", "utf8");

    const singleReport: WorkflowRunReportPayload = {
      mode: "single",
      runId,
      macro,
      readiness: "ready",
      artifacts: {} as never,
      validationIssues: [],
      readinessAggregate: { ready: 1, blockedMissingGds: 0 },
    };
    await writeFile(path.join(outputRoot, runId, "run-report.json"), `${JSON.stringify(singleReport, null, 2)}\n`, "utf8");

    const report = await runOpenRoadSmokeExec({
      outputRoot,
      runId,
      dockerImage: "openroad/test:latest",
      deps: {
        execFile: async (file, args) => {
          if (file === "docker") {
            throw new Error("spawn docker ENOENT");
          }
          return { stdout: "", stderr: "" };
        },
      },
      generatedUtc: "2026-01-01T00:00:00.000Z",
    });

    expect(report.execution.mode).toBe("skipped_docker_cli_unavailable");
  });
});
