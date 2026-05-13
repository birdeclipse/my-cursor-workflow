import { structuredSramSpecSchema } from "./schema.js";
import type { StructuredSramSpec } from "./types.js";

export function validateStructuredSpec(spec: StructuredSramSpec): StructuredSramSpec {
  const parsed = structuredSramSpecSchema.safeParse(spec);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Structured spec failed schema validation: ${detail}`);
  }
  return parsed.data as StructuredSramSpec;
}
