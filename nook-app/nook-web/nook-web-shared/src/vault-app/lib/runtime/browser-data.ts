import { appPath } from "$lib/content/legal";
import { runtimeError, suspendWasmLogging } from "$lib/runtime/log";

const LOCAL_DATA_RESET_CHANNEL = "nook-local-data-reset";
const TAB_ID = crypto.randomUUID();

enum LocalDataResetMessageType {
  Request = "request",
  Seen = "seen",
  Ready = "ready",
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

type LocalDataResetMessage =
  LocalDataResetRequest | LocalDataResetSeen | LocalDataResetReady;

function combineErrors(errors: Error[]): Error {
  return new Error(errors.map((error) => error.message).join("; "));
}

function visibleCookiePaths(): string[] {
  const paths = new Set<string>(["/"]);
  const addPath = (path: string) => {
    if (!path.startsWith("/")) return;
    paths.add(path);
    paths.add(path.endsWith("/") ? path.slice(0, -1) || "/" : `${path}/`);
  };

  addPath(appPath("/"));
  const segments = window.location.pathname.split("/").filter(Boolean);
  for (let length = 1; length <= segments.length; length += 1) {
    addPath(`/${segments.slice(0, length).join("/")}`);
  }
  return [...paths];
}

function clearAccessibleCookies(): void {
  const paths = visibleCookiePaths();
  const hostname = window.location.hostname.toLowerCase();
  const labels = hostname.split(".").filter(Boolean);
  const domains = new Set<string>();
  if (labels.length === 1) {
    domains.add(hostname);
  } else {
    for (let index = 0; index < labels.length - 1; index += 1) {
      domains.add(labels.slice(index).join("."));
    }
  }
  for (const cookie of document.cookie.split(";")) {
    const separator = cookie.indexOf("=");
    const name = (
      separator === -1 ? cookie : cookie.slice(0, separator)
    ).trim();
    if (!name) continue;
    for (const path of paths) {
      document.cookie = `${name}=; Max-Age=0; Path=${path}; SameSite=Lax`;
      for (const domain of domains) {
        document.cookie = `${name}=; Max-Age=0; Path=${path}; Domain=${domain}; SameSite=Lax`;
      }
    }
  }
}

export function clearTabScopedBrowserData(): void {
  sessionStorage.clear();
}

async function clearBrowserManagedStorage(): Promise<void> {
  const errors: Error[] = [];
  const operations: Array<() => void | Promise<void>> = [
    () => localStorage.clear(),
    () => sessionStorage.clear(),
    () => clearAccessibleCookies(),
    async () => {
      if (!("caches" in globalThis)) return;
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
    },
  ];
  for (const operation of operations) {
    try {
      await operation();
    } catch (error) {
      errors.push(runtimeError(error));
    }
  }
  if (errors.length > 0) {
    throw combineErrors(errors);
  }
}

export function subscribeToLocalBrowserDataDeletion(
  handler: () => Promise<void>,
): () => void {
  if (!("BroadcastChannel" in globalThis)) return () => {};
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
          error: runtimeError(error).message,
        },
      } satisfies LocalDataResetMessage;
      channel.postMessage(postMessageArgs3);
    }
  };

  channel.onmessage = (event: MessageEvent<LocalDataResetMessage>) => {
    void handleRequest(event.data);
  };
  return () => {
    channel.close();
  };
}

async function quiesceOtherTabs(): Promise<void> {
  if (!("BroadcastChannel" in globalThis)) {
    throw new Error("Safe cross-tab local data deletion is unavailable");
  }
  const request: LocalDataResetRequest = {
    type: LocalDataResetMessageType.Request,
    requestId: crypto.randomUUID(),
    senderId: TAB_ID,
  };
  const channel = new BroadcastChannel(LOCAL_DATA_RESET_CHANNEL);
  const seen = new Set<string>();
  const ready = new Map<string, LocalDataResetReadiness>();
  channel.onmessage = (event: MessageEvent<LocalDataResetMessage>) => {
    const message = event.data;
    if (
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
  channel.postMessage(request);

  const waitUntil = Date.now() + 20_000;
  await new Promise((resolve) => setTimeout(resolve, 150));
  while ([...seen].some((tabId) => !ready.has(tabId))) {
    if (Date.now() >= waitUntil) {
      channel.close();
      throw new Error("Another Nook tab did not stop local storage work");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  channel.close();
  const errors = [...ready.values()]
    .filter(
      (readiness) => readiness.kind === LocalDataResetReadinessKind.Failed,
    )
    .map((readiness) => readiness.error);
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
}

/**
 * Delete the complete Nook working copy from this browser.
 *
 * Rust owns the Nook database list and zeroizes the active session. This thin
 * browser adapter clears origin storage APIs that are only available in JS.
 */
export async function deleteLocalBrowserData(
  clearNookDatabases: () => Promise<void>,
): Promise<void> {
  const errors: Error[] = [];
  await suspendWasmLogging();
  await quiesceOtherTabs();
  try {
    await clearNookDatabases();
  } catch (error) {
    errors.push(runtimeError(error));
  }
  try {
    await clearBrowserManagedStorage();
  } catch (error) {
    errors.push(runtimeError(error));
  }
  if (errors.length > 0) {
    throw combineErrors(errors);
  }
  window.location.replace(appPath("/"));
}
