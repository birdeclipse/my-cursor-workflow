import type { WorkflowEvent, WorkflowPhase, WorkflowStreamEvent } from "../sdk/agentRunner.js";

export type TuiEvent =
  | { type: "phase_start"; phase: WorkflowPhase; runId: string; prompt: string }
  | { type: "assistant_chunk"; phase: WorkflowPhase; runId: string; text: string }
  | { type: "assistant_message"; text: string }
  | { type: "user_message"; text: string }
  | { type: "conversation_toggle_collapse"; collapsed: boolean }
  | { type: "conversation_scroll"; delta: number }
  | { type: "conversation_scroll_to"; position: "top" | "bottom" }
  | { type: "tool_call"; phase: WorkflowPhase; runId: string; name: string; status?: string }
  | { type: "phase_end"; phase: WorkflowPhase; runId: string; status: string }
  | { type: "clarification_requested"; question: string; choices: string[]; required: boolean }
  | { type: "clarification_answered"; answer: string }
  | { type: "error"; message: string };

export interface ClarificationRequest {
  question: string;
  choices: string[];
  required: boolean;
}

export interface TuiSessionState {
  currentPhase?: WorkflowPhase;
  phaseStatus: Partial<Record<WorkflowPhase, string>>;
  assistantLines: string[];
  conversation: Array<{ role: "user" | "assistant"; text: string }>;
  conversationCollapsedByUser: boolean;
  conversationScrollOffset: number;
  toolCalls: Array<{ phase: WorkflowPhase; name: string; status?: string }>;
  clarification?: ClarificationRequest;
  errors: string[];
}

type ConversationEntry = TuiSessionState["conversation"][number];

export const MAX_ASSISTANT_LINES = 24;
export const MAX_TOOL_CALLS = 12;
export const MAX_CONVERSATION_ENTRIES = 40;
export const CONVERSATION_WINDOW_LINES = 30;

export function createInitialTuiSessionState(): TuiSessionState {
  return {
    currentPhase: undefined,
    phaseStatus: {},
    assistantLines: [],
    conversation: [],
    conversationCollapsedByUser: false,
    conversationScrollOffset: 0,
    toolCalls: [],
    clarification: undefined,
    errors: [],
  };
}

function appendBounded(lines: string[], next: string, max: number): string[] {
  const segments = next.split("\n");
  if (segments.length === 0) return lines;

  const merged = [...lines];
  if (merged.length === 0) {
    merged.push("");
  }

  const [head, ...tail] = segments;
  merged[merged.length - 1] = `${merged[merged.length - 1] ?? ""}${head ?? ""}`;
  for (const segment of tail) {
    merged.push(segment);
  }

  const compact = merged.filter((line, index) => line.trim() !== "" || index === merged.length - 1);
  return compact.slice(Math.max(0, compact.length - max));
}

export function reduceTuiState(state: TuiSessionState, event: TuiEvent): TuiSessionState {
  switch (event.type) {
    case "phase_start":
      return {
        ...state,
        currentPhase: event.phase,
        phaseStatus: { ...state.phaseStatus, [event.phase]: "running" },
      };
    case "assistant_chunk":
      return {
        ...state,
        assistantLines: appendBounded(state.assistantLines, event.text, MAX_ASSISTANT_LINES),
      };
    case "tool_call":
      return {
        ...state,
        toolCalls: [...state.toolCalls, { phase: event.phase, name: event.name, status: event.status }].slice(
          Math.max(0, state.toolCalls.length + 1 - MAX_TOOL_CALLS),
        ),
      };
    case "phase_end":
      return {
        ...state,
        phaseStatus: { ...state.phaseStatus, [event.phase]: event.status },
      };
    case "assistant_message":
      {
        const entry: ConversationEntry = { role: "assistant", text: event.text };
        return {
          ...state,
          conversationScrollOffset: 0,
          conversation: [...state.conversation, entry].slice(Math.max(0, state.conversation.length + 1 - MAX_CONVERSATION_ENTRIES)),
        };
      }
    case "user_message":
      {
        const entry: ConversationEntry = { role: "user", text: event.text };
        return {
          ...state,
          conversationScrollOffset: 0,
          conversation: [...state.conversation, entry].slice(Math.max(0, state.conversation.length + 1 - MAX_CONVERSATION_ENTRIES)),
        };
      }
    case "conversation_toggle_collapse":
      return {
        ...state,
        conversationCollapsedByUser: event.collapsed,
        conversationScrollOffset: 0,
      };
    case "conversation_scroll":
      return {
        ...state,
        conversationScrollOffset: Math.max(0, state.conversationScrollOffset + event.delta),
      };
    case "conversation_scroll_to":
      return {
        ...state,
        conversationScrollOffset: event.position === "bottom" ? 0 : Number.MAX_SAFE_INTEGER,
      };
    case "clarification_requested":
      return {
        ...state,
        clarification: {
          question: event.question,
          choices: event.choices,
          required: event.required,
        },
      };
    case "clarification_answered":
      {
        const entry: ConversationEntry = { role: "user", text: event.answer };
        return {
          ...state,
          clarification: undefined,
          assistantLines: appendBounded(state.assistantLines, `User answer: ${event.answer}`, MAX_ASSISTANT_LINES),
          conversationScrollOffset: 0,
          conversation: [...state.conversation, entry].slice(Math.max(0, state.conversation.length + 1 - MAX_CONVERSATION_ENTRIES)),
        };
      }
    case "error":
      return {
        ...state,
        errors: [...state.errors, event.message].slice(Math.max(0, state.errors.length + 1 - 10)),
      };
  }
}

function assistantText(event: WorkflowEvent): string | undefined {
  return event.message?.content
    ?.filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("");
}

export function normalizeWorkflowStreamEvent(event: WorkflowStreamEvent): TuiEvent[] {
  if (event.lifecycle === "phase_start") {
    return [
      {
        type: "phase_start",
        phase: event.phase,
        runId: event.runId ?? "unknown-run",
        prompt: event.prompt ?? "",
      },
    ];
  }
  if (event.lifecycle === "phase_end") {
    return [
      {
        type: "phase_end",
        phase: event.phase,
        runId: event.runId ?? "unknown-run",
        status: event.result?.status ?? "unknown",
      },
    ];
  }
  if (event.event?.type === "tool_call") {
    return [
      {
        type: "tool_call",
        phase: event.phase,
        runId: event.runId ?? "unknown-run",
        name: event.event.name ?? "unknown-tool",
        status: event.event.status,
      },
    ];
  }
  const text = event.event === undefined ? undefined : assistantText(event.event);
  if (text !== undefined && text.trim() !== "") {
    return [
      {
        type: "assistant_chunk",
        phase: event.phase,
        runId: event.runId ?? "unknown-run",
        text,
      },
    ];
  }
  return [];
}

export function parseClarificationRequest(text: string): ClarificationRequest | undefined {
  const marker = "CLARIFICATION_REQUEST:";
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return undefined;
  const block = text.slice(markerIndex + marker.length).trim();
  const questionMatch = block.match(/question:\s*(.+)/i);
  if (questionMatch === null) return undefined;
  const requiredMatch = block.match(/required:\s*(true|false)/i);
  const choicesMatch = block.match(/choices:\s*(.+)/i);
  const choices =
    choicesMatch?.[1]
      ?.split("|")
      .map((choice) => choice.trim())
      .filter((choice) => choice.length > 0) ?? [];
  return {
    question: questionMatch[1].trim(),
    choices,
    required: requiredMatch?.[1]?.toLowerCase() !== "false",
  };
}
