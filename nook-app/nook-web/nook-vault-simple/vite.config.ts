import tailwindcss from "@tailwindcss/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";
import {
  VAULT_WORKSPACE_OUTPUT_ALIASES,
  VAULT_WORKSPACE_SPA_PATHS,
  vaultAppAliases,
  vaultSpaPlugin,
} from "../nook-web-shared/vite-config";

const simpleAppUrl =
  process.env.VITE_SIMPLE_APP_URL?.trim() || "https://simple.nokey.sh";
const siteUrl = process.env.VITE_SITE_URL?.trim() || "https://nokey.sh";

const simpleSpa = vaultSpaPlugin({
  name: "simple-vault-spa",
  spaPaths: [
    ...VAULT_WORKSPACE_SPA_PATHS,
    "/app-logs",
    "/extension-connect",
    "/logs",
    "/privacy",
    "/terms",
  ],
  outputAliases: [
    ...VAULT_WORKSPACE_OUTPUT_ALIASES,
    "app-logs",
    "extension-connect",
    "logs",
  ],
});

export default defineConfig({
  base: "./",
  define: {
    "import.meta.env.VITE_PUBLIC_APP_URL": JSON.stringify(simpleAppUrl),
    "import.meta.env.VITE_SIMPLE_APP_URL": JSON.stringify(simpleAppUrl),
    "import.meta.env.VITE_SITE_URL": JSON.stringify(siteUrl.replace(/\/$/, "")),
  },
  publicDir: new URL("../nook-web-app/public", import.meta.url).pathname,
  plugins: [tailwindcss(), svelte(), simpleSpa],
  resolve: {
    alias: {
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
