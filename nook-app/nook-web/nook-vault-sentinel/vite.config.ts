import tailwindcss from "@tailwindcss/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, type UserConfig } from "vitest/config";
import {
  VAULT_WORKSPACE_OUTPUT_ALIASES,
  VAULT_WORKSPACE_SPA_PATHS,
  vaultAppAliases,
  vaultSpaPlugin,
  type VaultSpaOptions,
} from "../nook-web-shared/vite-config";

const sentinelAppUrl =
  process.env.VITE_SENTINEL_APP_URL?.trim() || "https://sentinel.nokey.sh";
const simpleAppUrl =
  process.env.VITE_SIMPLE_APP_URL?.trim() || "https://simple.nokey.sh";

const sentinelSpaOptions: VaultSpaOptions = {
  name: "sentinel-vault-spa",
  spaPaths: [
    ...VAULT_WORKSPACE_SPA_PATHS,
    "/app-logs",
    "/logs",
    "/privacy",
    "/terms",
  ],
  denyPath: (pathname) => pathname === "/extension-connect",
  outputAliases: [...VAULT_WORKSPACE_OUTPUT_ALIASES, "app-logs", "logs"],
};
const sentinelSpa = vaultSpaPlugin(sentinelSpaOptions);

const sentinelViteConfig: UserConfig = {
  base: "./",
  define: {
    "import.meta.env.VITE_PUBLIC_APP_URL": JSON.stringify(sentinelAppUrl),
    "import.meta.env.VITE_SIMPLE_APP_URL": JSON.stringify(simpleAppUrl),
  },
  publicDir: new URL("../nook-web-app/public", import.meta.url).pathname,
  plugins: [tailwindcss(), svelte(), sentinelSpa],
  resolve: {
    alias: {
      "$lib/extension/connect": new URL(
        "./src/extension-connect-disabled.ts",
        import.meta.url,
      ).pathname,
      "$lib/components/ExtensionConnectConsent.svelte": new URL(
        "./src/ExtensionConnectDisabled.svelte",
        import.meta.url,
      ).pathname,
      ...vaultAppAliases(
        new URL(
          "../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm",
          import.meta.url,
        ).pathname,
      ),
    },
  },
  server: { fs: { allow: [".."] } },
};

export default defineConfig(sentinelViteConfig);
