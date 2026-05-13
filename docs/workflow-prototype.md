# Cursor SDK SRAM Workflow Prototype

This prototype turns local SRAM macro views into a structured SRAM spec and EDA flow setup artifacts.
SRAM22 is the first source adapter and OpenROAD/OpenLane/Hammer are the first EDA adapters; the target architecture is broader than either one.
It lives under `prototypes/cursor-sdk-sram-workflow/` and treats `data/` as immutable source truth.

## Commands

```bash
npm run discover
npm run demo:extract -- sram22_64x32m4w8 --run-id local-demo
npm run flow:quality -- local-demo
npm run smoke-run -- local-demo
CURSOR_API_KEY=... npm run agent:run -- sram22_64x32m4w8 --run-id sdk-demo
```

`demo:extract` is deterministic and does not need a Cursor API key. It emits:

- `outputs/<run-id>/<macro>/spec.yaml`
- `outputs/<run-id>/<macro>/spec.json`
- `outputs/<run-id>/<macro>/sram-cache.json`
- `outputs/<run-id>/<macro>/<macro>_wrapper.v`
- `outputs/<run-id>/<macro>/<macro>_protocol_assumptions.sv`
- `outputs/<run-id>/<macro>/<macro>_memory_semantics_checker.sv`
- `outputs/<run-id>/<macro>/openlane.config.json`
- `outputs/<run-id>/<macro>/base.sdc`
- `outputs/<run-id>/<macro>/openroad-smoke.tcl`
- `outputs/<run-id>/<macro>/run-openroad-smoke.sh`
- `outputs/<run-id>/<macro>/flow-smoke-report.json`
- `outputs/<run-id>/<macro>/openroad-smoke-log-report.json`
- `outputs/<run-id>/<macro>/openroad-setup.md`
- `outputs/<run-id>/run-report.json`
- `outputs/<run-id>/iteration-report.md`

`smoke-run` refreshes `openroad-smoke-log-report.json` and writes:

- `outputs/<run-id>/<macro>/openroad-smoke-exec-report.json`

`agent:run` performs the same deterministic extraction and emission, then uses the Cursor SDK for a
self-planning and self-review pass. SDK events are streamed to `agent-events.jsonl`.

## Architecture

The workflow intentionally separates deterministic fact extraction, EDA adapter emission, and agentic review:

- `extract/` currently parses SRAM22 macro names, Verilog localparams, LEF size, Liberty buses, and view inventory.
- `spec/` defines provenance-rich typed SRAM values and validation issues.
- `emit/` currently writes Hammer, OpenLane, OpenROAD, wrapper RTL, SDC, SVA, and smoke-run artifacts.
- `review/` performs deterministic traceability, static flow-quality, tool-smoke, HDL syntax, and log-classification checks.
- `sdk/` wraps Cursor SDK orchestration, streaming, subagents, run waiting, and failure separation.
- `.cursor/hooks/` protects `data/` and records tool-call audit events.

The next architecture boundary should split the prototype into:

- `src/core/` for provenance, schema plumbing, reports, quality gates, and bounded smoke execution.
- `src/domains/sram/` for the canonical SRAM KB and SRAM protocol validators.
- `src/sram-sources/` for source adapters such as SRAM22, OpenRAM, foundry compiler drops, and custom macros.
- `src/eda-adapters/` for OpenLane, OpenROAD, Hammer, formal, simulation, commercial STA, and commercial P&R integrations.
- `src/agent/` for Cursor SDK planning and self-review.

Implemented adapter boundary:

- `src/core/artifacts.ts`, `src/core/quality.ts`, and `src/core/smoke.ts` define shared emitted-file, quality, and smoke contracts.
- `src/domains/sram/sourceAdapter.ts` defines `SramSourceAdapter`.
- `src/sram-sources/sram22/` wraps the existing SRAM22 discovery/extraction path as the first source adapter.
- `src/eda-adapters/hammer/`, `src/eda-adapters/openlane/`, `src/eda-adapters/openroad/`, and `src/eda-adapters/verification/` expose the first EDA adapter set.
- The CLI still exposes the same commands, but single and batch extraction now route through the default SRAM source adapter, and emission routes through the default EDA flow adapter registry.

## Extending The Workflow

Add new SRAM source parsers as small modules under source-adapter folders that return traced values. Every numeric value
must include a source path and evidence string, or its confidence must be below `1.0`.

Add new EDA targets as flow adapters that consume only the canonical SRAM spec. Emitters should not
re-parse raw source files or ask an agent to infer facts.

Add new review rules under `src/review/`. Keep deterministic checks separate from Cursor SDK
self-review so CI can run without an API key.

The Cursor SDK layer is optional by design. `agent-run` adds planning and critique, but the generated
facts and flow files remain reproducible from source views.

## Ralph Loop Close-Out

Iterations 1-10 are summarized in `docs/ralph-loop-iteration-1-10-summary.md`.
That report separates the reusable SRAM spec-to-flow architecture from both SRAM22-specific source logic and OpenROAD-specific EDA adapter logic.

## Current Limits

- The prototype focuses on SRAM22 and a golden path macro, `sram22_64x32m4w8`.
- It emits OpenROAD smoke scripts and a bounded smoke-run command, but full dynamic execution still requires OpenROAD/OpenLane/Yosys or a pinned container.
- The OpenLane clock period is traced from SRAM22 Liberty `minimum_period`, but the timing policy is still smoke-oriented, not signoff-oriented.
- GDS is included when present as `.gds` or `.gds.gz`; missing GDS is reported as `missing_gds`
  rather than fabricated.
- Memory-semantics SVA is intentionally scaffolded with explicit TODO/confidence markers until stronger blackbox-equivalence evidence is added.

## Human-in-the-loop (`agent:run`)

`agent-run` can load a YAML (or JSON) requirements file before extraction. The resolved intent is written to `outputs/<run-id>/human-intent.json` (and `human-intent-source.json` for provenance).

```bash
CURSOR_API_KEY=... npm run agent:run -- --requirements prototypes/cursor-sdk-sram-workflow/examples/flow-requirements.sram22-64x32.yaml --run-id hitl-demo
```

Use `--interactive` when macro selection by constraints matches more than one macro; the CLI will prompt for a choice.

## Verification

```bash
npm test
npm run typecheck
npm run demo:extract -- sram22_64x32m4w8 --run-id verify-demo
npm run flow:quality -- verify-demo
npm run smoke-run -- verify-demo
```
