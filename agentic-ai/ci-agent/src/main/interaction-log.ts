export type LogWriter = {
  log: (line?: string) => void;
  write?: (chunk: string) => void;
};

const AGENT_PREFIX = "    ";

export class AgentTextLog {
  private open = false;
  private atLineStart = true;

  constructor(private readonly writer: LogWriter = consoleWriter()) {}

  write(delta: string): void {
    if (!delta) {
      return;
    }

    if (!this.open) {
      this.openBlock();
    }

    const text = delta.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    this.streamText(text);
  }

  closeBlock(): void {
    if (!this.open) {
      return;
    }

    if (!this.atLineStart) {
      this.emit("\n");
      this.atLineStart = true;
    }

    this.open = false;
  }

  private openBlock(): void {
    this.writer.log();
    this.writer.log("==> agent");
    this.open = true;
    this.atLineStart = true;
  }

  private streamText(text: string): void {
    for (const ch of text) {
      if (ch === "\n") {
        this.emit("\n");
        this.atLineStart = true;
        continue;
      }

      if (this.atLineStart) {
        this.emit(AGENT_PREFIX);
        this.atLineStart = false;
      }

      this.emit(ch);
    }
  }

  private emit(chunk: string): void {
    if (this.writer.write) {
      this.writer.write(chunk);
      return;
    }
    this.writer.log(chunk);
  }
}

export class ShellStreamLog {
  private open = false;
  private streamed = false;
  private atLineStart = true;

  constructor(private readonly writer: LogWriter = consoleWriter()) {}

  hasStreamed(): boolean {
    return this.streamed;
  }

  openBlock(): void {
    this.closeBlock();
    this.open = true;
    this.streamed = false;
    this.atLineStart = true;
  }

  write(chunk: string): void {
    if (!chunk || !this.open) {
      return;
    }

    if (!this.streamed) {
      this.writer.log("--- output ---");
      this.streamed = true;
    }

    const text = chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    for (const ch of text) {
      if (ch === "\n") {
        this.emit("\n");
        this.atLineStart = true;
        continue;
      }

      if (this.atLineStart) {
        this.emit(`${AGENT_PREFIX}| `);
        this.atLineStart = false;
      }

      this.emit(ch);
    }
  }

  closeBlock(): void {
    if (!this.open) {
      return;
    }

    if (!this.atLineStart) {
      this.emit("\n");
      this.atLineStart = true;
    }

    this.open = false;
  }

  private emit(chunk: string): void {
    if (this.writer.write) {
      this.writer.write(chunk);
      return;
    }
    this.writer.log(chunk);
  }
}

function consoleWriter(): LogWriter {
  return {
    log: (line = "") => {
      console.log(line);
    },
    write: (chunk) => {
      process.stdout.write(chunk);
    },
  };
}
