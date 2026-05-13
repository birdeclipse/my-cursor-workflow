import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { HumanIntentSource, ResolvedHumanIntent } from "./schema.js";

export interface WriteHumanIntentArtifactsOptions {
  runDir: string;
  intent: ResolvedHumanIntent;
  source: HumanIntentSource;
}

export interface HumanIntentArtifactPaths {
  intentJson: string;
  sourceJson: string;
}

export async function writeHumanIntentArtifacts(
  options: WriteHumanIntentArtifactsOptions,
): Promise<HumanIntentArtifactPaths> {
  await mkdir(options.runDir, { recursive: true });
  const intentJson = path.join(options.runDir, "human-intent.json");
  const sourceJson = path.join(options.runDir, "human-intent-source.json");
  await Promise.all([
    writeFile(intentJson, `${JSON.stringify(options.intent, null, 2)}\n`, "utf8"),
    writeFile(sourceJson, `${JSON.stringify(options.source, null, 2)}\n`, "utf8"),
  ]);
  return { intentJson, sourceJson };
}
