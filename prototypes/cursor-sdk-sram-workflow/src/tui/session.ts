import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { createWorkflowAgent, type WorkflowAgent, type WorkflowEvent } from "../sdk/agentRunner.js";
import {
  createInitialTuiSessionState,
  normalizeWorkflowStreamEvent,
  parseClarificationRequest,
  reduceTuiState,
  type ClarificationRequest,
  type TuiEvent,
  type TuiSessionState,
} from "./events.js";
import { promptChoice, promptLine } from "./input.js";
import { TuiRenderer } from "./renderer.js";

export interface RunTuiChatSessionOptions {
  apiKey: string;
  cwd: string;
  eventLogPath: string;
  initialPrompt: string;
  createAgent?: () => Promise<WorkflowAgent>;
  promptUser?: (request: ClarificationRequest) => Promise<string>;
  nextUserTurn?: () => Promise<string>;
  renderer?: Pick<TuiRenderer, "render">;
}

export function isExitCommand(input: string): boolean {
  const normalized = input.trim().toLowerCase();
  return normalized === "/exit" || normalized === "/quit" || normalized === "/finish";
}

function isCtrlO(input: string): boolean {
  return input.includes("\u000f");
}

type UiCommand =
  | { type: "collapse"; collapsed: boolean }
  | { type: "scroll"; delta: number }
  | { type: "scroll_to"; position: "top" | "bottom" };

function parseUiCommand(input: string): UiCommand | undefined {
  const normalized = input.trim().toLowerCase();
  if (
    isCtrlO(input) ||
    normalized === "/ctrl+o" ||
    normalized === "/collapse" ||
    normalized.startsWith("/collapse ")
  ) {
    return { type: "collapse", collapsed: true };
  }
  if (normalized === "/expand" || normalized.startsWith("/expand ")) {
    return { type: "collapse", collapsed: false };
  }
  if (normalized === "/scroll up") return { type: "scroll", delta: 8 };
  if (normalized === "/scroll down") return { type: "scroll", delta: -8 };
  if (normalized === "/scroll top") return { type: "scroll_to", position: "top" };
  if (normalized === "/scroll bottom") return { type: "scroll_to", position: "bottom" };
  return undefined;
}

function applyUiCommand(
  state: TuiSessionState,
  renderer: Pick<TuiRenderer, "render">,
  command: UiCommand,
): TuiSessionState {
  if (command.type === "collapse") {
    return applyEventAndRender(renderer, state, {
      type: "conversation_toggle_collapse",
      collapsed: command.collapsed,
    });
  }
  if (command.type === "scroll") {
    return applyEventAndRender(renderer, state, {
      type: "conversation_scroll",
      delta: command.delta,
    });
  }
  return applyEventAndRender(renderer, state, {
    type: "conversation_scroll_to",
    position: command.position,
  });
}

async function writeChatEvent(eventLogPath: string, event: WorkflowEvent): Promise<void> {
  await mkdir(path.dirname(eventLogPath), { recursive: true });
  await appendFile(eventLogPath, `${JSON.stringify(event)}\n`, "utf8");
}

function applyEventAndRender(
  renderer: Pick<TuiRenderer, "render">,
  state: TuiSessionState,
  event: TuiEvent,
): TuiSessionState {
  const next = reduceTuiState(state, event);
  renderer.render(next);
  return next;
}

function extractAssistantText(event: WorkflowEvent): string {
  const text = event.message?.content
    ?.filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("");
  return text ?? "";
}

export async function runTuiChatSession(options: RunTuiChatSessionOptions): Promise<void> {
  const renderer = options.renderer ?? new TuiRenderer();
  const promptUser =
    options.promptUser ?? ((request: ClarificationRequest) => promptChoice(request.question, request.choices, request.required));
  const nextUserTurn = options.nextUserTurn ?? (() => promptLine("You> "));
  const agentFactory = options.createAgent ?? (() => createWorkflowAgent({ apiKey: options.apiKey, cwd: options.cwd }));
  const agent = await agentFactory();
  let state = createInitialTuiSessionState();
  renderer.render(state);
  let outgoingMessage = options.initialPrompt;
  try {
    while (true) {
      const run = await agent.send(outgoingMessage);
      state = applyEventAndRender(renderer, state, {
        type: "phase_start",
        phase: "planning",
        runId: run.id,
        prompt: outgoingMessage,
      });

      let streamedText = "";
      for await (const event of run.stream()) {
        await writeChatEvent(options.eventLogPath, event);
        const normalized = normalizeWorkflowStreamEvent({
          phase: "planning",
          lifecycle: "stream_event",
          runId: run.id,
          event,
        });
        for (const item of normalized) {
          state = applyEventAndRender(renderer, state, item);
        }
        streamedText += extractAssistantText(event);
      }
      const result = await run.wait();
      state = applyEventAndRender(renderer, state, {
        type: "phase_end",
        phase: "planning",
        runId: run.id,
        status: result.status,
      });

      if (result.status === "error") {
        state = applyEventAndRender(renderer, state, {
          type: "error",
          message: "Agent run ended with error status.",
        });
        throw new Error(`Chat run failed: ${run.id}`);
      }

      const clarification = parseClarificationRequest(`${streamedText}\n${result.result ?? ""}`);
      const assistantMessage = (result.result ?? streamedText).trim();
      if (assistantMessage !== "") {
        state = applyEventAndRender(renderer, state, {
          type: "assistant_message",
          text: assistantMessage,
        });
      }
      if (clarification !== undefined) {
        state = applyEventAndRender(renderer, state, {
          type: "clarification_requested",
          question: clarification.question,
          choices: clarification.choices,
          required: clarification.required,
        });
        let answer = "";
        while (true) {
          const candidate = await promptUser(clarification);
          if (isExitCommand(candidate)) return;
          const uiCommand = parseUiCommand(candidate);
          if (uiCommand !== undefined) {
            state = applyUiCommand(state, renderer, uiCommand);
            continue;
          }
          if (clarification.required && candidate.trim() === "") {
            state = applyEventAndRender(renderer, state, {
              type: "error",
              message: "Clarification answer is required.",
            });
            continue;
          }
          answer = candidate;
          break;
        }
        state = applyEventAndRender(renderer, state, { type: "clarification_answered", answer });
        outgoingMessage = `Clarification response: ${answer}`;
        continue;
      }

      const userTurn = await nextUserTurn();
      if (isExitCommand(userTurn)) return;
      if (userTurn.trim() === "") continue;
      const uiCommand = parseUiCommand(userTurn);
      if (uiCommand !== undefined) {
        state = applyUiCommand(state, renderer, uiCommand);
        continue;
      }
      state = applyEventAndRender(renderer, state, { type: "user_message", text: userTurn });
      outgoingMessage = userTurn;
    }
  } finally {
    await agent[Symbol.asyncDispose]();
  }
}
