import tailwindcss from "@tailwindcss/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";
import {
  vaultAppAliases,
  vaultSpaPlugin,
} from "../nook-web-shared/vite-config";

const sentinelAppUrl =
  process.env.VITE_SENTINEL_APP_URL?.trim() || "https://sentinel.nokey.sh";
const simpleAppUrl =
  process.env.VITE_SIMPLE_APP_URL?.trim() || "https://simple.nokey.sh";

const sentinelSpa = vaultSpaPlugin({
  name: "sentinel-vault-spa",
  spaPaths: ["/app-logs", "/logs", "/privacy", "/terms"],
  denyPath: (pathname) => pathname === "/extension-connect",
  outputAliases: ["app-logs", "logs"],
});

export default defineConfig({
  base: "./",
  define: {
    __NOOK_APP_KIND__: JSON.stringify("sentinel"),
    __NOOK_WASM_APPLICATION__: JSON.stringify("sentinel"),
    "import.meta.env.VITE_PUBLIC_APP_URL": JSON.stringify(sentinelAppUrl),
    "import.meta.env.VITE_SIMPLE_APP_URL": JSON.stringify(simpleAppUrl),
  },
  publicDir: new URL("../nook-web-app/public", import.meta.url).pathname,
  plugins: [tailwindcss(), svelte(), sentinelSpa],
  resolve: {
    alias: {
      "$lib/extension-connect": new URL(
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
});
