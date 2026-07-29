/** Lazy-loaded Mermaid rendering for in-app help diagrams. */

export type MermaidTheme = "light" | "dark";

enum MermaidModuleCacheKind {
  NotLoaded = "not-loaded",
  Loaded = "loaded",
}

type MermaidModuleCache =
  | { kind: MermaidModuleCacheKind.NotLoaded }
  | { kind: MermaidModuleCacheKind.Loaded; module: typeof import("mermaid") };

let mermaidModuleCache: MermaidModuleCache = {
  kind: MermaidModuleCacheKind.NotLoaded,
};

async function loadMermaid() {
  if (mermaidModuleCache.kind === MermaidModuleCacheKind.Loaded) {
    return mermaidModuleCache.module.default;
  }
  const loaded = await import("mermaid");
  mermaidModuleCache = { kind: MermaidModuleCacheKind.Loaded, module: loaded };
  return loaded.default;
}

export async function renderMermaidDiagram(
  source: string,
  theme: MermaidTheme,
): Promise<string> {
  const mermaid = await loadMermaid();
  mermaid.initialize({
    startOnLoad: false,
    theme: theme === "dark" ? "dark" : "default",
    securityLevel: "strict",
    fontFamily: "inherit",
  });

  const id = `nook-mermaid-${crypto.randomUUID()}`;
  const { svg } = await mermaid.render(id, source.trim());
  return svg;
}
