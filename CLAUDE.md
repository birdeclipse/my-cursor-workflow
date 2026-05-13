# SRAM_SPEC_TO_WORKFLOW

Agentic workflow that turns an open-source SRAM macro into a ready-to-run
EDA-flow setup (KB → OpenLane / Hammer / OpenROAD configs).

## Primary target

**SRAM22** (`data/tier3_generators/sram22/` + `data/tier3_generators/sram22_macros/`).

Chosen because:
- All SOTA design knobs are visible Rust source, not binary blobs (replica
  self-timing v2, 4-way banking, TGate column mux, on-die TDC, configurable
  wmask granularity + mux ratio).
- 22 pre-generated sky130 macros with full view set (GDS / LEF / SPICE / V /
  3-corner Liberty) for end-to-end ground truth.
- Same PDK as the OpenRAM-emitted Tier 2 macros → A/B comparable.
- Exposes `USE_POWER_PINS` Verilog guard → already compatible with the
  OpenRAM/OpenLane macro convention.

GF180MCU SRAM IP (`data/tier1_gf180/`) is the **classical baseline** used for
extractor schema training (per-section CSV ground truth, 4 cells in a scaling
family). Not a workflow target.

## Cold-start data

| Path | What | Read first |
|---|---|---|
| `data/INDEX.md` | every cloned/downloaded artifact, provenance | yes |
| `data/MANIFEST.csv` | machine-readable provenance (25 rows) | when scripting |
| `data/tier1_gf180/TIER1_REPORT.md` | GF180 baseline — 4-cell scaling family, CSV-section schema | for extractor training |
| `data/tier3_generators/SRAM22_SOTA_REPORT.md` | SRAM22 architecture, SOTA features, knob surface, macro family, gap list | for any workflow change |
| `data/eda_flow_refs/hammer/hammer/technology/sky130/extra/sram22/` | productized sram22 wrapper for Hammer (sram-cache-gen.py, sram-cache.json) | for KB → flow emit |

## Implemented prototype (Cursor SDK)

The **executable** workflow lives under `prototypes/cursor-sdk-sram-workflow/`.

**Authoritative spec for that package:** `prototypes/cursor-sdk-sram-workflow/README.md` — agentic architecture, Mermaid flowcharts, key features, code layout, CLI (`discover`, `demo:extract`, `agent:run`, `flow:quality`, `smoke-run`), HITL (`--requirements`, `--interactive`), and output paths.

At a glance:

- **Deterministic path:** SRAM22 `SramSourceAdapter` → `StructuredSramSpec` → EDA adapters (Hammer, OpenLane, OpenROAD, verification) → artifacts under `outputs/<run-id>/`.
- **Optional Cursor SDK path:** planning → verification collateral → **SVA convergence** (intent → translate → reviewer with deterministic normalize/emit) → self-review; events in `agent-events.jsonl`.
- **Human-in-the-loop:** YAML/JSON requirements + optional interactive macro pick; resolved intent in `human-intent.json` (feeds prompts and adapter subset).

Supplementary notes: `docs/workflow-prototype.md`.

## Workflow vision (long-term)

```
SRAM22 macro views (.lib + .lef + .v + .spice + TOML config)
         │
         ▼
   spec extractor          ← agent reads views, no datasheet exists
         │
         ▼
   KB (YAML)               ← canonical knob/pin/timing/power state
         │
         ▼
   flow emitter            ← templates per EDA tool
         │
         ├─► OpenLane config.tcl + .sdc
         ├─► Hammer sram-cache.json (mirror)
         └─► OpenROAD setup
```

Roadmap stages beyond the prototype:

1. **Extractor** — broaden and harden view triangulation (lib / V / SPICE agreement); GF180 CSV round-trip remains training ground.
2. **KB** — YAML schema aligned with Hammer `sram-cache.json` and the structured spec.
3. **Emitter** — more flows and signoff-oriented timing policy (prototype smoke is not signoff).
4. **Agent loop** — already partially realized via Cursor SDK + convergence; extend validation (e.g. full OpenLane wrapper runs in CI when available).

## House rules

- **No data fabrication.** Every numeric value the pipeline emits must trace
  back to a source file under `data/` or be flagged with confidence < 1.0.
- **Round-trip is the spec.** Anything we generate must be re-derivable
  from the source views. If it isn't, we're inventing.
- **Apache-2.0 in, Apache-2.0 out.** Keep license posture clean — every
  artifact under `data/` is permissively licensed (see MANIFEST.csv).
- **Macro names encode the design**: `sram22_{words}x{width}m{mux}w{wmask_granularity}`.
  Parse with regex, not NLP.

## Repository state

- **Prototype code:** TypeScript under `prototypes/cursor-sdk-sram-workflow/`; `npm test` and `npm run typecheck` at repo root.
- **Agent runs:** require `CURSOR_API_KEY` for `npm run agent:run`; deterministic extract/emit does not.
- Manual-download PDFs (4 eScholarship + 2 vendor) marked `manual_required` in MANIFEST — only Cirimelli-Low's sky130 OpenRAM paper is on the critical path; rest are nice-to-have.
