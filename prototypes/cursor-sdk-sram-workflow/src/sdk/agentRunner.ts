import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { Agent, CursorAgentError } from "@cursor/sdk";
import type { ConvergenceDecision } from "../verification-collateral/schema.js";

export const CURSOR_SDK_MODEL_ID = "composer-2";

export type WorkflowPhase =
  | "planning"
  | "verification-collateral"
  | "spec-intention-extraction"
  | "sva-translation"
  | "spec-review"
  | "review";

export interface WorkflowEvent {
  type: string;
  message?: {
    content?: Array<{ type: string; text?: string }>;
  };
  name?: string;
  status?: string;
}

interface WorkflowRunResult {
  status: string;
  result?: string;
}

interface WorkflowRun {
  id: string;
  agentId: string;
  stream(): AsyncGenerator<WorkflowEvent, void>;
  wait(): Promise<WorkflowRunResult>;
  supports(operation: string): boolean;
  conversation(): Promise<unknown>;
}

export interface WorkflowAgent {
  agentId: string;
  send(message: string): Promise<WorkflowRun>;
  [Symbol.asyncDispose](): Promise<void>;
}

export interface RunSdkPlanningAndReviewOptions {
  apiKey: string;
  cwd: string;
  planningPrompt: string;
  collateralPrompt: string;
  reviewPrompt: string;
  eventLogPath: string;
  convergence?: SdkConvergenceOptions;
  onEvent?: (event: WorkflowStreamEvent) => Promise<void> | void;
  createAgent?: () => Promise<WorkflowAgent>;
}

export interface SdkPhaseResult {
  runId: string;
  status: string;
  result?: string;
  conversation?: unknown;
}

export interface SdkPlanningAndReviewResult {
  agentId: string;
  plan: SdkPhaseResult;
  verificationCollateral: SdkPhaseResult;
  convergence?: SdkConvergenceResult;
  review: SdkPhaseResult;
}

export interface SdkConvergenceOptions {
  maxIterations?: number;
  intentPrompt: string | ((iteration: number, previousDecision?: ConvergenceDecision) => string);
  translationPrompt: string | ((iteration: number, intent: SdkPhaseResult, previousDecision?: ConvergenceDecision) => string);
  reviewerPrompt: string | ((iteration: number, proposal: SdkPhaseResult, previousDecision?: ConvergenceDecision) => string);
  decideIteration?: (iteration: number, phases: {
    intent: SdkPhaseResult;
    proposal: SdkPhaseResult;
    review: SdkPhaseResult;
  }) => ConvergenceDecision;
}

export interface SdkConvergenceIterationResult {
  iteration: number;
  intent: SdkPhaseResult;
  proposal: SdkPhaseResult;
  review: SdkPhaseResult;
  decision: ConvergenceDecision;
}

export interface SdkConvergenceResult {
  status: ConvergenceDecision["status"];
  decision: ConvergenceDecision;
  iterations: SdkConvergenceIterationResult[];
}

type WorkflowLifecycleEventType = "phase_start" | "stream_event" | "phase_end";

export interface WorkflowStreamEvent {
  phase: WorkflowPhase;
  lifecycle: WorkflowLifecycleEventType;
  runId?: string;
  prompt?: string;
  event?: WorkflowEvent;
  result?: SdkPhaseResult;
}

function extractAssistantText(event: WorkflowEvent): string | undefined {
  const content = event.message?.content ?? [];
  return content
    .filter((block) => block.type === "text" && block.text !== undefined)
    .map((block) => block.text)
    .join("");
}

async function writeEvent(eventLogPath: string, phase: WorkflowPhase, event: WorkflowEvent): Promise<void> {
  await mkdir(path.dirname(eventLogPath), { recursive: true });
  const record = {
    phase,
    type: event.type,
    name: event.name,
    status: event.status,
    text: extractAssistantText(event),
  };
  await appendFile(eventLogPath, `${JSON.stringify(record)}\n`, "utf8");
}

async function runPhase(
  agent: WorkflowAgent,
  phase: WorkflowPhase,
  prompt: string,
  eventLogPath: string,
  onEvent?: (event: WorkflowStreamEvent) => Promise<void> | void,
): Promise<SdkPhaseResult> {
  const run = await agent.send(prompt);
  await onEvent?.({ phase, lifecycle: "phase_start", runId: run.id, prompt });
  for await (const event of run.stream()) {
    await writeEvent(eventLogPath, phase, event);
    await onEvent?.({ phase, lifecycle: "stream_event", runId: run.id, event });
  }
  const result = await run.wait();
  if (result.status === "error") {
    throw new Error(`Cursor SDK ${phase} run failed: ${run.id}`);
  }
  const conversation = run.supports("conversation") ? await run.conversation() : undefined;
  const phaseResult = {
    runId: run.id,
    status: result.status,
    result: result.result,
    conversation,
  };
  await onEvent?.({ phase, lifecycle: "phase_end", runId: run.id, result: phaseResult });
  return phaseResult;
}

function resolvePrompt<T extends unknown[]>(
  prompt: string | ((...args: T) => string),
  ...args: T
): string {
  return typeof prompt === "string" ? prompt : prompt(...args);
}

function parseDecisionFromReview(result: string | undefined): ConvergenceDecision {
  if (result !== undefined) {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch !== null) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as Partial<ConvergenceDecision>;
        if (parsed.status === "accept" || parsed.status === "revise" || parsed.status === "blocked") {
          return { status: parsed.status, rationale: parsed.rationale ?? "reviewer JSON decision", repeatedFindingCodes: parsed.repeatedFindingCodes };
        }
      } catch {
        // Fall through to conservative prose classification.
      }
    }
    if (/\bblocked\b/i.test(result)) return { status: "blocked", rationale: "reviewer prose requested blocked stop" };
    if (/\brevise\b/i.test(result)) return { status: "revise", rationale: "reviewer prose requested revision" };
  }
  return { status: "accept", rationale: "reviewer did not report blocking findings" };
}

function repeatedFindingBlocked(
  current: ConvergenceDecision,
  findingCounts: Map<string, number>,
): ConvergenceDecision | undefined {
  for (const code of current.repeatedFindingCodes ?? []) {
    const nextCount = (findingCounts.get(code) ?? 0) + 1;
    findingCounts.set(code, nextCount);
    if (nextCount >= 2) {
      return {
        status: "blocked",
        rationale: `Repeated convergence finding '${code}' appeared ${nextCount} times.`,
        repeatedFindingCodes: [code],
      };
    }
  }
  return undefined;
}

async function runSvaConvergenceLoop(
  agent: WorkflowAgent,
  options: SdkConvergenceOptions,
  eventLogPath: string,
  onEvent?: (event: WorkflowStreamEvent) => Promise<void> | void,
): Promise<SdkConvergenceResult> {
  const iterations: SdkConvergenceIterationResult[] = [];
  const findingCounts = new Map<string, number>();
  let previousDecision: ConvergenceDecision | undefined;
  const maxIterations = options.maxIterations ?? 3;

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const intent = await runPhase(
      agent,
      "spec-intention-extraction",
      resolvePrompt(options.intentPrompt, iteration, previousDecision),
      eventLogPath,
      onEvent,
    );
    const proposal = await runPhase(
      agent,
      "sva-translation",
      resolvePrompt(options.translationPrompt, iteration, intent, previousDecision),
      eventLogPath,
      onEvent,
    );
    const review = await runPhase(
      agent,
      "spec-review",
      resolvePrompt(options.reviewerPrompt, iteration, proposal, previousDecision),
      eventLogPath,
      onEvent,
    );
    const reviewerDecision = options.decideIteration?.(iteration, { intent, proposal, review }) ?? parseDecisionFromReview(review.result);
    const blockedDecision =
      reviewerDecision.status === "revise" ? repeatedFindingBlocked(reviewerDecision, findingCounts) : undefined;
    const decision = blockedDecision ?? reviewerDecision;
    iterations.push({ iteration, intent, proposal, review, decision });
    previousDecision = decision;
    if (decision.status === "accept" || decision.status === "blocked") {
      return { status: decision.status, decision, iterations };
    }
  }

  const decision: ConvergenceDecision = {
    status: "blocked",
    rationale: `Reached maximum convergence iterations (${maxIterations}) without accept.`,
  };
  return { status: "blocked", decision, iterations };
}

export interface CreateWorkflowAgentOptions {
  apiKey: string;
  cwd: string;
}

export async function createWorkflowAgent(options: CreateWorkflowAgentOptions): Promise<WorkflowAgent> {
  const sdkAgent = await Agent.create({
    apiKey: options.apiKey,
    model: { id: CURSOR_SDK_MODEL_ID },
    local: { cwd: options.cwd, settingSources: ["project"] },
    agents: {
      "sram-extractor-reviewer": {
        description: "Reviews extracted SRAM specs for source traceability and view consistency.",
        prompt:
          "Review SRAM structured specs for fabricated values, missing provenance, and disagreement across Verilog, LEF, SPICE, Liberty, and macro-name facts.",
      },
      "eda-flow-reviewer": {
        description: "Reviews emitted OpenLane, Hammer, and OpenROAD setup files for EDA-flow readiness.",
        prompt:
          "Review SRAM EDA flow setup artifacts for missing macro views, unsafe assumptions, and incorrect OpenLane/Hammer/OpenROAD variables.",
      },
      "sram-verification-collateral-generator": {
        description: "Generates source-backed SystemVerilog assertions, covers, and scoreboard ideas from SRAM specs.",
        prompt:
          "Generate maximal SRAM verification collateral only from structured spec facts. Do not invent timing, latency, reset, or internal implementation facts without source evidence.",
      },
      "spec-intention-extractor": {
        description: "Extracts source-backed verification intent from SRAM structured specs.",
        prompt:
          "Read SRAM spec JSON and output only machine-readable intent JSON: protocol facts, lanes, non-derivable boundaries, optional assumptions, and evidence paths.",
      },
      "sva-translator": {
        description: "Translates SRAM verification intent into structured property proposals.",
        prompt:
          "Output only JSON property proposals with id, role, category, confidence, sourceRefs, strictness, and svaBody. Never emit final SVA prose.",
      },
      "spec-reviewer": {
        description: "Reviews property proposals for provenance, lintability, and overclaiming.",
        prompt:
          "Reject tautological, unsourced, overclaiming, unsupported, or unlintable SRAM properties. Output JSON decision: accept, revise, or blocked.",
      },
    },
  });

  return {
    agentId: sdkAgent.agentId,
    async send(message: string) {
      return (await sdkAgent.send(message)) as unknown as WorkflowRun;
    },
    async [Symbol.asyncDispose]() {
      await sdkAgent[Symbol.asyncDispose]();
    },
  };
}

export async function runSdkPlanningAndReview(
  options: RunSdkPlanningAndReviewOptions,
): Promise<SdkPlanningAndReviewResult> {
  const agentFactory = options.createAgent ?? (() => createWorkflowAgent(options));
  let agent: WorkflowAgent | undefined;
  try {
    agent = await agentFactory();
    const plan = await runPhase(agent, "planning", options.planningPrompt, options.eventLogPath, options.onEvent);
    const verificationCollateral = await runPhase(
      agent,
      "verification-collateral",
      options.collateralPrompt,
      options.eventLogPath,
      options.onEvent,
    );
    const convergence =
      options.convergence === undefined
        ? undefined
        : await runSvaConvergenceLoop(agent, options.convergence, options.eventLogPath, options.onEvent);
    const review = await runPhase(agent, "review", options.reviewPrompt, options.eventLogPath, options.onEvent);
    return {
      agentId: agent.agentId,
      plan,
      verificationCollateral,
      convergence,
      review,
    };
  } catch (error: unknown) {
    if (error instanceof CursorAgentError) {
      throw new Error(`Cursor SDK startup failed: ${error.message}`);
    }
    throw error;
  } finally {
    if (agent !== undefined) {
      await agent[Symbol.asyncDispose]();
    }
  }
}
