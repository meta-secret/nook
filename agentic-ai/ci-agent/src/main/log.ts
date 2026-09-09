/** Human-readable CI log lines from Cursor SDK interaction updates. */

import type { InteractionUpdate, ToolCall } from "@cursor/sdk";

import { AgentTextLog, ShellStreamLog } from "./interaction-log.js";
import { Logger } from "./logger.js";
import {
  ShellOutputEvent,
  CompletedToolCall,
  StartedToolCall,
} from "./tool-summary.js";

const log = new Logger("cursor");

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
        const chunk = new ShellOutputEvent(update.event).text();
        if (chunk) {
          this.agentText.closeBlock();
          this.shellStream.write(chunk);
        }
        break;
      }
      case "tool-call-started":
        this.agentText.closeBlock();
        this.shellStream.closeBlock();
        log.info(new StartedToolCall(update.toolCall).format());
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
    const lines = new CompletedToolCall({
      toolCall: toolCall,
      options: {
        includeShellOutput: !this.shellStream.hasStreamed(),
      },
    }).format();
    for (const line of lines) {
      log.info(line);
    }
  }
}

export const defaultInteractionLogger = new CiInteractionLogger();
