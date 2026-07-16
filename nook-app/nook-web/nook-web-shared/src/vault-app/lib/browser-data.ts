import { appPath } from "$lib/legal-content";
import { suspendWasmLogging } from "$lib/log";

const LOCAL_DATA_RESET_CHANNEL = "nook-local-data-reset";
const TAB_ID = crypto.randomUUID();

type LocalDataResetMessage = {
  type: "request" | "seen" | "ready";
  requestId: string;
  senderId: string;
  responderId?: string;
  error?: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function combineErrors(errors: unknown[]): Error {
  return new Error(errors.map(errorMessage).join("; "));
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
  const errors: unknown[] = [];
  const operations: Array<() => void | Promise<void>> = [
    () => localStorage.clear(),
    () => sessionStorage.clear(),
    () => clearAccessibleCookies(),
    async () => {
      if (typeof caches === "undefined") return;
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
    },
  ];
  for (const operation of operations) {
    try {
      await operation();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw combineErrors(errors);
  }
}

export function subscribeToLocalBrowserDataDeletion(
  handler: () => Promise<void>,
): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(LOCAL_DATA_RESET_CHANNEL);
  const handledRequests = new Set<string>();

  const handleRequest = async (message: LocalDataResetMessage) => {
    if (
      message.type !== "request" ||
      message.senderId === TAB_ID ||
      handledRequests.has(message.requestId)
    ) {
      return;
    }
    handledRequests.add(message.requestId);
    channel.postMessage({
      type: "seen",
      requestId: message.requestId,
      senderId: message.senderId,
      responderId: TAB_ID,
    } satisfies LocalDataResetMessage);
    try {
      await handler();
      channel.postMessage({
        type: "ready",
        requestId: message.requestId,
        senderId: message.senderId,
        responderId: TAB_ID,
      } satisfies LocalDataResetMessage);
    } catch (error) {
      channel.postMessage({
        type: "ready",
        requestId: message.requestId,
        senderId: message.senderId,
        responderId: TAB_ID,
        error: errorMessage(error),
      } satisfies LocalDataResetMessage);
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
  if (typeof BroadcastChannel === "undefined") {
    throw new Error("Safe cross-tab local data deletion is unavailable");
  }
  const request: LocalDataResetMessage = {
    type: "request",
    requestId: crypto.randomUUID(),
    senderId: TAB_ID,
  };
  const channel = new BroadcastChannel(LOCAL_DATA_RESET_CHANNEL);
  const seen = new Set<string>();
  const ready = new Map<string, string | undefined>();
  channel.onmessage = (event: MessageEvent<LocalDataResetMessage>) => {
    const message = event.data;
    if (
      message.requestId !== request.requestId ||
      message.senderId !== TAB_ID ||
      !message.responderId
    ) {
      return;
    }
    if (message.type === "seen") seen.add(message.responderId);
    if (message.type === "ready") {
      ready.set(message.responderId, message.error);
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
  const errors = [...ready.values()].filter(
    (error): error is string => error !== undefined,
  );
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
  const errors: unknown[] = [];
  await suspendWasmLogging();
  await quiesceOtherTabs();
  try {
    await clearNookDatabases();
  } catch (error) {
    errors.push(error);
  }
  try {
    await clearBrowserManagedStorage();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0) {
    throw combineErrors(errors);
  }
  window.location.replace(appPath("/"));
}
