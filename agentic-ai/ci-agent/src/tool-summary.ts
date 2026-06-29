import type { ToolCall } from "@cursor/sdk";

const WORKSPACE_PREFIXES = [
  "/home/runner/work/nook/nook/",
  "/workspace/",
];

const MAX_SHELL_STREAM_CHARS = 16_000;

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

export function formatToolCompleted(toolCall: ToolCall): string[] | null {
  const result = toolCall.result;
  if (!result) {
    return null;
  }

  if (result.status === "error") {
    const message = errorMessage(result.error);
    return [`${toolCall.type} failed: ${truncate(message, 120)}`];
  }

  switch (toolCall.type) {
    case "shell": {
      const lines: string[] = [];
      lines.push(...formatShellOutputBlocks(result.value));
      const exitCode = shellExitCode(result.value);
      lines.push(exitCode === 0 ? "shell exit 0" : `shell exit ${exitCode}`);
      return lines;
    }
    case "task":
      return ["task done"];
    case "mcp":
      return ["mcp done"];
    default:
      return null;
  }
}

export function extractShellOutputChunk(event: Record<string, unknown> | undefined): string {
  if (!event) {
    return "";
  }

  const direct = readShellText(event);
  if (direct) {
    return direct;
  }

  const nested = event.value;
  if (nested && typeof nested === "object") {
    return readShellText(nested as Record<string, unknown>);
  }

  return "";
}

function formatShellOutputBlocks(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const { stdout, stderr } = value as { stdout?: unknown; stderr?: unknown };
  const lines: string[] = [];

  if (typeof stdout === "string" && stdout.length > 0) {
    lines.push(...formatOutputBlock("stdout", stdout));
  }
  if (typeof stderr === "string" && stderr.length > 0) {
    lines.push(...formatOutputBlock("stderr", stderr));
  }

  return lines;
}

function formatOutputBlock(label: string, text: string): string[] {
  const capped = capShellOutput(text);
  const body = capped.split("\n").map((line) => `    ${line}`);
  return [`--- ${label} ---`, ...body];
}

function capShellOutput(text: string): string {
  if (text.length <= MAX_SHELL_STREAM_CHARS) {
    return text.replace(/\n$/, "");
  }

  const omitted = text.length - MAX_SHELL_STREAM_CHARS;
  const tail = text.slice(-MAX_SHELL_STREAM_CHARS).replace(/^\n?/, "");
  return `... (${omitted} chars omitted) ...\n${tail}`.replace(/\n$/, "");
}

function readShellText(value: Record<string, unknown>): string {
  for (const key of ["text", "content", "data", "stdout", "stderr", "chunk"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return "";
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
