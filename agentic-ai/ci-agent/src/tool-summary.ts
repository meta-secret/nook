import type { ToolCall } from "@cursor/sdk";

const WORKSPACE_PREFIXES = [
  "/home/runner/work/nook/nook/",
  "/workspace/",
];

export function formatToolStarted(toolCall: ToolCall): string {
  switch (toolCall.type) {
    case "read":
      return `read ${shortenPath(stringArg(toolCall.args, "path"))}`;
    case "write":
      return `write ${shortenPath(stringArg(toolCall.args, "path"))}`;
    case "edit":
      return `edit ${shortenPath(stringArg(toolCall.args, "path"))}`;
    case "delete":
      return `delete ${shortenPath(stringArg(toolCall.args, "path"))}`;
    case "shell":
      return `shell ${truncate(stringArg(toolCall.args, "command"), 140)}`;
    case "grep": {
      const pattern = stringArg(toolCall.args, "pattern");
      const path = stringArg(toolCall.args, "path");
      return path ? `grep ${truncate(pattern, 80)} in ${shortenPath(path)}` : `grep ${truncate(pattern, 100)}`;
    }
    case "glob":
      return `glob ${stringArg(toolCall.args, "glob_pattern")}`;
    case "ls":
      return `ls ${shortenPath(stringArg(toolCall.args, "path") || ".")}`;
    case "semSearch":
      return `search ${truncate(stringArg(toolCall.args, "query"), 100)}`;
    case "readLints":
      return `lints ${shortenPath(stringArg(toolCall.args, "path") || ".")}`;
    case "task":
      return `task ${truncate(stringArg(toolCall.args, "description"), 100)}`;
    case "updateTodos":
      return "update todos";
    case "createPlan":
      return `plan ${truncate(stringArg(toolCall.args, "name"), 80)}`;
    case "mcp": {
      const server = stringArg(toolCall.args, "server");
      const tool = stringArg(toolCall.args, "toolName");
      return server && tool ? `mcp ${server}/${tool}` : "mcp";
    }
    default:
      return toolCall.type ?? "tool";
  }
}

export function formatToolCompleted(toolCall: ToolCall): string | null {
  const result = toolCall.result;
  if (!result) {
    return null;
  }

  if (result.status === "error") {
    const message = errorMessage(result.error);
    return `${toolCall.type} failed: ${truncate(message, 120)}`;
  }

  switch (toolCall.type) {
    case "shell": {
      const exitCode = shellExitCode(result.value);
      return exitCode === 0 ? "shell exit 0" : `shell exit ${exitCode}`;
    }
    case "task":
      return "task done";
    case "mcp":
      return "mcp done";
    default:
      return null;
  }
}

function stringArg(args: ToolCall["args"] | undefined, key: string): string {
  if (!args || typeof args !== "object") {
    return "";
  }
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function shortenPath(path: string): string {
  if (!path) {
    return ".";
  }
  for (const prefix of WORKSPACE_PREFIXES) {
    if (path.startsWith(prefix)) {
      return path.slice(prefix.length);
    }
  }
  return path;
}

function truncate(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max - 3)}...`;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return "unknown error";
}

function shellExitCode(value: unknown): number | string {
  if (value && typeof value === "object" && "exitCode" in value) {
    const exitCode = (value as { exitCode?: unknown }).exitCode;
    if (typeof exitCode === "number") {
      return exitCode;
    }
  }
  return "?";
}
