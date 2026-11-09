import tailwindcss from "@tailwindcss/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import type { UserConfig } from "vite";
import { defineConfig } from "vitest/config";
import {
  VAULT_WORKSPACE_OUTPUT_ALIASES,
  VAULT_WORKSPACE_SPA_PATHS,
  vaultAppAliases,
  vaultSpaPlugin,
  type VaultSpaOptions,
} from "../nook-web-shared/vite-config.ts";

const simpleAppUrl =
  process.env.VITE_SIMPLE_APP_URL?.trim() || "https://simple.nokey.sh";
const siteUrl = process.env.VITE_SITE_URL?.trim() || "https://nokey.sh";

const simpleSpaOptions: VaultSpaOptions = {
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
};
const simpleSpa = vaultSpaPlugin(simpleSpaOptions);

const simpleViteConfig: UserConfig = {
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
  // node_modules is a link to the web app's: an own dependency cache keeps
  // this dev server from optimizing into the cache another app's dev
  // server rewrites at the same time, as the isolation suite starts both.
  cacheDir: new URL("./node_modules/.vite-simple", import.meta.url).pathname,
};

export default defineConfig(simpleViteConfig);
