import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { parseSram22MacroName } from "../sram-sources/sram22/name.js";
import type { DiscoveredMacro } from "../spec/types.js";
import type { LoadedHumanIntent } from "./load.js";
import type { ResolvedHumanIntent } from "./schema.js";

export interface ResolveHumanIntentOptions {
  loaded: LoadedHumanIntent;
  discovered: readonly DiscoveredMacro[];
  interactive: boolean;
  /** Test hook: bypass readline when `interactive` resolves an ambiguous selection. */
  chooseMacro?: (matches: readonly DiscoveredMacro[]) => Promise<DiscoveredMacro>;
}

export interface ResolvedHumanIntentContext {
  intent: ResolvedHumanIntent;
  selectedMacro: DiscoveredMacro;
  /** True when macro choice came from resolving multiple constraint matches (interactive or test hook). */
  usedInteractiveDisambiguation: boolean;
}

function matchesSelection(intent: ResolvedHumanIntent, macro: DiscoveredMacro): boolean {
  const selection = intent.macro.selection;
  if (selection === undefined) return false;
  let parsed;
  try {
    parsed = parseSram22MacroName(macro.name);
  } catch {
    return false;
  }
  if (selection.minWords !== undefined && parsed.words < selection.minWords) return false;
  if (selection.minWidth !== undefined && parsed.width < selection.minWidth) return false;
  if (selection.preferredMux !== undefined && parsed.mux !== selection.preferredMux) return false;
  if (selection.requiresWriteMask === true && parsed.writeSize <= 1) return false;
  return true;
}

function assertNoValidationErrors(loaded: LoadedHumanIntent): void {
  const errors = loaded.findings.filter((finding) => finding.severity === "error");
  if (errors.length > 0) {
    throw new Error(`Human intent validation failed: ${errors.map((finding) => finding.message).join("; ")}`);
  }
}

async function promptMacroChoice(matches: readonly DiscoveredMacro[]): Promise<DiscoveredMacro> {
  const rl = createInterface({ input, output, terminal: true });
  try {
    output.write("Multiple macros matched human intent. Pick one:\n");
    matches.forEach((macro, index) => {
      output.write(`  ${index + 1}. ${macro.name}\n`);
    });
    const answer = await rl.question("Enter number (1–" + String(matches.length) + "): ");
    const choice = Number.parseInt(answer.trim(), 10);
    if (!Number.isFinite(choice) || choice < 1 || choice > matches.length) {
      throw new Error(`Invalid selection: ${answer.trim()}`);
    }
    const selected = matches[choice - 1];
    if (selected === undefined) throw new Error("Invalid selection index.");
    return selected;
  } finally {
    rl.close();
  }
}

export async function resolveHumanIntent(options: ResolveHumanIntentOptions): Promise<ResolvedHumanIntentContext> {
  assertNoValidationErrors(options.loaded);

  const explicitName = (options.loaded.intent.macro.name ?? "").trim();
  if (explicitName !== "") {
    const selected = options.discovered.find((macro) => macro.name === explicitName);
    if (selected === undefined) {
      throw new Error(`Human intent macro '${explicitName}' was not discovered.`);
    }
    return {
      intent: {
        ...options.loaded.intent,
        macro: { ...options.loaded.intent.macro, resolvedName: selected.name },
      },
      selectedMacro: selected,
      usedInteractiveDisambiguation: false,
    };
  }

  const matches = options.discovered.filter((macro) => matchesSelection(options.loaded.intent, macro));
  if (matches.length === 0) {
    throw new Error("Human intent macro selection matched zero macros.");
  }
  if (matches.length > 1) {
    if (!options.interactive) {
      throw new Error(
        `Human intent macro selection matched multiple macros: ${matches.map((macro) => macro.name).join(", ")}`,
      );
    }
    const selected =
      options.chooseMacro !== undefined ? await options.chooseMacro(matches) : await promptMacroChoice(matches);
    return {
      intent: {
        ...options.loaded.intent,
        macro: { ...options.loaded.intent.macro, resolvedName: selected.name },
      },
      selectedMacro: selected,
      usedInteractiveDisambiguation: true,
    };
  }

  const only = matches[0];
  if (only === undefined) throw new Error("Human intent macro selection matched zero macros.");
  return {
    intent: {
      ...options.loaded.intent,
      macro: { ...options.loaded.intent.macro, resolvedName: only.name },
    },
    selectedMacro: only,
    usedInteractiveDisambiguation: false,
  };
}
