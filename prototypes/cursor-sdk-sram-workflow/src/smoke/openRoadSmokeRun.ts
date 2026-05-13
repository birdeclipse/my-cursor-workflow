import { execFile } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { WorkflowRunReportPayload } from "../emit/runReport.js";
import {
  buildOpenRoadSmokeLogReport,
  type OpenRoadLogFinding,
  type OpenRoadSmokeLogReport,
} from "../review/flowSmoke.js";

const execFileAsync = promisify(execFile);

export type OpenRoadSmokeExecMode =
  | "skipped_batch_run"
  | "skipped_missing_runner_script"
  | "skipped_openroad_unavailable"
  | "skipped_docker_cli_unavailable"
  | "host_bash"
  | "docker"
  | "timeout"
  | "runner_failed";

export interface OpenRoadSmokeExecReport {
  schemaVersion: "0.1.0";
  runId: string;
  macro: string;
  generatedUtc: string;
  execution: {
    mode: OpenRoadSmokeExecMode;
    commandAttempted: string | null;
    exitCode: number | null;
    durationMs: number;
    stdouterrTail: string;
    dockerImage?: string;
  };
  logClassification: OpenRoadSmokeLogReport;
}

export interface ExecFileLike {
  (
    file: string,
    args: readonly string[] | undefined,
    options: { cwd?: string; timeout?: number; maxBuffer?: number; killSignal?: NodeJS.Signals },
  ): Promise<{ stdout: string; stderr: string }>;
}

export interface RunOpenRoadSmokeExecDeps {
  execFile: ExecFileLike;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function probeDockerCli(execImpl: ExecFileLike): Promise<boolean> {
  try {
    await execImpl("docker", ["version"], { timeout: 5_000, maxBuffer: 500_000 });
    return true;
  } catch {
    return false;
  }
}

async function probeOpenRoadCli(execImpl: ExecFileLike): Promise<boolean> {
  try {
    await execImpl("openroad", ["-version"], { timeout: 5_000, maxBuffer: 500_000 });
    return true;
  } catch {
    return false;
  }
}

function tailCombined(stdout: string, stderr: string, maxChars: number): string {
  const combined = `${stdout}${stderr}`.trimEnd();
  if (combined.length <= maxChars) return combined;
  return combined.slice(combined.length - maxChars);
}

function exitCodeFromUnknown(err: unknown): number | null {
  if (typeof err === "object" && err !== null && "code" in err) {
    const c = (err as { code?: unknown }).code;
    if (typeof c === "number") return c;
  }
  return null;
}

function stdouterrFromExecError(err: unknown): { stdout: string; stderr: string } {
  if (typeof err !== "object" || err === null) return { stdout: "", stderr: "" };
  const o = err as { stdout?: unknown; stderr?: unknown };
  return {
    stdout: typeof o.stdout === "string" ? o.stdout : "",
    stderr: typeof o.stderr === "string" ? o.stderr : "",
  };
}

function isExecTimeoutMessage(message: string): boolean {
  return /SIGTERM|SIGKILL|timed out|ETIMEDOUT|ETIMEOUT|maxBuffer exceeded/i.test(message);
}

async function readSmokeLogText(macroDir: string): Promise<string | undefined> {
  try {
    return await readFile(path.join(macroDir, "openroad-smoke.log"), "utf8");
  } catch {
    return undefined;
  }
}

export async function runOpenRoadSmokeExec(options: {
  outputRoot: string;
  runId: string;
  dockerImage?: string;
  timeoutMs?: number;
  logClassifier?: (logText: string) => OpenRoadLogFinding[];
  deps?: Partial<RunOpenRoadSmokeExecDeps>;
  generatedUtc?: string;
}): Promise<OpenRoadSmokeExecReport> {
  const execImpl = options.deps?.execFile ?? (execFileAsync as ExecFileLike);
  const timeoutMs = options.timeoutMs ?? 120_000;
  const generatedUtc = options.generatedUtc ?? new Date().toISOString();
  const runReportPath = path.join(options.outputRoot, options.runId, "run-report.json");
  const runReportRaw = await readFile(runReportPath, "utf8");
  const runReport = JSON.parse(runReportRaw) as WorkflowRunReportPayload;

  let macro = "unknown";
  let macroDir = "";

  if (runReport.mode === "batch") {
    const logClassification = buildOpenRoadSmokeLogReport({
      runId: options.runId,
      macro,
      logPath: "openroad-smoke.log",
      classifyLog: options.logClassifier,
      generatedUtc,
    });
    return {
      schemaVersion: "0.1.0",
      runId: options.runId,
      macro,
      generatedUtc,
      execution: {
        mode: "skipped_batch_run",
        commandAttempted: null,
        exitCode: null,
        durationMs: 0,
        stdouterrTail: "",
      },
      logClassification,
    };
  }

  macro = runReport.macro;
  macroDir = path.join(options.outputRoot, options.runId, macro);
  const runnerPath = path.join(macroDir, "run-openroad-smoke.sh");
  const dockerImageTrimmed = options.dockerImage?.trim();

  const emptyTail = "";

  if (!(await pathExists(runnerPath))) {
    const logText = await readSmokeLogText(macroDir);
    return {
      schemaVersion: "0.1.0",
      runId: options.runId,
      macro,
      generatedUtc,
      execution: {
        mode: "skipped_missing_runner_script",
        commandAttempted: null,
        exitCode: null,
        durationMs: 0,
        stdouterrTail: emptyTail,
      },
      logClassification: buildOpenRoadSmokeLogReport({
        runId: options.runId,
        macro,
        logPath: "openroad-smoke.log",
        logText,
        classifyLog: options.logClassifier,
        generatedUtc,
      }),
    };
  }

  const openroadAvailable = await probeOpenRoadCli(execImpl);

  let mode: OpenRoadSmokeExecMode = "skipped_openroad_unavailable";
  let commandAttempted: string | null = null;
  let exitCode: number | null = null;
  let durationMs = 0;
  let stdouterrTail = emptyTail;
  let dockerImageOut: string | undefined;

  if (dockerImageTrimmed !== undefined && dockerImageTrimmed.length > 0) {
    dockerImageOut = dockerImageTrimmed;
    const dockerOk = await probeDockerCli(execImpl);
    if (!dockerOk) {
      mode = "skipped_docker_cli_unavailable";
    } else {
      commandAttempted = `docker run --rm -v "${macroDir}:${macroDir}" -w "${macroDir}" ${dockerImageTrimmed} bash ./run-openroad-smoke.sh`;
      const started = Date.now();
      try {
        const r = await execImpl(
          "docker",
          ["run", "--rm", "-v", `${macroDir}:${macroDir}`, "-w", macroDir, dockerImageTrimmed, "bash", "./run-openroad-smoke.sh"],
          { timeout: timeoutMs, maxBuffer: 10_000_000 },
        );
        durationMs = Date.now() - started;
        mode = "docker";
        exitCode = 0;
        stdouterrTail = tailCombined(r.stdout, r.stderr, 4_000);
      } catch (err: unknown) {
        durationMs = Date.now() - started;
        const msg = err instanceof Error ? err.message : String(err);
        const { stdout, stderr } = stdouterrFromExecError(err);
        stdouterrTail = tailCombined(stdout, stderr, 4_000);
        if (stdouterrTail === "") stdouterrTail = msg.slice(-4_000);
        exitCode = exitCodeFromUnknown(err);
        if (isExecTimeoutMessage(msg)) {
          mode = "timeout";
        } else {
          mode = "runner_failed";
        }
      }
    }
  } else if (openroadAvailable) {
    commandAttempted = `bash "${runnerPath}"`;
    const started = Date.now();
    try {
      const r = await execImpl("bash", [runnerPath], { cwd: macroDir, timeout: timeoutMs, maxBuffer: 10_000_000 });
      durationMs = Date.now() - started;
      mode = "host_bash";
      exitCode = 0;
      stdouterrTail = tailCombined(r.stdout, r.stderr, 4_000);
    } catch (err: unknown) {
      durationMs = Date.now() - started;
      const msg = err instanceof Error ? err.message : String(err);
      const { stdout, stderr } = stdouterrFromExecError(err);
      stdouterrTail = tailCombined(stdout, stderr, 4_000);
      if (stdouterrTail === "") stdouterrTail = msg.slice(-4_000);
      exitCode = exitCodeFromUnknown(err);
      if (isExecTimeoutMessage(msg)) {
        mode = "timeout";
      } else {
        mode = "runner_failed";
      }
    }
  } else {
    mode = "skipped_openroad_unavailable";
  }

  const logText = await readSmokeLogText(macroDir);
  const logClassification = buildOpenRoadSmokeLogReport({
    runId: options.runId,
    macro,
    logPath: "openroad-smoke.log",
    logText,
    classifyLog: options.logClassifier,
    generatedUtc,
  });

  return {
    schemaVersion: "0.1.0",
    runId: options.runId,
    macro,
    generatedUtc,
    execution: {
      mode,
      commandAttempted,
      exitCode,
      durationMs,
      stdouterrTail,
      dockerImage: dockerImageOut,
    },
    logClassification,
  };
}

export const OPENROAD_SMOKE_EXEC_REPORT_FILENAME = "openroad-smoke-exec-report.json";

export async function writeOpenRoadSmokeExecReport(macroDir: string, report: OpenRoadSmokeExecReport): Promise<string> {
  const out = path.join(macroDir, OPENROAD_SMOKE_EXEC_REPORT_FILENAME);
  await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return out;
}
