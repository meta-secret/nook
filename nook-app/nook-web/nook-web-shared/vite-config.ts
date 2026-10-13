import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Connect } from "vite";
import type { Plugin } from "vitest/config";
import { vaultAppHeaders } from "./src/vault-app/security-headers.ts";

export type VaultSpaOptions = {
  name: string;
  spaPaths: readonly string[];
  denyPath?: (pathname: string) => boolean;
  outputAliases: readonly string[];
};

export const VAULT_WORKSPACE_OUTPUT_ALIASES = [
  "admin",
  "devices-access",
  "help",
  "identities",
  "identity/devices",
  "identity/keys",
  "identity/settings",
  "identity/sync",
  "identity/vaults",
  "onboard",
  "settings",
  "vault",
  "vault/devices",
  "vault/import",
  "vault/passwords",
  "vault/sync",
] as const;

/** Copy the app shell to a route alias, creating nested route folders. */
export function writeShellAlias(request: ShellAliasWrite): void {
  const target = join(request.outDir, `${request.alias}.html`);
  const folder: Parameters<typeof mkdirSync>[1] = { recursive: true };
  mkdirSync(dirname(target), folder);
  copyFileSync(request.shell, target);
}

export type ShellAliasWrite = {
  readonly shell: string;
  readonly outDir: string;
  readonly alias: string;
};

export const VAULT_WORKSPACE_SPA_PATHS = VAULT_WORKSPACE_OUTPUT_ALIASES.map(
  (alias) => `/${alias}`,
);

export function vaultSpaPlugin(options: VaultSpaOptions): Plugin {
  const spaPaths = new Set(options.spaPaths);
  const installMiddleware = (middlewares: Connect.Server) => {
    middlewares.use((request, response, next) => {
      const pathname =
        request.url?.split(/[?#]/, 1)[0]?.replace(/\/$/, "") || "/";
      if (options.denyPath?.(pathname)) {
        response.statusCode = 404;
        response.end("Not Found");
        return;
      }
      if (spaPaths.has(pathname)) request.url = "/index.html";
      next();
    });
  };
  return {
    name: options.name,
    transformIndexHtml(_html, context) {
      const vaultWasm = Object.values(
        ((v) => (v ? v : {}))(context.bundle),
      ).find(
        (output) =>
          output.type === "asset" &&
          output.fileName.includes("nook_wasm_bg") &&
          output.fileName.endsWith(".wasm"),
      );
      return vaultWasm
        ? [
            {
              tag: "link",
              attrs: {
                rel: "preload",
                href: `./${vaultWasm.fileName}`,
                as: "fetch",
                type: "application/wasm",
                crossorigin: "anonymous",
              },
              injectTo: "head",
            },
          ]
        : [];
    },
    configureServer(server) {
      installMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      installMiddleware(server.middlewares);
    },
    writeBundle() {
      const outDir = join(process.cwd(), "dist");
      const shell = join(outDir, "index.html");
      copyFileSync(shell, join(outDir, "404.html"));
      for (const alias of options.outputAliases) {
        const aliasWrite: ShellAliasWrite = { shell, outDir, alias };
        writeShellAlias(aliasWrite);
      }
      writeFileSync(join(outDir, "_headers"), vaultAppHeaders());
      writeFileSync(join(outDir, "robots.txt"), "User-agent: *\nDisallow: /\n");
    },
  };
}

export function vaultAppAliases(wasmApplicationPath: string) {
  return {
    $lib: new URL("./src/vault-app/lib", import.meta.url).pathname,
    "$vault-shared": new URL("./src/vault-app", import.meta.url).pathname,
    "$web-shared": new URL("./src", import.meta.url).pathname,
    "$app-wasm": wasmApplicationPath,
  };
}
