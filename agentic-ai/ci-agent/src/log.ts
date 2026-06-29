/** Human-readable CI log lines from Cursor SDK interaction updates. */

import type { InteractionUpdate } from "@cursor/sdk";

import { formatToolCompleted, formatToolStarted } from "./tool-summary.js";

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
      console.log(`\n==> ${formatToolStarted(update.toolCall)}`);
      break;
    case "tool-call-completed": {
      const summary = formatToolCompleted(update.toolCall);
      if (summary) {
        console.log(`==> ${summary}`);
      }
      break;
    }
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
