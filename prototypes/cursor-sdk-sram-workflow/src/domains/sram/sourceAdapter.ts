import type { CanonicalSramSpec, SramSourceInventory, SramValidationIssue } from "./types.js";

export interface SramExtractContext {
  repoRoot: string;
}

export interface SramSourceAdapter {
  id: string;
  discover(root: string): Promise<SramSourceInventory[]>;
  extract(inventory: SramSourceInventory, context: SramExtractContext): Promise<CanonicalSramSpec>;
  validate(spec: CanonicalSramSpec): SramValidationIssue[];
}
