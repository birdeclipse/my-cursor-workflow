import type { MacroNameParts } from "../../spec/types.js";

const SRAM22_NAME_PATTERN = /^sram22_(\d+)x(\d+)m(\d+)w(\d+)$/;

export function parseSram22MacroName(name: string): MacroNameParts {
  const match = SRAM22_NAME_PATTERN.exec(name);
  if (match === null) {
    throw new Error(`Unsupported SRAM22 macro name: ${name}`);
  }
  return {
    name,
    words: Number(match[1]),
    width: Number(match[2]),
    mux: Number(match[3]),
    writeSize: Number(match[4]),
  };
}
