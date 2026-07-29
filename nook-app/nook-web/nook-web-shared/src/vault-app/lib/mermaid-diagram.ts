/** Lazy-loaded Mermaid rendering for in-app help diagrams. */

export type MermaidTheme = "light" | "dark";

type MermaidModuleCache =
  | { kind: "not-loaded" }
  | { kind: "loaded"; module: typeof import("mermaid") };

let mermaidModuleCache: MermaidModuleCache = { kind: "not-loaded" };

async function loadMermaid() {
  if (mermaidModuleCache.kind === "loaded") {
    return mermaidModuleCache.module.default;
  }
  const loaded = await import("mermaid");
  mermaidModuleCache = { kind: "loaded", module: loaded };
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
