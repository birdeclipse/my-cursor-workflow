import { z } from "zod";

/** Zod schemas mirroring `types.ts` for post-extraction validation. */

export const sourceRefSchema = z.object({
  path: z.string(),
  line: z.number().int().nonnegative().optional(),
  evidence: z.string(),
});

export const tracedValueSchema = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({
    value: valueSchema,
    confidence: z.number().min(0).max(1),
    sources: z.array(sourceRefSchema),
  });

export const validationIssueSchema = z.object({
  code: z.string(),
  severity: z.enum(["info", "warning", "error"]),
  message: z.string(),
  sources: z.array(sourceRefSchema),
});

export const libertyViewsSchema = z.object({
  tt: z.string().optional(),
  ff: z.string().optional(),
  ss: z.string().optional(),
});

export const macroViewsSchema = z.object({
  verilog: z.string().optional(),
  lef: z.string().optional(),
  spice: z.string().optional(),
  gds: z.string().optional(),
  liberty: libertyViewsSchema,
});

const clockSamplingEdgeSchema = z.literal("posedge");

const wmaskLaneSemanticsSchema = z.object({
  laneIndex: z.number().int().nonnegative(),
  msb: z.number().int().nonnegative(),
  lsb: z.number().int().nonnegative(),
  verilogSliceAgrees: tracedValueSchema(z.boolean()),
});

export const sramInterfaceProtocolSchema = z.object({
  clock: z.object({
    portName: tracedValueSchema(z.string()),
    samplingEdge: tracedValueSchema(clockSamplingEdgeSchema),
  }),
  resetBar: z.object({
    portName: tracedValueSchema(z.string()),
    polarity: tracedValueSchema(z.literal("active_low")),
    resetsMemoryInModel: tracedValueSchema(z.boolean()),
    documentationNote: tracedValueSchema(z.string()),
  }),
  chipEnable: z.object({
    portName: tracedValueSchema(z.string()),
    polarity: tracedValueSchema(z.literal("active_high")),
  }),
  writeEnable: z.object({
    portName: tracedValueSchema(z.string()),
    polarity: tracedValueSchema(z.literal("active_high")),
  }),
  gating: z.object({
    activeCycleExpression: tracedValueSchema(z.string()),
  }),
  readWrite: z.object({
    writeCondition: tracedValueSchema(z.string()),
    readCondition: tracedValueSchema(z.string()),
  }),
  wmask: z.object({
    portName: tracedValueSchema(z.string()),
    polarity: tracedValueSchema(z.literal("active_high")),
    laneBitWidth: tracedValueSchema(z.number()),
    lanes: z.array(wmaskLaneSemanticsSchema),
  }),
});

export const structuredSramSpecSchema = z.object({
  schemaVersion: z.literal("0.1.0"),
  macro: z.object({
    name: z.string(),
    source: z.literal("sram22"),
    family: z.literal("1rw"),
    process: z.literal("sky130"),
  }),
  parameters: z.object({
    words: tracedValueSchema(z.number()),
    width: tracedValueSchema(z.number()),
    mux: tracedValueSchema(z.number()),
    writeSize: tracedValueSchema(z.number()),
    addrWidth: tracedValueSchema(z.number()),
    wmaskWidth: tracedValueSchema(z.number()),
    rows: tracedValueSchema(z.number()),
    cols: tracedValueSchema(z.number()),
  }),
  views: macroViewsSchema,
  physical: z.object({
    widthMicrons: tracedValueSchema(z.number()),
    heightMicrons: tracedValueSchema(z.number()),
    areaMicrons2: tracedValueSchema(z.number()),
  }),
  timing: z.object({
    clockPeriodNs: tracedValueSchema(z.number()),
  }),
  ports: z.object({
    clock: tracedValueSchema(z.array(z.string())),
    reset: tracedValueSchema(z.array(z.string())),
    chipEnable: tracedValueSchema(z.array(z.string())),
    writeEnable: tracedValueSchema(z.array(z.string())),
    address: tracedValueSchema(z.array(z.string())),
    input: tracedValueSchema(z.array(z.string())),
    output: tracedValueSchema(z.array(z.string())),
    writeMask: tracedValueSchema(z.array(z.string())),
    power: tracedValueSchema(z.array(z.string())),
    ground: tracedValueSchema(z.array(z.string())),
  }),
  interfaceProtocol: sramInterfaceProtocolSchema,
  validationIssues: z.array(validationIssueSchema),
});

export type StructuredSramSpecParsed = z.infer<typeof structuredSramSpecSchema>;
