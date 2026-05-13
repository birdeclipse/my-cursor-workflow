import type { StructuredSramSpec, TracedValue, ValidationIssue } from "../spec/types.js";

function hasTrace(value: TracedValue<unknown>): boolean {
  return value.confidence < 1 || value.sources.length > 0;
}

export function reviewSpecTraceability(spec: StructuredSramSpec): ValidationIssue[] {
  const tracedValues: Array<[string, TracedValue<unknown>]> = [
    ["parameters.words", spec.parameters.words],
    ["parameters.width", spec.parameters.width],
    ["parameters.mux", spec.parameters.mux],
    ["parameters.writeSize", spec.parameters.writeSize],
    ["parameters.addrWidth", spec.parameters.addrWidth],
    ["parameters.wmaskWidth", spec.parameters.wmaskWidth],
    ["parameters.rows", spec.parameters.rows],
    ["parameters.cols", spec.parameters.cols],
    ["physical.widthMicrons", spec.physical.widthMicrons],
    ["physical.heightMicrons", spec.physical.heightMicrons],
    ["physical.areaMicrons2", spec.physical.areaMicrons2],
  ];

  return tracedValues.flatMap(([field, value]) =>
    hasTrace(value)
      ? []
      : [
          {
            code: "missing_provenance",
            severity: "error" as const,
            message: `${field} has confidence 1.0 but no source references.`,
            sources: [],
          },
        ],
  );
}

export function isSpecReviewClean(spec: StructuredSramSpec): boolean {
  const deterministicIssues = reviewSpecTraceability(spec);
  const blockingIssues = spec.validationIssues.filter((issue) => issue.severity === "error");
  return deterministicIssues.length === 0 && blockingIssues.length === 0;
}
