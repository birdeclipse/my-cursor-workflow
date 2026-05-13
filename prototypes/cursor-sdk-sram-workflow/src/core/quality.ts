import type { Severity } from "../spec/types.js";

export interface QualityFinding {
  severity: Severity;
  code: string;
  message: string;
  file?: string;
  field?: string;
}

export interface QualityCounts {
  errors: number;
  warnings: number;
  info: number;
}

export interface QualityRule<TContext = unknown> {
  id: string;
  description: string;
  check(context: TContext): QualityFinding[] | Promise<QualityFinding[]>;
}

export function countFindingsBySeverity(findings: readonly QualityFinding[]): QualityCounts {
  return findings.reduce<QualityCounts>(
    (acc, finding) => {
      if (finding.severity === "error") return { ...acc, errors: acc.errors + 1 };
      if (finding.severity === "warning") return { ...acc, warnings: acc.warnings + 1 };
      return { ...acc, info: acc.info + 1 };
    },
    { errors: 0, warnings: 0, info: 0 },
  );
}
