import { CONVERSATION_WINDOW_LINES, type TuiSessionState } from "./events.js";

const COLOR_RESET = "\u001b[0m";
const COLOR_USER = "\u001b[38;5;45m"; // bright cyan
const COLOR_ASSISTANT = "\u001b[38;5;119m"; // bright green
const COLOR_HEADER = "\u001b[38;5;220m"; // warm yellow
const COLOR_MUTED = "\u001b[38;5;250m"; // readable light gray
const COLOR_INLINE_CODE = "\u001b[38;5;229m"; // pale yellow
const COLOR_CODE_BLOCK = "\u001b[38;5;153m"; // light blue
const COLOR_BULLET = "\u001b[38;5;111m"; // soft cyan
const STYLE_BOLD = "\u001b[1m";

function renderHeader(state: TuiSessionState): string {
  const phase = state.currentPhase ?? "idle";
  return `${COLOR_HEADER}SRAM Workflow Chat TUI | phase: ${phase}${COLOR_RESET}`;
}

function renderPhases(state: TuiSessionState): string {
  const phases = Object.entries(state.phaseStatus);
  if (phases.length === 0) return "No phases started.";
  return phases.map(([phase, status]) => `- ${phase}: ${status}`).join("\n");
}

function renderAssistant(state: TuiSessionState): string {
  if (state.assistantLines.length === 0) return "(no assistant output yet)";
  return renderMarkdown(state.assistantLines.join("\n"));
}

function renderConversation(state: TuiSessionState): string {
  if (state.conversation.length === 0) return "(no conversation yet)";
  const renderedLines = state.conversation
    .map((entry) => {
      const rendered = renderMarkdown(entry.text);
      if (entry.role === "user") {
        return `${COLOR_USER}User:${COLOR_RESET} ${rendered}`.split("\n");
      }
      return `${COLOR_ASSISTANT}Agent:${COLOR_RESET} ${rendered}`.split("\n");
    })
    .flat();
  const shouldAutoFold = renderedLines.length > CONVERSATION_WINDOW_LINES;
  const shouldFold = state.conversationCollapsedByUser || shouldAutoFold;
  if (!shouldFold) return renderChatBox(renderedLines);

  if (state.conversationCollapsedByUser) {
    const latest = renderedLines[renderedLines.length - 1] ?? "";
    const oneLine = compactSingleLine(latest);
    const folded = renderedLines.length;
    const summary = `${COLOR_MUTED}[collapsed ${folded} lines]${COLOR_RESET} ${oneLine}`;
    return renderChatBox([summary]);
  }

  const maxOffset = Math.max(0, renderedLines.length - CONVERSATION_WINDOW_LINES);
  const clampedOffset = Math.min(state.conversationScrollOffset, maxOffset);
  const endExclusive = renderedLines.length - clampedOffset;
  const startInclusive = Math.max(0, endExclusive - CONVERSATION_WINDOW_LINES);
  const visible = renderedLines.slice(startInclusive, endExclusive);
  const foldedCount = renderedLines.length - visible.length;
  const info = `${COLOR_MUTED}[chat-box folded | showing ${visible.length}/${renderedLines.length} lines | hidden ${foldedCount} lines | offset ${clampedOffset}]${COLOR_RESET}`;
  return renderChatBox([info, ...visible]);
}

function renderTools(state: TuiSessionState): string {
  if (state.toolCalls.length === 0) return "(no tool calls yet)";
  return state.toolCalls.map((call) => `${call.phase} :: ${call.name} [${call.status ?? "running"}]`).join("\n");
}

function renderErrors(state: TuiSessionState): string {
  if (state.errors.length === 0) return "(none)";
  return state.errors.join("\n");
}

export function renderFrame(state: TuiSessionState): string {
  const lines = [
    renderHeader(state),
    "",
    "== Phase Status ==",
    renderPhases(state),
    "",
    "== Assistant Stream ==",
    renderAssistant(state),
    "",
    "== Conversation ==",
    renderConversation(state),
    "",
    "== Tool Calls ==",
    renderTools(state),
    "",
    "== Errors ==",
    renderErrors(state),
    "",
    "Commands: /exit | /quit | /finish | /scroll up|down|top|bottom | /collapse | /expand (Ctrl+O also toggles collapse)",
  ];
  if (state.clarification !== undefined) {
    lines.push(
      "",
      "== Clarification Requested ==",
      state.clarification.question,
      state.clarification.choices.length > 0 ? `Choices: ${state.clarification.choices.join(" | ")}` : "Choices: free text",
    );
  }
  return lines.join("\n");
}

export class TuiRenderer {
  render(state: TuiSessionState): void {
    process.stdout.write("\u001bc");
    process.stdout.write(`${renderFrame(state)}\n`);
  }
}

function styleInlineMarkdown(input: string): string {
  return input
    .replace(/`([^`]+)`/g, `${COLOR_INLINE_CODE}$1${COLOR_RESET}`)
    .replace(/\*\*([^*]+)\*\*/g, `${STYLE_BOLD}$1${COLOR_RESET}`)
    .replace(/\*([^*]+)\*/g, `${COLOR_MUTED}$1${COLOR_RESET}`);
}

function renderMarkdown(markdown: string): string {
  const lines = markdown.split("\n");
  const rendered: string[] = [];
  let inCodeBlock = false;

  for (const rawLine of lines) {
    const line = rawLine;
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      rendered.push(`${COLOR_CODE_BLOCK}${trimmed}${COLOR_RESET}`);
      continue;
    }

    if (inCodeBlock) {
      rendered.push(`${COLOR_CODE_BLOCK}${line}${COLOR_RESET}`);
      continue;
    }

    if (trimmed.startsWith("#")) {
      const title = trimmed.replace(/^#+\s*/, "");
      rendered.push(`${STYLE_BOLD}${title}${COLOR_RESET}`);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const bulletBody = trimmed.replace(/^[-*]\s+/, "");
      rendered.push(`${COLOR_BULLET}•${COLOR_RESET} ${styleInlineMarkdown(bulletBody)}`);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      rendered.push(styleInlineMarkdown(trimmed));
      continue;
    }

    rendered.push(styleInlineMarkdown(line));
  }

  return rendered.join("\n");
}

function compactSingleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function visibleLength(text: string): number {
  return text.replace(/\u001b\[[0-9;]*m/g, "").length;
}

function renderChatBox(lines: string[]): string {
  const width = Math.max(40, Math.min(120, process.stdout.columns ?? 100) - 6);
  const horizontal = "─".repeat(width + 2);
  const top = `┌${horizontal}┐`;
  const bottom = `└${horizontal}┘`;
  const body = lines.map((line) => {
    const clipped = visibleLength(line) > width ? `${line.slice(0, Math.max(0, width - 1))}…` : line;
    const pad = Math.max(0, width - visibleLength(clipped));
    return `│ ${clipped}${" ".repeat(pad)} │`;
  });
  return [top, ...body, bottom].join("\n");
}
