export type Severity = "info" | "warning" | "error";

export interface SourceRef {
  path: string;
  line?: number;
  evidence: string;
}

export interface TracedValue<T> {
  value: T;
  confidence: number;
  sources: SourceRef[];
}

export interface ValidationIssue {
  code: string;
  severity: Severity;
  message: string;
  sources: SourceRef[];
}

export interface MacroNameParts {
  name: string;
  words: number;
  width: number;
  mux: number;
  writeSize: number;
}

export interface LibertyViews {
  tt?: string;
  ff?: string;
  ss?: string;
}

export interface MacroViews {
  verilog?: string;
  lef?: string;
  spice?: string;
  gds?: string;
  liberty: LibertyViews;
}

export interface DiscoveredMacro {
  name: string;
  dir: string;
  views: MacroViews;
}

export type ClockSamplingEdge = "posedge";

export interface WmaskLaneSemantics {
  laneIndex: number;
  msb: number;
  lsb: number;
  /** True when behavioral `wmask[k]` block slices match generic (k*writeSize)+:(writeSize) mapping. */
  verilogSliceAgrees: TracedValue<boolean>;
}

/** Pin-level protocol derived from SRAM22 behavioral Verilog + structural parameters (macro name / localparam). */
export interface SramInterfaceProtocol {
  clock: {
    portName: TracedValue<string>;
    samplingEdge: TracedValue<ClockSamplingEdge>;
  };
  resetBar: {
    portName: TracedValue<string>;
    polarity: TracedValue<"active_low">;
    /**
     * False with confidence 1.0 when the behavioral model has no reset branch that clears `mem` or `dout`;
     * reset only participates as `activeCycleExpression` gating (`ce && rstb`).
     */
    resetsMemoryInModel: TracedValue<boolean>;
    /** Comment on `input rstb` when present, plus behavioral interpretation (synchronous protocol text). */
    documentationNote: TracedValue<string>;
  };
  chipEnable: {
    portName: TracedValue<string>;
    polarity: TracedValue<"active_high">;
  };
  writeEnable: {
    portName: TracedValue<string>;
    polarity: TracedValue<"active_high">;
  };
  gating: {
    /** Expression under which read/write behaviors run in the behavioral `always` block. */
    activeCycleExpression: TracedValue<string>;
  };
  readWrite: {
    writeCondition: TracedValue<string>;
    readCondition: TracedValue<string>;
  };
  wmask: {
    portName: TracedValue<string>;
    polarity: TracedValue<"active_high">;
    /** Bits per mask lane = write granularity (e.g. macro name `w8` → 8). */
    laneBitWidth: TracedValue<number>;
    lanes: WmaskLaneSemantics[];
  };
}

export interface StructuredSramSpec {
  schemaVersion: "0.1.0";
  macro: {
    name: string;
    source: "sram22";
    family: "1rw";
    process: "sky130";
  };
  parameters: {
    words: TracedValue<number>;
    width: TracedValue<number>;
    mux: TracedValue<number>;
    writeSize: TracedValue<number>;
    addrWidth: TracedValue<number>;
    wmaskWidth: TracedValue<number>;
    rows: TracedValue<number>;
    cols: TracedValue<number>;
  };
  views: MacroViews;
  physical: {
    widthMicrons: TracedValue<number>;
    heightMicrons: TracedValue<number>;
    areaMicrons2: TracedValue<number>;
  };
  timing: {
    clockPeriodNs: TracedValue<number>;
  };
  ports: {
    clock: TracedValue<string[]>;
    reset: TracedValue<string[]>;
    chipEnable: TracedValue<string[]>;
    writeEnable: TracedValue<string[]>;
    address: TracedValue<string[]>;
    input: TracedValue<string[]>;
    output: TracedValue<string[]>;
    writeMask: TracedValue<string[]>;
    power: TracedValue<string[]>;
    ground: TracedValue<string[]>;
  };
  /** Protocol semantics for SVA / TB generation; sourced from behavioral Verilog + parameters. */
  interfaceProtocol: SramInterfaceProtocol;
  validationIssues: ValidationIssue[];
}

/** Minimal adapter surface for `emitMacroArtifacts` / `emitWorkflowArtifacts` (avoids importing full EDA adapter types into spec). */
export interface EmitWorkflowEdaAdapter {
  id: string;
  emit(spec: StructuredSramSpec): Array<{ fileName: string; contents: string }>;
}

export interface EmitWorkflowOptions {
  spec: StructuredSramSpec;
  outputRoot: string;
  runId: string;
  /** Used to resolve macro view paths and reference docs in flow-quality checks. */
  repoRoot?: string;
  /** When set, only these EDA adapters emit into the macro directory (order preserved). */
  edaAdapters?: readonly EmitWorkflowEdaAdapter[];
}

export interface EmittedArtifacts {
  runDir: string;
  macroDir: string;
  specYaml: string;
  specJson: string;
  hammerCacheJson: string;
  wrapperVerilog: string;
  protocolAssumptionsSv: string;
  memorySemanticsCheckerSv: string;
  verificationPropertiesJson?: string;
  protocolAssertionsSv?: string;
  protocolCoversSv?: string;
  memoryScoreboardSv?: string;
  verificationBindSv?: string;
  flowSmokeReportJson: string;
  openRoadSmokeTcl: string;
  openRoadSmokeRunnerSh: string;
  openRoadSmokeLogReportJson: string;
  openLaneConfigJson: string;
  openLaneSdc: string;
  openRoadReadme: string;
  runReportJson: string;
  /** Adapter ids that actually emitted files for this run (subset allowed). */
  emittedAdapterIds: readonly string[];
  humanIntentJson?: string;
  humanIntentSourceJson?: string;
  /** Written by full `emitWorkflowArtifacts` (single-macro path). */
  iterationReport?: string;
}
