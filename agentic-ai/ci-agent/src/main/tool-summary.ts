import type { ToolCall } from "@cursor/sdk";

export class ToolOutputValue {
  constructor(private readonly value: unknown) {}
  formatTaskOutputBlocks(): string[] {
    const value = this.value;

    if (!value || typeof value !== "object") {
      return [];
    }

    const record = value;
    const lines: string[] = [];

    if ("durationMs" in record && typeof record.durationMs === "number") {
      lines.push(`task duration ${record.durationMs}ms`);
    }
    if (
      "resultSuffix" in record &&
      typeof record.resultSuffix === "string" &&
      record.resultSuffix.trim().length > 0
    ) {
      lines.push(
        ...new ToolOutputBlock({
          label: "task result",
          text: record.resultSuffix,
        }).format(),
      );
    }

    return lines;
  }

  formatShellOutputBlocks(): string[] {
    const value = this.value;

    if (!value || typeof value !== "object") {
      return [];
    }

    const lines: string[] = [];

    if (
      "stdout" in value &&
      typeof value.stdout === "string" &&
      value.stdout.length > 0
    ) {
      lines.push(
        ...new ToolOutputBlock({
          label: "stdout",
          text: value.stdout,
        }).format(),
      );
    }
    if (
      "stderr" in value &&
      typeof value.stderr === "string" &&
      value.stderr.length > 0
    ) {
      lines.push(
        ...new ToolOutputBlock({
          label: "stderr",
          text: value.stderr,
        }).format(),
      );
    }

    return lines;
  }

  readShellText(): string {
    const value = this.value;

    if (!value || typeof value !== "object") return "";
    const fields = Object.entries(value);
    for (const key of [
      "text",
      "content",
      "data",
      "output",
      "stdout",
      "stderr",
      "chunk",
      "bytes",
    ]) {
      const entry = fields.find(([name]) => name === key);
      if (!entry) continue;
      const candidate: unknown = entry[1];
      if (typeof candidate === "string" && candidate.length > 0) {
        return candidate;
      }
    }
    return "";
  }

  shellExitCode(): number | string {
    const value = this.value;

    if (value && typeof value === "object" && "exitCode" in value) {
      const exitCode = value.exitCode;
      if (typeof exitCode === "number") {
        return exitCode;
      }
    }
    return "?";
  }
}

export interface ToolOutputTextTruncateRequest {
  readonly max: number;
}

export class ToolOutputText {
  constructor(private readonly value: string) {}
  capShellOutput(): string {
    const text = this.value;

    if (text.length <= MAX_SHELL_STREAM_CHARS) {
      return text.replace(/\n$/, "");
    }

    const omitted = text.length - MAX_SHELL_STREAM_CHARS;
    const tail = text.slice(-MAX_SHELL_STREAM_CHARS).replace(/^\n?/, "");
    return `... (${omitted} chars omitted) ...\n${tail}`.replace(/\n$/, "");
  }

  truncate(request: ToolOutputTextTruncateRequest): string {
    const text = this.value;
    const { max } = request;

    const normalized = text.replace(/\s+/g, " ").trim();
    if (normalized.length <= max) {
      return normalized;
    }
    return `${normalized.slice(0, max - 3)}...`;
  }
}

export class StartedToolCall {
  constructor(private readonly request: ToolCall) {}
  format(): string {
    const toolCall = this.request;

    switch (toolCall.type) {
      case "read":
        return `read ${new DisplayedToolPath(new ToolArgument({ args: toolCall.args, key: "path" }).text()).shorten()}`;
      case "write":
        return `write ${new DisplayedToolPath(new ToolArgument({ args: toolCall.args, key: "path" }).text()).shorten()}`;
      case "edit":
        return `edit ${new DisplayedToolPath(new ToolArgument({ args: toolCall.args, key: "path" }).text()).shorten()}`;
      case "delete":
        return `delete ${new DisplayedToolPath(new ToolArgument({ args: toolCall.args, key: "path" }).text()).shorten()}`;
      case "shell":
        return `shell ${new ToolOutputText(new ToolArgument({ args: toolCall.args, key: "command" }).text()).truncate({ max: 140 })}`;
      case "grep": {
        const pattern = new ToolArgument({
          args: toolCall.args,
          key: "pattern",
        }).text();
        const path = new ToolArgument({
          args: toolCall.args,
          key: "path",
        }).text();
        return path
          ? `grep ${new ToolOutputText(pattern).truncate({ max: 80 })} in ${new DisplayedToolPath(path).shorten()}`
          : `grep ${new ToolOutputText(pattern).truncate({ max: 100 })}`;
      }
      case "glob":
        return `glob ${new ToolArgument({ args: toolCall.args, key: "glob_pattern" }).text()}`;
      case "ls":
        return `ls ${new DisplayedToolPath(new ToolArgument({ args: toolCall.args, key: "path" }).text() || ".").shorten()}`;
      case "semSearch":
        return `search ${new ToolOutputText(new ToolArgument({ args: toolCall.args, key: "query" }).text()).truncate({ max: 100 })}`;
      case "readLints":
        return `lints ${new DisplayedToolPath(new ToolArgument({ args: toolCall.args, key: "path" }).text() || ".").shorten()}`;
      case "task":
        return `task ${new ToolOutputText(new ToolArgument({ args: toolCall.args, key: "description" }).text()).truncate({ max: 100 })}`;
      case "updateTodos":
        return "update todos";
      case "createPlan":
        return `plan ${new ToolOutputText(new ToolArgument({ args: toolCall.args, key: "name" }).text()).truncate({ max: 80 })}`;
      case "generateImage":
        return "generate image";
      case "recordScreen":
        return "record screen";
      case "mcp": {
        const server = new ToolArgument({
          args: toolCall.args,
          key: "server",
        }).text();
        const tool = new ToolArgument({
          args: toolCall.args,
          key: "toolName",
        }).text();
        return server && tool ? `mcp ${server}/${tool}` : "mcp";
      }
    }
  }
}

export interface AgentToolFormatToolCompletedRequest {
  readonly toolCall: ToolCall;
  readonly options?: { includeShellOutput?: boolean };
}

export class CompletedToolCall {
  constructor(private readonly request: AgentToolFormatToolCompletedRequest) {}
  format(): string[] {
    const { toolCall, options = {} } = this.request;

    const [includeShellOutput = true] = [options.includeShellOutput];
    const result = toolCall.result;
    if (!result) {
      return [];
    }

    if (result.status === "error") {
      const message = new ToolFailure(result.error).message();
      return [
        `${toolCall.type} failed: ${new ToolOutputText(message).truncate({ max: 120 })}`,
      ];
    }

    switch (toolCall.type) {
      case "shell": {
        const lines: string[] = [];
        if (includeShellOutput) {
          lines.push(
            ...new ToolOutputValue(result.value).formatShellOutputBlocks(),
          );
        }
        const exitCode = new ToolOutputValue(result.value).shellExitCode();
        lines.push(exitCode === 0 ? "shell exit 0" : `shell exit ${exitCode}`);
        return lines;
      }
      case "task": {
        const lines = ["task done"];
        lines.push(
          ...new ToolOutputValue(result.value).formatTaskOutputBlocks(),
        );
        return lines;
      }
      case "mcp":
        return ["mcp done"];
      case "delete":
      case "edit":
      case "write":
      case "glob":
      case "grep":
      case "read":
      case "ls":
      case "readLints":
      case "generateImage":
      case "semSearch":
      case "recordScreen":
      case "createPlan":
      case "updateTodos":
        return [];
    }
  }
}

export class ShellOutputEvent {
  constructor(private readonly request: unknown) {}
  text(): string {
    const event = this.request;

    if (!event || typeof event !== "object") {
      return "";
    }
    // Host SDK streaming events admit several protobuf envelopes; inspect only text fields.
    const eventRecord = event;

    const direct = new ToolOutputValue(eventRecord).readShellText();
    if (direct) {
      return direct;
    }

    if ("value" in eventRecord) {
      const nested = eventRecord.value;
      if (nested && typeof nested === "object") {
        const fromNested = new ToolOutputValue(nested).readShellText();
        if (fromNested) return fromNested;
      }
      if (
        "case" in eventRecord &&
        typeof eventRecord.case === "string" &&
        (eventRecord.case.includes("stdout") ||
          eventRecord.case.includes("stderr")) &&
        typeof nested === "string"
      )
        return nested;
    }

    return "";
  }
}

interface AgentToolFormatOutputBlockRequest {
  readonly label: string;
  readonly text: string;
}

class ToolOutputBlock {
  constructor(private readonly request: AgentToolFormatOutputBlockRequest) {}
  format(): string[] {
    const { label, text } = this.request;

    const capped = new ToolOutputText(text).capShellOutput();
    const body = capped.split("\n").map((line) => `    ${line}`);
    return [`--- ${label} ---`, ...body];
  }
}

interface AgentToolStringArgRequest {
  readonly args: unknown;
  readonly key: string;
}

class ToolArgument {
  constructor(private readonly request: AgentToolStringArgRequest) {}
  text(): string {
    const { args, key } = this.request;

    if (!args || typeof args !== "object") {
      return "";
    }
    const entry = Object.entries(args).find(([name]) => name === key);
    if (!entry) return "";
    const value: unknown = entry[1];
    return typeof value === "string" ? value : "";
  }
}

class DisplayedToolPath {
  constructor(private readonly request: string) {}
  shorten(): string {
    const path = this.request;

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
}

class ToolFailure {
  constructor(private readonly request: unknown) {}
  message(): string {
    const error = this.request;

    if (error && typeof error === "object" && "message" in error) {
      const message = error.message;
      if (typeof message === "string") {
        return message;
      }
    }
    return "unknown error";
  }
}

const WORKSPACE_PREFIXES = [
  "/home/runner/work/nook/nook/",
  "/meta-secret/nook/",
];

const MAX_SHELL_STREAM_CHARS = 16_000;
