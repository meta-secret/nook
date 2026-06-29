/** Human-readable CI log lines from Cursor SDK interaction updates. */

type InteractionUpdate = {
  type: string;
  text?: string;
  toolCall?: { type?: string; [key: string]: unknown };
};

export function logInteractionUpdate(update: InteractionUpdate): void {
  switch (update.type) {
    case "text-delta":
      if (update.text) {
        process.stdout.write(update.text);
      }
      break;
    case "thinking-delta":
      break;
    case "tool-call-started":
      console.log(`\n==> tool started: ${summarizeToolCall(update.toolCall)}`);
      break;
    case "tool-call-completed":
      console.log(`==> tool completed: ${summarizeToolCall(update.toolCall)}`);
      break;
    case "step-started":
      console.log("\n==> step started");
      break;
    case "step-completed":
      console.log("==> step completed");
      break;
    case "turn-ended":
      console.log("\n==> turn ended");
      break;
    default:
      break;
  }
}

function summarizeToolCall(toolCall: InteractionUpdate["toolCall"]): string {
  if (!toolCall) {
    return "unknown";
  }
  const type = toolCall.type ?? "tool";
  const raw = JSON.stringify(toolCall);
  if (raw.length <= 160) {
    return `${type} ${raw}`;
  }
  return `${type} ${raw.slice(0, 157)}...`;
}
