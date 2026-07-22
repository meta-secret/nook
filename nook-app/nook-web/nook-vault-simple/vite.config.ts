import tailwindcss from "@tailwindcss/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";
import {
  vaultAppAliases,
  vaultSpaPlugin,
} from "../nook-web-shared/vite-config";

const simpleAppUrl =
  process.env.VITE_SIMPLE_APP_URL?.trim() || "https://simple.nokey.sh";
const siteUrl = process.env.VITE_SITE_URL?.trim() || "https://nokey.sh";

const simpleSpa = vaultSpaPlugin({
  name: "simple-vault-spa",
  spaPaths: ["/app-logs", "/extension-connect", "/logs", "/privacy", "/terms"],
  outputAliases: ["app-logs", "extension-connect", "logs"],
});

export default defineConfig({
  base: "./",
  define: {
    __NOOK_APP_KIND__: JSON.stringify("simple"),
    __NOOK_WASM_APPLICATION__: JSON.stringify("simple"),
    "import.meta.env.VITE_PUBLIC_APP_URL": JSON.stringify(simpleAppUrl),
    "import.meta.env.VITE_SIMPLE_APP_URL": JSON.stringify(simpleAppUrl),
    "import.meta.env.VITE_SITE_URL": JSON.stringify(siteUrl.replace(/\/$/, "")),
  },
  publicDir: new URL("../nook-web-app/public", import.meta.url).pathname,
  plugins: [tailwindcss(), svelte(), simpleSpa],
  resolve: {
    alias: {
      ...vaultAppAliases(),
    },
  },
  server: { fs: { allow: [".."] } },
});
