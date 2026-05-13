import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { emitVerificationCollateralBundle } from "../src/verification-collateral/emit.js";
import { buildDefaultPropertyProposals, normalizePropertyCatalog } from "../src/verification-collateral/normalize.js";
import { extractStructuredSpec } from "../src/extract/sram22.js";
import type { PropertyProposal } from "../src/verification-collateral/schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const macrosRoot = path.join(repoRoot, "data/tier3_generators/sram22_macros");

async function getSpec() {
  return extractStructuredSpec({ macroName: "sram22_64x32m4w8", macrosRoot, repoRoot });
}

describe("verification collateral normalization", () => {
  test("rejects tautological properties before SVA rendering", async () => {
    const spec = await getSpec();
    const sourceRefs = spec.interfaceProtocol.readWrite.writeCondition.sources.map(
      (source) => `${source.path}:${source.line ?? "?"}: ${source.evidence}`,
    );
    const proposal: PropertyProposal = {
      id: "p_bad_tautology",
      role: "assert",
      category: "protocol",
      strictness: "strict_spec",
      confidence: 1,
      sourceRefs,
      svaBody: "(ce && rstb && we) == (ce && rstb && we)",
      description: "bad equality",
    };

    const result = normalizePropertyCatalog(spec, [proposal]);

    expect(result.findings.some((finding) => finding.code === "tautological_property")).toBe(true);
    expect(result.catalog.properties.map((property) => property.id)).not.toContain("p_bad_tautology");
  });

  test("rejects strict properties without source references or confidence", async () => {
    const spec = await getSpec();
    const proposal: PropertyProposal = {
      id: "p_unsourced",
      role: "assert",
      category: "protocol",
      strictness: "strict_spec",
      confidence: 1,
      sourceRefs: [],
      svaBody: "(ce && rstb) |-> ce",
      description: "unsourced property",
    };

    const result = normalizePropertyCatalog(spec, [proposal]);

    expect(result.findings.some((finding) => finding.code === "missing_source_refs")).toBe(true);
    expect(result.catalog.properties).toHaveLength(0);
  });

  test("preserves optional low-confidence assumptions separately from strict assertions", async () => {
    const spec = await getSpec();
    const proposals = buildDefaultPropertyProposals(spec);

    const result = normalizePropertyCatalog(spec, proposals);

    expect(result.findings.filter((finding) => finding.severity === "error")).toHaveLength(0);
    expect(result.catalog.properties.some((property) => property.strictness === "optional_environment")).toBe(true);
    expect(result.catalog.properties.some((property) => property.role === "assert" && property.strictness === "strict_spec")).toBe(true);
  });

  test("requires every write-mask lane to have assertion and cover coverage", async () => {
    const spec = await getSpec();
    const incomplete = buildDefaultPropertyProposals(spec).filter(
      (proposal) => !proposal.id.includes("lane_3"),
    );

    const result = normalizePropertyCatalog(spec, incomplete);

    expect(result.findings.some((finding) => finding.code === "missing_lane_assertion")).toBe(true);
    expect(result.findings.some((finding) => finding.code === "missing_lane_cover")).toBe(true);
  });

  test("emits split SVA files from normalized metadata", async () => {
    const spec = await getSpec();
    const normalized = normalizePropertyCatalog(spec, buildDefaultPropertyProposals(spec));
    const bundle = emitVerificationCollateralBundle(spec, normalized.catalog);

    expect(bundle.propertiesJson).toContain("\"schemaVersion\": \"0.1.0\"");
    expect(bundle.protocolAssertionsSv).toContain("wire logic active_cycle = ce && rstb;");
    expect(bundle.protocolAssertionsSv).not.toContain("(ce && rstb && we) == (ce && rstb && we)");
    expect(bundle.protocolCoversSv).toContain("p_cover_wmask_15");
    expect(bundle.memoryScoreboardSv).toContain("reference_mem[init_addr] = 'x;");
    expect(bundle.bindSv).toContain("bind sram22_64x32m4w8_wrapper");
  });
});
