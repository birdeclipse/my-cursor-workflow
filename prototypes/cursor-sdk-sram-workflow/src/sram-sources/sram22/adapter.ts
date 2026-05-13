import path from "node:path";

import type { SramSourceAdapter } from "../../domains/sram/sourceAdapter.js";
import { reviewSpecTraceability } from "../../review/checks.js";
import { discoverSram22Macros } from "../../extract/discover.js";
import { extractStructuredSpec } from "../../extract/sram22.js";

export const sram22SourceAdapter: SramSourceAdapter = {
  id: "sram22",
  discover(root) {
    return discoverSram22Macros(root);
  },
  extract(inventory, context) {
    return extractStructuredSpec({
      macroName: inventory.name,
      macrosRoot: path.dirname(inventory.dir),
      repoRoot: context.repoRoot,
    });
  },
  validate(spec) {
    return [...spec.validationIssues, ...reviewSpecTraceability(spec)];
  },
};
