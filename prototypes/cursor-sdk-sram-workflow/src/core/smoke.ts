export interface ToolProbe {
  tool: string;
  command: string;
}

export interface SmokePlan {
  name: string;
  cwd: string;
  command: string;
  args: string[];
}

export type SmokeExecutionStatus = "passed" | "failed" | "skipped" | "timeout";

export interface SmokeExecutionResult {
  status: SmokeExecutionStatus;
  command: string;
  detail: string;
  exitCode?: number;
  durationMs?: number;
}
