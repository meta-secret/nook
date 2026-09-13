import { readFileSync, writeFileSync } from "node:fs";
import { err, ok, type Result } from "neverthrow";

export enum WssProbeFailureKind {
  Arguments = "arguments",
  Credentials = "credentials",
  Connect = "connect",
  Handshake = "handshake",
  OpenTimeout = "open-timeout",
  Send = "send",
  Receive = "receive",
  Expectation = "expectation",
  Marker = "marker",
  Close = "close",
  Cleanup = "cleanup",
}
export interface WssProbeFailure {
  kind: WssProbeFailureKind;
  message: string;
}
interface NatsAuthorization {
  user: string;
  password: string;
}
interface NatsExpectation {
  pattern: RegExp;
  attempts: number;
  failure: string;
}
type NatsReceiveState =
  | { kind: NatsReceiveKind.Listening; text: string }
  | { kind: NatsReceiveKind.Failed; failure: WssProbeFailure };
enum NatsObservation { Matched = "matched", Waiting = "waiting" }
enum NatsReceiveKind {
  Listening = "listening",
  Failed = "failed",
}

/** Owns the foreign WebSocket callbacks and their bounded observation buffer. */
class NatsWebSocketSession {
  private readonly decoder = new TextDecoder();
  private received: NatsReceiveState = { kind: NatsReceiveKind.Listening, text: "" };
  constructor(private readonly socket: WebSocket) {
    socket.binaryType = "arraybuffer";
    socket.addEventListener("message", this.captureMessage.bind(this));
    socket.addEventListener("error", this.captureFailure.bind(this));
  }

  async authorize(credentials: NatsAuthorization): Promise<Result<void, WssProbeFailure>> {
    const opened = await this.waitUntilOpen();
    if (opened.isErr()) return err(opened.error);
    return this.send(`CONNECT ${JSON.stringify({
      verbose: false, pedantic: false, user: credentials.user,
      pass: credentials.password, lang: "bun", version: "1",
    })}\r\nPING\r\n`);
  }

  async require(expectation: NatsExpectation): Promise<Result<void, WssProbeFailure>> {
    for (let attempt = 0; attempt < expectation.attempts; attempt += 1) {
      const observation = this.observation(expectation.pattern);
      if (observation.isErr()) return err(observation.error);
      if (observation.value === NatsObservation.Matched) return ok();
      await Bun.sleep(50);
    }
    return err({ kind: WssProbeFailureKind.Expectation, message: expectation.failure });
  }

  clear(): void {
    if (this.received.kind === NatsReceiveKind.Listening)
      this.received = { kind: NatsReceiveKind.Listening, text: "" };
  }

  close(): Result<void, WssProbeFailure> {
    try { this.socket.close(); return ok(); }
    catch { return err({ kind: WssProbeFailureKind.Close, message: "WSS close failed" }); }
  }

  send(command: string): Result<void, WssProbeFailure> {
    try { this.socket.send(command); return ok(); }
    catch { return err({ kind: WssProbeFailureKind.Send, message: "WSS send failed" }); }
  }

  private observation(pattern: RegExp): Result<NatsObservation, WssProbeFailure> {
    switch (this.received.kind) {
      case NatsReceiveKind.Failed: return err(this.received.failure);
      case NatsReceiveKind.Listening: return ok(pattern.test(this.received.text) ? NatsObservation.Matched : NatsObservation.Waiting);
    }
  }

  private captureFailure(): void {
    this.received = { kind: NatsReceiveKind.Failed,
      failure: { kind: WssProbeFailureKind.Receive, message: "WSS receive failed" } };
  }

  private captureMessage(event: MessageEvent): void {
    if (this.received.kind === NatsReceiveKind.Failed) return;
    try {
      const text =
        typeof event.data === "string"
          ? event.data
          : event.data instanceof ArrayBuffer || ArrayBuffer.isView(event.data)
            ? this.decoder.decode(event.data)
            : (() => {
                throw new TypeError("Unsupported WSS message data");
              })();
      this.received = { kind: NatsReceiveKind.Listening, text: this.received.text + text };
    } catch { this.captureFailure(); }
  }

  private async waitUntilOpen(): Promise<Result<void, WssProbeFailure>> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (this.socket.readyState === WebSocket.OPEN) return ok();
      if (this.socket.readyState === WebSocket.CLOSING || this.socket.readyState === WebSocket.CLOSED)
        return err({ kind: WssProbeFailureKind.Handshake, message: "WSS handshake failed" });
      await Bun.sleep(100);
    }
    return err({ kind: WssProbeFailureKind.OpenTimeout, message: "WSS open timeout" });
  }
}

class NatsConnectionRequest {
  constructor(private readonly endpoint: string) {}
  open(): Result<NatsWebSocketSession, WssProbeFailure> {
    try { return ok(new NatsWebSocketSession(new WebSocket(this.endpoint, "nats"))); }
    catch { return err({ kind: WssProbeFailureKind.Connect, message: "WSS connection failed" }); }
  }
}

class WssProbeDirectory {
  constructor(private readonly path: string) {}
  credentials(): Result<NatsAuthorization, WssProbeFailure> {
    try {
      return ok({ user: readFileSync(`${this.path}/user`, "utf8").trim(),
        password: readFileSync(`${this.path}/password`, "utf8").trim() });
    } catch {
      return err({ kind: WssProbeFailureKind.Credentials, message: "Unable to read WSS credentials" });
    }
  }
  mark(marker: WssProbeMarker): Result<void, WssProbeFailure> {
    try { writeFileSync(`${this.path}/${marker}`, marker, { mode: 0o600 }); return ok(); }
    catch { return err({ kind: WssProbeFailureKind.Marker, message: `Unable to write ${marker} marker` }); }
  }
}
enum WssProbeMarker { Ready = "ready", Received = "received" }

class AuthorizedNatsProbe {
  constructor(private readonly session: NatsWebSocketSession) {}
  async denied(request: { command: string; pattern: RegExp; failure: string }): Promise<Result<void, WssProbeFailure>> {
    this.session.clear();
    const sent = this.session.send(request.command);
    if (sent.isErr()) return err(sent.error);
    return this.session.require({ pattern: request.pattern, attempts: 100, failure: request.failure });
  }
  async execute(directory: WssProbeDirectory): Promise<Result<void, WssProbeFailure>> {
    const pong = await this.session.require({ pattern: /PONG/, attempts: 100, failure: "NATS PONG timeout" });
    if (pong.isErr()) return err(pong.error);
    for (const request of [
      { command: "PUB default.github-webhook.pr-lifecycle 2\r\n{}\r\n", pattern: /Permissions Violation for Publish/i, failure: "application publish was not denied" },
      { command: "SUB unrelated.subject 91\r\n", pattern: /Permissions Violation for Subscription/i, failure: "unrelated subscription was not denied" },
      { command: "PUB $JS.API.INFO 0\r\n\r\n", pattern: /Permissions Violation for Publish/i, failure: "JetStream API access was not denied" },
    ]) {
      const denied = await this.denied(request);
      if (denied.isErr()) return err(denied.error);
    }
    this.session.clear();
    const subscribed = this.session.send("SUB default.github-webhook.pr-lifecycle 93\r\n");
    if (subscribed.isErr()) return err(subscribed.error);
    const ready = directory.mark(WssProbeMarker.Ready);
    if (ready.isErr()) return err(ready.error);
    const received = await this.session.require({ pattern: /MSG default\.github-webhook\.pr-lifecycle 93/,
      attempts: 1800, failure: "signed GitHub event was not received" });
    if (received.isErr()) return err(received.error);
    return directory.mark(WssProbeMarker.Received);
  }
}

class JetStreamWssCheck {
  constructor(private readonly args: string[]) {}
  async run(): Promise<Result<void, WssProbeFailure>> {
    if (this.args.length !== 4)
      return err({ kind: WssProbeFailureKind.Arguments, message: "usage: jetstream-wss-check.ts <endpoint> <work-directory>" });
    const endpoint = this.args[2];
    const workingDirectory = this.args[3];
    if (!endpoint || !workingDirectory)
      return err({ kind: WssProbeFailureKind.Arguments, message: "usage: jetstream-wss-check.ts <endpoint> <work-directory>" });
    const directory = new WssProbeDirectory(workingDirectory);
    const credentials = directory.credentials();
    if (credentials.isErr()) return err(credentials.error);
    for (const rejected of [{ user: "", password: "" }, { user: "invalid", password: "invalid" }]) {
      const outcome = await this.requireAuthenticationFailure({ endpoint, credentials: rejected });
      if (outcome.isErr()) return err(outcome.error);
    }
    const opened = new NatsConnectionRequest(endpoint).open();
    if (opened.isErr()) return err(opened.error);
    const authorized = await opened.value.authorize(credentials.value);
    const outcome = authorized.isErr() ? err<void, WssProbeFailure>(authorized.error)
      : await new AuthorizedNatsProbe(opened.value).execute(directory);
    const closed = opened.value.close();
    if (outcome.isErr() && closed.isErr()) return err({
      kind: WssProbeFailureKind.Cleanup,
      message: outcome.error.message + "; " + closed.error.message,
    });
    return outcome.isErr() ? outcome : closed;
  }
  private async requireAuthenticationFailure(request: { endpoint: string; credentials: NatsAuthorization }): Promise<Result<void, WssProbeFailure>> {
    const opened = new NatsConnectionRequest(request.endpoint).open();
    if (opened.isErr()) return err(opened.error);
    const authorized = await opened.value.authorize(request.credentials);
    const outcome = authorized.isErr() ? err<void, WssProbeFailure>(authorized.error)
      : await opened.value.require({ pattern: /Authorization Violation/i, attempts: 100, failure: "credential was accepted" });
    const closed = opened.value.close();
    if (outcome.isErr() && closed.isErr()) return err({
      kind: WssProbeFailureKind.Cleanup,
      message: outcome.error.message + "; " + closed.error.message,
    });
    return outcome.isErr() ? outcome : closed;
  }
}

const outcome = await new JetStreamWssCheck(process.argv).run();
if (outcome.isErr()) {
  console.error(outcome.error.message);
  process.exitCode = 1;
}
