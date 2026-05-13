import { source, trace } from "../spec/provenance.js";
import type { MacroNameParts, SramInterfaceProtocol, TracedValue, WmaskLaneSemantics } from "../spec/types.js";
import type { VerilogFacts, VerilogProtocolEvidence } from "./viewParsers.js";

export interface BuildInterfaceProtocolInput {
  verilogPath: string;
  nameParts: MacroNameParts;
  parameters: {
    width: TracedValue<number>;
    writeSize: TracedValue<number>;
    wmaskWidth: TracedValue<number>;
  };
  ports: VerilogFacts["ports"];
  protocolEvidence: VerilogProtocolEvidence;
}

function deriveWmaskLanes(
  verilogPath: string,
  writeSize: number,
  wmaskWidth: number,
  dataWidth: number,
  assignments: VerilogProtocolEvidence["wmaskLaneAssignments"],
): WmaskLaneSemantics[] {
  if (wmaskWidth * writeSize !== dataWidth) {
    throw new Error(
      `WMASK_WIDTH*WRITE_SIZE (${String(wmaskWidth)}*${String(writeSize)}) must equal DATA_WIDTH (${String(dataWidth)}) for lane derivation`,
    );
  }
  const lanes: WmaskLaneSemantics[] = [];
  for (let i = 0; i < wmaskWidth; i += 1) {
    const msb = (i + 1) * writeSize - 1;
    const lsb = i * writeSize;
    const assign = assignments.find((a) => a.laneIndex === i);
    let verilogSliceAgrees: TracedValue<boolean>;
    if (assign === undefined) {
      verilogSliceAgrees = trace(false, {
        path: verilogPath,
        evidence: `No behavioral wmask[${String(i)}] write slice found in Verilog`,
      });
    } else {
      const ok =
        assign.memMsb === msb &&
        assign.memLsb === lsb &&
        assign.dinMsb === msb &&
        assign.dinLsb === lsb;
      verilogSliceAgrees = trace(ok, source(verilogPath, assign.evidence, assign.line));
    }
    lanes.push({ laneIndex: i, msb, lsb, verilogSliceAgrees });
  }
  return lanes;
}

export function buildInterfaceProtocol(input: BuildInterfaceProtocolInput): SramInterfaceProtocol {
  const clk = input.ports.clock.value[0] ?? "clk";
  const rstb = input.ports.reset.value[0] ?? "rstb";
  const ce = input.ports.chipEnable.value[0] ?? "ce";
  const we = input.ports.writeEnable.value[0] ?? "we";
  const wmask = input.ports.writeMask.value[0] ?? "wmask";
  const ev = input.protocolEvidence;

  const writeCondition = `${ce} && ${rstb} && ${we}`;
  const readCondition = `${ce} && ${rstb} && !${we}`;
  const docChunks: string[] = [];
  if (ev.resetPortComment !== undefined) {
    docChunks.push(`Verilog port comment: ${ev.resetPortComment}`);
  }
  docChunks.push(
    "Behavioral Verilog has no reset branch that clears mem[] or dout; updates occur only on posedge clk inside the active-cycle guard.",
  );
  docChunks.push(
    "Interpret rstb as active-low gating (report wording: reset bar / active-low synchronous control gating) consistent with `if (" +
      ev.gatingExpression +
      ")`.",
  );

  const lanes = deriveWmaskLanes(
    input.verilogPath,
    input.parameters.writeSize.value,
    input.parameters.wmaskWidth.value,
    input.parameters.width.value,
    ev.wmaskLaneAssignments,
  );

  return {
    clock: {
      portName: trace(clk, source(input.verilogPath, ev.clockEdgeEvidence, ev.clockEdgeLine)),
      samplingEdge: trace("posedge", source(input.verilogPath, ev.clockEdgeEvidence, ev.clockEdgeLine)),
    },
    resetBar: {
      portName: trace(rstb, source(input.verilogPath, ev.gatingEvidence, ev.gatingLine)),
      polarity: trace("active_low", source(input.verilogPath, ev.gatingEvidence, ev.gatingLine)),
      resetsMemoryInModel: trace(
        false,
        source(input.verilogPath, `${ev.clockEdgeEvidence} … ${ev.gatingEvidence}`, ev.clockEdgeLine),
      ),
      documentationNote: trace(docChunks.join(" "), source(input.verilogPath, ev.gatingEvidence, ev.gatingLine)),
    },
    chipEnable: {
      portName: trace(ce, source(input.verilogPath, ev.gatingEvidence, ev.gatingLine)),
      polarity: trace("active_high", source(input.verilogPath, ev.gatingEvidence, ev.gatingLine)),
    },
    writeEnable: {
      portName: trace(we, source(input.verilogPath, ev.writeBranchEvidence, ev.writeBranchLine)),
      polarity: trace("active_high", source(input.verilogPath, ev.writeBranchEvidence, ev.writeBranchLine)),
    },
    gating: {
      activeCycleExpression: trace(ev.gatingExpression, source(input.verilogPath, ev.gatingEvidence, ev.gatingLine)),
    },
    readWrite: {
      writeCondition: trace(writeCondition, source(input.verilogPath, ev.writeBranchEvidence, ev.writeBranchLine)),
      readCondition: trace(readCondition, source(input.verilogPath, ev.readBranchEvidence, ev.readBranchLine)),
    },
    wmask: {
      portName: trace(
        wmask,
        source(
          input.verilogPath,
          ev.wmaskLaneAssignments[0]?.evidence ?? `input ${wmask} write mask`,
          ev.wmaskLaneAssignments[0]?.line,
        ),
      ),
      polarity: trace(
        "active_high",
        source(
          input.verilogPath,
          ev.wmaskLaneAssignments[0]?.evidence ?? ev.writeBranchEvidence,
          ev.wmaskLaneAssignments[0]?.line ?? ev.writeBranchLine,
        ),
      ),
      laneBitWidth: trace(
        input.parameters.writeSize.value,
        source(
          input.verilogPath,
          ev.wmaskLaneAssignments[0]?.evidence ?? `macro writeSize w${String(input.nameParts.writeSize)}`,
          ev.wmaskLaneAssignments[0]?.line,
        ),
      ),
      lanes,
    },
  };
}
