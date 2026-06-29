/** Human-readable CI log lines from Cursor SDK interaction updates. */

import type { InteractionUpdate } from "@cursor/sdk";

import {
  extractShellOutputChunk,
  formatToolCompleted,
  formatToolStarted,
} from "./tool-summary.js";

export function logInteractionUpdate(update: InteractionUpdate): void {
  switch (update.type) {
    case "text-delta":
      if (update.text) {
        process.stdout.write(update.text);
      }
      break;
    case "thinking-delta":
      break;
    case "shell-output-delta": {
      const chunk = extractShellOutputChunk(update.event);
      if (chunk) {
        process.stdout.write(chunk);
      }
      break;
    }
    case "tool-call-started":
      console.log(`\n==> ${formatToolStarted(update.toolCall)}`);
      break;
    case "tool-call-completed": {
      const lines = formatToolCompleted(update.toolCall);
      if (lines) {
        for (const line of lines) {
          console.log(`==> ${line}`);
        }
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
