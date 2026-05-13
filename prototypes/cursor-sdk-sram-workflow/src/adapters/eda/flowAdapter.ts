import type { EmittedFile, EmittedRun } from "../../core/artifacts.js";
import type { QualityFinding, QualityRule } from "../../core/quality.js";
import type { SmokePlan, ToolProbe } from "../../core/smoke.js";
import type { CanonicalSramSpec } from "../../domains/sram/types.js";

export interface EdaFlowAdapter {
  id: string;
  emit(spec: CanonicalSramSpec): EmittedFile[];
  qualityRules(): QualityRule[];
  toolProbes(): ToolProbe[];
  smokePlan(run: EmittedRun): SmokePlan;
  classifyLog(logText: string): QualityFinding[];
}
