import { err, ok, type Result } from "neverthrow";
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from "$lib/runtime/storage-failure";
import { ApplicationRoutePresentation } from "$lib/content/legal";
import { browserLogRuntime } from "$lib/runtime/log";

const LOCAL_DATA_RESET_CHANNEL = "nook-local-data-reset";

const LOCAL_DATA_STORAGE_LOCK = "nook-local-data-storage";

const LOCAL_DATA_STORAGE_GENERATION = "nook-local-data-storage-generation";

const TAB_ID = crypto.randomUUID();

enum LocalDataResetMessageType {
  Request = "request",
  Seen = "seen",
  Ready = "ready",
  Reload = "reload",
}

type LocalDataResetRequest = {
  type: LocalDataResetMessageType.Request;
  requestId: string;
  senderId: string;
};

type LocalDataResetSeen = {
  type: LocalDataResetMessageType.Seen;
  requestId: string;
  senderId: string;
  responderId: string;
};

enum LocalDataResetReadinessKind {
  Ready = "ready",
  Failed = "failed",
}

type LocalDataResetReadiness =
  | { kind: LocalDataResetReadinessKind.Ready }
  | {
      kind: LocalDataResetReadinessKind.Failed;
      failure: VaultStorageFailureKind;
    };

type LocalDataResetReady = {
  type: LocalDataResetMessageType.Ready;
  requestId: string;
  senderId: string;
  responderId: string;
  readiness: LocalDataResetReadiness;
};

type LocalDataResetReload = {
  type: LocalDataResetMessageType.Reload;
  senderId: string;
};

type LocalDataResetMessage =
  | LocalDataResetRequest
  | LocalDataResetSeen
  | LocalDataResetReady
  | LocalDataResetReload;

export type LocalDataStorageOperation<T, E = never> = {
  readonly generation: string;
  readonly operation: () => Result<T, E> | Promise<Result<T, E>>;
};

/** Owns this browser host’s resources and interaction lifecycle. */
class BrowserDataLifecycle {
  constructor(private readonly browser: typeof globalThis) {}

  captureLocalDataStorageGeneration(): Result<string, VaultStorageFailure> {
    try {
      const generation = this.browser.localStorage.getItem(
        LOCAL_DATA_STORAGE_GENERATION,
      );
      return ok(typeof generation === "string" ? generation : "");
    } catch {
      return err(
        new VaultStorageFailure(VaultStorageFailureKind.GenerationUnavailable),
      );
    }
  }

  async runWithLocalDataStorageLock<T, E = never>(
    input: LocalDataStorageOperation<T, E>,
  ): Promise<Result<T, E | VaultStorageFailure>> {
    const run = () => {
      const generation = this.captureLocalDataStorageGeneration();
      if (generation.isErr()) return err(generation.error);
      if (generation.value !== input.generation)
        return err(
          new VaultStorageFailure(VaultStorageFailureKind.GenerationChanged),
        );
      return input.operation();
    };
    if (!("locks" in this.browser.navigator)) return run();
    try {
      return await this.browser.navigator.locks.request(
        LOCAL_DATA_STORAGE_LOCK,
        // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
        { mode: "shared" },
        run,
      );
    } catch {
      return err(new VaultStorageFailure(VaultStorageFailureKind.LockFailed));
    }
  }

  async runWithExclusiveLocalDataStorageLock<T, E = never>(
    operation: () => Result<T, E> | Promise<Result<T, E>>,
  ): Promise<Result<T, E | VaultStorageFailure>> {
    if (!("locks" in this.browser.navigator))
      return err(
        new VaultStorageFailure(VaultStorageFailureKind.LockUnavailable),
      );
    try {
      return await this.browser.navigator.locks.request(
        LOCAL_DATA_STORAGE_LOCK,
        // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
        { mode: "exclusive" },
        async () => {
          const result = await operation();
          try {
            this.browser.localStorage.setItem(
              LOCAL_DATA_STORAGE_GENERATION,
              this.browser.crypto.randomUUID(),
            );
          } catch {
            return err(
              new VaultStorageFailure(
                VaultStorageFailureKind.GenerationUnavailable,
              ),
            );
          }
          return result;
        },
      );
    } catch {
      return err(new VaultStorageFailure(VaultStorageFailureKind.LockFailed));
    }
  }

  private visibleCookiePaths(): string[] {
    const paths = new Set<string>(["/"]);
    const addPath = (path: string) => {
      if (!path.startsWith("/")) return;
      paths.add(path);
      paths.add(path.endsWith("/") ? path.slice(0, -1) || "/" : `${path}/`);
    };

    addPath(new ApplicationRoutePresentation("/").appPath());
    const segments = this.browser.window.location.pathname
      .split("/")
      .filter(Boolean);
    for (let length = 1; length <= segments.length; length += 1) {
      addPath(`/${segments.slice(0, length).join("/")}`);
    }
    return [...paths];
  }

  private clearAccessibleCookies(): void {
    const paths = this.visibleCookiePaths();
    const hostname = this.browser.window.location.hostname.toLowerCase();
    const labels = hostname.split(".").filter(Boolean);
    const domains = new Set<string>();
    if (labels.length === 1) {
      domains.add(hostname);
    } else {
      for (let index = 0; index < labels.length - 1; index += 1) {
        domains.add(labels.slice(index).join("."));
      }
    }
    for (const cookie of this.browser.document.cookie.split(";")) {
      const separator = cookie.indexOf("=");
      const name = (
        separator === -1 ? cookie : cookie.slice(0, separator)
      ).trim();
      if (!name) continue;
      for (const path of paths) {
        this.browser.document.cookie = `${name}=; Max-Age=0; Path=${path}; SameSite=Lax`;
        for (const domain of domains) {
          this.browser.document.cookie = `${name}=; Max-Age=0; Path=${path}; Domain=${domain}; SameSite=Lax`;
        }
      }
    }
  }

  clearTabScopedBrowserData(): Result<void, VaultStorageFailure> {
    try {
      this.browser.sessionStorage.clear();
      return ok();
    } catch {
      return err(
        new VaultStorageFailure(VaultStorageFailureKind.BrowserCleanupFailed),
      );
    }
  }

  private async clearBrowserManagedStorage(): Promise<
    Result<void, VaultStorageFailure>
  > {
    const failures: VaultStorageFailureKind[] = [];
    const operations: Array<() => void | Promise<void>> = [
      () => this.browser.localStorage.clear(),
      () => this.browser.sessionStorage.clear(),
      () => this.clearAccessibleCookies(),
      async () => {
        if (!("caches" in this.browser)) return;
        const names = await this.browser.caches.keys();
        await Promise.all(
          names.map((name) => this.browser.caches.delete(name)),
        );
      },
    ];
    for (const operation of operations) {
      try {
        await operation();
      } catch {
        failures.push(VaultStorageFailureKind.BrowserCleanupFailed);
      }
    }
    return failures.length
      ? err(
          new VaultStorageFailure(VaultStorageFailureKind.BrowserCleanupFailed),
        )
      : ok();
  }

  subscribeToLocalBrowserDataDeletion(
    handler: () => Promise<Result<void, VaultStorageFailure>>,
  ): Result<() => void, VaultStorageFailure> {
    if (!("BroadcastChannel" in this.browser)) return ok(() => {});
    let channel: BroadcastChannel;
    try {
      channel = new this.browser.BroadcastChannel(LOCAL_DATA_RESET_CHANNEL);
    } catch {
      return err(
        new VaultStorageFailure(VaultStorageFailureKind.BroadcastFailed),
      );
    }
    const handled = new Set<string>();
    const handleRequest = async (message: LocalDataResetMessage) => {
      if (
        message.type !== LocalDataResetMessageType.Request ||
        message.senderId === TAB_ID ||
        handled.has(message.requestId)
      )
        return;
      handled.add(message.requestId);
      try {
        // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
        channel.postMessage({
          type: LocalDataResetMessageType.Seen,
          requestId: message.requestId,
          senderId: message.senderId,
          responderId: TAB_ID,
        } satisfies LocalDataResetMessage);
      } catch {
        browserLogRuntime
          .createLogger("browser-data")
          .warn("Peer storage stop acknowledgement could not be sent");
      }
      const outcome = await handler();
      const readiness: LocalDataResetReadiness = outcome.isOk()
        ? { kind: LocalDataResetReadinessKind.Ready }
        : {
            kind: LocalDataResetReadinessKind.Failed,
            failure: outcome.error.kind,
          };
      try {
        // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
        channel.postMessage({
          type: LocalDataResetMessageType.Ready,
          requestId: message.requestId,
          senderId: message.senderId,
          responderId: TAB_ID,
          readiness,
        } satisfies LocalDataResetMessage);
      } catch {
        /* The requesting tab cannot acknowledge this peer and will fail its deadline. */
      }
    };
    channel.onmessage = (event: MessageEvent<LocalDataResetMessage>) => {
      if (event.data.type === LocalDataResetMessageType.Reload) {
        if (event.data.senderId !== TAB_ID)
          this.browser.window.location.reload();
        return;
      }
      void handleRequest(event.data);
    };
    return ok(() => channel.close());
  }

  requireLocalDataRecoverySupport(): Result<void, VaultStorageFailure> {
    return "BroadcastChannel" in this.browser &&
      "locks" in this.browser.navigator
      ? ok()
      : err(new VaultStorageFailure(VaultStorageFailureKind.LockUnavailable));
  }

  async quiesceOtherTabsForLocalRecovery(): Promise<
    Result<void, VaultStorageFailure>
  > {
    const support = this.requireLocalDataRecoverySupport();
    if (support.isErr()) return err(support.error);
    let channel: BroadcastChannel;
    let request: LocalDataResetRequest;
    try {
      channel = new this.browser.BroadcastChannel(LOCAL_DATA_RESET_CHANNEL);
      request = {
        type: LocalDataResetMessageType.Request,
        requestId: this.browser.crypto.randomUUID(),
        senderId: TAB_ID,
      };
    } catch {
      return err(
        new VaultStorageFailure(VaultStorageFailureKind.BroadcastFailed),
      );
    }
    const seen = new Set<string>();
    const ready = new Map<string, LocalDataResetReadiness>();
    channel.onmessage = (event: MessageEvent<LocalDataResetMessage>) => {
      const message = event.data;
      if (
        message.type === LocalDataResetMessageType.Reload ||
        message.requestId !== request.requestId ||
        message.senderId !== TAB_ID ||
        message.type === LocalDataResetMessageType.Request
      )
        return;
      if (message.type === LocalDataResetMessageType.Seen)
        seen.add(message.responderId);
      if (message.type === LocalDataResetMessageType.Ready)
        ready.set(message.responderId, message.readiness);
    };
    let outcome: Result<void, VaultStorageFailure> = ok();
    try {
      try {
        channel.postMessage(request);
      } catch {
        outcome = err(
          new VaultStorageFailure(VaultStorageFailureKind.BroadcastFailed),
        );
      }
      if (outcome.isOk()) {
        const deadline = Date.now() + 20_000;
        await new Promise((resolve) => setTimeout(resolve, 150));
        while ([...seen].some((tab) => !ready.has(tab))) {
          if (Date.now() >= deadline) {
            outcome = err(
              new VaultStorageFailure(VaultStorageFailureKind.PeerTimeout),
            );
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (
          outcome.isOk() &&
          [...ready.values()].some(
            (value) => value.kind === LocalDataResetReadinessKind.Failed,
          )
        )
          outcome = err(
            new VaultStorageFailure(VaultStorageFailureKind.PeerFailed),
          );
      }
    } finally {
      channel.close();
    }
    if (outcome.isErr()) {
      await this.reloadQuiescedTabsAfterLocalRecovery();
    }
    return outcome;
  }

  async reloadQuiescedTabsAfterLocalRecovery(): Promise<
    Result<void, VaultStorageFailure>
  > {
    if (!("BroadcastChannel" in this.browser)) return ok();
    let channel: BroadcastChannel;
    try {
      channel = new this.browser.BroadcastChannel(LOCAL_DATA_RESET_CHANNEL);
    } catch {
      return err(
        new VaultStorageFailure(VaultStorageFailureKind.BroadcastFailed),
      );
    }
    try {
      // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
      channel.postMessage({
        type: LocalDataResetMessageType.Reload,
        senderId: TAB_ID,
      } satisfies LocalDataResetMessage);
      await new Promise((resolve) => setTimeout(resolve, 50));
      return ok();
    } catch {
      return err(new VaultStorageFailure(VaultStorageFailureKind.ReloadFailed));
    } finally {
      channel.close();
    }
  }

  async deleteLocalBrowserData(
    clearNookDatabases: () => Promise<Result<void, VaultStorageFailure>>,
  ): Promise<Result<void, VaultStorageFailure>> {
    const support = this.requireLocalDataRecoverySupport();
    if (support.isErr()) return err(support.error);
    const peers = await this.quiesceOtherTabsForLocalRecovery();
    if (peers.isErr()) return err(peers.error);
    let outcome: Result<void, VaultStorageFailure>;
    let logging: Result<void, VaultStorageFailure>;
    try {
      await browserLogRuntime.suspendWasmLogging();
      logging = ok();
    } catch {
      logging = err(
        new VaultStorageFailure(VaultStorageFailureKind.LoggingCleanupFailed),
      );
    }
    if (logging.isErr()) outcome = err(logging.error);
    else {
      outcome = await this.runWithExclusiveLocalDataStorageLock(async () => {
        const database = await clearNookDatabases();
        const browser = await this.clearBrowserManagedStorage();
        return database.isErr() ? err(database.error) : browser;
      });
    }
    const reloaded = await this.reloadQuiescedTabsAfterLocalRecovery();
    if (outcome.isErr()) return err(outcome.error);
    if (reloaded.isErr()) return err(reloaded.error);
    try {
      this.browser.window.location.replace(
        new ApplicationRoutePresentation("/").appPath(),
      );
    } catch {
      return err(new VaultStorageFailure(VaultStorageFailureKind.ReloadFailed));
    }
    return ok();
  }
}

export const browserDataLifecycle = new BrowserDataLifecycle(globalThis);
