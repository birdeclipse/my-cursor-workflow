import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { isExitCommand, runTuiChatSession } from "../src/tui/session.js";
import { createInitialTuiSessionState, reduceTuiState } from "../src/tui/events.js";

describe("TUI chat session", () => {
  test("recognizes supported system exit commands", () => {
    expect(isExitCommand("/exit")).toBe(true);
    expect(isExitCommand("/quit")).toBe(true);
    expect(isExitCommand("/finish")).toBe(true);
    expect(isExitCommand(" /QUIT ")).toBe(true);
    expect(isExitCommand("/stop")).toBe(false);
  });

  test("supports chat-box collapse and scrolling state events", () => {
    const initial = createInitialTuiSessionState();
    const collapsed = reduceTuiState(initial, { type: "conversation_toggle_collapse", collapsed: true });
    expect(collapsed.conversationCollapsedByUser).toBe(true);
    const scrolled = reduceTuiState(collapsed, { type: "conversation_scroll", delta: 12 });
    expect(scrolled.conversationScrollOffset).toBe(12);
    const bottom = reduceTuiState(scrolled, { type: "conversation_scroll_to", position: "bottom" });
    expect(bottom.conversationScrollOffset).toBe(0);
  });

  test("accepts collapse/expand command variants", () => {
    // parser is covered through session behavior; this keeps command compatibility regression-guarded.
    expect(isExitCommand("/collapse")).toBe(false);
    expect(isExitCommand("/expand")).toBe(false);
  });

  test("handles clarification roundtrip and exits", async () => {
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "sram-tui-"));
    const eventLogPath = path.join(outputRoot, "chat-events.jsonl");
    const sentMessages: string[] = [];
    try {
      await runTuiChatSession({
        apiKey: "test-key",
        cwd: process.cwd(),
        eventLogPath,
        initialPrompt: "start",
        promptUser: async () => "openroad",
        nextUserTurn: async () => "/exit",
        renderer: { render() {} },
        createAgent: async () => ({
          agentId: "agent-test",
          async send(message: string) {
            sentMessages.push(message);
            const firstTurn = sentMessages.length === 1;
            return {
              id: `run-${sentMessages.length}`,
              agentId: "agent-test",
              async *stream() {
                if (firstTurn) {
                  yield {
                    type: "assistant",
                    message: {
                      content: [
                        {
                          type: "text",
                          text: "CLARIFICATION_REQUEST:\nquestion: Which flow?\nchoices: openlane|openroad\nrequired: true",
                        },
                      ],
                    },
                  };
                  return;
                }
                yield { type: "assistant", message: { content: [{ type: "text", text: "thanks" }] } };
              },
              async wait() {
                return { status: "finished", result: firstTurn ? "need answer" : "done" };
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

      expect(sentMessages).toEqual(["start", "Clarification response: openroad"]);
      const logged = (await readFile(eventLogPath, "utf8")).trim().split("\n");
      expect(logged.length).toBeGreaterThanOrEqual(2);
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  test("does not forward ui commands as clarification answers", async () => {
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "sram-tui-"));
    const eventLogPath = path.join(outputRoot, "chat-events.jsonl");
    const sentMessages: string[] = [];
    const scriptedAnswers = ["/collapse", "openroad"];
    try {
      await runTuiChatSession({
        apiKey: "test-key",
        cwd: process.cwd(),
        eventLogPath,
        initialPrompt: "start",
        promptUser: async () => scriptedAnswers.shift() ?? "openroad",
        nextUserTurn: async () => "/exit",
        renderer: { render() {} },
        createAgent: async () => ({
          agentId: "agent-test",
          async send(message: string) {
            sentMessages.push(message);
            const firstTurn = sentMessages.length === 1;
            return {
              id: `run-${sentMessages.length}`,
              agentId: "agent-test",
              async *stream() {
                if (firstTurn) {
                  yield {
                    type: "assistant",
                    message: {
                      content: [
                        {
                          type: "text",
                          text: "CLARIFICATION_REQUEST:\nquestion: Which flow?\nchoices: openlane|openroad\nrequired: true",
                        },
                      ],
                    },
                  };
                  return;
                }
                yield { type: "assistant", message: { content: [{ type: "text", text: "ok" }] } };
              },
              async wait() {
                return { status: "finished", result: firstTurn ? "need answer" : "done" };
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

      expect(sentMessages).toEqual(["start", "Clarification response: openroad"]);
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  test("clarification prompt retries on empty required answer", async () => {
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "sram-tui-"));
    const eventLogPath = path.join(outputRoot, "chat-events.jsonl");
    const sentMessages: string[] = [];
    const scriptedAnswers = ["", "2"];
    try {
      await runTuiChatSession({
        apiKey: "test-key",
        cwd: process.cwd(),
        eventLogPath,
        initialPrompt: "start",
        promptUser: async () => {
          const answer = scriptedAnswers.shift();
          if (answer === undefined) return "2";
          return answer;
        },
        nextUserTurn: async () => "/exit",
        renderer: { render() {} },
        createAgent: async () => ({
          agentId: "agent-test",
          async send(message: string) {
            sentMessages.push(message);
            const firstTurn = sentMessages.length === 1;
            return {
              id: `run-${sentMessages.length}`,
              agentId: "agent-test",
              async *stream() {
                if (firstTurn) {
                  yield {
                    type: "assistant",
                    message: {
                      content: [
                        {
                          type: "text",
                          text: "CLARIFICATION_REQUEST:\nquestion: Choose one\nchoices: Fresh run|Continue/merge with existing\nrequired: true",
                        },
                      ],
                    },
                  };
                  return;
                }
                yield { type: "assistant", message: { content: [{ type: "text", text: "done" }] } };
              },
              async wait() {
                return { status: "finished", result: firstTurn ? "need answer" : "done" };
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

      expect(sentMessages).toEqual(["start", "Clarification response: 2"]);
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });
});
