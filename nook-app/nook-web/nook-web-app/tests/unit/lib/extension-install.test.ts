import { afterEach, describe, expect, test, vi } from "vitest";
import {
  extensionInstallLandingUrl,
  loadExtensionInstallTarget,
  openExtensionInstallTarget,
  resolveExtensionSetupStatus,
} from "$lib/extension-install";

afterEach(() => {
  document.documentElement.removeAttribute("data-nook-extension-runtime-id");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("extension install target", () => {
  test("falls back to the marketing install landing page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({}),
      })),
    );

    await expect(loadExtensionInstallTarget()).resolves.toEqual({
      installMethod: "manual_zip",
      installUrl: extensionInstallLandingUrl(),
      source: "fallback",
    });
  });

  test("uses production Chrome Web Store metadata when available", async () => {
    const extensionId = "abcdefghijklmnopqrstuvwxyzabcdef";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          channel: "production",
          version: "1.2.3",
          extension_id: extensionId,
          install_method: "chrome_web_store",
          install_url: `https://chromewebstore.google.com/detail/${extensionId}`,
        }),
      })),
    );

    await expect(loadExtensionInstallTarget()).resolves.toEqual({
      installMethod: "chrome_web_store",
      installUrl: `https://chromewebstore.google.com/detail/${extensionId}`,
      channel: "production",
      version: "1.2.3",
      source: "metadata",
    });
  });

  test("opens the resolved install URL", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);

    openExtensionInstallTarget({
      installMethod: "chrome_web_store",
      installUrl: "https://chromewebstore.google.com/detail/abcdefghijklmnopqrstuvwxyzabcdef",
      source: "metadata",
    });

    expect(open).toHaveBeenCalledWith(
      "https://chromewebstore.google.com/detail/abcdefghijklmnopqrstuvwxyzabcdef",
      "_blank",
      "noopener,noreferrer",
    );
  });
});

describe("extension setup status", () => {
  test("reports not_installed when the content-script attribute is missing", async () => {
    await expect(resolveExtensionSetupStatus("store-1")).resolves.toBe(
      "not_installed",
    );
  });

  test("reports installed_unpaired when the extension is present but not paired", async () => {
    document.documentElement.setAttribute(
      "data-nook-extension-runtime-id",
      "extension-1",
    );
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: (
          _extensionId: string,
          message: { payload: { requestId: string; vaultStoreId: string } },
          callback: (response: unknown) => void,
        ) => {
          callback({
            type: "nook:extension-paired-vault-identity-status",
            payload: {
              requestId: message.payload.requestId,
              vaultStoreId: message.payload.vaultStoreId,
              status: "unavailable",
            },
          });
        },
      },
    });

    await expect(resolveExtensionSetupStatus("store-1")).resolves.toBe(
      "installed_unpaired",
    );
  });

  test("reports paired when the extension holds a locked grant", async () => {
    document.documentElement.setAttribute(
      "data-nook-extension-runtime-id",
      "extension-1",
    );
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: (
          _extensionId: string,
          message: { payload: { requestId: string; vaultStoreId: string } },
          callback: (response: unknown) => void,
        ) => {
          callback({
            type: "nook:extension-paired-vault-identity-status",
            payload: {
              requestId: message.payload.requestId,
              vaultStoreId: message.payload.vaultStoreId,
              status: "locked",
            },
          });
        },
      },
    });

    await expect(resolveExtensionSetupStatus("store-1")).resolves.toBe(
      "paired",
    );
  });
});
