import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { CURSOR_SDK_MODEL_ID, runSdkPlanningAndReview } from "../src/sdk/agentRunner.js";

describe("Cursor SDK orchestration", () => {
  test("uses Composer as the explicit local SDK model", () => {
    expect(CURSOR_SDK_MODEL_ID).toBe("composer-2");
  });

  test("streams agent events to jsonl and waits for plan and review runs", async () => {
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "sram-agent-"));
    const eventLogPath = path.join(outputRoot, "agent-events.jsonl");
    const sentPrompts: string[] = [];

    try {
      const result = await runSdkPlanningAndReview({
        apiKey: "test-key",
        cwd: process.cwd(),
        planningPrompt: "plan prompt",
        collateralPrompt: "collateral prompt",
        reviewPrompt: "review prompt",
        eventLogPath,
        createAgent: async () => ({
          agentId: "agent-test",
          async send(message: string) {
            sentPrompts.push(message);
            return {
              id: `run-${sentPrompts.length}`,
              agentId: "agent-test",
              async *stream() {
                yield { type: "assistant", message: { content: [{ type: "text", text: "ok" }] } };
                yield { type: "tool_call", name: "Read", status: "completed" };
              },
              async wait() {
                return { status: "finished", result: `result-${sentPrompts.length}` };
              },
              supports(operation: string) {
                return operation === "conversation";
              },
              async conversation() {
                return [{ type: "agent", steps: [] }];
              },
            };
          },
          async [Symbol.asyncDispose]() {},
        }),
      });

      const eventLines = (await readFile(eventLogPath, "utf8")).trim().split("\n");
      expect(sentPrompts).toEqual(["plan prompt", "collateral prompt", "review prompt"]);
      expect(result.plan.status).toBe("finished");
      expect(result.verificationCollateral.status).toBe("finished");
      expect(result.review.status).toBe("finished");
      expect(eventLines.length).toBe(6);
      expect(JSON.parse(eventLines[1] ?? "{}")).toMatchObject({
        phase: "planning",
        type: "tool_call",
        name: "Read",
      });
      expect(JSON.parse(eventLines[2] ?? "{}")).toMatchObject({
        phase: "verification-collateral",
        type: "assistant",
      });
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  test("runs convergence prompts in role order and stops on accept", async () => {
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "sram-agent-"));
    const eventLogPath = path.join(outputRoot, "agent-events.jsonl");
    const sentPrompts: string[] = [];

    try {
      const result = await runSdkPlanningAndReview({
        apiKey: "test-key",
        cwd: process.cwd(),
        planningPrompt: "plan prompt",
        collateralPrompt: "collateral prompt",
        reviewPrompt: "review prompt",
        eventLogPath,
        convergence: {
          maxIterations: 3,
          intentPrompt: "intent prompt",
          translationPrompt: "translation prompt",
          reviewerPrompt: "reviewer prompt",
          decideIteration: () => ({ status: "accept", rationale: "clean" }),
        },
        createAgent: async () => ({
          agentId: "agent-test",
          async send(message: string) {
            sentPrompts.push(message);
            return {
              id: `run-${sentPrompts.length}`,
              agentId: "agent-test",
              async *stream() {
                yield { type: "assistant", message: { content: [{ type: "text", text: message }] } };
              },
              async wait() {
                return { status: "finished", result: message };
              },
              supports() {
                return false;
              },
              async conversation() {
                return [];
              },
            };
          },
          async [Symbol.asyncDispose]() {},
        }),
      });

      expect(sentPrompts).toEqual([
        "plan prompt",
        "collateral prompt",
        "intent prompt",
        "translation prompt",
        "reviewer prompt",
        "review prompt",
      ]);
      expect(result.convergence?.status).toBe("accept");
      expect(result.convergence?.iterations).toHaveLength(1);
      const eventPhases = (await readFile(eventLogPath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line).phase);
      expect(eventPhases).toContain("spec-intention-extraction");
      expect(eventPhases).toContain("sva-translation");
      expect(eventPhases).toContain("spec-review");
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  test("blocks convergence after repeated failure", async () => {
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "sram-agent-"));
    const eventLogPath = path.join(outputRoot, "agent-events.jsonl");

    try {
      const result = await runSdkPlanningAndReview({
        apiKey: "test-key",
        cwd: process.cwd(),
        planningPrompt: "plan prompt",
        collateralPrompt: "collateral prompt",
        reviewPrompt: "review prompt",
        eventLogPath,
        convergence: {
          maxIterations: 3,
          intentPrompt: "intent prompt",
          translationPrompt: "translation prompt",
          reviewerPrompt: "reviewer prompt",
          decideIteration: () => ({ status: "revise", rationale: "same issue", repeatedFindingCodes: ["lint_error"] }),
        },
        createAgent: async () => ({
          agentId: "agent-test",
          async send() {
            return {
              id: "run",
              agentId: "agent-test",
              async *stream() {
                yield { type: "assistant", message: { content: [{ type: "text", text: "retry" }] } };
              },
              async wait() {
                return { status: "finished", result: "retry" };
              },
              supports() {
                return false;
              },
              async conversation() {
                return [];
              },
            };
          },
          async [Symbol.asyncDispose]() {},
        }),
      });

      expect(result.convergence?.status).toBe("blocked");
      expect(result.convergence?.iterations).toHaveLength(2);
      expect(result.convergence?.decision.rationale).toContain("Repeated convergence finding");
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });
});
