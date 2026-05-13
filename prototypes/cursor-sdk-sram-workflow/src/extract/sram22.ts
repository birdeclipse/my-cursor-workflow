import { combineSources, source, trace } from "../spec/provenance.js";
import type { MacroNameParts, SourceRef, StructuredSramSpec, ValidationIssue } from "../spec/types.js";
import { validateStructuredSpec } from "../spec/validateSpec.js";
import { getDiscoveredMacro } from "./discover.js";
import { buildInterfaceProtocol } from "./interfaceProtocol.js";
import { parseLefFacts, parseLibertyFacts, parseVerilogFacts } from "./viewParsers.js";
import { parseSram22MacroName } from "../sram-sources/sram22/name.js";

export interface ExtractStructuredSpecOptions {
  macroName: string;
  macrosRoot: string;
  repoRoot: string;
}

export function parseMacroName(name: string): MacroNameParts {
  return parseSram22MacroName(name);
}

function requireView(pathValue: string | undefined, viewName: string, macroName: string): string {
  if (pathValue === undefined) {
    throw new Error(`Missing required ${viewName} view for ${macroName}`);
  }
  return pathValue;
}

function uniquePresent(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => v !== undefined))];
}

function dedupeSources(sources: SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  return sources.filter((src) => {
    const key = `${src.path}:${src.line ?? ""}:${src.evidence}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function extractStructuredSpec(
  options: ExtractStructuredSpecOptions,
): Promise<StructuredSramSpec> {
  const nameParts = parseMacroName(options.macroName);
  const discovered = await getDiscoveredMacro(options.macrosRoot, options.macroName);
  const verilogPath = requireView(discovered.views.verilog, "Verilog", discovered.name);
  const lefPath = requireView(discovered.views.lef, "LEF", discovered.name);
  const libertyPath = requireView(discovered.views.liberty.tt, "typical Liberty", discovered.name);

  const [verilog, lef, liberty] = await Promise.all([
    parseVerilogFacts(verilogPath),
    parseLefFacts(lefPath),
    parseLibertyFacts(libertyPath),
  ]);
  const additionalLibertyFacts = await Promise.all(
    uniquePresent([discovered.views.liberty.ff, discovered.views.liberty.ss]).map((p) => parseLibertyFacts(p)),
  );
  const clockPeriods = [liberty.minimumClockPeriodNs, ...additionalLibertyFacts.map((facts) => facts.minimumClockPeriodNs)];
  const maxClockPeriod = Math.max(...clockPeriods.map((period) => period.value));
  const maxClockPeriodSources = clockPeriods
    .filter((period) => period.value === maxClockPeriod)
    .flatMap((period) => period.sources);
  const clockPeriodNs = {
    value: maxClockPeriod,
    confidence: 1,
    sources: dedupeSources([...maxClockPeriodSources, ...clockPeriods.flatMap((period) => period.sources)]),
  };

  const macroNameSource = source(discovered.dir, discovered.name);
  const words = trace(nameParts.words, macroNameSource);
  const width = trace(nameParts.width, macroNameSource);
  const mux = trace(nameParts.mux, macroNameSource);
  const writeSize = trace(nameParts.writeSize, macroNameSource);
  const rows = trace(nameParts.words / nameParts.mux, macroNameSource);
  const cols = trace(nameParts.width * nameParts.mux, macroNameSource);
  const areaMicrons2 = trace(
    Number((lef.widthMicrons.value * lef.heightMicrons.value).toFixed(6)),
    {
      path: lefPath,
      evidence: `SIZE ${lef.widthMicrons.value} BY ${lef.heightMicrons.value}`,
      line: lef.widthMicrons.sources[0]?.line,
    },
  );

  const validationIssues: ValidationIssue[] = [
    ...(discovered.views.gds === undefined
      ? [
          {
            code: "missing_gds",
            severity: "warning" as const,
            message:
              "No .gds or .gds.gz file is present in the local macro directory; layout signoff setup is not complete.",
            sources: [source(discovered.dir, "directory scanned for .gds and .gds.gz")],
          },
        ]
      : []),
    ...(nameParts.width !== verilog.dataWidth.value || nameParts.width !== liberty.dataWidth.value
      ? [
          {
            code: "width_mismatch",
            severity: "error" as const,
            message: "Macro-name width does not agree with Verilog/Liberty data width.",
            sources: combineSources(width, verilog.dataWidth, liberty.dataWidth),
          },
        ]
      : []),
    ...(verilog.addrWidth.value !== liberty.addressWidth.value
      ? [
          {
            code: "addr_width_mismatch",
            severity: "error" as const,
            message: "Verilog ADDR_WIDTH does not agree with Liberty address bus width.",
            sources: combineSources(verilog.addrWidth, liberty.addressWidth),
          },
        ]
      : []),
  ];

  const interfaceProtocol = buildInterfaceProtocol({
    verilogPath,
    nameParts,
    parameters: {
      width,
      writeSize,
      wmaskWidth: verilog.wmaskWidth,
    },
    ports: verilog.ports,
    protocolEvidence: verilog.protocolEvidence,
  });

  const spec: StructuredSramSpec = {
    schemaVersion: "0.1.0",
    macro: {
      name: discovered.name,
      source: "sram22",
      family: "1rw",
      process: "sky130",
    },
    parameters: {
      words,
      width,
      mux,
      writeSize,
      addrWidth: verilog.addrWidth,
      wmaskWidth: verilog.wmaskWidth,
      rows,
      cols,
    },
    views: discovered.views,
    physical: {
      widthMicrons: lef.widthMicrons,
      heightMicrons: lef.heightMicrons,
      areaMicrons2,
    },
    timing: {
      clockPeriodNs,
    },
    ports: verilog.ports,
    interfaceProtocol,
    validationIssues,
  };

  return validateStructuredSpec(spec);
}
