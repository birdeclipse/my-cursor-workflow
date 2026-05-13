# Ralph Loop Iterations 1-10 Summary

This report closes the SRAM22 Ralph loop after iteration 10. The prototype now turns SRAM22 macro views into a provenance-rich structured spec, emits flow setup artifacts, checks those artifacts deterministically, and records tool-smoke readiness without fabricating OpenROAD success when the local toolchain is missing.

The saved iteration outputs live under `outputs/ralph-openroad-iteration-1/` through `outputs/ralph-openroad-iteration-10/`.

## Executive Finding

The workflow improved from a static SRAM KB and partial OpenLane stub into a traceable spec-to-flow package with:

- Source-backed spec extraction from SRAM22 macro views.
- Generated wrapper RTL, OpenLane config, Hammer SRAM cache, SDC, OpenROAD TCL, and OpenROAD runner.
- Pin protocol semantics and SVA sidecars derived from behavioral Verilog.
- Deterministic flow-quality checks for required keys, paths, SDC, SVA, TCL, runner hygiene, and tool availability.
- Verilator syntax smoke for generated wrapper/SVA.
- Machine-readable smoke reports and OpenROAD log/exec classification.

Current dynamic OpenROAD execution remains blocked by local environment, not by missing emitted scripts:

- `openroad`: missing
- `openlane`: missing
- `yosys`: missing
- `verilator`: available
- Generated wrapper/SVA Verilator lint: passed
- Static flow-quality errors: 0
- Static flow-quality warnings: 0
- Remaining findings: informational prototype metadata and explicit memory-semantics TODO scaffold

## Iteration Timeline

### Iteration 1: Make Flow Quality Measurable

Output: `outputs/ralph-openroad-iteration-1/`

The first loop added a repeatable `iteration-report.md` and deterministic flow-quality analyzer. It checked OpenLane required keys, SDC clock consistency, referenced view paths, and OpenROAD binary availability.

Finding: the first OpenLane config was not runnable yet. It missed `VERILOG_FILES` and `CLOCK_NET`, and used a low-confidence default clock period.

Why it mattered: before this point, the workflow could emit files but could not explain whether those files were flow-ready.

### Iteration 2: Generate Wrapper RTL and Required OpenLane Fields

Output: `outputs/ralph-openroad-iteration-2/`

The second loop generated `<macro>_wrapper.v`, added `VERILOG_FILES`, `VERILOG_FILES_BLACKBOX`, and `CLOCK_NET`, and expanded path checks to cover wrapper RTL and blackbox Verilog.

Finding: OpenLane required-key errors dropped to zero. The main remaining issue was clock-period provenance.

Why it mattered: the emitted OpenLane folder became structurally complete enough for static flow review.

### Iteration 3: Replace Placeholder Timing with Liberty Provenance

Output: `outputs/ralph-openroad-iteration-3/`

The third loop parsed SRAM22 Liberty `minimum_period` constraints on `clk`, selected the worst available corner, added `timing.clockPeriodNs` to the structured spec, and emitted `CLOCK_PERIOD` plus SDC `create_clock` from that traced value.

Finding: low-confidence clock warnings disappeared. The clock period became re-derivable from source views.

Why it mattered: timing constraints moved from prototype assumption to source-backed KB data.

### Iteration 4: Add Pin Semantics and SVA Sidecars

Output: `outputs/ralph-openroad-iteration-4/`

The fourth loop extracted interface protocol evidence from behavioral Verilog:

- Clock edge: `posedge clk`
- Active-cycle gating: `ce && rstb`
- Reset polarity: active-low `rstb`
- Write/read conditions through `we`
- `wmask` lane mapping from Verilog slices

It added `interfaceProtocol` to the structured spec and emitted:

- `<macro>_protocol_assumptions.sv`
- `<macro>_memory_semantics_checker.sv`

Finding: protocol assumptions became explicit and bindable. Memory semantics remained a declared scaffold because full blackbox memory equivalence needs more evidence.

Why it mattered: the KB stopped being only "files and dimensions" and started capturing behavioral contracts around pins.

### Iteration 5: Add Planner-Ready Flow Smoke Report

Output: `outputs/ralph-openroad-iteration-5/`

The fifth loop introduced `flow-smoke-report.json`, which records tool probes for OpenROAD, OpenLane, Yosys, and Verilator, along with static flow-quality counts.

Finding: the workflow could now distinguish "generated artifact problem" from "local EDA tool unavailable."

Why it mattered: later agent planning can consume a structured blocker instead of rediscovering missing binaries from prose.

### Iteration 6: Use Verilator as an Available Executable Gate

Output: `outputs/ralph-openroad-iteration-6/`

The sixth loop added Verilator syntax lint plans for:

- Wrapper RTL
- Protocol SVA
- Memory semantics SVA

Each top is linted separately to avoid false multi-top failures.

Finding: generated HDL/SVA sidecars are syntactically parseable by Verilator. Full OpenROAD/OpenLane execution still remained unavailable.

Why it mattered: the workflow gained a real executable verification step even before OpenROAD is installed.

### Iteration 7: Emit OpenROAD Smoke TCL

Output: `outputs/ralph-openroad-iteration-7/`

The seventh loop emitted `openroad-smoke.tcl`. The script reads LEF, Liberty, wrapper RTL, macro Verilog, links the wrapper, reads SDC, and runs `report_checks`.

Finding: the emitted directory gained a deterministic OpenROAD command surface. Flow-quality checks now statically audit key OpenROAD TCL commands.

Why it mattered: tool availability remained a blocker, but the artifact bundle became more runnable.

### Iteration 8: Add Cwd-Safe OpenROAD Runner

Output: `outputs/ralph-openroad-iteration-8/`

The eighth loop emitted `run-openroad-smoke.sh`, which:

- Uses strict shell mode.
- Changes to the macro output directory.
- Checks `openroad` on `PATH`.
- Runs `openroad -exit openroad-smoke.tcl`.
- Tees output to `openroad-smoke.log`.

Finding: future OpenROAD runs now have a stable command and stable log path.

Why it mattered: the loop eliminated an avoidable class of "ran from wrong directory" and "lost log" failures.

### Iteration 9: Classify OpenROAD Smoke Logs

Output: `outputs/ralph-openroad-iteration-9/`

The ninth loop added `openroad-smoke-log-report.json`, with `not_run` status when no log exists and classifications for:

- Missing input files
- Link failures
- OpenROAD errors
- OpenROAD warnings

Finding: the workflow can now convert future raw OpenROAD logs into planner-readable failure classes.

Why it mattered: dynamic EDA output becomes feedback for the next planning step instead of manual text inspection.

### Iteration 10: Add Repeatable Smoke Execution/Refresh

Output: `outputs/ralph-openroad-iteration-10/`

The final loop added a `smoke-run` command and `openroad-smoke-exec-report.json`. The command resolves a prior run, probes OpenROAD, runs `run-openroad-smoke.sh` with bounded process capture when possible, optionally supports a conservative Docker path, refreshes log classification, and prints a JSON envelope for harness use.

Finding: on this machine the execution report is honest:

```json
{
  "mode": "skipped_openroad_unavailable",
  "commandAttempted": null,
  "exitCode": null
}
```

Why it mattered: the workflow now has a safe "try dynamic smoke" step that does not hang or pretend success when OpenROAD is absent.

## Final Health Snapshot

The final saved run is `outputs/ralph-openroad-iteration-10/`.

Important artifacts:

- `outputs/ralph-openroad-iteration-10/iteration-report.md`
- `outputs/ralph-openroad-iteration-10/run-report.json`
- `outputs/ralph-openroad-iteration-10/sram22_64x32m4w8/spec.yaml`
- `outputs/ralph-openroad-iteration-10/sram22_64x32m4w8/spec.json`
- `outputs/ralph-openroad-iteration-10/sram22_64x32m4w8/sram-cache.json`
- `outputs/ralph-openroad-iteration-10/sram22_64x32m4w8/openlane.config.json`
- `outputs/ralph-openroad-iteration-10/sram22_64x32m4w8/base.sdc`
- `outputs/ralph-openroad-iteration-10/sram22_64x32m4w8/openroad-smoke.tcl`
- `outputs/ralph-openroad-iteration-10/sram22_64x32m4w8/run-openroad-smoke.sh`
- `outputs/ralph-openroad-iteration-10/sram22_64x32m4w8/flow-smoke-report.json`
- `outputs/ralph-openroad-iteration-10/sram22_64x32m4w8/openroad-smoke-log-report.json`
- `outputs/ralph-openroad-iteration-10/sram22_64x32m4w8/openroad-smoke-exec-report.json`

Final quality state:

- OpenLane required fields: present.
- Referenced source views and generated RTL paths: readable.
- Clock period: traced from Liberty.
- Protocol assumptions SVA: emitted and Verilator-clean.
- Memory semantics checker: emitted as explicit TODO scaffold and Verilator-clean.
- OpenROAD TCL: emitted and statically checked.
- OpenROAD runner: emitted, executable, cwd-safe, and statically checked.
- OpenROAD execution: skipped because `openroad` is not installed.

## Generalized SRAM EDA Workflow Architecture

The architecture that emerged is not only an OpenROAD flow and not only an SRAM22 compiler wrapper. The intended target is a general SRAM EDA integration workflow: take any SRAM macro family or SRAM compiler output, extract a source-traceable SRAM KB, and emit validated setup artifacts for multiple downstream EDA flows.

OpenROAD/SRAM22 is the first concrete adapter pair:

- SRAM source adapter: `sram22`
- EDA flow adapter: `openroad` / `openlane` / `hammer`

The durable architecture should treat those as replaceable plugins around a common SRAM core.

```text
Source artifacts
  .lib / .lef / .v / .spice / .gds / compiler configs / datasheets / docs
        |
        v
SRAM source adapters
  SRAM22 / OpenRAM / vendor compiler / foundry SRAM IP / custom macro family
        |
        v
Deterministic SRAM extractors
  parse names, views, dimensions, ports, timing, power, protocol, pin semantics
        |
        v
Canonical SRAM KB
  typed schema + traced values + confidence + validation issues + flow intents
        |
        v
EDA flow adapters
  OpenLane / OpenROAD / Hammer / commercial P&R / formal / STA / simulation
        |
        v
Static quality gates
  schema, path, config, SDC, SVA, script, runner checks
        |
        v
Executable smoke gates
  Verilator, OpenROAD, containers, future vendor tools
        |
        v
Machine-readable reports
  run report, iteration report, flow smoke, exec report, log classification
        |
        v
Agent planner/reviewer loop
  choose one improvement, implement, verify, record why/how
```

### Reusable SRAM Core

These parts should be generalized beyond SRAM22 and OpenROAD:

- `SourceInventory`: discover source views, versions, provenance, and missing critical files.
- `SramSourceAdapterRegistry`: adapters for SRAM22, OpenRAM, foundry SRAM IP, vendor compiler drops, and hand-authored SRAM macro families.
- `ExtractorRegistry`: small deterministic parsers that emit typed SRAM facts with source references.
- `CanonicalSramSpec`: technology-neutral SRAM KB with dimensions, ports, timing, power, views, pin semantics, capabilities, and validation issues.
- `EdaFlowAdapterRegistry`: backend-specific emitters that consume only `CanonicalSramSpec`.
- `QualityRuleRegistry`: deterministic checks over emitted artifacts.
- `ToolProbeRegistry`: version and availability probes for external tools.
- `SmokeRunner`: bounded execution with stdout/stderr capture and timeout.
- `LogClassifier`: maps tool logs into stable failure classes.
- `IterationLedger`: saves goals, why/how, generated outputs, verification commands, and findings.
- `AgentOrchestrator`: self-planning and self-review layer that reads structured reports rather than raw logs.

### SRAM Source Adapter Layer

The SRAM source adapter is responsible for normalizing different SRAM origins into the same canonical KB. It should hide source-format differences from the flow emitters.

Examples:

- `sram22`: parse macro-name grammar, Rust/TOML metadata when available, generated Verilog, Liberty, LEF, SPICE, GDS.
- `openram`: parse OpenRAM naming/config conventions, emitted datasheets, Liberty, LEF, GDS, SPICE, and Verilog.
- `foundry-sram`: parse vendor memory compiler reports, Liberty views, abstract views, Verilog models, and datasheet tables.
- `custom-sram`: support hand-authored macros where datasheet facts and view triangulation may have different confidence.

The adapter output should be the same shape regardless of source:

```typescript
interface SramSourceAdapter {
  id: string;
  discover(root: string): Promise<SramSourceInventory[]>;
  extract(input: SramSourceInventory): Promise<CanonicalSramSpec>;
  validate(spec: CanonicalSramSpec): SramValidationIssue[];
}
```

No EDA backend should need to know whether the SRAM came from SRAM22, OpenRAM, a foundry compiler, or a custom macro.

### EDA Flow Adapter Layer

The EDA flow adapter is responsible for turning the canonical SRAM KB into tool-specific integration artifacts. It should hide tool command language, config file shape, tool probes, smoke commands, and log classifiers from the SRAM extractors.

Candidate adapters:

- `openlane`: `config.json` / `config.tcl`, macro integration keys, SDC, wrapper references.
- `openroad`: TCL smoke scripts, timing checks, log classification.
- `hammer`: `sram-cache.json`, technology plugin integration, hierarchical flow hooks.
- `commercial-sta`: PrimeTime/Tempus-style Liberty/Verilog/SDC load scripts and timing report classifiers.
- `commercial-pnr`: Innovus/ICC2-style macro placement/import templates and log classifiers.
- `formal`: SVA bind files, interface assumptions, memory blackbox wrappers.
- `simulation`: Verilog/SystemVerilog test harnesses and compile scripts.

Each adapter should emit artifacts, define static checks, probe tools, attempt bounded smoke execution, and classify logs.

### OpenROAD-Specific Adapter

These should stay adapter-specific:

- `openroad-smoke.tcl` generation.
- `run-openroad-smoke.sh`.
- OpenROAD TCL command audits such as `read_lef`, `read_liberty`, `read_verilog`, `link_design`, `read_sdc`, `report_checks`.
- OpenROAD log classifiers for link failures, missing file diagnostics, and OpenROAD warning/error syntax.
- OpenROAD/OpenLane/Yosys tool probes.
- OpenLane config keys such as `EXTRA_LEFS`, `EXTRA_LIBS`, `EXTRA_GDS_FILES`, `VERILOG_FILES_BLACKBOX`, `CLOCK_NET`, and `CLOCK_PORT`.

### General Adapter Shape

Any EDA backend should implement the same interface shape:

```typescript
interface EdaFlowAdapter {
  id: string;
  emit(spec: CanonicalSramSpec): EmittedFile[];
  qualityRules(): QualityRule[];
  toolProbes(): ToolProbe[];
  smokePlan(run: EmittedRun): SmokePlan;
  classifyLog(logText: string): ToolFinding[];
}
```

This makes OpenROAD one adapter among several. A Hammer adapter, Synopsys adapter, Cadence adapter, or FPGA adapter should plug into the same loop as long as it can emit files, validate static requirements, probe tools, run bounded smoke, and classify logs.

### Adapter Boundary Rule

The key rule is one-way dependency:

- SRAM source adapters produce canonical SRAM facts.
- EDA flow adapters consume canonical SRAM facts.
- Agents read reports and choose improvements.

No flow adapter should re-parse raw SRAM source views. No source adapter should emit OpenROAD/OpenLane/Hammer files. This keeps the workflow extensible across both axes: new SRAM compilers and new EDA tools.

## What Generalizes Well

The strongest general pattern is the separation between facts, templates, and decisions:

- Facts come from deterministic extractors.
- Templates come from flow adapters.
- Decisions come from agents reading structured reports.

This prevents the LLM from inventing numeric constraints or hidden tool behavior. The agent can decide what to improve next, but the emitted numbers and flow inputs still trace back to source files or explicit low-confidence placeholders.

The report loop also generalizes well. Each iteration answers the same questions:

- What failed or remained weak?
- Why does that matter for flow readiness?
- What deterministic improvement was added?
- Which files changed or were generated?
- Which checks passed?
- What remains blocked by environment?

## What Does Not Generalize Automatically

The SRAM-specific parts need replacement for other IP families:

- Macro-name parsing such as `sram22_{words}x{width}m{mux}w{wmask}`.
- SRAM-specific ports such as `clk`, `ce`, `we`, `rstb`, `wmask`, `addr`, `din`, `dout`.
- Memory protocol SVA assumptions.
- Liberty `minimum_period` policy for SRAM clocking.
- Hammer SRAM cache schema details.

The OpenROAD-specific parts also need replacement for other flow backends:

- TCL command sequence.
- OpenLane JSON keys.
- OpenROAD log regexes.
- Container image assumptions.
- Tool availability probes.

## Recommended Next Architecture Step

Stop the Ralph loop here and refactor the prototype into a backend-neutral, SRAM-centered adapter boundary:

```text
src/core/
  inventory
  provenance
  schema
  reports
  quality
  smoke

src/domains/sram/
  canonical schema
  protocol semantics
  SRAM-specific validators

src/sram-sources/
  sram22
  openram
  foundry-compiler
  custom-macro

src/eda-adapters/
  openlane
  openroad
  hammer
  formal
  simulation
  commercial-sta
  commercial-pnr

src/agent/
  Cursor SDK planner
  self-review prompts
  iteration ledger
```

The immediate value of that refactor is not abstraction for its own sake. It makes it possible to add a new SRAM source adapter without disturbing EDA flow emitters, and to add a new EDA adapter without rewriting SRAM extraction. SRAM22 and OpenROAD remain the first reference implementation, not the architecture boundary.

Implementation status:

- `src/core/` now contains shared artifact, quality, and smoke contracts.
- `src/domains/sram/` now exposes canonical SRAM aliases and `SramSourceAdapter`.
- `src/sram-sources/sram22/` now wraps SRAM22 discovery/extraction as the first source adapter.
- `src/eda-adapters/` now contains Hammer, OpenLane, OpenROAD, and verification adapters.
- `extract`, `extract --all`, `discover`, `flow-quality`, and `smoke-run` keep their user-facing command shape while routing through the new source/flow registries where applicable.

## Closure

The 10-iteration loop achieved its intended research outcome: it turned a cold-start SRAM22 corpus into a working, traceable, reviewable spec-to-flow prototype. The remaining blocker is environmental, not conceptual: OpenROAD/OpenLane/Yosys need to be installed locally or supplied through a pinned container before full dynamic smoke can run.

The loop should stop here. Further work should be tracked as architecture/refactor tasks rather than more Ralph iterations.
