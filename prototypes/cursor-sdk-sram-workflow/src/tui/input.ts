import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export async function promptLine(prompt: string): Promise<string> {
  const rl = createInterface({ input, output, terminal: true });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
}

export async function promptChoice(question: string, choices: readonly string[], required: boolean): Promise<string> {
  output.write(`${question}\n`);
  if (choices.length > 0) {
    choices.forEach((choice, idx) => {
      output.write(`  ${idx + 1}. ${choice}\n`);
    });
  }
  while (true) {
    const suffix = required ? " (required)" : " (optional, enter to skip)";
    const answer = await promptLine(`Answer${suffix}: `);
    if (answer === "" && !required) return "";

    // Preserve slash commands so session-level command parsing can intercept them.
    if (answer.startsWith("/")) return answer;

    if (choices.length === 0) {
      if (answer === "" && required) {
        output.write("Please provide an answer.\n");
        continue;
      }
      return answer;
    }

    const numeric = Number.parseInt(answer, 10);
    if (Number.isFinite(numeric) && numeric >= 1 && numeric <= choices.length) {
      const selected = choices[numeric - 1];
      if (selected !== undefined) return selected;
    }
    if (answer !== "") return answer;
    output.write("Invalid clarification answer. Enter a number, text, or a slash command.\n");
  }
}
