import type { QualityFinding } from "../core/quality.js";
import { DEFAULT_EDA_FLOW_ADAPTERS } from "./index.js";
import type { EdaFlowAdapter } from "./flowAdapter.js";
import {
  probeTool,
  type OpenRoadLogFinding,
  type ToolName,
  type ToolProbeResult,
} from "../review/flowSmoke.js";

const KNOWN_FLOW_TOOL_ORDER: readonly ToolName[] = ["openroad", "openlane", "yosys", "verilator"];
const KNOWN_FLOW_TOOLS = new Set<string>(KNOWN_FLOW_TOOL_ORDER);

function isToolName(tool: string): tool is ToolName {
  return KNOWN_FLOW_TOOLS.has(tool);
}

export function toolNamesForAdapters(
  adapters: readonly EdaFlowAdapter[] = DEFAULT_EDA_FLOW_ADAPTERS,
): ToolName[] {
  const seen = new Set<ToolName>();

  for (const adapter of adapters) {
    for (const probe of adapter.toolProbes()) {
      if (!isToolName(probe.tool) || seen.has(probe.tool)) continue;
      seen.add(probe.tool);
    }
  }

  return KNOWN_FLOW_TOOL_ORDER.filter((tool) => seen.has(tool));
}

export async function probeToolsForAdapters(
  adapters: readonly EdaFlowAdapter[] = DEFAULT_EDA_FLOW_ADAPTERS,
  timeoutMs?: number,
): Promise<ToolProbeResult[]> {
  return Promise.all(toolNamesForAdapters(adapters).map((tool) => probeTool(tool, timeoutMs)));
}

export function classifyLogWithAdapter(
  adapterId: string,
  logText: string,
  adapters: readonly EdaFlowAdapter[] = DEFAULT_EDA_FLOW_ADAPTERS,
): QualityFinding[] {
  const adapter = adapters.find((candidate) => candidate.id === adapterId);
  return adapter === undefined ? [] : adapter.classifyLog(logText);
}

export function classifyOpenRoadLogWithAdapters(
  logText: string,
  adapters: readonly EdaFlowAdapter[] = DEFAULT_EDA_FLOW_ADAPTERS,
): OpenRoadLogFinding[] {
  return classifyLogWithAdapter("openroad", logText, adapters) as OpenRoadLogFinding[];
}
