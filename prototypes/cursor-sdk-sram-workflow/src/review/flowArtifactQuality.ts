import { readFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** OpenLane-required keys per `data/eda_flow_refs/OpenLane/docs/source/reference/configuration.md` (required variables). */
export const OPENLANE_REQUIRED_KEYS = [
  "DESIGN_NAME",
  "VERILOG_FILES",
  "CLOCK_PERIOD",
  "CLOCK_NET",
  "CLOCK_PORT",
] as const;

export type FlowQualitySeverity = "info" | "warning" | "error";

export interface FlowQualityFinding {
  code: string;
  severity: FlowQualitySeverity;
  message: string;
  /** Relative file under macro output dir when applicable. */
  file?: string;
  /** Config/field key when applicable. */
  field?: string;
  /** Local documentation path under repo for rationale. */
  reference?: string;
}

export interface OpenRoadProbeResult {
  available: boolean;
  detail: string;
}

export interface FlowArtifactAnalysis {
  openRoad: OpenRoadProbeResult;
  findings: FlowQualityFinding[];
}

const OPENLANE_CONFIGURATION_DOC =
  "data/eda_flow_refs/OpenLane/docs/source/reference/configuration.md";
const OPENLANE_MACRO_DOC = "data/eda_flow_refs/OpenLane/docs/source/usage/hardening_macros.md";

function finding(
  f: Omit<FlowQualityFinding, "severity"> & { severity?: FlowQualitySeverity },
): FlowQualityFinding {
  return { severity: "warning", ...f };
}

export async function probeOpenRoadBinary(): Promise<OpenRoadProbeResult> {
  try {
    const { stdout, stderr } = await execFileAsync("openroad", ["-version"], {
      timeout: 8_000,
      maxBuffer: 2_000_000,
    });
    const combined = `${stdout}${stderr}`.trim();
    return { available: true, detail: combined.slice(0, 800) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { available: false, detail: message };
  }
}

/** Keys emitted by this prototype that are not OpenLane built-ins (informational). */
const PROTOTYPE_EXTENSION_KEYS = new Set([
  "CLOCK_PERIOD_CONFIDENCE",
  "CLOCK_PERIOD_SOURCE",
  "READINESS_STATUS",
]);

export function analyzeOpenLaneConfigContent(jsonText: string): FlowQualityFinding[] {
  const out: FlowQualityFinding[] = [];
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    return [
      finding({
        code: "openlane_config_json_parse_error",
        severity: "error",
        message: "openlane.config.json is not valid JSON.",
        file: "openlane.config.json",
      }),
    ];
  }

  for (const key of OPENLANE_REQUIRED_KEYS) {
    if (!(key in parsed) || parsed[key] === "" || parsed[key] === undefined) {
      out.push(
        finding({
          code: "openlane_missing_required_or_empty",
          severity: "error",
          message: `OpenLane required variable '${key}' is missing or empty (see ${OPENLANE_CONFIGURATION_DOC}).`,
          file: "openlane.config.json",
          field: key,
          reference: OPENLANE_CONFIGURATION_DOC,
        }),
      );
    }
  }

  for (const key of PROTOTYPE_EXTENSION_KEYS) {
    if (key in parsed) {
      out.push(
        finding({
          code: "prototype_extension_key",
          severity: "info",
          message: `Non-standard OpenLane key '${key}' documents prototype metadata; flows may ignore it.`,
          file: "openlane.config.json",
          field: key,
        }),
      );
    }
  }

  const conf = parsed.CLOCK_PERIOD_CONFIDENCE;
  if (typeof conf === "number" && conf < 1) {
    out.push(
      finding({
        code: "low_confidence_clock_period",
        severity: "warning",
        message: `CLOCK_PERIOD has confidence ${String(conf)}; replace with traced timing before signoff.`,
        file: "openlane.config.json",
        field: "CLOCK_PERIOD",
      }),
    );
  }

  const src = parsed.CLOCK_PERIOD_SOURCE;
  if (src === "prototype_default_not_from_sram22_views") {
    out.push(
      finding({
        code: "clock_period_not_from_views",
        severity: "warning",
        message: "Clock period is explicitly marked as not extracted from SRAM22 views.",
        file: "openlane.config.json",
        field: "CLOCK_PERIOD_SOURCE",
      }),
    );
  }

  const readiness = parsed.READINESS_STATUS;
  const gds = parsed.EXTRA_GDS_FILES;
  if (readiness === "ready" && (gds === undefined || gds === "")) {
    out.push(
      finding({
        code: "readiness_ready_without_gds",
        severity: "warning",
        message: "READINESS_STATUS is 'ready' but EXTRA_GDS_FILES is absent; verify GDS integration.",
        file: "openlane.config.json",
        field: "EXTRA_GDS_FILES",
        reference: OPENLANE_MACRO_DOC,
      }),
    );
  }

  return out;
}

export async function analyzeOpenLaneConfigAsync(
  jsonText: string,
  repoRoot: string | undefined,
  configDir?: string,
): Promise<FlowQualityFinding[]> {
  const contentFindings = analyzeOpenLaneConfigContent(jsonText);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    return contentFindings;
  }

  const pathFindings: FlowQualityFinding[] = [];
  if (repoRoot !== undefined || configDir !== undefined) {
    for (const field of ["EXTRA_LEFS", "EXTRA_LIBS", "EXTRA_GDS_FILES", "VERILOG_FILES", "VERILOG_FILES_BLACKBOX"] as const) {
      const val = parsed[field];
      if (typeof val !== "string" || val.trim() === "") continue;
      const candidates = path.isAbsolute(val)
        ? [val]
        : [
            ...(configDir === undefined ? [] : [path.join(configDir, val)]),
            ...(repoRoot === undefined ? [] : [path.join(repoRoot, val)]),
          ];
      let readable = false;
      try {
        await Promise.any(candidates.map((candidate) => readFile(candidate, { flag: "r" })));
        readable = true;
      } catch {
        readable = false;
      }
      if (!readable) {
        pathFindings.push(
          finding({
            code: "referenced_view_path_unreadable",
            severity: "error",
            message: `Cannot read ${field} path '${val}' (tried: ${candidates.join(", ")}).`,
            file: "openlane.config.json",
            field,
          }),
        );
      }
    }
  }

  return [...contentFindings, ...pathFindings];
}

const CREATE_CLOCK_RE = /create_clock\s+-name\s+(\S+)\s+-period\s+(\S+)\s+\[get_ports\s+([^\]]+)\]/;

export function analyzeSdc(sdcText: string, expectedClockPort: string | undefined): FlowQualityFinding[] {
  const out: FlowQualityFinding[] = [];
  if (!sdcText.includes("create_clock")) {
    out.push(
      finding({
        code: "sdc_missing_create_clock",
        severity: "error",
        message: "base.sdc does not call create_clock.",
        file: "base.sdc",
      }),
    );
    return out;
  }

  const m = sdcText.match(CREATE_CLOCK_RE);
  if (m === null) {
    out.push(
      finding({
        code: "sdc_create_clock_unparsed",
        severity: "warning",
        message: "create_clock present but did not match expected pattern (name + period).",
        file: "base.sdc",
      }),
    );
  } else if (expectedClockPort !== undefined && m[3] !== expectedClockPort) {
    out.push(
      finding({
        code: "sdc_clock_name_mismatch",
        severity: "warning",
        message: `SDC clock target port '${m[3]}' differs from OpenLane CLOCK_PORT '${expectedClockPort}'.`,
        file: "base.sdc",
      }),
    );
  }

  if (/Confidence:\s*0\.25|prototype default/i.test(sdcText)) {
    out.push(
      finding({
        code: "sdc_low_confidence_clock",
        severity: "info",
        message: "SDC documents low-confidence / prototype default clock period.",
        file: "base.sdc",
      }),
    );
  }

  if (!sdcText.includes("set_input_delay") || !sdcText.includes("set_output_delay")) {
    out.push(
      finding({
        code: "sdc_missing_io_delays",
        severity: "info",
        message: "SDC may be incomplete: expected set_input_delay / set_output_delay for macro integration.",
        file: "base.sdc",
      }),
    );
  }

  return out;
}

export function analyzeOpenRoadReadme(mdText: string): FlowQualityFinding[] {
  const out: FlowQualityFinding[] = [];
  const headings = ["LEF", "Liberty", "Verilog", "GDS"];
  for (const h of headings) {
    if (!mdText.includes(h)) {
      out.push(
        finding({
          code: "openroad_readme_missing_inventory_heading",
          severity: "info",
          message: `openroad-setup.md does not mention '${h}' in expected inventory context.`,
          file: "openroad-setup.md",
        }),
      );
    }
  }
  if (mdText.includes("missing")) {
    out.push(
      finding({
        code: "openroad_readme_reports_missing_view",
        severity: "warning",
        message: "Readme lists one or more views as missing — verify before OpenROAD/Hammer runs.",
        file: "openroad-setup.md",
      }),
    );
  }
  return out;
}

export interface EmittedArtifactPaths {
  openLaneConfigJson: string;
  openLaneSdc: string;
  wrapperVerilog?: string;
  openRoadReadme: string;
  openRoadSmokeTcl?: string;
  openRoadSmokeRunnerSh?: string;
  /** Present for workflow runs that emit SVA checkers. */
  protocolAssumptionsSv?: string;
  memorySemanticsCheckerSv?: string;
  verificationPropertiesJson?: string;
  protocolAssertionsSv?: string;
  protocolCoversSv?: string;
  memoryScoreboardSv?: string;
  verificationBindSv?: string;
}

export function analyzeOpenRoadSmokeTcl(tclText: string, fileBaseName = "openroad-smoke.tcl"): FlowQualityFinding[] {
  const required: Array<[string, RegExp]> = [
    ["read_lef", /\bread_lef\s+\S+/],
    ["read_liberty", /\bread_liberty\s+\S+/],
    ["read_verilog", /\bread_verilog\s+\S+/],
    ["link_design", /\blink_design\s+\S+/],
    ["read_sdc", /\bread_sdc\s+\S+/],
  ];
  const out: FlowQualityFinding[] = [];
  for (const [cmd, re] of required) {
    if (!re.test(tclText)) {
      out.push(
        finding({
          code: `openroad_tcl_missing_${cmd}`,
          severity: "error",
          message: `OpenROAD smoke TCL is missing required '${cmd}' command.`,
          file: fileBaseName,
        }),
      );
    }
  }
  const readVerilogCount = tclText.match(/\bread_verilog\s+\S+/g)?.length ?? 0;
  if (readVerilogCount < 2) {
    out.push(
      finding({
        code: "openroad_tcl_missing_wrapper_and_macro_verilog",
        severity: "error",
        message: "OpenROAD smoke TCL should read both generated wrapper RTL and source macro Verilog.",
        file: fileBaseName,
      }),
    );
  }
  if (!/\breport_checks\b/.test(tclText)) {
    out.push(
      finding({
        code: "openroad_tcl_missing_report_checks",
        severity: "info",
        message: "OpenROAD smoke TCL does not request report_checks output.",
        file: fileBaseName,
      }),
    );
  }
  const linkDesignIndex = tclText.search(/\blink_design\s+\S+/);
  const readSdcIndex = tclText.search(/\bread_sdc\s+\S+/);
  if (linkDesignIndex >= 0 && readSdcIndex >= 0 && readSdcIndex < linkDesignIndex) {
    out.push(
      finding({
        code: "openroad_tcl_read_sdc_before_link_design",
        severity: "error",
        message: "OpenROAD smoke TCL should link the wrapper design before reading SDC constraints.",
        file: fileBaseName,
      }),
    );
  }
  return out;
}

function extractFirst(text: string, regex: RegExp): string | undefined {
  return regex.exec(text)?.[1];
}

function readVerilogTargets(tclText: string): string[] {
  return [...tclText.matchAll(/\bread_verilog\s+(\S+)/g)].map((match) => match[1]);
}

export function analyzeFlowArtifactConsistency(options: {
  openLaneConfigText: string;
  openRoadSmokeTclText?: string;
  wrapperVerilogText?: string;
}): FlowQualityFinding[] {
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(options.openLaneConfigText) as Record<string, unknown>;
  } catch {
    return [];
  }

  const out: FlowQualityFinding[] = [];
  const designName = typeof config.DESIGN_NAME === "string" ? config.DESIGN_NAME : undefined;
  const wrapperFile = typeof config.VERILOG_FILES === "string" ? config.VERILOG_FILES : undefined;
  const wrapperModule =
    options.wrapperVerilogText === undefined
      ? undefined
      : extractFirst(options.wrapperVerilogText, /\bmodule\s+([A-Za-z_][A-Za-z0-9_$]*)\b/);
  const linkDesign =
    options.openRoadSmokeTclText === undefined
      ? undefined
      : extractFirst(options.openRoadSmokeTclText, /\blink_design\s+(\S+)/);

  if (designName !== undefined && wrapperModule !== undefined && designName !== wrapperModule) {
    out.push(
      finding({
        code: "flow_wrapper_design_name_mismatch",
        severity: "error",
        message: `OpenLane DESIGN_NAME '${designName}' does not match wrapper module '${wrapperModule}'.`,
        file: "openlane.config.json",
        field: "DESIGN_NAME",
      }),
    );
  }

  if (designName !== undefined && linkDesign !== undefined && designName !== linkDesign) {
    out.push(
      finding({
        code: "flow_tcl_link_design_mismatch",
        severity: "error",
        message: `OpenROAD link_design target '${linkDesign}' does not match OpenLane DESIGN_NAME '${designName}'.`,
        file: "openroad-smoke.tcl",
      }),
    );
  }

  if (wrapperFile !== undefined && options.openRoadSmokeTclText !== undefined) {
    const wrapperBase = path.basename(wrapperFile);
    const readsWrapper = readVerilogTargets(options.openRoadSmokeTclText).some(
      (target) => target === wrapperFile || path.basename(target) === wrapperBase,
    );
    if (!readsWrapper) {
      out.push(
        finding({
          code: "flow_tcl_missing_openlane_wrapper_verilog",
          severity: "error",
          message: `OpenROAD smoke TCL should read the OpenLane wrapper Verilog '${wrapperFile}'.`,
          file: "openroad-smoke.tcl",
          field: "VERILOG_FILES",
        }),
      );
    }
  }

  return out;
}

async function analyzeOptionalOpenRoadSmokeTcl(absPath: string | undefined): Promise<FlowQualityFinding[]> {
  if (absPath === undefined) return [];
  const base = path.basename(absPath);
  try {
    const text = await readFile(absPath, "utf8");
    return analyzeOpenRoadSmokeTcl(text, base);
  } catch {
    return [
      finding({
        code: "openroad_tcl_file_missing",
        severity: "error",
        message: `Cannot read OpenROAD smoke TCL at ${absPath}`,
        file: base,
      }),
    ];
  }
}

async function analyzeOptionalFlowArtifactConsistency(
  configText: string,
  openRoadSmokeTclPath: string | undefined,
  wrapperVerilogPath: string | undefined,
): Promise<FlowQualityFinding[]> {
  try {
    const [openRoadSmokeTclText, wrapperVerilogText] = await Promise.all([
      openRoadSmokeTclPath === undefined ? Promise.resolve(undefined) : readFile(openRoadSmokeTclPath, "utf8"),
      wrapperVerilogPath === undefined ? Promise.resolve(undefined) : readFile(wrapperVerilogPath, "utf8"),
    ]);
    return analyzeFlowArtifactConsistency({
      openLaneConfigText: configText,
      openRoadSmokeTclText,
      wrapperVerilogText,
    });
  } catch {
    // Missing files are reported by their dedicated analyzers; avoid duplicate findings here.
    return [];
  }
}

export function analyzeOpenRoadSmokeRunnerSh(
  shellText: string,
  fileBaseName = "run-openroad-smoke.sh",
): FlowQualityFinding[] {
  const out: FlowQualityFinding[] = [];
  const checks: Array<[string, RegExp, string]> = [
    ["openroad_runner_missing_tool_check", /command\s+-v\s+openroad/, "Runner should check that openroad exists on PATH."],
    ["openroad_runner_missing_macro_dir_cd", /cd\s+"\$SCRIPT_DIR"/, "Runner should cd to the macro output directory before using relative TCL/SDC paths."],
    ["openroad_runner_missing_exit_mode", /openroad\s+-exit\s+openroad-smoke\.tcl/, "Runner should execute openroad-smoke.tcl with -exit."],
    ["openroad_runner_missing_log_capture", /\|\s*tee\s+openroad-smoke\.log/, "Runner should capture OpenROAD output to openroad-smoke.log."],
  ];
  for (const [code, re, message] of checks) {
    if (!re.test(shellText)) {
      out.push(finding({ code, severity: "error", message, file: fileBaseName }));
    }
  }
  return out;
}

async function analyzeOptionalOpenRoadSmokeRunner(absPath: string | undefined): Promise<FlowQualityFinding[]> {
  if (absPath === undefined) return [];
  const base = path.basename(absPath);
  try {
    const text = await readFile(absPath, "utf8");
    return analyzeOpenRoadSmokeRunnerSh(text, base);
  } catch {
    return [
      finding({
        code: "openroad_runner_file_missing",
        severity: "error",
        message: `Cannot read OpenROAD smoke runner at ${absPath}`,
        file: base,
      }),
    ];
  }
}

export function analyzeSvaContent(
  svaText: string,
  fileBaseName: string,
  kind: "protocol" | "semantics",
): FlowQualityFinding[] {
  const out: FlowQualityFinding[] = [];
  if (!/\bmodule\s+\S+/.test(svaText)) {
    out.push(
      finding({
        code: "sva_missing_module",
        severity: "error",
        message: "SVA file does not declare a module.",
        file: fileBaseName,
      }),
    );
  }
  if (!/\bendmodule\b/.test(svaText)) {
    out.push(
      finding({
        code: "sva_missing_endmodule",
        severity: "error",
        message: "SVA file is missing endmodule.",
        file: fileBaseName,
      }),
    );
  }
  const hasProp =
    /\bproperty\b/.test(svaText) &&
    (/\bassert\s+property\b/.test(svaText) ||
      /\bassume\s+property\b/.test(svaText) ||
      /\bcover\s+property\b/.test(svaText));
  const semanticsScaffold = kind === "semantics" && /TODO\(confidence/i.test(svaText);
  if (!hasProp && !semanticsScaffold) {
    out.push(
      finding({
        code: "sva_missing_property_primitives",
        severity: "warning",
        message: "SVA file should include property plus assume/assert property for checker usefulness.",
        file: fileBaseName,
      }),
    );
  }
  if (kind === "semantics" && /TODO\(confidence/i.test(svaText)) {
    out.push(
      finding({
        code: "sva_semantics_scaffold_todo",
        severity: "info",
        message: "Memory semantics file is explicitly marked TODO / sub-unit confidence — expect placeholder logic.",
        file: fileBaseName,
      }),
    );
  }
  if (kind === "protocol" && !/\binput\s+wire\s+logic\b/.test(svaText) && !/\binput\s+logic\b/.test(svaText)) {
    out.push(
      finding({
        code: "sva_protocol_missing_port_list",
        severity: "warning",
        message: "Protocol SVA module should expose DUT-matching input ports for bind usage.",
        file: fileBaseName,
      }),
    );
  }
  return out;
}

export function analyzePropertyMetadataContent(
  propertiesJsonText: string,
  splitSvaTexts: Record<string, string>,
): FlowQualityFinding[] {
  let parsed: { schemaVersion?: unknown; properties?: unknown };
  try {
    parsed = JSON.parse(propertiesJsonText) as { schemaVersion?: unknown; properties?: unknown };
  } catch {
    return [
      finding({
        code: "property_metadata_json_parse_error",
        severity: "error",
        message: "properties.json is not valid JSON.",
        file: "properties.json",
      }),
    ];
  }
  const out: FlowQualityFinding[] = [];
  if (parsed.schemaVersion !== "0.1.0") {
    out.push(
      finding({
        code: "property_metadata_schema_version",
        severity: "error",
        message: "properties.json must declare schemaVersion 0.1.0.",
        file: "properties.json",
      }),
    );
  }
  if (!Array.isArray(parsed.properties)) {
    out.push(
      finding({
        code: "property_metadata_missing_properties",
        severity: "error",
        message: "properties.json must include a properties array.",
        file: "properties.json",
      }),
    );
    return out;
  }
  const allSva = Object.values(splitSvaTexts).join("\n");
  for (const property of parsed.properties as Array<Record<string, unknown>>) {
    const id = typeof property.id === "string" ? property.id : undefined;
    if (id === undefined) {
      out.push(
        finding({
          code: "property_metadata_missing_id",
          severity: "error",
          message: "A property metadata entry is missing its id.",
          file: "properties.json",
        }),
      );
      continue;
    }
    if (!allSva.includes(id)) {
      out.push(
        finding({
          code: "property_metadata_id_missing_from_sva",
          severity: "error",
          message: `Property '${id}' is present in metadata but not in any split SVA file.`,
          file: "properties.json",
          field: id,
        }),
      );
    }
  }
  return out;
}

async function analyzeOptionalSvaFile(
  absPath: string | undefined,
  kind: "protocol" | "semantics",
): Promise<FlowQualityFinding[]> {
  if (absPath === undefined) return [];
  const base = path.basename(absPath);
  try {
    const text = await readFile(absPath, "utf8");
    return analyzeSvaContent(text, base, kind);
  } catch {
    return [
      finding({
        code: kind === "protocol" ? "sva_protocol_file_missing" : "sva_semantics_file_missing",
        severity: "error",
        message: `Cannot read SVA file at ${absPath}`,
        file: base,
      }),
    ];
  }
}

async function analyzeOptionalPropertyMetadata(paths: EmittedArtifactPaths): Promise<FlowQualityFinding[]> {
  if (paths.verificationPropertiesJson === undefined) return [];
  const splitPaths = [
    paths.protocolAssumptionsSv,
    paths.protocolAssertionsSv,
    paths.protocolCoversSv,
    paths.memoryScoreboardSv,
  ].filter((item): item is string => item !== undefined);
  try {
    const [propertiesJsonText, splitTexts] = await Promise.all([
      readFile(paths.verificationPropertiesJson, "utf8"),
      Promise.all(
        splitPaths.map(async (splitPath) => [path.basename(splitPath), await readFile(splitPath, "utf8")] as const),
      ),
    ]);
    return analyzePropertyMetadataContent(propertiesJsonText, Object.fromEntries(splitTexts));
  } catch {
    return [
      finding({
        code: "property_metadata_file_missing",
        severity: "error",
        message: `Cannot read properties metadata or split SVA files near ${paths.verificationPropertiesJson}`,
        file: "properties.json",
      }),
    ];
  }
}

const DEFAULT_EMITTED_ADAPTER_IDS: readonly string[] = ["hammer", "openlane", "verification", "openroad"];

export async function analyzeEmittedFlowArtifacts(
  paths: EmittedArtifactPaths,
  repoRoot: string | undefined,
  clockPortForSdc: string | undefined,
  options?: { openRoadProbe?: OpenRoadProbeResult; emittedAdapterIds?: readonly string[] },
): Promise<FlowArtifactAnalysis> {
  const enabled = new Set(options?.emittedAdapterIds ?? DEFAULT_EMITTED_ADAPTER_IDS);
  const checkOpenLane = enabled.has("openlane");
  const checkOpenRoad = enabled.has("openroad");
  const checkVerification = enabled.has("verification");

  const openRoad = checkOpenRoad
    ? (options?.openRoadProbe ?? (await probeOpenRoadBinary()))
    : { available: false, detail: "OpenROAD adapter not included in this emit." };

  const cfgFindings: FlowQualityFinding[] = [];
  const sdcFindings: FlowQualityFinding[] = [];
  let cfgRawForConsistency: string | undefined;
  if (checkOpenLane) {
    try {
      const [cfgRaw, sdcRaw] = await Promise.all([
        readFile(paths.openLaneConfigJson, "utf8"),
        readFile(paths.openLaneSdc, "utf8"),
      ]);
      cfgRawForConsistency = cfgRaw;
      cfgFindings.push(
        ...(await analyzeOpenLaneConfigAsync(cfgRaw, repoRoot, path.dirname(paths.openLaneConfigJson))),
      );
      sdcFindings.push(...analyzeSdc(sdcRaw, clockPortForSdc));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      cfgFindings.push(
        finding({
          code: "openlane_artifact_read_failed",
          severity: "error",
          message: `Cannot read OpenLane artifacts: ${message}`,
          file: "openlane.config.json",
        }),
      );
    }
  }

  let mdFindings: FlowQualityFinding[] = [];
  let openRoadTclFindings: FlowQualityFinding[] = [];
  let openRoadRunnerFindings: FlowQualityFinding[] = [];
  if (checkOpenRoad) {
    try {
      const mdRaw = await readFile(paths.openRoadReadme, "utf8");
      mdFindings = analyzeOpenRoadReadme(mdRaw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      mdFindings = [
        finding({
          code: "openroad_readme_read_failed",
          severity: "error",
          message: `Cannot read OpenROAD readme: ${message}`,
          file: "openroad-setup.md",
        }),
      ];
    }
    openRoadTclFindings = await analyzeOptionalOpenRoadSmokeTcl(paths.openRoadSmokeTcl);
    openRoadRunnerFindings = await analyzeOptionalOpenRoadSmokeRunner(paths.openRoadSmokeRunnerSh);
  }

  let consistencyFindings: FlowQualityFinding[] = [];
  if (checkOpenLane && checkOpenRoad && cfgRawForConsistency !== undefined) {
    consistencyFindings = await analyzeOptionalFlowArtifactConsistency(
      cfgRawForConsistency,
      paths.openRoadSmokeTcl,
      paths.wrapperVerilog,
    );
  }

  let svaFindings: FlowQualityFinding[] = [];
  if (checkVerification) {
    svaFindings = [
      ...(await analyzeOptionalSvaFile(paths.protocolAssumptionsSv, "protocol")),
      ...(await analyzeOptionalSvaFile(paths.memorySemanticsCheckerSv, "semantics")),
      ...(await analyzeOptionalSvaFile(paths.protocolAssertionsSv, "protocol")),
      ...(await analyzeOptionalSvaFile(paths.protocolCoversSv, "protocol")),
      ...(await analyzeOptionalSvaFile(paths.memoryScoreboardSv, "semantics")),
      ...(await analyzeOptionalPropertyMetadata(paths)),
    ];
  }

  const findings = [
    ...cfgFindings,
    ...sdcFindings,
    ...mdFindings,
    ...openRoadTclFindings,
    ...openRoadRunnerFindings,
    ...consistencyFindings,
    ...svaFindings,
  ].sort((a, b) => {
    const rank = (s: FlowQualitySeverity) => (s === "error" ? 0 : s === "warning" ? 1 : 2);
    return rank(a.severity) - rank(b.severity);
  });

  return { openRoad, findings };
}
