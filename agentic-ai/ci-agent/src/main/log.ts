/** Human-readable CI log lines from Cursor SDK interaction updates. */

import type { InteractionUpdate, ToolCall } from "@cursor/sdk";

import {
  AgentTextLog,
  ShellStreamLog,
  StreamEvidence,
} from "./interaction-log.js";
import { Logger } from "./logger.js";
import {
  ShellOutputEvent,
  CompletedToolCall,
  StartedToolCall,
} from "./tool-summary.js";

const log = new Logger("cursor");

export class CiInteractionLogger {
  constructor(
    private readonly agentText = new AgentTextLog(),
    private readonly shellStream = new ShellStreamLog(),
  ) {}

  log(update: InteractionUpdate): CiInteractionLogger {
    let agentText = this.agentText,
      shellStream = this.shellStream;
    switch (update.type) {
      case "text-delta":
        if (update.text) {
          agentText = agentText.write(update.text);
        }
        break;
      case "thinking-delta":
      case "thinking-completed":
      case "user-message-appended":
      case "partial-tool-call":
      case "token-delta":
      case "summary":
      case "summary-started":
      case "summary-completed":
      case "tool-call-delta":
        break;
      case "shell-output-delta": {
        const chunk = new ShellOutputEvent(update.event).text();
        if (chunk) {
          agentText = agentText.closeBlock();
          shellStream = shellStream.write(chunk);
        }
        break;
      }
      case "tool-call-started":
        agentText = agentText.closeBlock();
        shellStream = shellStream.closeBlock();
        log.info(new StartedToolCall(update.toolCall).format());
        if (update.toolCall.type === "shell") {
          shellStream = shellStream.openBlock();
        }
        break;
      case "tool-call-completed":
        shellStream = shellStream.closeBlock();
        this.logToolCompleted(update.toolCall);
        break;
      case "step-started":
        agentText = agentText.closeBlock();
        shellStream = shellStream.closeBlock();
        log.debug("step started");
        break;
      case "step-completed":
        log.debug("step completed");
        break;
      case "turn-ended":
        agentText = agentText.closeBlock();
        shellStream = shellStream.closeBlock();
        log.debug("turn ended");
        break;
    }
    return new CiInteractionLogger(agentText, shellStream);
  }

  finish(): CiInteractionLogger {
    return new CiInteractionLogger(
      this.agentText.closeBlock(),
      this.shellStream.closeBlock(),
    );
  }

  private logToolCompleted(toolCall: ToolCall): void {
    const lines = new CompletedToolCall({
      toolCall: toolCall,
      options: {
        includeShellOutput:
          this.shellStream.observation() !== StreamEvidence.Seen,
      },
    }).format();
    for (const line of lines) {
      log.info(line);
    }
  }
}
