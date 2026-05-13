import type { MacroViews } from "../spec/types.js";

/** Views required for deterministic extraction (Verilog + LEF + typical Liberty). */
export type CriticalViewId = "verilog" | "lef" | "liberty_tt";

export function listMissingCriticalViews(views: MacroViews): CriticalViewId[] {
  const missing: CriticalViewId[] = [];
  if (views.verilog === undefined) missing.push("verilog");
  if (views.lef === undefined) missing.push("lef");
  if (views.liberty.tt === undefined) missing.push("liberty_tt");
  return missing;
}

export function macroReadinessFromSpec(validationIssues: { code: string }[]): "ready" | "blocked_missing_gds" {
  return validationIssues.some((i) => i.code === "missing_gds") ? "blocked_missing_gds" : "ready";
}
