export { sram22SourceAdapter } from "./sram22/index.js";

import type { SramSourceAdapter } from "../domains/sram/sourceAdapter.js";
import { sram22SourceAdapter } from "./sram22/index.js";

export const DEFAULT_SRAM_SOURCE_ADAPTER: SramSourceAdapter = sram22SourceAdapter;
export const SRAM_SOURCE_ADAPTERS: readonly SramSourceAdapter[] = [sram22SourceAdapter];
