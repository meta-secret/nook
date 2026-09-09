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
  | { kind: LocalDataResetReadinessKind.Failed; error: string };

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

type BrowserDataDeletionErrors = Error[];

export type LocalDataStorageOperation<T> = {
  readonly generation: string;
  readonly generationChangedMessage: string;
  readonly operation: () => T | Promise<T>;
};

/** Owns this browser host’s resources and interaction lifecycle. */
class BrowserDataLifecycle {
  constructor(private readonly browser: typeof globalThis) {}

  captureLocalDataStorageGeneration(): string {
    return ((v) => (v ? v : ""))(
      this.browser.localStorage.getItem(LOCAL_DATA_STORAGE_GENERATION),
    );
  }

  async runWithLocalDataStorageLock<T>(
    input: LocalDataStorageOperation<T>,
  ): Promise<T> {
    if (!("locks" in this.browser.navigator)) return input.operation();
    const options: LockOptions = { mode: "shared" };
    return this.browser.navigator.locks.request(
      LOCAL_DATA_STORAGE_LOCK,
      options,
      () => {
        if (
          ((v) => (v ? v : ""))(
            this.browser.localStorage.getItem(LOCAL_DATA_STORAGE_GENERATION),
          ) !== input.generation
        ) {
          throw new Error(input.generationChangedMessage);
        }
        return input.operation();
      },
    );
  }

  async runWithExclusiveLocalDataStorageLock<T>(
    operation: () => T | Promise<T>,
  ): Promise<T> {
    if (!("locks" in this.browser.navigator)) {
      throw new Error("Safe cross-tab local data recovery is unavailable");
    }
    const options: LockOptions = { mode: "exclusive" };
    return this.browser.navigator.locks.request(
      LOCAL_DATA_STORAGE_LOCK,
      options,
      async () => {
        try {
          return await operation();
        } finally {
          this.browser.localStorage.setItem(
            LOCAL_DATA_STORAGE_GENERATION,
            this.browser.crypto.randomUUID(),
          );
        }
      },
    );
  }

  private combineErrors(errors: BrowserDataDeletionErrors): Error {
    return new Error(errors.map((error) => error.message).join("; "));
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

  clearTabScopedBrowserData(): void {
    this.browser.sessionStorage.clear();
  }

  private async clearBrowserManagedStorage(): Promise<void> {
    const errors: Error[] = [];
    const operations: Array<() => void | Promise<void>> = [
      () => this.browser.localStorage.clear(),
      () => this.browser.sessionStorage.clear(),
      () => this.clearAccessibleCookies(),
      async () => {
        if (!("caches" in this.browser)) return;
        const cacheNames = await this.browser.caches.keys();
        await Promise.all(
          cacheNames.map((name) => this.browser.caches.delete(name)),
        );
      },
    ];
    for (const operation of operations) {
      try {
        await operation();
      } catch (error) {
        errors.push(browserLogRuntime.runtimeError(error));
      }
    }
    if (errors.length > 0) {
      throw this.combineErrors(errors);
    }
  }

  subscribeToLocalBrowserDataDeletion(
    handler: () => Promise<void>,
  ): () => void {
    if (!("BroadcastChannel" in this.browser)) return () => {};
    const channel = new BroadcastChannel(LOCAL_DATA_RESET_CHANNEL);
    const handledRequests = new Set<string>();

    const handleRequest = async (message: LocalDataResetMessage) => {
      if (
        message.type !== LocalDataResetMessageType.Request ||
        message.senderId === TAB_ID ||
        handledRequests.has(message.requestId)
      ) {
        return;
      }
      handledRequests.add(message.requestId);
      const postMessageArgs: Parameters<typeof channel.postMessage>[0] = {
        type: LocalDataResetMessageType.Seen,
        requestId: message.requestId,
        senderId: message.senderId,
        responderId: TAB_ID,
      } satisfies LocalDataResetMessage;
      channel.postMessage(postMessageArgs);
      try {
        await handler();
        const postMessageArgs2: Parameters<typeof channel.postMessage>[0] = {
          type: LocalDataResetMessageType.Ready,
          requestId: message.requestId,
          senderId: message.senderId,
          responderId: TAB_ID,
          readiness: { kind: LocalDataResetReadinessKind.Ready },
        } satisfies LocalDataResetMessage;
        channel.postMessage(postMessageArgs2);
      } catch (error) {
        const postMessageArgs3: Parameters<typeof channel.postMessage>[0] = {
          type: LocalDataResetMessageType.Ready,
          requestId: message.requestId,
          senderId: message.senderId,
          responderId: TAB_ID,
          readiness: {
            kind: LocalDataResetReadinessKind.Failed,
            error: browserLogRuntime.runtimeError(error).message,
          },
        } satisfies LocalDataResetMessage;
        channel.postMessage(postMessageArgs3);
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
    return () => {
      channel.close();
    };
  }

  requireLocalDataRecoverySupport(): void {
    if (
      !("BroadcastChannel" in this.browser) ||
      !("locks" in this.browser.navigator)
    ) {
      throw new Error("Safe cross-tab local data deletion is unavailable");
    }
  }

  async quiesceOtherTabsForLocalRecovery(): Promise<void> {
    this.requireLocalDataRecoverySupport();
    const request: LocalDataResetRequest = {
      type: LocalDataResetMessageType.Request,
      requestId: this.browser.crypto.randomUUID(),
      senderId: TAB_ID,
    };
    const channel = new BroadcastChannel(LOCAL_DATA_RESET_CHANNEL);
    const seen = new Set<string>();
    const ready = new Map<string, LocalDataResetReadiness>();
    channel.onmessage = (event: MessageEvent<LocalDataResetMessage>) => {
      const message = event.data;
      if (
        message.type === LocalDataResetMessageType.Reload ||
        message.requestId !== request.requestId ||
        message.senderId !== TAB_ID ||
        message.type === LocalDataResetMessageType.Request
      ) {
        return;
      }
      if (message.type === LocalDataResetMessageType.Seen)
        seen.add(message.responderId);
      if (message.type === LocalDataResetMessageType.Ready) {
        ready.set(message.responderId, message.readiness);
      }
    };
    try {
      channel.postMessage(request);

      const waitUntil = Date.now() + 20_000;
      await new Promise((resolve) => setTimeout(resolve, 150));
      while ([...seen].some((tabId) => !ready.has(tabId))) {
        if (Date.now() >= waitUntil) {
          throw new Error("Another Nook tab did not stop local storage work");
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const errors = [...ready.values()]
        .filter(
          (readiness) => readiness.kind === LocalDataResetReadinessKind.Failed,
        )
        .map((readiness) => readiness.error);
      if (errors.length > 0) {
        throw new Error(errors.join("; "));
      }
    } catch (error) {
      try {
        await this.reloadQuiescedTabsAfterLocalRecovery();
      } catch {
        // A peer may already be suspended even when another peer reports a
        // failure. Reload is best-effort because the channel can disappear as a
        // tab or origin is torn down.
      }
      throw error;
    } finally {
      channel.close();
    }
  }

  async reloadQuiescedTabsAfterLocalRecovery(): Promise<void> {
    if (!("BroadcastChannel" in this.browser)) return;
    const channel = new BroadcastChannel(LOCAL_DATA_RESET_CHANNEL);
    try {
      const message: LocalDataResetReload = {
        type: LocalDataResetMessageType.Reload,
        senderId: TAB_ID,
      };
      channel.postMessage(message);
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      channel.close();
    }
  }

  async deleteLocalBrowserData(
    clearNookDatabases: () => Promise<void>,
  ): Promise<void> {
    this.requireLocalDataRecoverySupport();
    await this.quiesceOtherTabsForLocalRecovery();
    try {
      await browserLogRuntime.suspendWasmLogging();
      await this.runWithExclusiveLocalDataStorageLock(async () => {
        const errors: Error[] = [];
        try {
          await clearNookDatabases();
        } catch (error) {
          errors.push(browserLogRuntime.runtimeError(error));
        }
        try {
          await this.clearBrowserManagedStorage();
        } catch (error) {
          errors.push(browserLogRuntime.runtimeError(error));
        }
        if (errors.length > 0) throw this.combineErrors(errors);
      });
    } finally {
      try {
        await this.reloadQuiescedTabsAfterLocalRecovery();
      } catch {
        // Browser cleanup already completed. Peer reload is best-effort because
        // a browser may revoke BroadcastChannel while origin data is cleared.
      }
    }
    this.browser.window.location.replace(
      new ApplicationRoutePresentation("/").appPath(),
    );
  }
}

export const browserDataLifecycle = new BrowserDataLifecycle(globalThis);
