import { copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, type Plugin } from "vitest/config";
import { vaultAppHeaders } from "../nook-web-shared/src/vault-app/security-headers";

const spaPaths = new Set([
  "/app-logs",
  "/extension-connect",
  "/logs",
  "/privacy",
  "/terms",
]);

function simpleSpa(): Plugin {
  return {
    name: "simple-vault-spa",
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const pathname =
          request.url?.split(/[?#]/, 1)[0]?.replace(/\/$/, "") || "/";
        if (spaPaths.has(pathname)) request.url = "/index.html";
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, _response, next) => {
        const pathname =
          request.url?.split(/[?#]/, 1)[0]?.replace(/\/$/, "") || "/";
        if (spaPaths.has(pathname)) request.url = "/index.html";
        next();
      });
    },
    writeBundle() {
      const outDir = join(process.cwd(), "dist");
      const shell = join(outDir, "index.html");
      copyFileSync(shell, join(outDir, "404.html"));
      for (const alias of ["app-logs", "extension-connect", "logs"]) {
        copyFileSync(shell, join(outDir, `${alias}.html`));
      }
      writeFileSync(join(outDir, "_headers"), vaultAppHeaders());
      writeFileSync(join(outDir, "robots.txt"), "User-agent: *\nDisallow: /\n");
    },
  };
}

export default defineConfig({
  base: "./",
  define: {
    __NOOK_APP_KIND__: JSON.stringify("simple"),
    __NOOK_WASM_APPLICATION__: JSON.stringify("simple"),
    "import.meta.env.VITE_PUBLIC_APP_URL": JSON.stringify(
      "https://simple.nokey.sh",
    ),
  },
  publicDir: new URL("../nook-web-app/public", import.meta.url).pathname,
  plugins: [tailwindcss(), svelte(), simpleSpa()],
  resolve: {
    alias: {
      $lib: new URL("../nook-web-shared/src/vault-app/lib", import.meta.url)
        .pathname,
      "$vault-shared": new URL(
        "../nook-web-shared/src/vault-app",
        import.meta.url,
      ).pathname,
      "$web-shared": new URL("../nook-web-shared/src", import.meta.url)
        .pathname,
      "$app-wasm": new URL(
        "../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm",
        import.meta.url,
      ).pathname,
    },
  },
  server: { fs: { allow: [".."] } },
});
