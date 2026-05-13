import type { StructuredSramSpec } from "../spec/types.js";
import { emitVerificationCollateralBundle } from "../verification-collateral/emit.js";
import { buildDefaultPropertyProposals, normalizePropertyCatalog } from "../verification-collateral/normalize.js";

/** One file produced for a macro directory by an EDA flow target. */
export interface EdaTargetArtifact {
  /** File name only; joined with macro output directory. */
  fileName: string;
  contents: string;
}

/** Pluggable EDA flow emitter (Hammer, OpenLane, OpenROAD, future tools). */
export interface EdaTarget {
  readonly id: string;
  readonly description: string;
  emit(spec: StructuredSramSpec): EdaTargetArtifact[];
}

interface HammerPort {
  "address port name": string;
  "address port polarity": "active high";
  "clock port name": string;
  "clock port polarity": "active high";
  "write enable port name": string;
  "write enable port polarity": "active high";
  "output port name": string;
  "output port polarity": "active high";
  "input port name": string;
  "input port polarity": "active high";
  "mask port name": string;
  "mask granularity": number;
  "mask port polarity": "active high";
}

interface HammerSramCacheEntry {
  type: "sram";
  name: string;
  source: "sram22";
  depth: string;
  width: number;
  family: "1rw";
  mask: "true";
  vt: "svt";
  mux: number;
  ports: HammerPort[];
}

export function buildHammerCacheEntry(spec: StructuredSramSpec): HammerSramCacheEntry {
  return {
    type: "sram",
    name: spec.macro.name,
    source: "sram22",
    depth: String(spec.parameters.words.value),
    width: spec.parameters.width.value,
    family: "1rw",
    mask: "true",
    vt: "svt",
    mux: spec.parameters.mux.value,
    ports: [
      {
        "address port name": spec.ports.address.value[0] ?? "addr",
        "address port polarity": "active high",
        "clock port name": spec.ports.clock.value[0] ?? "clk",
        "clock port polarity": "active high",
        "write enable port name": spec.ports.writeEnable.value[0] ?? "we",
        "write enable port polarity": "active high",
        "output port name": spec.ports.output.value[0] ?? "dout",
        "output port polarity": "active high",
        "input port name": spec.ports.input.value[0] ?? "din",
        "input port polarity": "active high",
        "mask port name": spec.ports.writeMask.value[0] ?? "wmask",
        "mask granularity": spec.parameters.writeSize.value,
        "mask port polarity": "active high",
      },
    ],
  };
}

export function buildOpenLaneConfig(spec: StructuredSramSpec): Record<string, string | number | boolean> {
  const clock = spec.ports.clock.value[0] ?? "clk";
  const clockSource = spec.timing.clockPeriodNs.sources[0];
  const config: Record<string, string | number | boolean> = {
    DESIGN_NAME: `${spec.macro.name}_wrapper`,
    VERILOG_FILES: `${spec.macro.name}_wrapper.v`,
    VERILOG_FILES_BLACKBOX: spec.views.verilog ?? "",
    CLOCK_NET: clock,
    CLOCK_PORT: clock,
    CLOCK_PERIOD: spec.timing.clockPeriodNs.value,
    CLOCK_PERIOD_CONFIDENCE: spec.timing.clockPeriodNs.confidence,
    CLOCK_PERIOD_SOURCE: clockSource === undefined ? "unknown" : `${clockSource.path}:${clockSource.line ?? "?"}`,
    USE_POWER_PINS: true,
    EXTRA_LEFS: spec.views.lef ?? "",
    EXTRA_LIBS: spec.views.liberty.tt ?? "",
    BASE_SDC_FILE: "base.sdc",
    FP_PDN_MACRO_HOOKS: `u_${spec.macro.name} vdd vss vdd vss`,
    READINESS_STATUS: spec.views.gds === undefined ? "blocked_missing_gds" : "ready",
  };

  return spec.views.gds === undefined ? config : { ...config, EXTRA_GDS_FILES: spec.views.gds };
}

export function buildOpenRoadReadme(spec: StructuredSramSpec): string {
  const issues = spec.validationIssues.map((issue) => `- ${issue.code}: ${issue.message}`).join("\n");
  return `# OpenROAD setup for ${spec.macro.name}

This prototype emits the source view inventory needed by an OpenROAD-based flow.

- LEF: ${spec.views.lef ?? "missing"}
- Liberty TT: ${spec.views.liberty.tt ?? "missing"}
- Verilog: ${spec.views.verilog ?? "missing"}
- SPICE: ${spec.views.spice ?? "missing"}
- GDS: ${spec.views.gds ?? "missing"}

## Readiness
${issues.length > 0 ? issues : "- no blocking issues detected"}
`;
}

export function buildOpenRoadSmokeTcl(spec: StructuredSramSpec): string {
  const lef = spec.views.lef ?? "missing.lef";
  const liberty = spec.views.liberty.tt ?? "missing.lib";
  const verilog = spec.views.verilog ?? "missing.v";
  return `# Auto-generated OpenROAD smoke script for ${spec.macro.name}
# Static smoke target: verify source views, wrapper RTL, and SDC can be loaded.
# Generated from structured spec; numeric constraints remain in base.sdc.
# Run from this macro output directory so relative wrapper/base.sdc paths resolve.
# View paths are absolute traced source paths; re-emit if this bundle moves machines.
# Scope limit: macro LEF + behavioral macro Verilog smoke, not a full P&R deck.
read_lef ${lef}
read_liberty ${liberty}
read_verilog ${spec.macro.name}_wrapper.v
read_verilog ${verilog}
link_design ${spec.macro.name}_wrapper
read_sdc base.sdc
report_checks -path_delay min_max
`;
}

export function buildOpenRoadSmokeRunnerSh(): string {
  return `#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v openroad >/dev/null 2>&1; then
  echo "openroad not found on PATH; install OpenROAD or run inside a pinned flow container." >&2
  exit 127
fi

openroad -exit openroad-smoke.tcl 2>&1 | tee openroad-smoke.log
`;
}

export function buildWrapperVerilog(spec: StructuredSramSpec): string {
  const clock = spec.ports.clock.value[0] ?? "clk";
  const reset = spec.ports.reset.value[0] ?? "rstb";
  const chipEnable = spec.ports.chipEnable.value[0] ?? "ce";
  const writeEnable = spec.ports.writeEnable.value[0] ?? "we";
  const writeMask = spec.ports.writeMask.value[0] ?? "wmask";
  const address = spec.ports.address.value[0] ?? "addr";
  const input = spec.ports.input.value[0] ?? "din";
  const output = spec.ports.output.value[0] ?? "dout";
  const power = spec.ports.power.value[0] ?? "vdd";
  const ground = spec.ports.ground.value[0] ?? "vss";

  return `// Auto-generated wrapper for OpenLane/OpenROAD smoke integration.
// All widths are traced from SRAM22 macro views in spec.yaml/spec.json.
module ${spec.macro.name}_wrapper (
\`ifdef USE_POWER_PINS
  inout ${power},
  inout ${ground},
\`endif
  input ${clock},
  input ${reset},
  input ${chipEnable},
  input ${writeEnable},
  input [${spec.parameters.wmaskWidth.value - 1}:0] ${writeMask},
  input [${spec.parameters.addrWidth.value - 1}:0] ${address},
  input [${spec.parameters.width.value - 1}:0] ${input},
  output [${spec.parameters.width.value - 1}:0] ${output}
);

  ${spec.macro.name} u_${spec.macro.name} (
\`ifdef USE_POWER_PINS
    .${power}(${power}),
    .${ground}(${ground}),
\`endif
    .${clock}(${clock}),
    .${reset}(${reset}),
    .${chipEnable}(${chipEnable}),
    .${writeEnable}(${writeEnable}),
    .${writeMask}(${writeMask}),
    .${address}(${address}),
    .${input}(${input}),
    .${output}(${output})
  );

endmodule
`;
}

export function buildSdc(spec: StructuredSramSpec): string {
  const clock = spec.ports.clock.value[0] ?? "clk";
  const clockSource = spec.timing.clockPeriodNs.sources[0];
  const clockPeriod = spec.timing.clockPeriodNs.value;
  const sourceLabel = clockSource === undefined ? "unknown" : `${clockSource.path}:${clockSource.line ?? "?"}`;
  return `# CLOCK_PERIOD=${clockPeriod} extracted from Liberty minimum_period constraints.
# Source: ${sourceLabel}
# Confidence: ${spec.timing.clockPeriodNs.confidence}
create_clock -name ${clock} -period ${clockPeriod} [get_ports ${clock}]
set_input_delay 0 -clock ${clock} [all_inputs]
set_output_delay 0 -clock ${clock} [all_outputs]
`;
}

/** High-level protocol assumptions/properties bindable to wrapper or TB (source-backed notes in headers). */
export function buildProtocolAssumptionsSv(spec: StructuredSramSpec): string {
  const normalized = normalizePropertyCatalog(spec, buildDefaultPropertyProposals(spec));
  return emitVerificationCollateralBundle(spec, normalized.catalog).legacyProtocolAssumptionsSv;

  const m = spec.macro.name;
  const clk = spec.interfaceProtocol.clock.portName.value;
  const rstb = spec.interfaceProtocol.resetBar.portName.value;
  const ce = spec.interfaceProtocol.chipEnable.portName.value;
  const we = spec.interfaceProtocol.writeEnable.portName.value;
  const wmask = spec.interfaceProtocol.wmask.portName.value;
  const addr = spec.ports.address.value[0] ?? "addr";
  const din = spec.ports.input.value[0] ?? "din";
  const addrMsb = spec.parameters.addrWidth.value - 1;
  const dataMsb = spec.parameters.width.value - 1;
  const wmaskMsb = spec.parameters.wmaskWidth.value - 1;
  const gate = spec.interfaceProtocol.gating.activeCycleExpression.value;
  const writeCond = spec.interfaceProtocol.readWrite.writeCondition.value;
  const readCond = spec.interfaceProtocol.readWrite.readCondition.value;
  const laneParams = spec.interfaceProtocol.wmask.lanes
    .map(
      (lane) => `  localparam int LANE_${lane.laneIndex}_MSB = ${lane.msb};
  localparam int LANE_${lane.laneIndex}_LSB = ${lane.lsb};`,
    )
    .join("\n");
  const laneKnownProperties = spec.interfaceProtocol.wmask.lanes
    .map(
      (lane) => `  property p_lane_${lane.laneIndex}_mask_known_when_write;
    @(posedge ${clk}) (${writeCond}) |-> !$isunknown(${wmask}[${lane.laneIndex}]);
  endproperty
  assume property (p_lane_${lane.laneIndex}_mask_known_when_write);

  property p_lane_${lane.laneIndex}_data_known_when_selected;
    @(posedge ${clk}) (${writeCond} && ${wmask}[${lane.laneIndex}]) |->
      !$isunknown(${din}[LANE_${lane.laneIndex}_MSB:LANE_${lane.laneIndex}_LSB]);
  endproperty
  assume property (p_lane_${lane.laneIndex}_data_known_when_selected);

  property p_cover_write_lane_${lane.laneIndex};
    @(posedge ${clk}) (${writeCond} && ${wmask}[${lane.laneIndex}]);
  endproperty
  cover property (p_cover_write_lane_${lane.laneIndex});`,
    )
    .join("\n\n");

  return `// Protocol SVA for ${m} — derived from spec.interfaceProtocol (behavioral Verilog + parameters).
// Bind example (TB): bind ${m}_wrapper ${m}_protocol_assumptions proto_* (.*);
// Review tool support for assume/assert before relying in formal.

\`default_nettype none
module ${m}_protocol_assumptions (
  input wire logic ${clk},
  input wire logic ${rstb},
  input wire logic ${ce},
  input wire logic ${we},
  input wire logic [${wmaskMsb}:0] ${wmask},
  input wire logic [${addrMsb}:0] ${addr},
  input wire logic [${dataMsb}:0] ${din}
);

  localparam int DATA_WIDTH = ${spec.parameters.width.value};
  localparam int ADDR_WIDTH = ${spec.parameters.addrWidth.value};
  localparam int WMASK_WIDTH = ${spec.parameters.wmaskWidth.value};
  localparam int WRITE_SIZE = ${spec.interfaceProtocol.wmask.laneBitWidth.value};
  localparam int SRAM_DEPTH = ${spec.parameters.words.value};
${laneParams}

  // ----------------------------------------------------------------------------
  // Source-backed assumptions: clean control/data in the active decoded window.
  // ----------------------------------------------------------------------------
  property p_no_x_when_active;
    @(posedge ${clk}) (${gate}) |-> (!$isunknown({${we}, ${addr}, ${din}, ${wmask}}));
  endproperty
  assume property (p_no_x_when_active);

  property p_ce_we_rstb_defined;
    @(posedge ${clk}) !$isunknown({${ce}, ${we}, ${rstb}});
  endproperty
  assume property (p_ce_we_rstb_defined);

  property p_addr_known_when_active;
    @(posedge ${clk}) (${gate}) |-> !$isunknown(${addr});
  endproperty
  assume property (p_addr_known_when_active);

  property p_wmask_known_when_write;
    @(posedge ${clk}) (${writeCond}) |-> !$isunknown(${wmask});
  endproperty
  assume property (p_wmask_known_when_write);

  // ----------------------------------------------------------------------------
  // Reset / enable interpretation (informational assertions — may be demoted in flows).
  // ----------------------------------------------------------------------------
  property p_active_high_ce_for_protocol_text;
    @(posedge ${clk}) (${gate}) |-> (${ce} === 1'b1 && ${rstb} === 1'b1);
  endproperty

  // Read vs write partition matches behavioral if (${we}) / if (!${we}) under ${gate}
  property p_write_implies_condition;
    @(posedge ${clk}) (${writeCond}) |-> (${we} === 1'b1);
  endproperty

  property p_read_implies_condition;
    @(posedge ${clk}) (${readCond}) |-> (${we} === 1'b0);
  endproperty

  property p_write_condition_equivalence;
    @(posedge ${clk}) (${writeCond}) == (${gate} && ${we});
  endproperty

  property p_read_condition_equivalence;
    @(posedge ${clk}) (${readCond}) == (${gate} && !${we});
  endproperty

  assert property (p_active_high_ce_for_protocol_text);
  assert property (p_write_implies_condition);
  assert property (p_read_implies_condition);
  assert property (p_write_condition_equivalence);
  assert property (p_read_condition_equivalence);

  // The source has one WE rail, so active cycles partition into exactly read or write.
  property p_active_cycle_partitions_read_or_write;
    @(posedge ${clk}) (${gate}) |-> ((${writeCond}) || (${readCond}));
  endproperty
  assert property (p_active_cycle_partitions_read_or_write);

${laneKnownProperties}

  property p_cover_active_write;
    @(posedge ${clk}) (${writeCond});
  endproperty
  cover property (p_cover_active_write);

  property p_cover_active_read;
    @(posedge ${clk}) (${readCond});
  endproperty
  cover property (p_cover_active_read);

  property p_cover_full_mask_write;
    @(posedge ${clk}) (${writeCond} && (&${wmask}));
  endproperty
  cover property (p_cover_full_mask_write);

  property p_cover_partial_mask_write;
    @(posedge ${clk}) (${writeCond} && (|${wmask}) && !(&${wmask}));
  endproperty
  cover property (p_cover_partial_mask_write);

endmodule
\`default_nettype wire
`;
}

/**
 * Scaffold for future shadow-memory / scoreboarding. Not source-complete for blackbox GDS flows.
 * confidence: treat as TODO — internal mem not visible on macro boundary.
 */
export function buildMemorySemanticsCheckerSv(spec: StructuredSramSpec): string {
  const normalized = normalizePropertyCatalog(spec, buildDefaultPropertyProposals(spec));
  return emitVerificationCollateralBundle(spec, normalized.catalog).legacyMemorySemanticsCheckerSv;

  const m = spec.macro.name;
  const clk = spec.interfaceProtocol.clock.portName.value;
  const rstb = spec.interfaceProtocol.resetBar.portName.value;
  const ce = spec.interfaceProtocol.chipEnable.portName.value;
  const we = spec.interfaceProtocol.writeEnable.portName.value;
  const wmask = spec.interfaceProtocol.wmask.portName.value;
  const addr = spec.ports.address.value[0] ?? "addr";
  const din = spec.ports.input.value[0] ?? "din";
  const dout = spec.ports.output.value[0] ?? "dout";
  const addrMsb = spec.parameters.addrWidth.value - 1;
  const dataMsb = spec.parameters.width.value - 1;
  const wmaskMsb = spec.parameters.wmaskWidth.value - 1;
  const gate = spec.interfaceProtocol.gating.activeCycleExpression.value;
  const writeCond = spec.interfaceProtocol.readWrite.writeCondition.value;
  const readCond = spec.interfaceProtocol.readWrite.readCondition.value;
  const laneWrites = spec.interfaceProtocol.wmask.lanes
    .map(
      (lane) => `      if (${wmask}[${lane.laneIndex}]) begin
        reference_mem[${addr}][${lane.msb}:${lane.lsb}] <= ${din}[${lane.msb}:${lane.lsb}];
        reference_lane_valid[${addr}][${lane.laneIndex}] <= 1'b1;
      end`,
    )
    .join("\n");
  const laneAssertions = spec.interfaceProtocol.wmask.lanes
    .map(
      (lane) => `  property p_read_lane_${lane.laneIndex}_matches_reference;
    @(posedge ${clk}) expected_read_valid[${lane.laneIndex}] |->
      (${dout}[${lane.msb}:${lane.lsb}] == expected_read_data[${lane.msb}:${lane.lsb}]);
  endproperty
  assert property (p_read_lane_${lane.laneIndex}_matches_reference);`,
    )
    .join("\n\n");

  return `// Boundary-observable shadow-memory semantics checker for ${m}
// Source basis: behavioral Verilog writes byte lanes under ${writeCond} and reads dout under ${readCond}.
// Scope: checks externally visible read-after-write behavior for lanes previously written through this interface.
// It does not bind to internal mem[] and does not claim power-up contents.

\`default_nettype none
module ${m}_memory_semantics_checker (
  input wire logic ${clk},
  input wire logic ${rstb},
  input wire logic ${ce},
  input wire logic ${we},
  input wire logic [${wmaskMsb}:0] ${wmask},
  input wire logic [${addrMsb}:0] ${addr},
  input wire logic [${dataMsb}:0] ${din},
  input wire logic [${dataMsb}:0] ${dout}
);

  localparam int DATA_WIDTH = ${spec.parameters.width.value};
  localparam int ADDR_WIDTH = ${spec.parameters.addrWidth.value};
  localparam int WMASK_WIDTH = ${spec.parameters.wmaskWidth.value};
  localparam int SRAM_DEPTH = ${spec.parameters.words.value};

  logic [${dataMsb}:0] reference_mem [0:${spec.parameters.words.value - 1}];
  logic [${wmaskMsb}:0] reference_lane_valid [0:${spec.parameters.words.value - 1}];
  logic [${dataMsb}:0] expected_read_data;
  logic [${wmaskMsb}:0] expected_read_valid;
  integer init_addr;

  initial begin
    expected_read_data = 'x;
    expected_read_valid = '0;
    for (init_addr = 0; init_addr < SRAM_DEPTH; init_addr = init_addr + 1) begin
      reference_mem[init_addr] = 'x;
      reference_lane_valid[init_addr] = '0;
    end
  end

  always @(posedge ${clk}) begin
    expected_read_valid <= '0;
    if (${gate}) begin
      if (${readCond}) begin
        expected_read_data <= reference_mem[${addr}];
        expected_read_valid <= reference_lane_valid[${addr}];
      end
      if (${writeCond}) begin
${laneWrites}
      end
    end
  end

${laneAssertions}

endmodule
\`default_nettype wire
`;
}

export const hammerSramCacheTarget: EdaTarget = {
  id: "hammer_sram_cache_json",
  description: "Hammer-style sram-cache.json fragment for SRAM blackboxing",
  emit(spec) {
    return [
      {
        fileName: "sram-cache.json",
        contents: `${JSON.stringify([buildHammerCacheEntry(spec)], null, 2)}\n`,
      },
    ];
  },
};

export const openLaneConfigTarget: EdaTarget = {
  id: "openlane_config_json",
  description: "OpenLane JSON config stub with macro view paths",
  emit(spec) {
    return [
      {
        fileName: "openlane.config.json",
        contents: `${JSON.stringify(buildOpenLaneConfig(spec), null, 2)}\n`,
      },
    ];
  },
};

export const openLaneWrapperTarget: EdaTarget = {
  id: "openlane_wrapper_verilog",
  description: "Minimal top-level wrapper RTL that instantiates the SRAM macro for OpenLane/OpenROAD smoke integration",
  emit(spec) {
    return [{ fileName: `${spec.macro.name}_wrapper.v`, contents: buildWrapperVerilog(spec) }];
  },
};

export const openLaneSdcTarget: EdaTarget = {
  id: "openlane_base_sdc",
  description: "Base SDC with a Liberty-traced clock period",
  emit(spec) {
    return [{ fileName: "base.sdc", contents: buildSdc(spec) }];
  },
};

export const openRoadNotesTarget: EdaTarget = {
  id: "openroad_setup_md",
  description: "OpenROAD-oriented view inventory / readiness notes",
  emit(spec) {
    return [{ fileName: "openroad-setup.md", contents: buildOpenRoadReadme(spec) }];
  },
};

export const openRoadSmokeTclTarget: EdaTarget = {
  id: "openroad_smoke_tcl",
  description: "OpenROAD TCL smoke script that loads emitted wrapper, macro blackbox, LEF, Liberty, and SDC",
  emit(spec) {
    return [{ fileName: "openroad-smoke.tcl", contents: buildOpenRoadSmokeTcl(spec) }];
  },
};

export const openRoadSmokeRunnerTarget: EdaTarget = {
  id: "openroad_smoke_runner_sh",
  description: "Cwd-safe shell runner for openroad-smoke.tcl that captures openroad-smoke.log",
  emit() {
    return [{ fileName: "run-openroad-smoke.sh", contents: buildOpenRoadSmokeRunnerSh() }];
  },
};

export const sramProtocolAssumptionsTarget: EdaTarget = {
  id: "sram_protocol_assumptions_sv",
  description: "Source-backed SVA protocol assumptions/assertions bindable to wrapper/TB",
  emit(spec) {
    return [{ fileName: `${spec.macro.name}_protocol_assumptions.sv`, contents: buildProtocolAssumptionsSv(spec) }];
  },
};

export const sramMemorySemanticsCheckerTarget: EdaTarget = {
  id: "sram_memory_semantics_checker_sv",
  description: "Prototype SVA scaffold for future shadow-memory semantics (low confidence until bind point exists)",
  emit(spec) {
    return [{ fileName: `${spec.macro.name}_memory_semantics_checker.sv`, contents: buildMemorySemanticsCheckerSv(spec) }];
  },
};

/** Default EDA targets shipped with the prototype; append targets here for new flows. */
export const DEFAULT_EDA_TARGETS: readonly EdaTarget[] = [
  hammerSramCacheTarget,
  openLaneWrapperTarget,
  openLaneConfigTarget,
  openLaneSdcTarget,
  sramProtocolAssumptionsTarget,
  sramMemorySemanticsCheckerTarget,
  openRoadSmokeTclTarget,
  openRoadSmokeRunnerTarget,
  openRoadNotesTarget,
];
