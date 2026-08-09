/** Lazy-loaded Mermaid rendering for in-app help diagrams. */

export enum MermaidTheme {
  Light = "light",
  Dark = "dark",
}

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

export async function renderMermaidDiagram({
  source,
  theme,
}: {
  readonly source: string;
  readonly theme: MermaidTheme;
}): Promise<string> {
  const mermaid = await loadMermaid();
  const initializeArgs: Parameters<typeof mermaid.initialize>[0] = {
    startOnLoad: false,
    theme: theme === MermaidTheme.Dark ? "dark" : "default",
    securityLevel: "strict",
    fontFamily: "inherit",
  };
  mermaid.initialize(initializeArgs);

  const id = `nook-mermaid-${crypto.randomUUID()}`;
  const { svg } = await mermaid.render(id, source.trim());
  return svg;
}
