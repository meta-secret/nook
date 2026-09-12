import { LogRecord, LogLevel } from "./logger.js";
export type LogWriter = {
  log: (line?: string) => void;
  write?: (chunk: string) => void;
};
enum LogBlockState {
  Closed,
  Open,
}
enum LinePosition {
  Start,
  Within,
}
export enum StreamEvidence {
  None,
  Seen,
}
class LogStreamCursor {
  constructor(
    private readonly writer: LogWriter,
    private readonly prefix: string,
    private readonly position: LinePosition = LinePosition.Start,
  ) {}
  write(text: string): LogStreamCursor {
    let position = this.position;
    for (const ch of text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")) {
      if (ch === "\n") {
        this.emit("\n");
        position = LinePosition.Start;
        continue;
      }
      if (position === LinePosition.Start) {
        this.emit(this.prefix);
        position = LinePosition.Within;
      }
      this.emit(ch);
    }
    return new LogStreamCursor(this.writer, this.prefix, position);
  }
  finish(): LogStreamCursor {
    if (this.position === LinePosition.Within) this.emit("\n");
    return new LogStreamCursor(this.writer, this.prefix);
  }
  private emit(chunk: string): void {
    if (this.writer.write) this.writer.write(chunk);
    else this.writer.log(chunk);
  }
}
export class AgentTextLog {
  constructor(
    private readonly writer: LogWriter = new ConsoleLogWriter(),
    private readonly state: LogBlockState = LogBlockState.Closed,
    private readonly cursor: LogStreamCursor = new LogStreamCursor(
      writer,
      "    ",
    ),
  ) {}
  write(delta: string): AgentTextLog {
    if (!delta) return this;
    if (this.state === LogBlockState.Closed)
      this.writer.log(
        new LogRecord({
          level: LogLevel.Info,
          component: "ci-agent/cursor/agent",
          message: "agent output",
        }).format(),
      );
    return new AgentTextLog(
      this.writer,
      LogBlockState.Open,
      this.cursor.write(delta),
    );
  }
  closeBlock(): AgentTextLog {
    if (this.state === LogBlockState.Closed) return this;
    return new AgentTextLog(
      this.writer,
      LogBlockState.Closed,
      this.cursor.finish(),
    );
  }
}
export class ShellStreamLog {
  constructor(
    private readonly writer: LogWriter = new ConsoleLogWriter(),
    private readonly state: LogBlockState = LogBlockState.Closed,
    private readonly evidence: StreamEvidence = StreamEvidence.None,
    private readonly cursor: LogStreamCursor = new LogStreamCursor(
      writer,
      "    | ",
    ),
  ) {}
  observation(): StreamEvidence {
    return this.evidence;
  }
  openBlock(): ShellStreamLog {
    const closed = this.closeBlock();
    return new ShellStreamLog(
      this.writer,
      LogBlockState.Open,
      StreamEvidence.None,
      closed.cursor,
    );
  }
  write(chunk: string): ShellStreamLog {
    if (!chunk || this.state === LogBlockState.Closed) return this;
    if (this.evidence === StreamEvidence.None)
      this.writer.log(
        new LogRecord({
          level: LogLevel.Info,
          component: "ci-agent/cursor/shell",
          message: "output",
        }).format(),
      );
    return new ShellStreamLog(
      this.writer,
      LogBlockState.Open,
      StreamEvidence.Seen,
      this.cursor.write(chunk),
    );
  }
  closeBlock(): ShellStreamLog {
    if (this.state === LogBlockState.Closed) return this;
    return new ShellStreamLog(
      this.writer,
      LogBlockState.Closed,
      this.evidence,
      this.cursor.finish(),
    );
  }
}
class ConsoleLogWriter implements LogWriter {
  log(line = ""): void {
    console.log(line);
  }
  write(chunk: string): void {
    process.stdout.write(chunk);
  }
}
