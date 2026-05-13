import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { buildInterfaceProtocol } from "../src/extract/interfaceProtocol.js";
import { parseVerilogFacts } from "../src/extract/viewParsers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const verilogPath = path.join(
  repoRoot,
  "data/tier3_generators/sram22_macros/sram22_64x32m4w8/sram22_64x32m4w8.v",
);

describe("interfaceProtocol", () => {
  test("derives source-backed pin protocol and wmask lanes from SRAM22 Verilog", async () => {
    const facts = await parseVerilogFacts(verilogPath);
    const proto = buildInterfaceProtocol({
      verilogPath,
      nameParts: { name: "sram22_64x32m4w8", words: 64, width: 32, mux: 4, writeSize: 8 },
      parameters: {
        width: { value: 32, confidence: 1, sources: [] },
        writeSize: { value: 8, confidence: 1, sources: [] },
        wmaskWidth: { value: 4, confidence: 1, sources: [] },
      },
      ports: facts.ports,
      protocolEvidence: facts.protocolEvidence,
    });

    expect(proto.clock.samplingEdge.value).toBe("posedge");
    expect(proto.clock.portName.value).toBe("clk");
    expect(proto.resetBar.polarity.value).toBe("active_low");
    expect(proto.resetBar.resetsMemoryInModel.value).toBe(false);
    expect(proto.resetBar.resetsMemoryInModel.confidence).toBe(1);
    expect(proto.gating.activeCycleExpression.value).toContain("ce");
    expect(proto.gating.activeCycleExpression.value).toContain("rstb");
    expect(proto.readWrite.writeCondition.value).toMatch(/we/);
    expect(proto.readWrite.readCondition.value).toMatch(/we/);
    expect(proto.wmask.lanes).toHaveLength(4);
    expect(proto.wmask.lanes[0]).toMatchObject({ laneIndex: 0, msb: 7, lsb: 0 });
    expect(proto.wmask.lanes[3]).toMatchObject({ laneIndex: 3, msb: 31, lsb: 24 });
    expect(proto.wmask.laneBitWidth.value).toBe(8);
    expect(proto.wmask.lanes.every((l) => l.verilogSliceAgrees.value)).toBe(true);

    expect(facts.protocolEvidence.wmaskLaneAssignments.length).toBeGreaterThanOrEqual(4);
  });
});
