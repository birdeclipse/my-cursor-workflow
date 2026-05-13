import { readFile } from "node:fs/promises";

import { source, trace } from "../spec/provenance.js";
import type { TracedValue } from "../spec/types.js";

/** Per-lane write routing extracted from behavioral `mem[..] <= din[..]` guarded by `wmask[k]`. */
export interface VerilogWmaskLaneAssignment {
  laneIndex: number;
  memMsb: number;
  memLsb: number;
  dinMsb: number;
  dinLsb: number;
  evidence: string;
  line?: number;
}

/** Structural + behavioral cues used to build `interfaceProtocol` with provenance. */
export interface VerilogProtocolEvidence {
  clockName: string;
  clockEdgeEvidence: string;
  clockEdgeLine?: number;
  /** Textual gating expression from `if (<expr>)` (e.g. `ce && rstb`). */
  gatingExpression: string;
  gatingEvidence: string;
  gatingLine?: number;
  /** Port comment lines near `input rstb` when present. */
  resetPortComment?: string;
  writeBranchEvidence: string;
  writeBranchLine?: number;
  readBranchEvidence: string;
  readBranchLine?: number;
  wmaskLaneAssignments: VerilogWmaskLaneAssignment[];
}

export interface VerilogFacts {
  dataWidth: TracedValue<number>;
  addrWidth: TracedValue<number>;
  wmaskWidth: TracedValue<number>;
  ramDepthExpression: TracedValue<string>;
  protocolEvidence: VerilogProtocolEvidence;
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
}

export interface LefFacts {
  macroName: TracedValue<string>;
  widthMicrons: TracedValue<number>;
  heightMicrons: TracedValue<number>;
}

export interface LibertyFacts {
  addressWidth: TracedValue<number>;
  dataWidth: TracedValue<number>;
  wmaskWidth: TracedValue<number>;
  area: TracedValue<number>;
  minimumClockPeriodNs: TracedValue<number>;
}

function lineNumber(contents: string, evidence: string): number | undefined {
  const index = contents.indexOf(evidence);
  if (index < 0) return undefined;
  return contents.slice(0, index).split("\n").length;
}

function parseLocalParam(contents: string, filePath: string, name: string): TracedValue<number> {
  const regex = new RegExp(`localparam\\s+${name}\\s*=\\s*(\\d+)\\s*;`);
  const match = regex.exec(contents);
  if (match === null) {
    throw new Error(`Missing Verilog localparam ${name} in ${filePath}`);
  }
  const evidence = match[0];
  return trace(Number(match[1]), source(filePath, evidence, lineNumber(contents, evidence)));
}

function escapeVerilogId(id: string): string {
  return id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractResetBarPortComment(contents: string, resetPort: string): string | undefined {
  const re = new RegExp(`input\\s+${escapeVerilogId(resetPort)}\\s*;\\s*//\\s*(.+)$`, "m");
  const m = re.exec(contents);
  return m === null ? undefined : m[1].trim();
}

function extractVerilogProtocolEvidence(
  contents: string,
  filePath: string,
  ports: VerilogFacts["ports"],
): VerilogProtocolEvidence {
  const ce = ports.chipEnable.value[0] ?? "ce";
  const rstb = ports.reset.value[0] ?? "rstb";
  const clk = ports.clock.value[0] ?? "clk";
  const wmaskPort = ports.writeMask.value[0] ?? "wmask";
  const we = ports.writeEnable.value[0] ?? "we";

  const edgeRe = new RegExp(`always\\s*@\\s*\\(\\s*posedge\\s+${escapeVerilogId(clk)}\\s*\\)`, "m");
  const edgeMatch = edgeRe.exec(contents);
  if (edgeMatch === null) {
    throw new Error(`Missing posedge clock behavioral block for ${clk} in ${filePath}`);
  }
  const clockEdgeEvidence = edgeMatch[0];
  const clockEdgeLine = lineNumber(contents, clockEdgeEvidence);

  const gateRe = new RegExp(
    `if\\s*\\(\\s*${escapeVerilogId(ce)}\\s*&&\\s*${escapeVerilogId(rstb)}\\s*\\)`,
    "m",
  );
  const gateMatch = gateRe.exec(contents);
  if (gateMatch === null) {
    throw new Error(`Missing active-cycle gating if (${ce} && ${rstb}) in ${filePath}`);
  }
  const gatingEvidence = gateMatch[0];
  const gatingExpression = `${ce} && ${rstb}`;

  const writeRe = new RegExp(`if\\s*\\(\\s*${escapeVerilogId(we)}\\s*\\)`, "m");
  const writeMatch = writeRe.exec(contents);
  if (writeMatch === null) {
    throw new Error(`Missing write branch if (${we}) in ${filePath}`);
  }
  const writeBranchEvidence = writeMatch[0];

  const readRe = new RegExp(`if\\s*\\(\\s*!\\s*${escapeVerilogId(we)}\\s*\\)`, "m");
  const readMatch = readRe.exec(contents);
  if (readMatch === null) {
    throw new Error(`Missing read branch if (!${we}) in ${filePath}`);
  }
  const readBranchEvidence = readMatch[0];

  const wmaskLaneAssignments: VerilogWmaskLaneAssignment[] = [];
  const laneRe = new RegExp(
    `if\\s*\\(\\s*${escapeVerilogId(wmaskPort)}\\[(\\d+)\\]\\s*\\)\\s*begin\\s*` +
      `mem\\s*\\[\\s*addr\\s*\\]\\s*\\[(\\d+)\\s*:\\s*(\\d+)\\]\\s*<=\\s*din\\s*\\[(\\d+)\\s*:\\s*(\\d+)\\]`,
    "g",
  );
  let laneMatch: RegExpExecArray | null;
  while ((laneMatch = laneRe.exec(contents)) !== null) {
    const evidence = laneMatch[0];
    wmaskLaneAssignments.push({
      laneIndex: Number(laneMatch[1]),
      memMsb: Number(laneMatch[2]),
      memLsb: Number(laneMatch[3]),
      dinMsb: Number(laneMatch[4]),
      dinLsb: Number(laneMatch[5]),
      evidence,
      line: lineNumber(contents, evidence),
    });
  }
  wmaskLaneAssignments.sort((a, b) => a.laneIndex - b.laneIndex);

  return {
    clockName: clk,
    clockEdgeEvidence,
    clockEdgeLine,
    gatingExpression,
    gatingEvidence,
    gatingLine: lineNumber(contents, gatingEvidence),
    resetPortComment: extractResetBarPortComment(contents, rstb),
    writeBranchEvidence,
    writeBranchLine: lineNumber(contents, writeBranchEvidence),
    readBranchEvidence,
    readBranchLine: lineNumber(contents, readBranchEvidence),
    wmaskLaneAssignments,
  };
}

export async function parseVerilogFacts(filePath: string): Promise<VerilogFacts> {
  const contents = await readFile(filePath, "utf8");
  const moduleHeader = /module\s+\w+\(([\s\S]*?)\);/.exec(contents);
  if (moduleHeader === null) {
    throw new Error(`Missing Verilog module header in ${filePath}`);
  }
  const headerEvidence = moduleHeader[0];

  const ports: VerilogFacts["ports"] = {
    clock: trace(["clk"], source(filePath, headerEvidence, lineNumber(contents, headerEvidence))),
    reset: trace(["rstb"], source(filePath, headerEvidence, lineNumber(contents, headerEvidence))),
    chipEnable: trace(["ce"], source(filePath, headerEvidence, lineNumber(contents, headerEvidence))),
    writeEnable: trace(["we"], source(filePath, headerEvidence, lineNumber(contents, headerEvidence))),
    address: trace(["addr"], source(filePath, headerEvidence, lineNumber(contents, headerEvidence))),
    input: trace(["din"], source(filePath, headerEvidence, lineNumber(contents, headerEvidence))),
    output: trace(["dout"], source(filePath, headerEvidence, lineNumber(contents, headerEvidence))),
    writeMask: trace(["wmask"], source(filePath, headerEvidence, lineNumber(contents, headerEvidence))),
    power: trace(["vdd"], source(filePath, "`ifdef USE_POWER_PINS", lineNumber(contents, "`ifdef USE_POWER_PINS"))),
    ground: trace(["vss"], source(filePath, "`ifdef USE_POWER_PINS", lineNumber(contents, "`ifdef USE_POWER_PINS"))),
  };

  const protocolEvidence = extractVerilogProtocolEvidence(contents, filePath, ports);

  return {
    dataWidth: parseLocalParam(contents, filePath, "DATA_WIDTH"),
    addrWidth: parseLocalParam(contents, filePath, "ADDR_WIDTH"),
    wmaskWidth: parseLocalParam(contents, filePath, "WMASK_WIDTH"),
    ramDepthExpression: trace(
      "1 << ADDR_WIDTH",
      source(filePath, "localparam RAM_DEPTH = 1 << ADDR_WIDTH;", lineNumber(contents, "localparam RAM_DEPTH")),
    ),
    protocolEvidence,
    ports,
  };
}

export async function parseLefFacts(filePath: string): Promise<LefFacts> {
  const contents = await readFile(filePath, "utf8");
  const macroMatch = /MACRO\s+(\S+)/.exec(contents);
  const sizeMatch = /SIZE\s+([0-9.]+)\s+BY\s+([0-9.]+)\s*;/.exec(contents);
  if (macroMatch === null || sizeMatch === null) {
    throw new Error(`Missing LEF macro or size in ${filePath}`);
  }
  return {
    macroName: trace(macroMatch[1], source(filePath, macroMatch[0], lineNumber(contents, macroMatch[0]))),
    widthMicrons: trace(Number(sizeMatch[1]), source(filePath, sizeMatch[0], lineNumber(contents, sizeMatch[0]))),
    heightMicrons: trace(Number(sizeMatch[2]), source(filePath, sizeMatch[0], lineNumber(contents, sizeMatch[0]))),
  };
}

function parseBusWidth(contents: string, filePath: string, busName: string): TracedValue<number> {
  const regex = new RegExp(`type \\([^)]*_${busName}_[^)]*\\) \\{[\\s\\S]*?bit_width\\s*:\\s*(\\d+)\\s*;`);
  const match = regex.exec(contents);
  if (match === null) {
    throw new Error(`Missing Liberty bus width for ${busName} in ${filePath}`);
  }
  return trace(Number(match[1]), source(filePath, match[0], lineNumber(contents, match[0])));
}

function parseMinimumClockPeriodNs(contents: string, filePath: string): TracedValue<number> {
  const timingTypeIndex = contents.indexOf("timing_type : minimum_period;");
  if (timingTypeIndex < 0) {
    throw new Error(`Missing Liberty minimum_period timing constraint in ${filePath}`);
  }
  const blockStart = contents.lastIndexOf("timing ()", timingTypeIndex);
  if (blockStart < 0) {
    throw new Error(`Cannot locate Liberty timing block for minimum_period in ${filePath}`);
  }
  const followingBlockCandidates = [
    contents.indexOf("\n      timing ()", timingTypeIndex + 1),
    contents.indexOf("\n      internal_power", timingTypeIndex),
    contents.indexOf("\n    }", timingTypeIndex),
  ].filter((index) => index > timingTypeIndex);
  if (followingBlockCandidates.length === 0) {
    throw new Error(`Cannot determine Liberty minimum_period block boundary in ${filePath}`);
  }
  const blockEnd = Math.min(...followingBlockCandidates);
  const evidence = contents.slice(blockStart, blockEnd);
  if (!/related_pin\s*:\s*"clk"\s*;/.test(evidence)) {
    throw new Error(`Liberty minimum_period is not related to clk in ${filePath}`);
  }
  const numbers = [...evidence.matchAll(/values\s*\(\s*\\?\s*"([^"]+)"/g)].flatMap((m) =>
    [...m[1].matchAll(/-?\d+(?:\.\d+)?/g)].map((valueMatch) => Number(valueMatch[0])),
  );
  if (numbers.length === 0) {
    throw new Error(`Missing numeric Liberty minimum_period values in ${filePath}`);
  }
  const maxPeriod = Math.max(...numbers);
  return trace(maxPeriod, source(filePath, evidence, lineNumber(contents, evidence)));
}

export async function parseLibertyFacts(filePath: string): Promise<LibertyFacts> {
  const contents = await readFile(filePath, "utf8");
  const areaMatch = /area\s*:\s*([0-9.]+)\s*;/.exec(contents);
  if (areaMatch === null) {
    throw new Error(`Missing Liberty area in ${filePath}`);
  }
  return {
    addressWidth: parseBusWidth(contents, filePath, "addr"),
    dataWidth: parseBusWidth(contents, filePath, "din"),
    wmaskWidth: parseBusWidth(contents, filePath, "wmask"),
    area: trace(Number(areaMatch[1]), source(filePath, areaMatch[0], lineNumber(contents, areaMatch[0]))),
    minimumClockPeriodNs: parseMinimumClockPeriodNs(contents, filePath),
  };
}
