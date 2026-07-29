/** Lazy-loaded Mermaid rendering for in-app help diagrams. */

import {
  EMPTY_VALUE,
  presentValue,
  type ValueState,
} from "../../explicit-state";

export type MermaidTheme = "light" | "dark";

let mermaidModule: ValueState<typeof import("mermaid")> = EMPTY_VALUE;

async function loadMermaid() {
  if (mermaidModule.kind === "present") {
    return mermaidModule.value.default;
  }
  const loaded = await import("mermaid");
  mermaidModule = presentValue(loaded);
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
