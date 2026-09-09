import {readFileSync,writeFileSync} from "node:fs";

class NatsWebSocketSession {
  private readonly decoder = new TextDecoder();
  private received = "";
  private readonly socket: WebSocket;

  private constructor(endpoint: string) {
    this.socket = new WebSocket(endpoint, "nats");
    this.socket.binaryType = "arraybuffer";
    this.socket.addEventListener("message", this.captureMessage.bind(this));
  }

  static async connect(
    endpoint: string,
    user: string,
    password: string,
  ): Promise<NatsWebSocketSession> {
    const session = new NatsWebSocketSession(endpoint);
    await session.waitUntilOpen();
    session.send(
      `CONNECT ${JSON.stringify({
        verbose: false,
        pedantic: false,
        user,
        pass: password,
        lang: "bun",
        version: "1",
      })}\r\nPING\r\n`,
    );
    return session;
  }

  async require(
    pattern: RegExp,
    attempts: number,
    failure: string,
  ): Promise<void> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (pattern.test(this.received)) return;
      await Bun.sleep(50);
    }
    this.close();
    throw new Error(failure);
  }

  clear(): void {
    this.received = "";
  }

  close(): void {
    this.socket.close();
  }

  send(command: string): void {
    this.socket.send(command);
  }

  private captureMessage(event: MessageEvent): void {
    this.received +=
      typeof event.data === "string"
        ? event.data
        : this.decoder.decode(event.data);
  }

  private async waitUntilOpen(): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (this.socket.readyState === WebSocket.OPEN) return;
      if (
        this.socket.readyState === WebSocket.CLOSING ||
        this.socket.readyState === WebSocket.CLOSED
      ) {
        throw new Error("WSS handshake failed");
      }
      await Bun.sleep(100);
    }
    this.close();
    throw new Error("WSS open timeout");
  }
}

class JetStreamWssCheck {
  static async run(args: string[]): Promise<void> {
    if (args.length !== 4) {
      throw new Error(
        "usage: jetstream-wss-check.ts <endpoint> <work-directory>",
      );
    }
    const endpoint = args[2];
    const workDirectory = args[3];
    const user = readFileSync(`${workDirectory}/user`, "utf8").trim();
    const password = readFileSync(`${workDirectory}/password`, "utf8").trim();

    await JetStreamWssCheck.requireAuthenticationFailure(endpoint, "", "");
    await JetStreamWssCheck.requireAuthenticationFailure(
      endpoint,
      "invalid",
      "invalid",
    );

    const valid = await NatsWebSocketSession.connect(endpoint, user, password);
    await valid.require(/PONG/, 100, "NATS PONG timeout");

    valid.clear();
    valid.send("PUB default.github-webhook.pr-lifecycle 2\r\n{}\r\n");
    await valid.require(
      /Permissions Violation for Publish/i,
      100,
      "application publish was not denied",
    );

    valid.clear();
    valid.send("SUB unrelated.subject 91\r\n");
    await valid.require(
      /Permissions Violation for Subscription/i,
      100,
      "unrelated subscription was not denied",
    );

    valid.clear();
    valid.send("PUB $JS.API.INFO 0\r\n\r\n");
    await valid.require(
      /Permissions Violation for Publish/i,
      100,
      "JetStream API access was not denied",
    );

    valid.clear();
    valid.send("SUB default.github-webhook.pr-lifecycle 93\r\n");
    writeFileSync(`${workDirectory}/ready`, "ready", { mode: 0o600 });
    await valid.require(
      /MSG default\.github-webhook\.pr-lifecycle 93/,
      1800,
      "signed GitHub event was not received",
    );
    writeFileSync(`${workDirectory}/received`, "received", { mode: 0o600 });
    valid.close();
  }

  private static async requireAuthenticationFailure(
    endpoint: string,
    user: string,
    password: string,
  ): Promise<void> {
    const session = await NatsWebSocketSession.connect(
      endpoint,
      user,
      password,
    );
    await session.require(
      /Authorization Violation/i,
      100,
      "credential was accepted",
    );
    session.close();
  }
}

await JetStreamWssCheck.run(process.argv);
