import type { StructuredSramSpec } from "../spec/types.js";
import type { NormalizedProperty, PropertyCatalog, PropertyRole, VerificationCollateralBundle } from "./schema.js";

function propBlock(property: NormalizedProperty): string {
  const label = property.id;
  if (property.role === "cover") {
    return `  ${label}: cover property (@(posedge clk) ${property.svaBody});`;
  }
  const keyword = property.role === "assume" ? "assume" : "assert";
  return `  ${label}: ${keyword} property (@(posedge clk) disable iff (!rstb) ${property.svaBody});`;
}

function header(spec: StructuredSramSpec, moduleSuffix: string): string {
  const macro = spec.macro.name;
  const width = spec.parameters.width.value;
  const addrWidth = spec.parameters.addrWidth.value;
  const wmaskWidth = spec.parameters.wmaskWidth.value;
  return `// Auto-generated from normalized SRAM verification collateral metadata.
// Source-backed only; generated properties are listed in properties.json.
module ${macro}_${moduleSuffix} (
  input logic clk,
  input logic rstb,
  input logic ce,
  input logic we,
  input logic [${addrWidth - 1}:0] addr,
  input logic [${width - 1}:0] din,
  input logic [${width - 1}:0] dout,
  input logic [${wmaskWidth - 1}:0] wmask
);
  localparam int SRAM_DEPTH = ${spec.parameters.words.value};
  localparam int DATA_WIDTH = ${width};
  localparam int ADDR_WIDTH = ${addrWidth};
  localparam int WMASK_WIDTH = ${wmaskWidth};
  localparam int WRITE_SIZE = ${spec.parameters.writeSize.value};

  wire logic active_cycle = ce && rstb;
  wire logic write_cycle = active_cycle && we;
  wire logic read_cycle = active_cycle && !we;
`;
}

function renderModule(spec: StructuredSramSpec, moduleSuffix: string, role: PropertyRole, properties: NormalizedProperty[]): string {
  const relevant = properties.filter((property) => property.role === role);
  const body = relevant.map(propBlock).join("\n");
  return `${header(spec, moduleSuffix)}
${body}
endmodule
`;
}

function renderAssertions(spec: StructuredSramSpec, properties: NormalizedProperty[]): string {
  const relevant = properties.filter((property) => property.role === "assert" && property.category !== "memory_semantics");
  return `${header(spec, "protocol_assertions")}
${relevant.map(propBlock).join("\n")}
endmodule
`;
}

function renderMemoryScoreboard(spec: StructuredSramSpec, properties: NormalizedProperty[]): string {
  const macro = spec.macro.name;
  const width = spec.parameters.width.value;
  const addrWidth = spec.parameters.addrWidth.value;
  const depth = spec.parameters.words.value;
  const writeSize = spec.parameters.writeSize.value;
  const wmaskWidth = spec.parameters.wmaskWidth.value;
  const lanes = Array.from({ length: wmaskWidth }, (_, lane) => lane);
  const assertions = lanes
    .map((lane) => {
      const lsb = lane * writeSize;
      const msb = lsb + writeSize - 1;
      return `  p_read_lane_${lane}_matches_reference: assert property (@(posedge clk) disable iff (!rstb)
    expected_read_valid && reference_lane_valid[expected_read_addr][${lane}] |->
      dout[${msb}:${lsb}] == reference_mem[expected_read_addr][${msb}:${lsb}]);`;
    })
    .join("\n\n");
  const metadataComments = properties
    .filter((property) => property.role === "scoreboard")
    .map((property) => `  // ${property.id}: ${property.description}`)
    .join("\n");
  return `// Auto-generated from normalized SRAM verification collateral metadata.
module ${macro}_memory_scoreboard (
  input logic clk,
  input logic rstb,
  input logic ce,
  input logic we,
  input logic [${addrWidth - 1}:0] addr,
  input logic [${width - 1}:0] din,
  input logic [${width - 1}:0] dout,
  input logic [${wmaskWidth - 1}:0] wmask
);
  localparam int SRAM_DEPTH = ${depth};
  localparam int DATA_WIDTH = ${width};
  localparam int ADDR_WIDTH = ${addrWidth};
  localparam int WMASK_WIDTH = ${wmaskWidth};
  localparam int WRITE_SIZE = ${writeSize};

  logic [${width - 1}:0] reference_mem [0:${depth - 1}];
  logic [${wmaskWidth - 1}:0] reference_lane_valid [0:${depth - 1}];
  logic [${addrWidth - 1}:0] expected_read_addr;
  logic expected_read_valid;

${metadataComments}

  wire logic active_cycle = ce && rstb;
  wire logic write_cycle = active_cycle && we;
  wire logic read_cycle = active_cycle && !we;

  integer init_addr;
  initial begin
    for (init_addr = 0; init_addr < SRAM_DEPTH; init_addr = init_addr + 1) begin
      reference_mem[init_addr] = 'x;
      reference_lane_valid[init_addr] = '0;
    end
    expected_read_addr = '0;
    expected_read_valid = 1'b0;
  end

  integer lane;
  always_ff @(posedge clk) begin
    expected_read_valid <= 1'b0;
    if (write_cycle) begin
      for (lane = 0; lane < WMASK_WIDTH; lane = lane + 1) begin
        if (wmask[lane]) begin
          reference_mem[addr][lane*WRITE_SIZE +: WRITE_SIZE] <= din[lane*WRITE_SIZE +: WRITE_SIZE];
          reference_lane_valid[addr][lane] <= 1'b1;
        end
      end
    end else if (read_cycle) begin
      expected_read_addr <= addr;
      expected_read_valid <= 1'b1;
    end
  end

${assertions}
endmodule
`;
}

function renderBind(spec: StructuredSramSpec): string {
  const macro = spec.macro.name;
  return `// Bind normalized verification collateral to the generated wrapper boundary.
bind ${macro}_wrapper ${macro}_protocol_assumptions protocol_assumptions_i (
  .clk(clk), .rstb(rstb), .ce(ce), .we(we), .addr(addr), .din(din), .dout(dout), .wmask(wmask)
);
bind ${macro}_wrapper ${macro}_protocol_assertions protocol_assertions_i (
  .clk(clk), .rstb(rstb), .ce(ce), .we(we), .addr(addr), .din(din), .dout(dout), .wmask(wmask)
);
bind ${macro}_wrapper ${macro}_protocol_covers protocol_covers_i (
  .clk(clk), .rstb(rstb), .ce(ce), .we(we), .addr(addr), .din(din), .dout(dout), .wmask(wmask)
);
bind ${macro}_wrapper ${macro}_memory_scoreboard memory_scoreboard_i (
  .clk(clk), .rstb(rstb), .ce(ce), .we(we), .addr(addr), .din(din), .dout(dout), .wmask(wmask)
);
`;
}

export function emitVerificationCollateralBundle(
  spec: StructuredSramSpec,
  catalog: PropertyCatalog,
): VerificationCollateralBundle {
  const protocolAssumptionsSv = renderModule(spec, "protocol_assumptions", "assume", catalog.properties);
  const protocolAssertionsSv = renderAssertions(spec, catalog.properties);
  const protocolCoversSv = renderModule(spec, "protocol_covers", "cover", catalog.properties);
  const memoryScoreboardSv = renderMemoryScoreboard(spec, catalog.properties);
  const bindSv = renderBind(spec);
  return {
    propertiesJson: `${JSON.stringify(catalog, null, 2)}\n`,
    protocolAssumptionsSv,
    protocolAssertionsSv,
    protocolCoversSv,
    memoryScoreboardSv,
    bindSv,
    legacyProtocolAssumptionsSv: [protocolAssumptionsSv, protocolAssertionsSv, protocolCoversSv].join("\n"),
    legacyMemorySemanticsCheckerSv: memoryScoreboardSv.replaceAll(
      `${spec.macro.name}_memory_scoreboard`,
      `${spec.macro.name}_memory_semantics_checker`,
    ),
  };
}
