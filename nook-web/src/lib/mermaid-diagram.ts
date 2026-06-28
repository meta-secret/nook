/** Lazy-loaded Mermaid rendering for in-app help diagrams. */

export type MermaidTheme = 'light' | 'dark'

let mermaidModule: typeof import('mermaid') | null = null

async function loadMermaid() {
  if (!mermaidModule) {
    mermaidModule = await import('mermaid')
  }
  return mermaidModule.default
}

export async function renderMermaidDiagram(
  source: string,
  theme: MermaidTheme,
): Promise<string> {
  const mermaid = await loadMermaid()
  mermaid.initialize({
    startOnLoad: false,
    theme: theme === 'dark' ? 'dark' : 'default',
    securityLevel: 'strict',
    fontFamily: 'inherit',
  })

  const id = `nook-mermaid-${crypto.randomUUID()}`
  const { svg } = await mermaid.render(id, source.trim())
  return svg
}
