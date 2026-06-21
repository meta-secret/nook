export type NookProject = {
  name: string
  purpose: string
  language: string
}

export type NookSnapshot = {
  summary: string
  projects: NookProject[]
}

export async function loadNookSnapshot(): Promise<NookSnapshot> {
  const wasm = await import('./nook-wasm/nook_wasm.js')
  await wasm.default()

  return {
    summary: wasm.projectSummary(),
    projects: JSON.parse(wasm.workspaceProjectsJson()) as NookProject[],
  }
}
