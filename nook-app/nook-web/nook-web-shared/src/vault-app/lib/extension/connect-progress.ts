import { Effect } from "effect";
import {
  ExtensionConnectStepKind,
  type ExtensionConnectFailureReason,
  type ExtensionConnectStep,
} from "$web-shared/extension/extension-connect-progress";

/**
 * The connect page's long-lived runtime port to the extension that opened
 * it, over the existing externally_connectable channel. The page tells the
 * extension's side panel which step it is on; steps are UI progress only.
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

type ExtensionConnectRuntime = {
  readonly connect?: (extensionId: string) => ExtensionConnectPagePort;
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
};

type ExtensionConnectStepPair = {
  readonly sent: ExtensionConnectStep;
  readonly next: ExtensionConnectStep;
};

type ExtensionConnectReasonPair = {
  readonly sent: ExtensionConnectFailureReason;
  readonly next: ExtensionConnectStep;
};

enum ExtensionConnectStepSameness {
  Same = "same",
  Changed = "changed",
}

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
    const connect = this.host.chrome?.runtime?.connect;
    switch (typeof connect) {
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
    const opened = Effect.runSync(
      Effect.result(Effect.try(() => connect(request.extensionRuntimeId))),
    );
    switch (opened._tag) {
      case "Failure":
        this.link = { kind: ExtensionConnectProgressLinkKind.Ended };
        return;
      case "Success":
        break;
    }
    const port = opened.success;
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

  /** The page's current step; sent while the port is open and changed. */
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
    switch (sent.kind) {
      case ExtensionConnectSentKind.Nothing:
        break;
      case ExtensionConnectSentKind.Sent: {
        const pair: ExtensionConnectStepPair = { sent: sent.step, next: step };
        switch (ExtensionConnectProgress.sameness(pair)) {
          case ExtensionConnectStepSameness.Same:
            return;
          case ExtensionConnectStepSameness.Changed:
            break;
        }
      }
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

  private static sameness(
    pair: ExtensionConnectStepPair,
  ): ExtensionConnectStepSameness {
    const { sent, next } = pair;
    switch (sent.kind === next.kind) {
      case false:
        return ExtensionConnectStepSameness.Changed;
      case true:
        break;
    }
    switch (sent.kind) {
      case ExtensionConnectStepKind.Failed: {
        const reasons: ExtensionConnectReasonPair = { sent: sent.reason, next };
        return ExtensionConnectProgress.reasonSameness(reasons);
      }
      case ExtensionConnectStepKind.Opened:
      case ExtensionConnectStepKind.Unlock:
      case ExtensionConnectStepKind.Choosing:
      case ExtensionConnectStepKind.Creating:
      case ExtensionConnectStepKind.Consent:
      case ExtensionConnectStepKind.Approved:
        return ExtensionConnectStepSameness.Same;
    }
  }

  private static reasonSameness(
    pair: ExtensionConnectReasonPair,
  ): ExtensionConnectStepSameness {
    const { sent, next } = pair;
    switch (next.kind) {
      case ExtensionConnectStepKind.Failed:
        break;
      case ExtensionConnectStepKind.Opened:
      case ExtensionConnectStepKind.Unlock:
      case ExtensionConnectStepKind.Choosing:
      case ExtensionConnectStepKind.Creating:
      case ExtensionConnectStepKind.Consent:
      case ExtensionConnectStepKind.Approved:
        return ExtensionConnectStepSameness.Changed;
    }
    switch (next.reason === sent) {
      case true:
        return ExtensionConnectStepSameness.Same;
      case false:
        return ExtensionConnectStepSameness.Changed;
    }
  }
}

export const extensionConnectProgress = new ExtensionConnectProgress(
  globalThis,
);
