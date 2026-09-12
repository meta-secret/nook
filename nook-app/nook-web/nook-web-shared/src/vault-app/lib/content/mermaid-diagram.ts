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

type MermaidDiagramRendering = {
  readonly source: string;
  readonly theme: MermaidTheme;
};

/** Owns the browser runtime resources shared by these interactions. */
class MermaidRenderer {
  private mermaidModuleCache: MermaidModuleCache = {
    kind: MermaidModuleCacheKind.NotLoaded,
  };
  private async loadMermaid() {
    if (this.mermaidModuleCache.kind === MermaidModuleCacheKind.Loaded) {
      return this.mermaidModuleCache.module.default;
    }
    const loaded = await import("mermaid");
    this.mermaidModuleCache = {
      kind: MermaidModuleCacheKind.Loaded,
      module: loaded,
    };
    return loaded.default;
  }

  async renderMermaidDiagram({
    source,
    theme,
  }: MermaidDiagramRendering): Promise<string> {
    const mermaid = await this.loadMermaid();
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
}

export const mermaidRenderer = new MermaidRenderer();
