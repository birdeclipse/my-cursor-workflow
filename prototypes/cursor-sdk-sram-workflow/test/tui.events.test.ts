import { describe, expect, test } from "vitest";

import {
  createInitialTuiSessionState,
  normalizeWorkflowStreamEvent,
  parseClarificationRequest,
  reduceTuiState,
} from "../src/tui/events.js";

describe("TUI event model", () => {
  test("parses strict clarification blocks", () => {
    const parsed = parseClarificationRequest(`some text
CLARIFICATION_REQUEST:
question: Which flow should we prioritize?
choices: openlane|openroad|hammer
required: true`);

    expect(parsed).toEqual({
      question: "Which flow should we prioritize?",
      choices: ["openlane", "openroad", "hammer"],
      required: true,
    });
  });

  test("normalizes tool call stream events", () => {
    const normalized = normalizeWorkflowStreamEvent({
      phase: "planning",
      lifecycle: "stream_event",
      runId: "run-1",
      event: { type: "tool_call", name: "Read", status: "completed" },
    });
    expect(normalized).toEqual([
      {
        type: "tool_call",
        phase: "planning",
        runId: "run-1",
        name: "Read",
        status: "completed",
      },
    ]);
  });

  test("reduces state for clarification lifecycle", () => {
    const initial = createInitialTuiSessionState();
    const requested = reduceTuiState(initial, {
      type: "clarification_requested",
      question: "Choose one",
      choices: ["a", "b"],
      required: true,
    });
    expect(requested.clarification?.question).toBe("Choose one");
    const answered = reduceTuiState(requested, {
      type: "clarification_answered",
      answer: "a",
    });
    expect(answered.clarification).toBeUndefined();
    expect(answered.assistantLines.join("\n")).toContain("User answer: a");
    expect(answered.conversation[0]).toEqual({ role: "user", text: "a" });
  });

  test("merges tokenized stream chunks into readable lines", () => {
    const initial = createInitialTuiSessionState();
    const withFirstChunk = reduceTuiState(initial, {
      type: "assistant_chunk",
      phase: "planning",
      runId: "run-1",
      text: "we` quiet",
    });
    const withSecondChunk = reduceTuiState(withFirstChunk, {
      type: "assistant_chunk",
      phase: "planning",
      runId: "run-1",
      text: " during `rstb\n==0`.",
    });
    expect(withSecondChunk.assistantLines).toEqual(["we` quiet during `rstb", "==0`."]);
  });

  test("stores explicit user and assistant history entries", () => {
    const initial = createInitialTuiSessionState();
    const withUser = reduceTuiState(initial, { type: "user_message", text: "Please prioritize openroad." });
    const withAssistant = reduceTuiState(withUser, { type: "assistant_message", text: "Understood. Prioritizing openroad." });
    expect(withAssistant.conversation).toEqual([
      { role: "user", text: "Please prioritize openroad." },
      { role: "assistant", text: "Understood. Prioritizing openroad." },
    ]);
  });
});
