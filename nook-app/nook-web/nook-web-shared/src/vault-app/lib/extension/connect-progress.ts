import { Effect } from "effect";
import {
  ExtensionConnectFollowKind,
  ExtensionConnectStepKind,
  type ExtensionConnectFailureReason,
  type ExtensionConnectFollow,
  type ExtensionConnectStep,
} from "$web-shared/extension/extension-connect-progress";

/**
 * The connect page's long-lived runtime port to the extension that opened
 * it, over the existing externally_connectable channel. The page tells the
 * extension's side panel which step it is on; steps are UI progress only.
 * The port carries the connect id the side panel named, so that panel can
 * tell it from other pages' ports; a connect URL without one opens no port.
 *
 * The port opens once per page and is never reopened: when no side panel
 * listens, or the panel rejects or closes the port, it simply ends and the
 * page's own create, join and consent flow goes on unaffected. Nothing is
 * retried or polled.
 */
type ExtensionConnectPortDisconnectEvent = {
  readonly addListener: (listener: () => void) => void;
};

/** The part of Chrome's runtime Port the page uses. */
type ExtensionConnectPagePort = {
  readonly postMessage: (message: ExtensionConnectStep) => void;
  readonly disconnect: () => void;
  readonly onDisconnect: ExtensionConnectPortDisconnectEvent;
};

/** Chrome's connect options: the port's name. */
type ExtensionConnectPortInfo = { readonly name: string };

type ExtensionConnectRuntime = {
  readonly connect?: (
    extensionId: string,
    connectInfo: ExtensionConnectPortInfo,
  ) => ExtensionConnectPagePort;
};

/** The browser global; only Chromium exposes chrome.runtime to the page. */
export type ExtensionConnectProgressHost = {
  readonly chrome?: { readonly runtime?: ExtensionConnectRuntime };
};

enum ExtensionConnectProgressLinkKind {
  /** The port has not been opened in this page. */
  Idle = "idle",
  Open = "open",
  /** The port closed; this page does not open another. */
  Ended = "ended",
}

enum ExtensionConnectSentKind {
  Nothing = "nothing",
  Sent = "sent",
}

type ExtensionConnectSent =
  | { readonly kind: ExtensionConnectSentKind.Nothing }
  | {
      readonly kind: ExtensionConnectSentKind.Sent;
      readonly step: ExtensionConnectStep;
    };

enum ExtensionConnectRepetition {
  Repeat = "repeat",
  Changed = "changed",
}

type ExtensionConnectRepeatCheck = {
  readonly sent: ExtensionConnectSent;
  readonly next: ExtensionConnectStep;
};

type ExtensionConnectFailureCheck = {
  readonly sent: ExtensionConnectStep;
  readonly reason: ExtensionConnectFailureReason;
};

type ExtensionConnectProgressLink =
  | { readonly kind: ExtensionConnectProgressLinkKind.Idle }
  | {
      readonly kind: ExtensionConnectProgressLinkKind.Open;
      readonly port: ExtensionConnectPagePort;
      readonly sent: ExtensionConnectSent;
    }
  | { readonly kind: ExtensionConnectProgressLinkKind.Ended };

enum ExtensionConnectCurrentKind {
  None = "none",
  Step = "step",
}

type ExtensionConnectCurrent =
  | { readonly kind: ExtensionConnectCurrentKind.None }
  | {
      readonly kind: ExtensionConnectCurrentKind.Step;
      readonly step: ExtensionConnectStep;
    };

export type ExtensionConnectProgressBegin = {
  /** The extension runtime id the connect URL named. */
  readonly extensionRuntimeId: string;
  /** Whether a side panel follows this page, by its connect id. */
  readonly follow: ExtensionConnectFollow;
};

/** Owns this page's port to the extension and the step it reports. */
export class ExtensionConnectProgress {
  private link: ExtensionConnectProgressLink = {
    kind: ExtensionConnectProgressLinkKind.Idle,
  };
  private current: ExtensionConnectCurrent = {
    kind: ExtensionConnectCurrentKind.None,
  };

  constructor(private readonly host: ExtensionConnectProgressHost) {}

  /** Open the port and say the page opened, then where it is now. */
  begin(request: ExtensionConnectProgressBegin): void {
    switch (this.link.kind) {
      case ExtensionConnectProgressLinkKind.Open:
      case ExtensionConnectProgressLinkKind.Ended:
        return;
      case ExtensionConnectProgressLinkKind.Idle:
        break;
    }
    const { follow } = request;
    switch (follow.kind) {
      case ExtensionConnectFollowKind.Unnamed:
        this.link = { kind: ExtensionConnectProgressLinkKind.Ended };
        return;
      case ExtensionConnectFollowKind.Named:
        break;
    }
    const runtime = this.host.chrome?.runtime;
    switch (typeof runtime?.connect) {
      case "function":
        break;
      // A browser without the extension runtime has no port to open.
      case "undefined":
      case "object":
      case "string":
      case "number":
      case "bigint":
      case "boolean":
      case "symbol":
        this.link = { kind: ExtensionConnectProgressLinkKind.Ended };
        return;
    }
    // Called as a runtime method, as Chrome expects.
    const portInfo: ExtensionConnectPortInfo = { name: follow.connectId };
    const opened = Effect.runSync(
      Effect.result(
        Effect.try(() =>
          runtime?.connect?.(request.extensionRuntimeId, portInfo),
        ),
      ),
    );
    switch (opened._tag) {
      case "Failure":
        this.link = { kind: ExtensionConnectProgressLinkKind.Ended };
        return;
      case "Success":
        break;
    }
    const port = opened.success;
    switch (typeof port) {
      case "object":
        break;
      case "undefined":
      case "string":
      case "number":
      case "bigint":
      case "boolean":
      case "symbol":
      case "function":
        this.link = { kind: ExtensionConnectProgressLinkKind.Ended };
        return;
    }
    port.onDisconnect.addListener(() => this.disconnected(port));
    this.link = {
      kind: ExtensionConnectProgressLinkKind.Open,
      port,
      sent: { kind: ExtensionConnectSentKind.Nothing },
    };
    const openedStep: ExtensionConnectStep = {
      kind: ExtensionConnectStepKind.Opened,
    };
    this.send(openedStep);
    switch (this.current.kind) {
      case ExtensionConnectCurrentKind.None:
        return;
      case ExtensionConnectCurrentKind.Step:
        this.send(this.current.step);
    }
  }

  /** The page's current step; sent while the port is open, unless it is
   * the step just sent. */
  report(step: ExtensionConnectStep): void {
    this.current = { kind: ExtensionConnectCurrentKind.Step, step };
    this.send(step);
  }

  /** The page left the connect route: close the port. */
  end(): void {
    switch (this.link.kind) {
      case ExtensionConnectProgressLinkKind.Idle:
      case ExtensionConnectProgressLinkKind.Ended:
        return;
      case ExtensionConnectProgressLinkKind.Open:
        break;
    }
    const { port } = this.link;
    this.link = { kind: ExtensionConnectProgressLinkKind.Ended };
    port.disconnect();
  }

  private send(step: ExtensionConnectStep): void {
    switch (this.link.kind) {
      case ExtensionConnectProgressLinkKind.Idle:
      case ExtensionConnectProgressLinkKind.Ended:
        return;
      case ExtensionConnectProgressLinkKind.Open:
        break;
    }
    const { port, sent } = this.link;
    const repeat: ExtensionConnectRepeatCheck = { sent, next: step };
    switch (ExtensionConnectProgress.repetition(repeat)) {
      case ExtensionConnectRepetition.Repeat:
        return;
      case ExtensionConnectRepetition.Changed:
        break;
    }
    const posted = Effect.runSync(
      Effect.result(Effect.try(() => port.postMessage(step))),
    );
    switch (posted._tag) {
      case "Failure":
        // Chrome throws on a port that already disconnected.
        this.link = { kind: ExtensionConnectProgressLinkKind.Ended };
        return;
      case "Success":
        this.link = {
          kind: ExtensionConnectProgressLinkKind.Open,
          port,
          sent: { kind: ExtensionConnectSentKind.Sent, step },
        };
    }
  }

  /** The same step as the one just sent adds nothing for the panel. */
  private static repetition(
    check: ExtensionConnectRepeatCheck,
  ): ExtensionConnectRepetition {
    const { sent, next } = check;
    switch (sent.kind) {
      case ExtensionConnectSentKind.Nothing:
        return ExtensionConnectRepetition.Changed;
      case ExtensionConnectSentKind.Sent:
        break;
    }
    switch (next.kind) {
      case ExtensionConnectStepKind.Failed: {
        const failure: ExtensionConnectFailureCheck = {
          sent: sent.step,
          reason: next.reason,
        };
        return ExtensionConnectProgress.failureRepetition(failure);
      }
      case ExtensionConnectStepKind.Opened:
      case ExtensionConnectStepKind.Unlock:
      case ExtensionConnectStepKind.Choosing:
      case ExtensionConnectStepKind.Creating:
      case ExtensionConnectStepKind.Consent:
      case ExtensionConnectStepKind.Approved:
        break;
    }
    switch (sent.step.kind === next.kind) {
      case true:
        return ExtensionConnectRepetition.Repeat;
      case false:
        return ExtensionConnectRepetition.Changed;
    }
  }

  /** A failure repeats only with the same reason. */
  private static failureRepetition(
    check: ExtensionConnectFailureCheck,
  ): ExtensionConnectRepetition {
    const { sent, reason } = check;
    switch (sent.kind) {
      case ExtensionConnectStepKind.Failed:
        break;
      case ExtensionConnectStepKind.Opened:
      case ExtensionConnectStepKind.Unlock:
      case ExtensionConnectStepKind.Choosing:
      case ExtensionConnectStepKind.Creating:
      case ExtensionConnectStepKind.Consent:
      case ExtensionConnectStepKind.Approved:
        return ExtensionConnectRepetition.Changed;
    }
    switch (sent.reason === reason) {
      case true:
        return ExtensionConnectRepetition.Repeat;
      case false:
        return ExtensionConnectRepetition.Changed;
    }
  }

  private disconnected(port: ExtensionConnectPagePort): void {
    // Reading lastError marks Chrome's disconnect reason as handled; a
    // missing receiver is the ordinary case without a side panel.
    const runtime = this.host.chrome?.runtime;
    switch (typeof runtime) {
      case "object":
        void Reflect.get(runtime, "lastError");
        break;
      case "undefined":
      case "string":
      case "number":
      case "bigint":
      case "boolean":
      case "symbol":
      case "function":
        break;
    }
    switch (this.link.kind) {
      case ExtensionConnectProgressLinkKind.Idle:
      case ExtensionConnectProgressLinkKind.Ended:
        return;
      case ExtensionConnectProgressLinkKind.Open:
        break;
    }
    switch (this.link.port === port) {
      case false:
        return;
      case true:
        this.link = { kind: ExtensionConnectProgressLinkKind.Ended };
    }
  }
}

/** The page's global, which carries chrome.runtime only in Chromium; the
 * intersection keeps it assignable where the chrome typings are absent. */
type ExtensionConnectBrowserGlobal = typeof globalThis &
  ExtensionConnectProgressHost;

const browserGlobal: ExtensionConnectBrowserGlobal = globalThis;

export const extensionConnectProgress = new ExtensionConnectProgress(
  browserGlobal,
);
