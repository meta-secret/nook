/** Human-readable CI log lines from Cursor SDK interaction updates. */

import type { InteractionUpdate, ToolCall } from "@cursor/sdk";

import { AgentTextLog, ShellStreamLog } from "./interaction-log.js";
import { createLogger } from "./logger.js";
import {
  extractShellOutputChunk,
  formatToolCompleted,
  formatToolStarted,
} from "./tool-summary.js";

const log = createLogger("cursor");

export class CiInteractionLogger {
  private readonly agentText = new AgentTextLog();
  private readonly shellStream = new ShellStreamLog();

  log(update: InteractionUpdate): void {
    switch (update.type) {
      case "text-delta":
        if (update.text) {
          this.agentText.write(update.text);
        }
        break;
      case "thinking-delta":
        break;
      case "shell-output-delta": {
        const chunk = extractShellOutputChunk(update.event);
        if (chunk) {
          this.agentText.closeBlock();
          this.shellStream.write(chunk);
        }
        break;
      }
      case "tool-call-started":
        this.agentText.closeBlock();
        this.shellStream.closeBlock();
        log.debug(formatToolStarted(update.toolCall));
        if (update.toolCall.type === "shell") {
          this.shellStream.openBlock();
        }
        break;
      case "tool-call-completed":
        this.shellStream.closeBlock();
        this.logToolCompleted(update.toolCall);
        break;
      case "step-started":
        this.agentText.closeBlock();
        this.shellStream.closeBlock();
        log.debug("step started");
        break;
      case "step-completed":
        log.debug("step completed");
        break;
      case "turn-ended":
        this.agentText.closeBlock();
        this.shellStream.closeBlock();
        log.debug("turn ended");
        break;
      default:
        break;
    }
  }

  finish(): void {
    this.agentText.closeBlock();
    this.shellStream.closeBlock();
  }

  private logToolCompleted(toolCall: ToolCall): void {
    const lines = formatToolCompleted(toolCall, {
      includeShellOutput: !this.shellStream.hasStreamed(),
    });
    if (lines) {
      for (const line of lines) {
        log.debug(line);
      }
    }
  }
}

const defaultLogger = new CiInteractionLogger();

export function logInteractionUpdate(update: InteractionUpdate): void {
  defaultLogger.log(update);
}

export function finishInteractionLog(): void {
  defaultLogger.finish();
}
