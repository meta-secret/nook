export type LogWriter = {
  log: (line?: string) => void;
};

const AGENT_PREFIX = "    ";

export class AgentTextLog {
  private buffer = "";
  private open = false;

  constructor(private readonly writer: LogWriter = consoleWriter()) {}

  write(delta: string): void {
    if (!delta) {
      return;
    }

    if (!this.open) {
      this.openBlock();
    }

    this.buffer += delta.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    this.flushCompleteLines(false);
  }

  closeBlock(): void {
    if (!this.open) {
      return;
    }

    this.flushCompleteLines(true);
    this.open = false;
  }

  private openBlock(): void {
    this.writer.log();
    this.writer.log("==> agent");
    this.open = true;
  }

  private flushCompleteLines(includePartial: boolean): void {
    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline === -1) {
        break;
      }

      this.writeLine(this.buffer.slice(0, newline));
      this.buffer = this.buffer.slice(newline + 1);
    }

    if (includePartial && this.buffer.length > 0) {
      this.writeLine(this.buffer);
      this.buffer = "";
    }
  }

  private writeLine(line: string): void {
    if (line.length === 0) {
      this.writer.log();
      return;
    }
    this.writer.log(`${AGENT_PREFIX}${line}`);
  }
}

export class ShellStreamLog {
  private buffer = "";
  private open = false;
  private streamed = false;

  constructor(private readonly writer: LogWriter = consoleWriter()) {}

  hasStreamed(): boolean {
    return this.streamed;
  }

  openBlock(): void {
    this.closeBlock();
    this.open = true;
    this.streamed = false;
    this.buffer = "";
  }

  write(chunk: string): void {
    if (!chunk || !this.open) {
      return;
    }

    if (!this.streamed) {
      this.writer.log("--- output ---");
    }

    this.streamed = true;
    this.buffer += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline === -1) {
        break;
      }

      this.writeLine(this.buffer.slice(0, newline));
      this.buffer = this.buffer.slice(newline + 1);
    }
  }

  closeBlock(): void {
    if (!this.open) {
      return;
    }

    if (this.buffer.length > 0) {
      this.writeLine(this.buffer);
      this.buffer = "";
    }

    this.open = false;
  }

  private writeLine(line: string): void {
    this.writer.log(`${AGENT_PREFIX}| ${line}`);
  }
}

function consoleWriter(): LogWriter {
  return {
    log: (line = "") => {
      console.log(line);
    },
  };
}
