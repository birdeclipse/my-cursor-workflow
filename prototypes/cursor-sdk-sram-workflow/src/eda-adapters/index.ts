export { hammerAdapter } from "./hammer/adapter.js";
export { openLaneAdapter } from "./openlane/adapter.js";
export { openRoadAdapter } from "./openroad/adapter.js";
export { verificationAdapter } from "./verification/adapter.js";

import { hammerAdapter } from "./hammer/adapter.js";
import { openLaneAdapter } from "./openlane/adapter.js";
import { openRoadAdapter } from "./openroad/adapter.js";
import { verificationAdapter } from "./verification/adapter.js";
import type { EdaFlowAdapter } from "./flowAdapter.js";

export const DEFAULT_EDA_FLOW_ADAPTERS: readonly EdaFlowAdapter[] = [
  hammerAdapter,
  openLaneAdapter,
  verificationAdapter,
  openRoadAdapter,
];

export function adaptersById(
  adapters: readonly EdaFlowAdapter[] = DEFAULT_EDA_FLOW_ADAPTERS,
): Map<string, EdaFlowAdapter> {
  return new Map(adapters.map((adapter) => [adapter.id, adapter]));
}

export function adaptersMatchingIds(
  ids: readonly string[],
  registry: readonly EdaFlowAdapter[] = DEFAULT_EDA_FLOW_ADAPTERS,
): EdaFlowAdapter[] {
  const byId = adaptersById(registry);
  return ids.map((id) => {
    const adapter = byId.get(id);
    if (adapter === undefined) {
      throw new Error(`Unknown EDA adapter '${id}'.`);
    }
    return adapter;
  });
}

export function selectEdaFlowAdapters(ids: readonly string[]): EdaFlowAdapter[] {
  return adaptersMatchingIds(ids);
}
