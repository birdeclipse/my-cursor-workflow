import type { SourceRef, TracedValue } from "./types.js";

export function trace<T>(value: T, source: SourceRef, confidence = 1): TracedValue<T> {
  return {
    value,
    confidence,
    sources: [source],
  };
}

export function source(path: string, evidence: string, line?: number): SourceRef {
  return {
    path,
    evidence,
    ...(line === undefined ? {} : { line }),
  };
}

export function combineSources(...values: Array<TracedValue<unknown>>): SourceRef[] {
  return values.flatMap((value) => value.sources);
}
