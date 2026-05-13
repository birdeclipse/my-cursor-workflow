import { readdir } from "node:fs/promises";
import path from "node:path";

import type { DiscoveredMacro, LibertyViews, MacroViews } from "../spec/types.js";

function classifyLiberty(fileName: string): keyof LibertyViews | undefined {
  if (fileName.includes("_tt_")) return "tt";
  if (fileName.includes("_ff_")) return "ff";
  if (fileName.includes("_ss_")) return "ss";
  return undefined;
}

export async function discoverSram22Macros(macrosRoot: string): Promise<DiscoveredMacro[]> {
  const entries = await readdir(macrosRoot, { withFileTypes: true });
  const macroDirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("sram22_"))
    .map((entry) => entry.name)
    .sort();

  return Promise.all(
    macroDirs.map(async (name) => {
      const dir = path.join(macrosRoot, name);
      const files = await readdir(dir);
      const views = files.reduce<MacroViews>(
        (accumulator, fileName) => {
          const fullPath = path.join(dir, fileName);
          if (fileName === `${name}.v`) return { ...accumulator, verilog: fullPath };
          if (fileName === `${name}.lef`) return { ...accumulator, lef: fullPath };
          if (fileName === `${name}.spice`) return { ...accumulator, spice: fullPath };
          if (fileName === `${name}.gds` || fileName === `${name}.gds.gz`) {
            return { ...accumulator, gds: fullPath };
          }
          if (fileName.endsWith(".lib")) {
            const corner = classifyLiberty(fileName);
            if (corner === undefined) return accumulator;
            return {
              ...accumulator,
              liberty: {
                ...accumulator.liberty,
                [corner]: fullPath,
              },
            };
          }
          return accumulator;
        },
        { liberty: {} },
      );

      return { name, dir, views };
    }),
  );
}

export async function getDiscoveredMacro(macrosRoot: string, macroName: string): Promise<DiscoveredMacro> {
  const macros = await discoverSram22Macros(macrosRoot);
  const macro = macros.find((candidate) => candidate.name === macroName);
  if (macro === undefined) {
    throw new Error(`SRAM22 macro not found: ${macroName}`);
  }
  return macro;
}
